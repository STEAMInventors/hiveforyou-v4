-- V4-004H — Explicit owner-triggered Rebuild Study (D-049).
--
-- Analyze (`public.start_study_preparation`) is unchanged: it still reuses a compatible accepted
-- Canonical Study and may queue only the missing Writer runs.
--
-- Rebuild (`public.rebuild_study`) is a separate owner action. It does not reuse that Study.
-- It freezes the current sources and intent, requires pages that are already read, and queues a
-- new Study investigation. Accepting that investigation appends a new immutable revision and does
-- not queue Customer or Pro Writer runs. Prior revisions and their reports stay.
--
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

ALTER TABLE hive.processing_runs
  ADD COLUMN IF NOT EXISTS preparation_mode text NOT NULL DEFAULT 'ANALYZE';

ALTER TABLE hive.processing_runs DROP CONSTRAINT IF EXISTS ck_processing_runs__preparation_mode;
ALTER TABLE hive.processing_runs
  ADD CONSTRAINT ck_processing_runs__preparation_mode
  CHECK (preparation_mode IN ('ANALYZE', 'REBUILD'));

COMMENT ON COLUMN hive.processing_runs.preparation_mode IS
  'ANALYZE may reuse a compatible accepted Study and queue Writer. REBUILD starts a new Study investigation from the frozen sources and does not queue Writer.';

