-- V5-005b part A — V5 workflow wiring: EXTRACTING handoff stage_attempt reset, accept canonical-study-1,
-- READING/acknowledge -> EXTRACTING. Lease for model stages remains 300 s (>= 270 s client + persistence).
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

-- ---------------------------------------------------------------------------
-- study_revisions — V5 canonical payload without study_prompt_preview
-- ---------------------------------------------------------------------------
ALTER TABLE hive.study_revisions ALTER COLUMN study_prompt_preview_id DROP NOT NULL;

ALTER TABLE hive.study_revisions DROP CONSTRAINT IF EXISTS ck_study_revisions__json;
ALTER TABLE hive.study_revisions ADD CONSTRAINT ck_study_revisions__json CHECK (
  jsonb_typeof(investigation) = 'object'
  AND jsonb_typeof(verification) = 'object'
  AND verification ->> 'schema' = 'hive.study-verification/1'
  AND jsonb_typeof(audience_configuration) = 'object'
  AND audience_configuration ->> 'schema' = 'hive.audience-configuration/1'
  AND octet_length(investigation::text) <= 2097152
  AND octet_length(verification::text) <= 262144
  AND (
    (format = 'investigation-1' AND investigation ->> 'schema' = 'hive.study-investigation/1')
    OR (format = 'canonical-study-1' AND investigation ->> 'schema' = 'hive.canonical-study/1')
  )
);

