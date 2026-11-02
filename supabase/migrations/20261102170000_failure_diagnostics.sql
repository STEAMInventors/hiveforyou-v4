-- Failure diagnostics (failure-diagnostic@1).
-- Additive: nullable failure_diagnostic on processing runs, report runs and document reads.
-- Existing error_code / error_message_safe / retryable columns are unchanged.
-- Unknown keys in transition details were already ignored; this revision stores failure_diagnostic
-- in the same update that records the failure, because a finished row cannot be updated again.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

CREATE OR REPLACE FUNCTION hive.is_valid_failure_diagnostic(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT p IS NOT NULL
     AND jsonb_typeof(p) = 'object'
     AND p ->> 'contractVersion' = 'failure-diagnostic@1'
     AND p ->> 'component' IN ('reader', 'planner', 'analysis', 'writer', 'scenario', 'a2ui')
     AND coalesce(p ->> 'operation', '') ~ '^[a-z][a-z0-9_]{0,63}$'
     AND (jsonb_typeof(p -> 'task') = 'null' OR coalesce(p ->> 'task', '') ~ '^[a-z][a-z0-9_]{0,63}$')
     AND coalesce(p ->> 'stage', '') ~ '^[A-Z][A-Z0-9_]{0,63}$'
     AND coalesce(p ->> 'errorCode', '') ~ '^[A-Z][A-Z0-9_]{0,63}$'
     AND coalesce(p ->> 'diagnosticReason', '') ~ '^[a-z][a-z0-9_]{0,63}$'
     AND (
       jsonb_typeof(p -> 'diagnosticField') = 'null'
       OR coalesce(p ->> 'diagnosticField', '') ~ '^[][A-Za-z0-9_.:/@+-]{1,128}$'
     )
     AND jsonb_typeof(p -> 'retryable') = 'boolean'
     AND coalesce(p ->> 'attempt', '') ~ '^[0-9]{1,4}$'
     AND (
       SELECT count(*)
         FROM jsonb_object_keys(p) AS key
        WHERE key IN (
          'contractVersion', 'component', 'operation', 'task', 'stage', 'errorCode',
          'diagnosticReason', 'diagnosticField', 'retryable', 'attempt'
        )
     ) = 10
     AND (SELECT count(*) FROM jsonb_object_keys(p)) = 10
     AND octet_length(p::text) <= 2048;
$$;

CREATE OR REPLACE FUNCTION hive.take_failure_diagnostic(p_details jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF p_details IS NULL
     OR jsonb_typeof(p_details) <> 'object'
     OR NOT (p_details ? 'failure_diagnostic')
     OR jsonb_typeof(p_details -> 'failure_diagnostic') = 'null' THEN
    RETURN NULL;
  END IF;
  IF NOT hive.is_valid_failure_diagnostic(p_details -> 'failure_diagnostic') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  RETURN p_details -> 'failure_diagnostic';
END;
$$;

-- Historical rows keep error_code only. The lookup fills a safe diagnostic from that code.
CREATE OR REPLACE FUNCTION hive.support_failure_diagnostic(
  p_stored jsonb,
  p_component text,
  p_operation text,
  p_task text,
  p_stage text,
  p_error_code text,
  p_retryable boolean,
  p_attempt integer
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT CASE
    WHEN hive.is_valid_failure_diagnostic(p_stored) THEN p_stored
    WHEN p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN NULL
    WHEN p_stage IS NULL OR p_stage !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN NULL
    ELSE jsonb_build_object(
      'contractVersion', 'failure-diagnostic@1',
      'component', p_component,
      'operation', p_operation,
      'task', to_jsonb(p_task),
      'stage', p_stage,
      'errorCode', p_error_code,
      'diagnosticReason', CASE p_error_code
        WHEN 'SOURCE_CHANGED' THEN 'source_changed'
        WHEN 'MODEL_TIMEOUT' THEN 'planner_timeout'
        WHEN 'MODEL_OUTPUT_INVALID' THEN 'model_output_invalid'
        WHEN 'MODEL_UNAVAILABLE' THEN 'planner_unavailable'
        WHEN 'COVERAGE_INCOMPLETE' THEN 'coverage_incomplete'
        WHEN 'DOCUMENT_UNREADABLE' THEN 'document_unreadable'
        WHEN 'PAGE_READ_FAILED' THEN 'page_read_failed'
        WHEN 'PERSISTENCE_FAILED' THEN 'persistence_failed'
        ELSE 'unexpected_exception'
      END,
      'diagnosticField', NULL,
      'retryable', coalesce(p_retryable, false),
      'attempt', least(greatest(coalesce(p_attempt, 1), 0), 99)
    )
  END;
$$;

ALTER TABLE hive.processing_runs ADD COLUMN IF NOT EXISTS failure_diagnostic jsonb;
ALTER TABLE hive.report_runs ADD COLUMN IF NOT EXISTS failure_diagnostic jsonb;
ALTER TABLE hive.document_reads ADD COLUMN IF NOT EXISTS failure_diagnostic jsonb;

ALTER TABLE hive.processing_runs DROP CONSTRAINT IF EXISTS ck_processing_runs__failure_diagnostic;
ALTER TABLE hive.processing_runs ADD CONSTRAINT ck_processing_runs__failure_diagnostic
  CHECK (failure_diagnostic IS NULL OR hive.is_valid_failure_diagnostic(failure_diagnostic));
ALTER TABLE hive.report_runs DROP CONSTRAINT IF EXISTS ck_report_runs__failure_diagnostic;
ALTER TABLE hive.report_runs ADD CONSTRAINT ck_report_runs__failure_diagnostic
  CHECK (failure_diagnostic IS NULL OR hive.is_valid_failure_diagnostic(failure_diagnostic));
ALTER TABLE hive.document_reads DROP CONSTRAINT IF EXISTS ck_document_reads__failure_diagnostic;
ALTER TABLE hive.document_reads ADD CONSTRAINT ck_document_reads__failure_diagnostic
  CHECK (failure_diagnostic IS NULL OR hive.is_valid_failure_diagnostic(failure_diagnostic));

COMMENT ON COLUMN hive.processing_runs.failure_diagnostic IS
  'Safe failure-diagnostic@1 for the latest failure. No prompts, page text, model output or credentials.';
COMMENT ON COLUMN hive.report_runs.failure_diagnostic IS
  'Safe failure-diagnostic@1 for the latest Writer, scenario or A2UI failure.';
COMMENT ON COLUMN hive.document_reads.failure_diagnostic IS
  'Safe failure-diagnostic@1 for a failed or unreadable document read.';

CREATE OR REPLACE FUNCTION public.retry_processing_run_stage(p_run_id uuid, p_status text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_metrics jsonb;
BEGIN
  PERFORM hive.require_service_role();
  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> upper(btrim(coalesce(p_status, ''))) THEN
    RETURN json_build_object('retried', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;
  v_metrics := v_run.stage_metrics;
  IF v_details ? 'stage_metric' THEN
    IF NOT hive.is_valid_stage_metric(v_details -> 'stage_metric') THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
    v_metrics := v_metrics || jsonb_build_array(v_details -> 'stage_metric');
  END IF;
  IF v_run.stage_attempt >= 3 THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           stage_metrics = v_metrics,
           failure_diagnostic = coalesce(hive.take_failure_diagnostic(v_details), failure_diagnostic),
           error_code = nullif(btrim(v_details ->> 'error_code'), ''),
           error_message_safe = nullif(left(btrim(coalesce(v_details ->> 'error_message_safe', '')), 300), ''),
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('retried', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;
  UPDATE hive.processing_runs
     SET stage_attempt = stage_attempt + 1,
         stage_metrics = v_metrics,
         failure_diagnostic = coalesce(hive.take_failure_diagnostic(v_details), failure_diagnostic),
         lease_expires_at = NULL,
         next_dispatch_at = now() + make_interval(secs => 20 * v_run.stage_attempt)
   WHERE id = p_run_id
  RETURNING * INTO v_run;
  RETURN json_build_object('retried', true, 'processingRun', hive.processing_run_json(v_run));
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
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

  -- Reading has finished: freeze the sources now, or stop if coverage needs the person.
  IF v_to = 'UNDERSTANDING_REQUEST' AND v_run.source_snapshot IS NULL THEN
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
      -- Freeze what was read and wait for the owner; the reads are finished and stay finished.
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
      -- Every material gap was acknowledged before: at this run's start (OWNER) or earlier (PRIOR).
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
           'studyInvestigation'
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
     OR (v_to = 'VERIFYING_EVIDENCE' AND NOT v_outputs ? 'studyInvestigation') THEN
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
         started_at = CASE WHEN v_to = 'UNDERSTANDING_REQUEST' THEN coalesce(started_at, now()) ELSE started_at END,
         -- The invocation that advanced the run keeps the next stage until it releases it.
         lease_expires_at = CASE WHEN v_terminal THEN NULL ELSE now() + interval '300 seconds' END,
         next_dispatch_at = CASE WHEN v_terminal THEN NULL ELSE now() + interval '30 seconds' END,
         stage_attempt = CASE WHEN v_to <> status THEN 1 ELSE stage_attempt END,
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

-- Accepts a verified Canonical Study in one transaction: immutable revision, current pointer,
-- both Writer runs queued, run SUCCEEDED. Replays return the same revision.

CREATE OR REPLACE FUNCTION public.transition_report_run(
  p_report_run_id uuid,
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
  v_run hive.report_runs%ROWTYPE;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_to text := upper(btrim(coalesce(p_to_status, '')));
  v_metrics jsonb;
  v_retry boolean;
BEGIN
  PERFORM hive.require_service_role();
  IF v_to NOT IN ('VALIDATING', 'SAVING', 'FAILED') OR jsonb_typeof(v_details) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM hive.report_runs WHERE id = p_report_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> upper(btrim(coalesce(p_from_status, ''))) THEN
    RETURN json_build_object('applied', false, 'reportRun', hive.report_run_json(v_run));
  END IF;
  v_metrics := v_run.stage_metrics;
  IF v_details ? 'stage_metric' THEN
    IF NOT hive.is_valid_stage_metric(v_details -> 'stage_metric') THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
    v_metrics := v_metrics || jsonb_build_array(v_details -> 'stage_metric');
  END IF;

  -- A retryable failure with attempts left goes back to QUEUED (the Study is never rerun).
  v_retry := v_to = 'FAILED' AND coalesce((v_details ->> 'retryable')::boolean, false)
             AND v_run.attempt_count < v_run.max_attempts;

  UPDATE hive.report_runs
     SET status = CASE WHEN v_retry THEN 'QUEUED' ELSE v_to END,
         stage_metrics = v_metrics,
         lease_expires_at = CASE WHEN v_to = 'FAILED' THEN NULL ELSE now() + interval '300 seconds' END,
         next_dispatch_at = CASE WHEN v_retry THEN now() + make_interval(secs => 30 * v_run.attempt_count) ELSE NULL END,
         error_code = CASE WHEN v_to = 'FAILED' THEN nullif(btrim(v_details ->> 'error_code'), '') ELSE error_code END,
         error_message_safe = CASE WHEN v_to = 'FAILED'
           THEN nullif(left(btrim(coalesce(v_details ->> 'error_message_safe', '')), 300), '') ELSE error_message_safe END,
         retryable = CASE WHEN v_to = 'FAILED' THEN (v_details ->> 'retryable')::boolean ELSE retryable END,
         failure_diagnostic = CASE WHEN v_to = 'FAILED'
           THEN coalesce(hive.take_failure_diagnostic(v_details), failure_diagnostic)
           ELSE failure_diagnostic END,
         finished_at = CASE WHEN v_to = 'FAILED' AND NOT v_retry THEN now() ELSE NULL END
   WHERE id = p_report_run_id
  RETURNING * INTO v_run;
  RETURN json_build_object('applied', true, 'retrying', v_retry, 'reportRun', hive.report_run_json(v_run));
EXCEPTION
  WHEN invalid_text_representation OR check_violation THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

-- Write-once report; the run succeeds in the same transaction.

CREATE OR REPLACE FUNCTION public.transition_document_read(
  p_read_id uuid,
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
  v_read hive.document_reads%ROWTYPE;
  v_doc hive.source_documents%ROWTYPE;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_to text := upper(btrim(coalesce(p_to_status, '')));
  v_from text := upper(btrim(coalesce(p_from_status, '')));
  v_terminal boolean;
  v_digest text;
  v_verified integer;
  v_persisted integer;
  v_message text;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_details) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_read FROM hive.document_reads WHERE id = p_read_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_read_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_read.status <> v_from THEN
    RETURN json_build_object('applied', false, 'documentRead', hive.document_read_json(v_read));
  END IF;

  v_terminal := v_to IN ('SUCCEEDED', 'PARTIAL', 'UNREADABLE', 'FAILED');

  SELECT * INTO v_doc FROM hive.source_documents WHERE id = v_read.source_document_id;
  IF NOT v_terminal AND (
    NOT FOUND
    OR v_doc.lifecycle_status <> 'ACTIVE'
    OR v_doc.deleted_at IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = v_read.hive_id AND (h.deleting_at IS NOT NULL OR h.archived_at IS NOT NULL)
    )
  ) THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_to IN ('SUCCEEDED', 'PARTIAL') OR (v_to = 'UNREADABLE' AND v_from = 'VERIFYING') THEN
    v_digest := lower(btrim(coalesce(v_details ->> 'page_set_digest', v_read.page_set_digest, '')));
    v_verified := (v_details ->> 'verified_page_count')::integer;
    IF v_digest !~ '^sha256:[0-9a-f]{64}$' OR v_verified IS NULL OR v_verified < 1 THEN
      RAISE EXCEPTION 'page_generation_incomplete' USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO v_persisted
      FROM hive.document_pages p
     WHERE p.source_document_id = v_read.source_document_id
       AND p.hive_id = v_read.hive_id
       AND p.page_set_digest = v_digest;
    IF v_persisted <> v_verified THEN
      RAISE EXCEPTION 'page_generation_incomplete' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_message := nullif(left(btrim(coalesce(v_details ->> 'error_message_safe', '')), 300), '');

  UPDATE hive.document_reads
     SET status = v_to,
         started_at = CASE WHEN v_to = 'READING' THEN now() ELSE started_at END,
         lease_expires_at = CASE WHEN v_terminal THEN NULL ELSE now() + interval '180 seconds' END,
         finished_at = CASE WHEN v_terminal THEN now() ELSE NULL END,
         read_fingerprint = coalesce(nullif(btrim(v_details ->> 'read_fingerprint'), ''), read_fingerprint),
         page_set_digest = coalesce(lower(nullif(btrim(v_details ->> 'page_set_digest'), '')), page_set_digest),
         total_physical_pages = coalesce((v_details ->> 'total_physical_pages')::integer, total_physical_pages),
         saved_page_count = coalesce((v_details ->> 'saved_page_count')::integer, saved_page_count),
         verified_page_count = coalesce((v_details ->> 'verified_page_count')::integer, verified_page_count),
         unreadable_page_count = coalesce((v_details ->> 'unreadable_page_count')::integer, unreadable_page_count),
         error_code = CASE WHEN v_terminal THEN nullif(btrim(v_details ->> 'error_code'), '') ELSE error_code END,
         error_message_safe = CASE WHEN v_terminal THEN v_message ELSE error_message_safe END,
         retryable = CASE WHEN v_terminal THEN (v_details ->> 'retryable')::boolean ELSE retryable END,
         failure_diagnostic = CASE WHEN v_terminal
           THEN coalesce(hive.take_failure_diagnostic(v_details), failure_diagnostic)
           ELSE failure_diagnostic END
   WHERE id = p_read_id
  RETURNING * INTO v_read;

  IF v_terminal AND v_doc.id IS NOT NULL THEN
    UPDATE hive.source_documents
       SET read_status = v_to,
           page_count = CASE
             WHEN v_to IN ('SUCCEEDED', 'PARTIAL', 'UNREADABLE') AND v_read.total_physical_pages IS NOT NULL
               THEN v_read.total_physical_pages
             ELSE page_count
           END
     WHERE id = v_read.source_document_id
       AND lifecycle_status = 'ACTIVE'
       AND deleted_at IS NULL;
  END IF;

  IF v_to = 'READING' THEN
    RETURN json_build_object(
      'applied', true,
      'documentRead', hive.document_read_json(v_read),
      'source', json_build_object(
        'source_document_id', v_doc.id,
        'hive_id', v_doc.case_id,
        'owner_user_id', v_doc.owner_user_id,
        'file_name', v_doc.original_filename,
        'mime_type', v_doc.mime_type,
        'byte_size', v_doc.byte_size,
        'sha256', lower(btrim(v_doc.sha256)),
        'storage_bucket', v_doc.storage_bucket,
        'storage_path', v_doc.storage_path,
        'page_count', v_doc.page_count
      )
    );
  END IF;

  RETURN json_build_object('applied', true, 'documentRead', hive.document_read_json(v_read));
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Row-Level Security & least-privilege grants
-- ---------------------------------------------------------------------------
ALTER TABLE hive.document_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.document_reads FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_document_reads__select__owner ON hive.document_reads;
CREATE POLICY pol_document_reads__select__owner
  ON hive.document_reads
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = document_reads.hive_id
         AND h.owner_user_id = auth.uid()
         AND h.archived_at IS NULL
         AND h.deleting_at IS NULL
    )
  );

REVOKE ALL ON hive.document_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hive.document_reads TO authenticated;
GRANT ALL ON hive.document_reads TO service_role;

REVOKE ALL ON FUNCTION hive.enforce_document_read_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.expire_stale_document_reads(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.document_read_json(hive.document_reads) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.latest_document_reads_json(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.start_document_reads(uuid, uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_document_reads(uuid, uuid, uuid, uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.list_document_reads(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_document_reads(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_failure_diagnostics(p_hive_id uuid, p_correlation_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
      AND h.owner_user_id = v_uid
      AND h.archived_at IS NULL
      AND h.deleting_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(json_agg(row_to_json(found) ORDER BY found.sort_at DESC), '[]'::json)
    INTO v_rows
    FROM (
      SELECT 'processing_run' AS kind,
             r.id AS "operationId",
             r.status,
             hive.support_failure_diagnostic(
               r.failure_diagnostic,
               'analysis',
               'analyze',
               NULL,
               coalesce(
                 CASE WHEN r.stage_metrics -> -1 ->> 'stage' ~ '^[A-Z][A-Z0-9_]{0,63}$'
                      THEN r.stage_metrics -> -1 ->> 'stage' END,
                 r.status
               ),
               r.error_code,
               r.retryable,
               r.stage_attempt
             ) AS diagnostic,
             r.updated_at AS sort_at
        FROM hive.processing_runs r
       WHERE r.hive_id = p_hive_id
         AND r.owner_user_id = v_uid
         AND r.correlation_id = p_correlation_id
         AND (r.failure_diagnostic IS NOT NULL OR r.error_code IS NOT NULL OR r.status = 'FAILED')
      UNION ALL
      SELECT 'report_run',
             r.id,
             r.status,
             hive.support_failure_diagnostic(
               r.failure_diagnostic, 'writer', 'write_report', 'writer', 'WRITING',
               r.error_code, r.retryable, r.attempt_count
             ),
             r.updated_at
        FROM hive.report_runs r
       WHERE r.hive_id = p_hive_id
         AND r.owner_user_id = v_uid
         AND r.correlation_id = p_correlation_id
         AND (r.failure_diagnostic IS NOT NULL OR r.error_code IS NOT NULL OR r.status = 'FAILED')
      UNION ALL
      SELECT 'document_read',
             r.id,
             r.status,
             hive.support_failure_diagnostic(
               r.failure_diagnostic, 'reader', 'read_document', 'read', 'READ',
               r.error_code, r.retryable, r.attempt_number
             ),
             r.updated_at
        FROM hive.document_reads r
       WHERE r.hive_id = p_hive_id
         AND r.owner_user_id = v_uid
         AND r.correlation_id = p_correlation_id
         AND (r.failure_diagnostic IS NOT NULL OR r.error_code IS NOT NULL OR r.status IN ('FAILED', 'UNREADABLE'))
    ) found
   WHERE found.diagnostic IS NOT NULL;

  RETURN json_build_object('correlationId', p_correlation_id, 'diagnostics', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION hive.is_valid_failure_diagnostic(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.take_failure_diagnostic(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.support_failure_diagnostic(jsonb, text, text, text, text, text, boolean, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_failure_diagnostics(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_failure_diagnostics(uuid, uuid) TO authenticated;

COMMIT;