-- Identity now includes preparation_mode. Transitions are otherwise unchanged (D-044 plan skip remains).
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
              AND NEW.status = 'UNDERSTANDING_REQUEST' AND NEW.coverage_acknowledgement = 'OWNER'
              AND NEW.coverage_acknowledged AND NEW.coverage_acknowledged_at IS NOT NULL) THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;

  IF OLD.status IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED') THEN
    RAISE EXCEPTION 'processing_run_finished' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'QUEUED' AND NEW.status IN ('READING_DOCUMENTS', 'UNDERSTANDING_REQUEST', 'NEEDS_CLARIFICATION', 'FAILED'))
    OR (OLD.status = 'READING_DOCUMENTS' AND NEW.status IN ('AWAITING_ACKNOWLEDGEMENT', 'UNDERSTANDING_REQUEST', 'FAILED'))
    OR (OLD.status = 'AWAITING_ACKNOWLEDGEMENT' AND NEW.status IN ('UNDERSTANDING_REQUEST', 'FAILED'))
    OR (OLD.status = 'UNDERSTANDING_REQUEST' AND NEW.status IN ('IDENTIFYING_DOMAIN', 'FAILED'))
    OR (OLD.status = 'IDENTIFYING_DOMAIN' AND NEW.status IN ('DEVELOPING_QUESTIONS', 'FAILED'))
    OR (OLD.status = 'DEVELOPING_QUESTIONS' AND NEW.status IN ('PLANNING_INVESTIGATION', 'BUILDING_PROMPT', 'FAILED'))
    OR (OLD.status = 'PLANNING_INVESTIGATION' AND NEW.status IN ('BUILDING_PROMPT', 'FAILED'))
    OR (OLD.status = 'BUILDING_PROMPT' AND NEW.status IN ('SAVING', 'FAILED'))
    OR (OLD.status = 'SAVING' AND NEW.status IN ('INVESTIGATING', 'FAILED'))
    OR (OLD.status = 'INVESTIGATING' AND NEW.status IN ('VERIFYING_EVIDENCE', 'FAILED'))
    OR (OLD.status = 'VERIFYING_EVIDENCE' AND NEW.status IN ('ACCEPTING_STUDY', 'FAILED'))
    OR (OLD.status = 'ACCEPTING_STUDY' AND NEW.status IN ('SUCCEEDED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'processing_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hive.processing_run_json(r hive.processing_runs)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT json_build_object(
    'id', r.id,
    'hiveId', r.hive_id,
    'kind', r.kind,
    'requestId', r.request_id,
    'attemptNumber', r.attempt_number,
    'status', r.status,
    'preparationMode', r.preparation_mode,
    'authorizedSourceDocumentIds', coalesce(to_json(r.authorized_source_document_ids), '[]'::json),
    'intentRequestIds', to_json(r.intent_request_ids),
    'coverageComplete', coalesce(r.coverage_complete, false),
    'coverageAcknowledged', r.coverage_acknowledged,
    'coverageDigest', r.coverage_digest,
    'coverageStatus', r.coverage_status,
    'coverageGaps', coalesce(r.coverage_gaps, '[]'::jsonb),
    'coverageAcknowledgement', r.coverage_acknowledgement,
    'coverageAcknowledgedAt', r.coverage_acknowledged_at,
    'snapshotFrozen', r.source_snapshot IS NOT NULL,
    'stageAttempt', r.stage_attempt,
    'stageMetrics', r.stage_metrics,
    'errorCode', r.error_code,
    'errorMessageSafe', r.error_message_safe,
    'retryable', r.retryable,
    'correlationId', r.correlation_id,
    'createdAt', r.created_at,
    'startedAt', r.started_at,
    'updatedAt', r.updated_at,
    'finishedAt', r.finished_at
  );
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

-- Accepts a verified Canonical Study. Analyze still queues both Writer runs. Rebuild appends the
-- revision only, and only when the investigation has a document inventory and atomic DF findings.
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
BEGIN
  PERFORM hive.require_service_role();
  IF jsonb_typeof(coalesce(p_revision, 'null'::jsonb)) <> 'object' THEN
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

  SELECT * INTO v_preview FROM hive.study_prompt_previews WHERE processing_run_id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preview_not_saved' USING ERRCODE = 'P0001';
  END IF;

  IF v_run.preparation_mode = 'REBUILD' THEN
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

  INSERT INTO hive.canonical_studies (hive_id, owner_user_id)
  VALUES (v_run.hive_id, v_run.owner_user_id)
  ON CONFLICT ON CONSTRAINT uq_canonical_studies__hive DO NOTHING;
  SELECT * INTO v_study FROM hive.canonical_studies WHERE hive_id = v_run.hive_id FOR UPDATE;

  SELECT coalesce(max(s.revision_number), 0) + 1 INTO v_number
    FROM hive.study_revisions s WHERE s.canonical_study_id = v_study.id;

  INSERT INTO hive.study_revisions (
    canonical_study_id, hive_id, owner_user_id, revision_number, predecessor_revision_id,
    processing_run_id, study_prompt_preview_id, investigation, verification, audience_configuration,
    investigation_digest, prompt_digest, source_snapshot_digest, intent_snapshot_digest, coverage_digest,
    coverage_complete, coverage_status, coverage_gaps, coverage_acknowledgement, model_alias, resolved_model
  )
  VALUES (
    v_study.id, v_run.hive_id, v_run.owner_user_id, v_number, v_study.current_revision_id,
    v_run.id, v_preview.id, p_revision -> 'investigation', p_revision -> 'verification',
    p_revision -> 'audience_configuration',
    lower(p_revision ->> 'investigation_digest'), v_preview.prompt_digest, v_run.source_snapshot_digest,
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

  UPDATE hive.study_prompt_previews
     SET superseded_by_run_id = v_run.id
   WHERE hive_id = v_run.hive_id
     AND processing_run_id <> v_run.id
     AND superseded_by_run_id IS NULL;

  RETURN json_build_object('created', true, 'studyRevision', hive.study_revision_summary_json(v_revision),
                           'reportRuns', hive.latest_report_runs_json(v_revision.id),
                           'processingRun', hive.processing_run_json(v_run));
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_study(
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
  v_revision hive.study_revisions%ROWTYPE;
  v_sources jsonb;
  v_intents jsonb;
  v_ack text := lower(nullif(btrim(coalesce(p_coverage_acknowledgement_digest, '')), ''));
  v_attempt integer;
  v_needs_read integer;
  v_gaps jsonb;
  v_known jsonb;
  v_unacked jsonb;
  v_acked_now boolean := false;
  v_coverage_status text;
  v_acknowledgement text;
  v_acknowledged_at timestamptz;
  v_created boolean := true;
  v_has_revision boolean := false;
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
    IF v_run.hive_id <> p_hive_id OR v_run.preparation_mode IS DISTINCT FROM 'REBUILD' THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    IF v_run.status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
       AND NOT hive.processing_run_snapshot_current(v_run) THEN
      UPDATE hive.processing_runs
         SET status = 'FAILED',
             error_code = 'SOURCE_CHANGED',
             error_message_safe = 'Your documents or request changed while rebuilding the study. Rebuild again to use the latest versions.',
             retryable = true,
             lease_expires_at = NULL,
             next_dispatch_at = NULL,
             finished_at = now()
       WHERE id = v_run.id
      RETURNING * INTO v_run;
    END IF;
    SELECT * INTO v_revision FROM hive.study_revisions WHERE processing_run_id = v_run.id;
    v_has_revision := FOUND;
    RETURN json_build_object(
      'processingRun', hive.processing_run_json(v_run),
      'created', false,
      'reusedStudy', false,
      'reportsReady', false,
      'studyRevision', CASE WHEN v_has_revision THEN hive.study_revision_summary_json(v_revision) END,
      'reportRuns', '[]'::json,
      'queuedReadIds', '[]'::json,
      'queuedReportRunIds', '[]'::json
    );
  END IF;

  UPDATE hive.processing_runs r
     SET status = 'FAILED',
         error_code = 'SOURCE_CHANGED',
         error_message_safe = 'Your documents or request changed while rebuilding the study. Rebuild again to use the latest versions.',
         failure_diagnostic = jsonb_build_object(
           'contractVersion', 'failure-diagnostic@1',
           'component', 'analysis',
           'operation', 'rebuild_study',
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
    IF v_run.preparation_mode IS DISTINCT FROM 'REBUILD' THEN
      RAISE EXCEPTION 'analysis_active' USING ERRCODE = 'P0001';
    END IF;
    RETURN json_build_object(
      'processingRun', hive.processing_run_json(v_run),
      'created', false,
      'reusedStudy', false,
      'reportsReady', false,
      'reportRuns', '[]'::json,
      'queuedReadIds', '[]'::json,
      'queuedReportRunIds', '[]'::json
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM hive.study_revisions s
     WHERE s.hive_id = p_hive_id AND s.owner_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'study_not_accepted' USING ERRCODE = 'P0001';
  END IF;

  v_intents := hive.compute_study_intent_snapshot(p_hive_id);
  IF jsonb_array_length(v_intents -> 'intentRequestIds') = 0 THEN
    RAISE EXCEPTION 'intent_missing' USING ERRCODE = 'P0001';
  END IF;

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

  IF v_needs_read > 0
     OR coalesce((v_sources ->> 'activeReadCount')::integer, 0) > 0
     OR jsonb_array_length(coalesce(v_sources -> 'documents', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'documents_not_read' USING ERRCODE = 'P0001';
  END IF;

  v_gaps := hive.classify_coverage_gaps(v_sources);
  SELECT coalesce(jsonb_agg(g ORDER BY g ->> 'key'), '[]'::jsonb) INTO v_known
    FROM jsonb_array_elements(v_gaps) g;
  v_unacked := hive.unacknowledged_material_gaps(p_hive_id, v_known);
  IF jsonb_array_length(v_unacked) > 0 THEN
    IF v_ack IS DISTINCT FROM (v_sources ->> 'coverageDigest') THEN
      RAISE EXCEPTION 'coverage_unacknowledged' USING ERRCODE = 'P0001';
    END IF;
    v_acked_now := true;
  END IF;

  SELECT coalesce(max(r.attempt_number), 0) + 1 INTO v_attempt
    FROM hive.processing_runs r
   WHERE r.hive_id = p_hive_id AND r.kind = 'STUDY_PREPARATION';

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

  BEGIN
    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id, preparation_mode,
      authorized_source_document_ids, intent_request_ids, source_snapshot,
      source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
      coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement, coverage_acknowledged_at,
      snapshot_frozen_at, next_dispatch_at
    )
    VALUES (
      p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt, 'QUEUED', p_correlation_id, 'REBUILD',
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
  EXCEPTION
    WHEN unique_violation THEN
      v_created := false;
      SELECT * INTO v_run FROM hive.processing_runs
       WHERE owner_user_id = v_uid AND request_id = p_request_id;
      IF FOUND THEN
        IF v_run.hive_id <> p_hive_id OR v_run.preparation_mode IS DISTINCT FROM 'REBUILD' THEN
          RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
        END IF;
      ELSE
        SELECT * INTO v_run FROM hive.processing_runs
         WHERE hive_id = p_hive_id
           AND kind = 'STUDY_PREPARATION'
           AND preparation_mode = 'REBUILD'
           AND status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED');
        IF NOT FOUND THEN
          RAISE EXCEPTION 'analysis_active' USING ERRCODE = 'P0001';
        END IF;
      END IF;
  END;

  IF v_created AND v_acked_now THEN
    PERFORM hive.record_coverage_acknowledgements(v_run, v_unacked, v_sources ->> 'coverageDigest');
  END IF;

  RETURN json_build_object(
    'processingRun', hive.processing_run_json(v_run),
    'created', v_created,
    'reusedStudy', false,
    'reportsReady', false,
    'queuedReadIds', '[]'::json,
    'queuedReportRunIds', '[]'::json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_study(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebuild_study(uuid, uuid, uuid, text) TO authenticated;

COMMIT;