-- ---------------------------------------------------------------------------
-- enforce_processing_run_transition — QUEUED may enter EXTRACTING when snapshot is already frozen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.enforce_processing_run_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.hive_id IS DISTINCT FROM OLD.hive_id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.intent_request_ids IS DISTINCT FROM OLD.intent_request_ids
     OR NEW.intent_snapshot_digest IS DISTINCT FROM OLD.intent_snapshot_digest
     OR NEW.preparation_mode IS DISTINCT FROM OLD.preparation_mode
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;

  IF OLD.source_snapshot IS NOT NULL AND (
       NEW.authorized_source_document_ids IS DISTINCT FROM OLD.authorized_source_document_ids
       OR NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot
       OR NEW.source_snapshot_digest IS DISTINCT FROM OLD.source_snapshot_digest
       OR NEW.coverage_digest IS DISTINCT FROM OLD.coverage_digest
       OR NEW.coverage_complete IS DISTINCT FROM OLD.coverage_complete
       OR NEW.coverage_status IS DISTINCT FROM OLD.coverage_status
       OR NEW.coverage_gaps IS DISTINCT FROM OLD.coverage_gaps
       OR NEW.snapshot_frozen_at IS DISTINCT FROM OLD.snapshot_frozen_at) THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;
  IF OLD.source_snapshot IS NOT NULL AND (
       NEW.coverage_acknowledgement IS DISTINCT FROM OLD.coverage_acknowledgement
       OR NEW.coverage_acknowledged_at IS DISTINCT FROM OLD.coverage_acknowledged_at
       OR NEW.coverage_acknowledged IS DISTINCT FROM OLD.coverage_acknowledged)
     AND NOT (OLD.status = 'AWAITING_ACKNOWLEDGEMENT' AND OLD.coverage_acknowledgement = 'PENDING'
              AND NEW.status IN ('UNDERSTANDING_REQUEST', 'EXTRACTING')
              AND NEW.coverage_acknowledgement = 'OWNER'
              AND NEW.coverage_acknowledged AND NEW.coverage_acknowledged_at IS NOT NULL) THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;

  IF OLD.status IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED') THEN
    RAISE EXCEPTION 'processing_run_finished' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'QUEUED' AND NEW.status IN (
      'READING_DOCUMENTS', 'EXTRACTING', 'UNDERSTANDING_REQUEST', 'NEEDS_CLARIFICATION', 'FAILED'))
    OR (OLD.status = 'READING_DOCUMENTS' AND NEW.status IN ('AWAITING_ACKNOWLEDGEMENT', 'UNDERSTANDING_REQUEST', 'EXTRACTING', 'FAILED'))
    OR (OLD.status = 'AWAITING_ACKNOWLEDGEMENT' AND NEW.status IN ('UNDERSTANDING_REQUEST', 'EXTRACTING', 'FAILED'))
    OR (OLD.status = 'UNDERSTANDING_REQUEST' AND NEW.status IN ('IDENTIFYING_DOMAIN', 'FAILED'))
    OR (OLD.status = 'IDENTIFYING_DOMAIN' AND NEW.status IN ('DEVELOPING_QUESTIONS', 'FAILED'))
    OR (OLD.status = 'DEVELOPING_QUESTIONS' AND NEW.status IN ('PLANNING_INVESTIGATION', 'BUILDING_PROMPT', 'FAILED'))
    OR (OLD.status = 'PLANNING_INVESTIGATION' AND NEW.status IN ('BUILDING_PROMPT', 'FAILED'))
    OR (OLD.status = 'BUILDING_PROMPT' AND NEW.status IN ('SAVING', 'FAILED'))
    OR (OLD.status = 'SAVING' AND NEW.status IN ('INVESTIGATING', 'FAILED'))
    OR (OLD.status = 'INVESTIGATING' AND NEW.status IN ('VERIFYING_EVIDENCE', 'FAILED'))
    OR (OLD.status = 'EXTRACTING' AND NEW.status IN ('EXTRACTING', 'CANONICALIZING', 'FAILED'))
    OR (OLD.status = 'CANONICALIZING' AND NEW.status IN ('ACCEPTING_STUDY', 'FAILED'))
    OR (OLD.status = 'VERIFYING_EVIDENCE' AND NEW.status IN ('ACCEPTING_STUDY', 'FAILED'))
    OR (OLD.status = 'ACCEPTING_STUDY' AND NEW.status IN ('SUCCEEDED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'processing_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- transition_processing_run — freeze on EXTRACTING; per-document stage_attempt reset; canonicalStudy output
-- Stage lease after transition: 300 s for all non-terminal stages (including EXTRACTING, CANONICALIZING, ACCEPTING_STUDY).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_processing_run(
  p_run_id uuid,
  p_from_status text,
  p_to_status text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_to text := upper(btrim(coalesce(p_to_status, '')));
  v_from text := upper(btrim(coalesce(p_from_status, '')));
  v_terminal boolean;
  v_outputs jsonb;
  v_metrics jsonb;
  v_output_key text;
  v_message text;
  v_digest text;
  v_sources jsonb;
  v_freeze boolean := false;
  v_gaps jsonb;
  v_coverage_status text;
  v_acknowledgement text;
  v_acknowledged_at timestamptz;
BEGIN
  PERFORM hive.require_service_role();
  IF jsonb_typeof(v_details) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF v_to = 'SUCCEEDED' THEN
    RAISE EXCEPTION 'processing_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_run.status <> v_from THEN
    RETURN json_build_object('applied', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  v_terminal := v_to IN ('NEEDS_CLARIFICATION', 'FAILED');

  IF v_to <> 'FAILED' AND EXISTS (
    SELECT 1 FROM hive.hives h
     WHERE h.id = v_run.hive_id AND (h.deleting_at IS NOT NULL OR h.archived_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_to IN ('UNDERSTANDING_REQUEST', 'EXTRACTING') AND v_run.source_snapshot IS NULL THEN
    PERFORM hive.expire_stale_document_reads(v_run.hive_id);
    v_sources := hive.compute_study_source_snapshot(v_run.hive_id);
    IF (v_sources ->> 'activeReadCount')::integer > 0 THEN
      RETURN json_build_object('applied', false, 'waiting', true, 'processingRun', hive.processing_run_json(v_run));
    END IF;
    IF jsonb_array_length(v_sources -> 'documents') = 0 THEN
      UPDATE hive.processing_runs
         SET status = 'FAILED',
             error_code = 'COVERAGE_INCOMPLETE',
             error_message_safe = 'We couldn''t read any of your documents. Check the files, then analyze again.',
             failure_diagnostic = jsonb_build_object(
               'contractVersion', 'failure-diagnostic@1',
               'component', 'reader',
               'operation', 'read_documents',
               'task', 'read',
               'stage', 'READING_DOCUMENTS',
               'errorCode', 'COVERAGE_INCOMPLETE',
               'diagnosticReason', 'coverage_incomplete',
               'diagnosticField', NULL,
               'retryable', false,
               'attempt', v_run.stage_attempt
             ),
             retryable = false,
             lease_expires_at = NULL,
             next_dispatch_at = NULL,
             finished_at = now()
       WHERE id = p_run_id
      RETURNING * INTO v_run;
      RETURN json_build_object('applied', false, 'processingRun', hive.processing_run_json(v_run));
    END IF;
    v_gaps := hive.classify_coverage_gaps(v_sources);
    v_coverage_status := hive.coverage_status_for(v_gaps);
    IF v_coverage_status = 'MATERIAL_GAPS'
       AND jsonb_array_length(hive.unacknowledged_material_gaps(v_run.hive_id, v_gaps)) > 0 THEN
      IF (hive.compute_study_intent_snapshot(v_run.hive_id) ->> 'intentSnapshotDigest') = v_run.intent_snapshot_digest THEN
        UPDATE hive.processing_runs
           SET status = 'AWAITING_ACKNOWLEDGEMENT',
               authorized_source_document_ids =
                 ARRAY(SELECT (d ->> 'sourceDocumentId')::uuid FROM jsonb_array_elements(v_sources -> 'documents') d),
               source_snapshot = jsonb_build_object(
                 'documents', v_sources -> 'documents',
                 'excluded', v_sources -> 'excluded',
                 'coverageComplete', v_sources -> 'coverageComplete'),
               source_snapshot_digest = v_sources ->> 'sourceSnapshotDigest',
               coverage_digest = v_sources ->> 'coverageDigest',
               coverage_complete = false,
               coverage_status = v_coverage_status,
               coverage_gaps = v_gaps,
               coverage_acknowledgement = 'PENDING',
               coverage_acknowledged = false,
               snapshot_frozen_at = now(),
               lease_expires_at = NULL,
               next_dispatch_at = NULL
         WHERE id = p_run_id
        RETURNING * INTO v_run;
        RETURN json_build_object('applied', false, 'awaitingAcknowledgement', true,
                                 'processingRun', hive.processing_run_json(v_run));
      END IF;
    END IF;
    IF v_coverage_status = 'MATERIAL_GAPS' THEN
      SELECT CASE WHEN bool_or(a.processing_run_id = v_run.id) THEN 'OWNER' ELSE 'PRIOR' END, max(a.acknowledged_at)
        INTO v_acknowledgement, v_acknowledged_at
        FROM hive.coverage_acknowledgements a
        JOIN jsonb_array_elements(v_gaps) g ON g ->> 'key' = a.gap_key
       WHERE a.hive_id = v_run.hive_id;
    ELSE
      v_acknowledgement := 'NOT_REQUIRED';
      v_acknowledged_at := NULL;
    END IF;
    v_freeze := true;
  END IF;

  IF v_to <> 'FAILED' AND NOT v_freeze AND NOT hive.processing_run_snapshot_current(v_run) THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'SOURCE_CHANGED',
           error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
           failure_diagnostic = jsonb_build_object(
             'contractVersion', 'failure-diagnostic@1',
             'component', 'analysis',
             'operation', 'analyze',
             'task', NULL,
             'stage', v_run.status,
             'errorCode', 'SOURCE_CHANGED',
             'diagnosticReason', 'source_changed',
             'diagnosticField', NULL,
             'retryable', true,
             'attempt', v_run.stage_attempt
           ),
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('applied', false, 'sourceChanged', true,
                             'processingRun', hive.processing_run_json(v_run));
  END IF;
  IF v_freeze AND (hive.compute_study_intent_snapshot(v_run.hive_id) ->> 'intentSnapshotDigest') <> v_run.intent_snapshot_digest THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'SOURCE_CHANGED',
           error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
           failure_diagnostic = jsonb_build_object(
             'contractVersion', 'failure-diagnostic@1',
             'component', 'analysis',
             'operation', 'analyze',
             'task', NULL,
             'stage', v_run.status,
             'errorCode', 'SOURCE_CHANGED',
             'diagnosticReason', 'source_changed',
             'diagnosticField', NULL,
             'retryable', true,
             'attempt', v_run.stage_attempt
           ),
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('applied', false, 'sourceChanged', true,
                             'processingRun', hive.processing_run_json(v_run));
  END IF;

  v_outputs := v_run.stage_outputs;
  IF v_details ? 'stage_outputs' THEN
    IF jsonb_typeof(v_details -> 'stage_outputs') <> 'object' THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
    FOR v_output_key IN SELECT jsonb_object_keys(v_details -> 'stage_outputs') LOOP
      IF v_output_key NOT IN (
           'intentDecomposition', 'domainProposal', 'sampleCoverage', 'intentIntelligence', 'investigationPlan',
           'studyInvestigation', 'canonicalStudy'
         )
         OR jsonb_typeof(v_details -> 'stage_outputs' -> v_output_key) <> 'object' THEN
        RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
      END IF;
      IF v_outputs ? v_output_key THEN
        RAISE EXCEPTION 'stage_output_exists' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    v_outputs := v_outputs || (v_details -> 'stage_outputs');
  END IF;

  v_metrics := v_run.stage_metrics;
  IF v_details ? 'stage_metric' THEN
    IF NOT hive.is_valid_stage_metric(v_details -> 'stage_metric') THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
    v_metrics := v_metrics || jsonb_build_array(v_details -> 'stage_metric');
  END IF;

  IF (v_to = 'IDENTIFYING_DOMAIN' AND NOT v_outputs ? 'intentDecomposition')
     OR (v_to = 'DEVELOPING_QUESTIONS' AND NOT (v_outputs ? 'domainProposal' AND v_outputs ? 'sampleCoverage'))
     OR (v_to = 'PLANNING_INVESTIGATION' AND NOT v_outputs ? 'intentIntelligence')
     OR (v_to = 'BUILDING_PROMPT' AND NOT v_outputs ? 'investigationPlan')
     OR (v_to = 'VERIFYING_EVIDENCE' AND NOT v_outputs ? 'studyInvestigation')
     OR (v_to = 'ACCEPTING_STUDY' AND v_from = 'CANONICALIZING' AND NOT v_outputs ? 'canonicalStudy') THEN
    RAISE EXCEPTION 'stage_output_missing' USING ERRCODE = 'P0001';
  END IF;

  IF v_to = 'INVESTIGATING' THEN
    v_digest := lower(btrim(coalesce(v_details ->> 'prompt_digest', '')));
    IF NOT EXISTS (
      SELECT 1 FROM hive.study_prompt_previews p
       WHERE p.processing_run_id = v_run.id AND p.prompt_digest = v_digest
    ) THEN
      RAISE EXCEPTION 'preview_not_saved' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_message := nullif(left(btrim(coalesce(v_details ->> 'error_message_safe', '')), 300), '');

  UPDATE hive.processing_runs
     SET status = v_to,
         started_at = CASE WHEN v_to IN ('UNDERSTANDING_REQUEST', 'EXTRACTING') THEN coalesce(started_at, now()) ELSE started_at END,
         lease_expires_at = CASE WHEN v_terminal THEN NULL ELSE now() + interval '300 seconds' END,
         next_dispatch_at = CASE WHEN v_terminal THEN NULL ELSE now() + interval '30 seconds' END,
         stage_attempt = CASE
           WHEN v_to <> status THEN 1
           WHEN status = 'EXTRACTING' AND v_to = 'EXTRACTING'
                AND v_details ? 'stage_metric'
                AND (v_details -> 'stage_metric' ->> 'outcome') = 'SUCCEEDED' THEN 1
           ELSE stage_attempt
         END,
         finished_at = CASE WHEN v_terminal THEN now() ELSE NULL END,
         stage_outputs = v_outputs,
         stage_metrics = v_metrics,
         authorized_source_document_ids = CASE WHEN v_freeze
           THEN ARRAY(SELECT (d ->> 'sourceDocumentId')::uuid FROM jsonb_array_elements(v_sources -> 'documents') d)
           ELSE authorized_source_document_ids END,
         source_snapshot = CASE WHEN v_freeze THEN jsonb_build_object(
             'documents', v_sources -> 'documents',
             'excluded', v_sources -> 'excluded',
             'coverageComplete', v_sources -> 'coverageComplete')
           ELSE source_snapshot END,
         source_snapshot_digest = CASE WHEN v_freeze THEN v_sources ->> 'sourceSnapshotDigest' ELSE source_snapshot_digest END,
         coverage_digest = CASE WHEN v_freeze THEN v_sources ->> 'coverageDigest' ELSE coverage_digest END,
         coverage_complete = CASE WHEN v_freeze THEN (v_sources ->> 'coverageComplete')::boolean ELSE coverage_complete END,
         coverage_acknowledged = CASE WHEN v_freeze THEN v_acknowledgement IN ('PRIOR', 'OWNER')
                                      ELSE coverage_acknowledged END,
         coverage_status = CASE WHEN v_freeze THEN v_coverage_status ELSE coverage_status END,
         coverage_gaps = CASE WHEN v_freeze THEN v_gaps ELSE coverage_gaps END,
         coverage_acknowledgement = CASE WHEN v_freeze THEN v_acknowledgement ELSE coverage_acknowledgement END,
         coverage_acknowledged_at = CASE WHEN v_freeze THEN v_acknowledged_at ELSE coverage_acknowledged_at END,
         snapshot_frozen_at = CASE WHEN v_freeze THEN now() ELSE snapshot_frozen_at END,
         error_code = CASE WHEN v_terminal THEN nullif(btrim(v_details ->> 'error_code'), '') ELSE error_code END,
         error_message_safe = CASE WHEN v_terminal THEN v_message ELSE error_message_safe END,
         retryable = CASE WHEN v_terminal THEN (v_details ->> 'retryable')::boolean ELSE retryable END,
         failure_diagnostic = CASE WHEN v_terminal
           THEN coalesce(hive.take_failure_diagnostic(v_details), failure_diagnostic)
           ELSE failure_diagnostic END
   WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN json_build_object('applied', true, 'processingRun', hive.processing_run_json(v_run));
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

-- Owner acknowledged material gaps: resume into the V5 pipeline (EXTRACTING).
CREATE OR REPLACE FUNCTION public.acknowledge_study_coverage(
  p_hive_id uuid,
  p_processing_run_id uuid,
  p_coverage_digest text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run hive.processing_runs%ROWTYPE;
  v_digest text := lower(nullif(btrim(coalesce(p_coverage_digest, '')), ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_processing_run_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
      AND h.owner_user_id = v_uid
      AND h.archived_at IS NULL
      AND h.deleting_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM hive.expire_stale_processing_runs(p_hive_id);

  SELECT * INTO v_run FROM hive.processing_runs
   WHERE id = p_processing_run_id AND hive_id = p_hive_id AND owner_user_id = v_uid
     AND kind = 'STUDY_PREPARATION'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_run.status <> 'AWAITING_ACKNOWLEDGEMENT' THEN
    IF v_run.coverage_acknowledgement = 'OWNER' AND v_run.coverage_digest = v_digest THEN
      RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'resumed', false);
    END IF;
    RAISE EXCEPTION 'processing_run_not_awaiting' USING ERRCODE = 'P0001';
  END IF;
  IF v_digest IS DISTINCT FROM v_run.coverage_digest THEN
    RAISE EXCEPTION 'coverage_unacknowledged' USING ERRCODE = 'P0001';
  END IF;

  IF NOT hive.processing_run_snapshot_current(v_run) THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'SOURCE_CHANGED',
           error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = v_run.id
    RETURNING * INTO v_run;
    RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'resumed', false, 'sourceChanged', true);
  END IF;

  PERFORM hive.record_coverage_acknowledgements(v_run, v_run.coverage_gaps, v_run.coverage_digest);

  UPDATE hive.processing_runs
     SET status = 'EXTRACTING',
         coverage_acknowledgement = 'OWNER',
         coverage_acknowledged = true,
         coverage_acknowledged_at = now(),
         started_at = coalesce(started_at, now()),
         stage_attempt = 1,
         lease_expires_at = NULL,
         next_dispatch_at = now() + interval '30 seconds'
   WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'resumed', true);
END;
$$;

-- accept_study_revision — investigation-1 (legacy) and canonical-study-1 (V5)
CREATE OR REPLACE FUNCTION public.accept_study_revision(p_run_id uuid, p_revision jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_preview hive.study_prompt_previews%ROWTYPE;
  v_study hive.canonical_studies%ROWTYPE;
  v_revision hive.study_revisions%ROWTYPE;
  v_number integer;
  v_metrics jsonb;
  v_documents integer;
  v_findings integer;
  v_format text;
  v_prompt_digest text;
BEGIN
  PERFORM hive.require_service_role();
  IF jsonb_typeof(coalesce(p_revision, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  v_format := coalesce(nullif(btrim(p_revision ->> 'format'), ''), 'investigation-1');
  IF v_format NOT IN ('investigation-1', 'canonical-study-1') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_revision FROM hive.study_revisions WHERE processing_run_id = p_run_id;
  IF FOUND THEN
    IF v_revision.investigation_digest <> lower(coalesce(p_revision ->> 'investigation_digest', '')) THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN json_build_object('created', false, 'studyRevision', hive.study_revision_summary_json(v_revision),
                             'reportRuns', hive.latest_report_runs_json(v_revision.id),
                             'processingRun', hive.processing_run_json(v_run));
  END IF;

  IF v_run.status <> 'ACCEPTING_STUDY' THEN
    RAISE EXCEPTION 'processing_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF NOT hive.processing_run_snapshot_current(v_run) THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'SOURCE_CHANGED',
           error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('created', false, 'sourceChanged', true, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  IF v_format = 'investigation-1' THEN
    SELECT * INTO v_preview FROM hive.study_prompt_previews WHERE processing_run_id = p_run_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'preview_not_saved' USING ERRCODE = 'P0001';
    END IF;
    v_prompt_digest := v_preview.prompt_digest;
  ELSE
    v_prompt_digest := lower(btrim(coalesce(p_revision ->> 'prompt_digest', '')));
    IF v_prompt_digest !~ '^sha256:[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_run.preparation_mode = 'REBUILD' THEN
    IF v_format = 'canonical-study-1' THEN
      v_documents := CASE
        WHEN jsonb_typeof(p_revision -> 'investigation' -> 'documents') = 'array'
          THEN jsonb_array_length(p_revision -> 'investigation' -> 'documents')
        ELSE 0
      END;
      IF v_documents < 1 THEN
        RAISE EXCEPTION 'study_documents_incomplete' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      v_documents := CASE
        WHEN jsonb_typeof(p_revision -> 'investigation' -> 'documents') = 'array'
          THEN jsonb_array_length(p_revision -> 'investigation' -> 'documents')
        ELSE 0
      END;
      v_findings := CASE
        WHEN jsonb_typeof(p_revision -> 'investigation' -> 'documentFindings') = 'array'
          THEN jsonb_array_length(p_revision -> 'investigation' -> 'documentFindings')
        ELSE 0
      END;
      IF v_documents < 1 OR v_findings < 1 THEN
        RAISE EXCEPTION 'study_documents_incomplete' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  INSERT INTO hive.canonical_studies (hive_id, owner_user_id)
  VALUES (v_run.hive_id, v_run.owner_user_id)
  ON CONFLICT ON CONSTRAINT uq_canonical_studies__hive DO NOTHING;
  SELECT * INTO v_study FROM hive.canonical_studies WHERE hive_id = v_run.hive_id FOR UPDATE;

  SELECT coalesce(max(s.revision_number), 0) + 1 INTO v_number
    FROM hive.study_revisions s WHERE s.canonical_study_id = v_study.id;

  INSERT INTO hive.study_revisions (
    canonical_study_id, hive_id, owner_user_id, revision_number, predecessor_revision_id,
    processing_run_id, study_prompt_preview_id, format, investigation, verification, audience_configuration,
    investigation_digest, prompt_digest, source_snapshot_digest, intent_snapshot_digest, coverage_digest,
    coverage_complete, coverage_status, coverage_gaps, coverage_acknowledgement, model_alias, resolved_model
  )
  VALUES (
    v_study.id, v_run.hive_id, v_run.owner_user_id, v_number, v_study.current_revision_id,
    v_run.id,
    CASE WHEN v_format = 'investigation-1' THEN v_preview.id ELSE NULL END,
    v_format,
    p_revision -> 'investigation', p_revision -> 'verification',
    p_revision -> 'audience_configuration',
    lower(p_revision ->> 'investigation_digest'), v_prompt_digest, v_run.source_snapshot_digest,
    v_run.intent_snapshot_digest, v_run.coverage_digest, v_run.coverage_complete,
    v_run.coverage_status, v_run.coverage_gaps, v_run.coverage_acknowledgement,
    nullif(p_revision ->> 'model_alias', ''), nullif(p_revision ->> 'resolved_model', '')
  )
  RETURNING * INTO v_revision;

  UPDATE hive.canonical_studies SET current_revision_id = v_revision.id, updated_at = now() WHERE id = v_study.id;

  IF v_run.preparation_mode IS DISTINCT FROM 'REBUILD' THEN
    INSERT INTO hive.report_runs (hive_id, owner_user_id, study_revision_id, audience, trigger, correlation_id, next_dispatch_at)
    SELECT v_run.hive_id, v_run.owner_user_id, v_revision.id, a.audience, 'STUDY_ACCEPTED', gen_random_uuid(),
           now() + interval '30 seconds'
      FROM (VALUES ('CUSTOMER'), ('PRO')) AS a (audience);
  END IF;

  v_metrics := v_run.stage_metrics;
  IF p_revision ? 'stage_metric' AND hive.is_valid_stage_metric(p_revision -> 'stage_metric') THEN
    v_metrics := v_metrics || jsonb_build_array(p_revision -> 'stage_metric');
  END IF;

  UPDATE hive.processing_runs
     SET status = 'SUCCEEDED',
         stage_metrics = v_metrics,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE id = p_run_id
  RETURNING * INTO v_run;

  IF v_format = 'investigation-1' THEN
    UPDATE hive.study_prompt_previews
       SET superseded_by_run_id = v_run.id
     WHERE hive_id = v_run.hive_id
       AND processing_run_id <> v_run.id
       AND superseded_by_run_id IS NULL;
  END IF;

  RETURN json_build_object('created', true, 'studyRevision', hive.study_revision_summary_json(v_revision),
                           'reportRuns', hive.latest_report_runs_json(v_revision.id),
                           'processingRun', hive.processing_run_json(v_run));
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION hive.study_revision_summary_json(s hive.study_revisions)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT json_build_object(
    'id', s.id,
    'canonicalStudyId', s.canonical_study_id,
    'revisionNumber', s.revision_number,
    'predecessorRevisionId', s.predecessor_revision_id,
    'processingRunId', s.processing_run_id,
    'format', s.format,
    'coverageComplete', s.coverage_complete,
    'coverageStatus', s.coverage_status,
    'coverageGaps', s.coverage_gaps,
    'coverageAcknowledgement', s.coverage_acknowledgement,
    'audienceConfiguration', s.audience_configuration,
    'counts', s.verification -> 'counts',
    'sourceCount', CASE
      WHEN jsonb_typeof(s.investigation -> 'documents') = 'array' THEN jsonb_array_length(s.investigation -> 'documents')
      WHEN jsonb_typeof(s.verification -> 'documentCoverage') = 'array' THEN jsonb_array_length(s.verification -> 'documentCoverage')
      ELSE 0
    END,
    'documentFindingCount', CASE
      WHEN jsonb_typeof(s.verification -> 'counts') = 'object'
           AND coalesce(s.verification -> 'counts' ->> 'documentFindings', '') ~ '^[0-9]+$'
        THEN (s.verification -> 'counts' ->> 'documentFindings')::integer
      WHEN jsonb_typeof(s.investigation -> 'documentFindings') = 'array'
        THEN jsonb_array_length(s.investigation -> 'documentFindings')
      ELSE 0
    END,
    'createdAt', s.created_at
  );
$$;

COMMIT;
