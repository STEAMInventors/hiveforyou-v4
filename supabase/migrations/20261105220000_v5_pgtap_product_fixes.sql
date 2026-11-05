-- V5 pipeline — pgTAP-driven fixes: model-stage lease retries and source-change detection on frozen runs.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_processing_run(p_run_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_attempt integer;
BEGIN
  PERFORM hive.require_service_role();
  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     OR (v_run.lease_expires_at IS NOT NULL AND v_run.lease_expires_at > now())
     OR (v_run.lease_expires_at IS NULL AND v_run.stage_attempt > 1 AND v_run.next_dispatch_at > now()) THEN
    RETURN json_build_object('claimed', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  v_attempt := v_run.stage_attempt + CASE
    WHEN v_run.lease_expires_at IS NOT NULL AND v_run.status <> 'READING_DOCUMENTS' THEN 1 ELSE 0 END;
  IF v_attempt > 3 THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'PREPARATION_INTERRUPTED',
           error_message_safe = 'Analysis stopped before it finished. You can try again.',
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('claimed', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  UPDATE hive.processing_runs
     SET stage_attempt = v_attempt,
         lease_expires_at = now() + interval '300 seconds',
         next_dispatch_at = NULL
   WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN json_build_object('claimed', true, 'processingRun', hive.processing_run_json(v_run));
END;
$$;

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

  IF v_to <> 'FAILED'
     AND v_run.source_snapshot IS NOT NULL
     AND NOT hive.processing_run_snapshot_current(v_run) THEN
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

  IF v_to <> 'FAILED' AND NOT hive.processing_run_snapshot_current(v_run) THEN
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

-- Reuse compatible canonical-study-1 revisions (no study_prompt_preview) when Analyze reports are ready.
CREATE OR REPLACE FUNCTION public.start_study_preparation(
  p_hive_id uuid,
  p_request_id uuid,
  p_correlation_id uuid,
  p_coverage_acknowledgement_digest text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run hive.processing_runs%ROWTYPE;
  v_sources jsonb;
  v_intents jsonb;
  v_ack text := lower(nullif(btrim(coalesce(p_coverage_acknowledgement_digest, '')), ''));
  v_attempt integer;
  v_live integer;
  v_needs_read integer;
  v_no_intent boolean;
  v_queued json := '[]'::json;
  v_queued_reports json := '[]'::json;
  v_gaps jsonb;
  v_known jsonb;
  v_unacked jsonb;
  v_acked_now boolean := false;
  v_coverage_status text;
  v_acknowledgement text;
  v_acknowledged_at timestamptz;
  v_revision hive.study_revisions%ROWTYPE;
  v_report_run hive.report_runs%ROWTYPE;
  v_audience text;
  v_has_valid_report boolean;
  v_queued_report_ids uuid[] := ARRAY[]::uuid[];
  v_customer_ready boolean := false;
  v_pro_ready boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_correlation_id IS NULL THEN
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

  PERFORM hive.expire_stale_document_reads(p_hive_id);
  PERFORM hive.expire_stale_processing_runs(p_hive_id);
  PERFORM hive.expire_stale_report_runs(p_hive_id);

  SELECT * INTO v_run FROM hive.processing_runs
   WHERE owner_user_id = v_uid AND request_id = p_request_id;
  IF FOUND THEN
    IF v_run.hive_id <> p_hive_id THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    SELECT s.* INTO v_revision
      FROM hive.study_revisions s
     WHERE s.processing_run_id = v_run.id;
    IF FOUND THEN
      v_customer_ready := EXISTS (
        SELECT 1 FROM hive.reports p WHERE p.study_revision_id = v_revision.id AND p.audience = 'CUSTOMER'
      );
      v_pro_ready := EXISTS (
        SELECT 1 FROM hive.reports p WHERE p.study_revision_id = v_revision.id AND p.audience = 'PRO'
      );
      RETURN json_build_object(
        'processingRun', hive.processing_run_json(v_run),
        'created', false,
        'reusedStudy', true,
        'reportsReady', (v_customer_ready AND v_pro_ready),
        'studyRevision', hive.study_revision_summary_json(v_revision),
        'reportRuns', hive.latest_report_runs_json(v_revision.id),
        'queuedReadIds', '[]'::json,
        'queuedReportRunIds', '[]'::json
      );
    END IF;
    RETURN json_build_object(
      'processingRun', hive.processing_run_json(v_run),
      'created', false,
      'queuedReadIds', '[]'::json,
      'queuedReportRunIds', '[]'::json
    );
  END IF;

  SELECT * INTO v_report_run FROM hive.report_runs
   WHERE owner_user_id = v_uid AND request_id = p_request_id
   ORDER BY created_at DESC, id DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_report_run.hive_id <> p_hive_id THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_revision FROM hive.study_revisions WHERE id = v_report_run.study_revision_id;
    SELECT * INTO v_run FROM hive.processing_runs WHERE id = v_revision.processing_run_id;
    v_customer_ready := EXISTS (
      SELECT 1 FROM hive.reports p WHERE p.study_revision_id = v_revision.id AND p.audience = 'CUSTOMER'
    );
    v_pro_ready := EXISTS (
      SELECT 1 FROM hive.reports p WHERE p.study_revision_id = v_revision.id AND p.audience = 'PRO'
    );
    RETURN json_build_object(
      'processingRun', hive.processing_run_json(v_run),
      'created', false,
      'reusedStudy', true,
      'reportsReady', (v_customer_ready AND v_pro_ready),
      'studyRevision', hive.study_revision_summary_json(v_revision),
      'reportRuns', hive.latest_report_runs_json(v_revision.id),
      'queuedReadIds', '[]'::json,
      'queuedReportRunIds', '[]'::json
    );
  END IF;

  UPDATE hive.processing_runs r
     SET status = 'FAILED',
         error_code = 'SOURCE_CHANGED',
         error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
         failure_diagnostic = jsonb_build_object(
           'contractVersion', 'failure-diagnostic@1',
           'component', 'analysis',
           'operation', 'analyze',
           'task', NULL,
           'stage', r.status,
           'errorCode', 'SOURCE_CHANGED',
           'diagnosticReason', 'source_changed',
           'diagnosticField', NULL,
           'retryable', true,
           'attempt', r.stage_attempt
         ),
         retryable = true,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.kind = 'STUDY_PREPARATION'
     AND r.status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     AND NOT hive.processing_run_snapshot_current(r);

  SELECT * INTO v_run FROM hive.processing_runs
   WHERE hive_id = p_hive_id
     AND kind = 'STUDY_PREPARATION'
     AND status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED');
  IF FOUND THEN
    RETURN json_build_object(
      'processingRun', hive.processing_run_json(v_run),
      'created', false,
      'queuedReadIds', '[]'::json,
      'queuedReportRunIds', '[]'::json
    );
  END IF;

  SELECT count(*) INTO v_live
    FROM hive.source_documents d
   WHERE d.case_id = p_hive_id AND d.lifecycle_status = 'ACTIVE' AND d.deleted_at IS NULL
     AND d.upload_status = 'UPLOADED';
  IF v_live = 0 THEN
    RAISE EXCEPTION 'no_eligible_documents' USING ERRCODE = 'P0001';
  END IF;

  v_intents := hive.compute_study_intent_snapshot(p_hive_id);
  v_no_intent := jsonb_array_length(v_intents -> 'intentRequestIds') = 0;
  v_sources := hive.compute_study_source_snapshot(p_hive_id);

  SELECT count(*) INTO v_needs_read
    FROM hive.source_documents d
   WHERE d.case_id = p_hive_id AND d.owner_user_id = v_uid
     AND d.lifecycle_status = 'ACTIVE' AND d.deleted_at IS NULL AND d.upload_status = 'UPLOADED'
     AND d.read_status IN ('PENDING', 'FAILED')
     AND NOT EXISTS (
       SELECT 1 FROM hive.document_reads a
        WHERE a.source_document_id = d.id AND a.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')
     );

  IF NOT v_no_intent AND v_needs_read = 0 AND (v_sources ->> 'activeReadCount')::integer = 0
     AND jsonb_array_length(v_sources -> 'documents') = 0 THEN
    RAISE EXCEPTION 'no_eligible_documents' USING ERRCODE = 'P0001';
  END IF;

  v_gaps := hive.classify_coverage_gaps(v_sources);
  SELECT coalesce(jsonb_agg(g ORDER BY g ->> 'key'), '[]'::jsonb) INTO v_known
    FROM jsonb_array_elements(v_gaps) g
   WHERE NOT EXISTS (
     SELECT 1 FROM hive.source_documents d
      WHERE d.id = (g ->> 'sourceDocumentId')::uuid
        AND (d.read_status IN ('PENDING', 'FAILED')
             OR EXISTS (SELECT 1 FROM hive.document_reads a
                         WHERE a.source_document_id = d.id
                           AND a.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')))
   );
  v_unacked := hive.unacknowledged_material_gaps(p_hive_id, v_known);
  IF NOT v_no_intent AND jsonb_array_length(v_unacked) > 0 THEN
    IF v_ack IS DISTINCT FROM (v_sources ->> 'coverageDigest') THEN
      RAISE EXCEPTION 'coverage_unacknowledged' USING ERRCODE = 'P0001';
    END IF;
    v_acked_now := true;
  END IF;

  IF NOT v_no_intent AND v_needs_read = 0 AND (v_sources ->> 'activeReadCount')::integer = 0 THEN
    SELECT s.* INTO v_revision
      FROM hive.study_revisions s
      JOIN hive.processing_runs r ON r.id = s.processing_run_id
      LEFT JOIN hive.study_prompt_previews p ON p.id = s.study_prompt_preview_id
     WHERE s.hive_id = p_hive_id
       AND s.owner_user_id = v_uid
       AND r.status = 'SUCCEEDED'
       AND s.source_snapshot_digest = (v_sources ->> 'sourceSnapshotDigest')
       AND s.intent_snapshot_digest = (v_intents ->> 'intentSnapshotDigest')
       AND s.coverage_digest = (v_sources ->> 'coverageDigest')
       AND (
         s.format = 'canonical-study-1'
         OR (
           p.id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
               FROM jsonb_array_elements(coalesce(p.execution_manifest -> 'bindings', '[]'::jsonb)) b
              WHERE b ->> 'format' IS DISTINCT FROM 'hive.source-page-index/1'
           )
         )
       )
     ORDER BY s.revision_number DESC, s.created_at DESC, s.id DESC
     LIMIT 1;

    IF FOUND THEN
      SELECT * INTO v_run FROM hive.processing_runs WHERE id = v_revision.processing_run_id;

      IF v_acked_now THEN
        PERFORM hive.record_coverage_acknowledgements(v_run, v_unacked, v_sources ->> 'coverageDigest');
      END IF;

      UPDATE hive.canonical_studies c
         SET current_revision_id = v_revision.id,
             updated_at = now()
       WHERE c.hive_id = p_hive_id
         AND c.owner_user_id = v_uid
         AND c.current_revision_id IS DISTINCT FROM v_revision.id
         AND NOT EXISTS (
           SELECT 1 FROM hive.study_revisions newer
            WHERE newer.id = c.current_revision_id
              AND newer.revision_number > v_revision.revision_number
         );

      FOREACH v_audience IN ARRAY ARRAY['CUSTOMER', 'PRO'] LOOP
        v_has_valid_report := EXISTS (
          SELECT 1
            FROM hive.reports rep
            JOIN hive.report_runs rr ON rr.id = rep.report_run_id
           WHERE rep.hive_id = p_hive_id
             AND rep.owner_user_id = v_uid
             AND rep.study_revision_id = v_revision.id
             AND rep.audience = v_audience
             AND rr.status = 'SUCCEEDED'
        );

        IF v_has_valid_report THEN
          IF v_audience = 'CUSTOMER' THEN
            v_customer_ready := true;
          ELSE
            v_pro_ready := true;
          END IF;
        ELSE
          SELECT * INTO v_report_run
            FROM hive.report_runs rr
           WHERE rr.hive_id = p_hive_id
             AND rr.owner_user_id = v_uid
             AND rr.study_revision_id = v_revision.id
             AND rr.audience = v_audience
             AND rr.status NOT IN ('SUCCEEDED', 'FAILED')
           ORDER BY rr.created_at DESC, rr.id DESC
           LIMIT 1;

          IF NOT FOUND THEN
            INSERT INTO hive.report_runs (
              hive_id, owner_user_id, study_revision_id, audience, trigger, request_id, correlation_id, next_dispatch_at
            )
            VALUES (
              p_hive_id, v_uid, v_revision.id, v_audience, 'OWNER_GENERATE', p_request_id, p_correlation_id,
              now() + interval '30 seconds'
            )
            ON CONFLICT DO NOTHING
            RETURNING * INTO v_report_run;

            IF FOUND THEN
              v_queued_report_ids := array_append(v_queued_report_ids, v_report_run.id);
            END IF;
          ELSIF v_report_run.status = 'QUEUED'
                AND v_report_run.attempt_count = 0
                AND v_report_run.lease_expires_at IS NULL THEN
            v_queued_report_ids := array_append(v_queued_report_ids, v_report_run.id);
          END IF;
        END IF;
      END LOOP;

      SELECT coalesce(json_agg(x), '[]'::json) INTO v_queued_reports
        FROM unnest(v_queued_report_ids) AS x;

      RETURN json_build_object(
        'processingRun', hive.processing_run_json(v_run),
        'created', false,
        'reusedStudy', true,
        'reportsReady', (v_customer_ready AND v_pro_ready),
        'studyRevision', hive.study_revision_summary_json(v_revision),
        'reportRuns', hive.latest_report_runs_json(v_revision.id),
        'queuedReadIds', '[]'::json,
        'queuedReportRunIds', v_queued_reports
      );
    END IF;
  END IF;

  SELECT coalesce(max(r.attempt_number), 0) + 1 INTO v_attempt
    FROM hive.processing_runs r
   WHERE r.hive_id = p_hive_id AND r.kind = 'STUDY_PREPARATION';

  IF v_no_intent THEN
    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      intent_request_ids, intent_snapshot_digest,
      error_code, error_message_safe, retryable, finished_at
    )
    VALUES (
      p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt, 'NEEDS_CLARIFICATION', p_correlation_id,
      ARRAY[]::uuid[], v_intents ->> 'intentSnapshotDigest',
      'INTENT_MISSING', 'Tell us what you want to understand from these documents, then analyze again.', true, now()
    )
    RETURNING * INTO v_run;
  ELSIF v_needs_read > 0 OR (v_sources ->> 'activeReadCount')::integer > 0 THEN
    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      intent_request_ids, intent_snapshot_digest, next_dispatch_at
    )
    VALUES (
      p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt, 'READING_DOCUMENTS', p_correlation_id,
      ARRAY(SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_intents -> 'intentRequestIds') x),
      v_intents ->> 'intentSnapshotDigest',
      now() + interval '30 seconds'
    )
    RETURNING * INTO v_run;

    INSERT INTO hive.document_reads (
      hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
      lease_expires_at
    )
    SELECT p_hive_id, v_uid, d.id, p_request_id,
           coalesce((SELECT max(r.attempt_number) FROM hive.document_reads r WHERE r.source_document_id = d.id), 0) + 1,
           'QUEUED', p_correlation_id, now() + interval '330 seconds'
      FROM hive.source_documents d
     WHERE d.case_id = p_hive_id AND d.owner_user_id = v_uid
       AND d.lifecycle_status = 'ACTIVE' AND d.deleted_at IS NULL AND d.upload_status = 'UPLOADED'
       AND d.read_status IN ('PENDING', 'FAILED')
       AND NOT EXISTS (
         SELECT 1 FROM hive.document_reads a
          WHERE a.source_document_id = d.id AND a.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')
       )
     ORDER BY d.created_at, d.id
    ON CONFLICT DO NOTHING;

    SELECT coalesce(json_agg(r.id ORDER BY r.created_at, r.id), '[]'::json) INTO v_queued
      FROM hive.document_reads r
     WHERE r.hive_id = p_hive_id AND r.request_id = p_request_id AND r.status = 'QUEUED';
  ELSE
    v_coverage_status := hive.coverage_status_for(v_gaps);
    IF v_coverage_status <> 'MATERIAL_GAPS' THEN
      v_acknowledgement := 'NOT_REQUIRED';
    ELSIF v_acked_now THEN
      v_acknowledgement := 'OWNER';
      v_acknowledged_at := now();
    ELSE
      v_acknowledgement := 'PRIOR';
      SELECT max(a.acknowledged_at) INTO v_acknowledged_at
        FROM hive.coverage_acknowledgements a
        JOIN jsonb_array_elements(v_gaps) g ON g ->> 'key' = a.gap_key
       WHERE a.hive_id = p_hive_id;
    END IF;

    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      authorized_source_document_ids, intent_request_ids, source_snapshot,
      source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
      coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement, coverage_acknowledged_at,
      snapshot_frozen_at, next_dispatch_at
    )
    VALUES (
      p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt, 'QUEUED', p_correlation_id,
      ARRAY(SELECT (d ->> 'sourceDocumentId')::uuid FROM jsonb_array_elements(v_sources -> 'documents') d),
      ARRAY(SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_intents -> 'intentRequestIds') x),
      jsonb_build_object(
        'documents', v_sources -> 'documents',
        'excluded', v_sources -> 'excluded',
        'coverageComplete', v_sources -> 'coverageComplete'
      ),
      v_sources ->> 'sourceSnapshotDigest',
      v_intents ->> 'intentSnapshotDigest',
      v_sources ->> 'coverageDigest',
      (v_sources ->> 'coverageComplete')::boolean,
      v_acknowledgement IN ('PRIOR', 'OWNER'),
      v_coverage_status,
      v_gaps,
      v_acknowledgement,
      v_acknowledged_at,
      now(),
      now() + interval '30 seconds'
    )
    RETURNING * INTO v_run;
  END IF;

  IF v_acked_now THEN
    PERFORM hive.record_coverage_acknowledgements(v_run, v_unacked, v_sources ->> 'coverageDigest');
  END IF;

  RETURN json_build_object(
    'processingRun', hive.processing_run_json(v_run),
    'created', true,
    'queuedReadIds', coalesce(v_queued, '[]'::json),
    'queuedReportRunIds', '[]'::json
  );
END;
$$;

COMMIT;
