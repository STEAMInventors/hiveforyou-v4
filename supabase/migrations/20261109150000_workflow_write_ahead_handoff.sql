-- Write-ahead workflow hand-off: reserve next_dispatch while the lease is held so a killed invocation
-- still leaves a recoverable dispatch time. Stall recovery uses workflow_last_handoff_at (not updated_at).
BEGIN;

ALTER TABLE hive.processing_runs
  ADD COLUMN IF NOT EXISTS workflow_last_handoff_at timestamptz;

ALTER TABLE hive.report_runs
  ADD COLUMN IF NOT EXISTS workflow_last_handoff_at timestamptz;

COMMENT ON COLUMN hive.processing_runs.workflow_last_handoff_at IS
  'Last claim, reserve, or release that scheduled or cleared hand-off; not bumped by progress estimate writes.';

CREATE OR REPLACE FUNCTION hive.workflow_handoff_grace_interval()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT interval '5 minutes';
$$;

CREATE OR REPLACE FUNCTION hive.extract_zero_progress_handoff_count(p_stage_outputs jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT greatest(0, coalesce(
    CASE
      WHEN jsonb_typeof(coalesce(p_stage_outputs, '{}'::jsonb) -> 'extractZeroProgressHandoffs') = 'object'
        THEN (p_stage_outputs -> 'extractZeroProgressHandoffs' ->> 'count')::integer
      WHEN jsonb_typeof(coalesce(p_stage_outputs, '{}'::jsonb) -> 'extractZeroProgressHandoffs') = 'number'
        THEN (p_stage_outputs ->> 'extractZeroProgressHandoffs')::integer
      ELSE NULL
    END,
    0
  ));
$$;

CREATE OR REPLACE FUNCTION hive.preparation_interrupted_failure_diagnostic(
  p_stage text,
  p_attempt integer,
  p_diagnostic_reason text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT jsonb_build_object(
    'contractVersion', 'failure-diagnostic@1',
    'component', 'analysis',
    'operation', 'analyze',
    'task', NULL,
    'stage', coalesce(nullif(upper(btrim(coalesce(p_stage, ''))), ''), 'EXTRACTING'),
    'errorCode', 'PREPARATION_INTERRUPTED',
    'diagnosticReason', left(btrim(coalesce(p_diagnostic_reason, 'preparation_interrupted')), 64),
    'diagnosticField', NULL,
    'retryable', true,
    'attempt', greatest(1, coalesce(p_attempt, 1))::text
  );
$$;

DROP FUNCTION IF EXISTS hive.is_overdue_workflow_handoff(timestamptz, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION hive.is_overdue_workflow_handoff(
  p_lease_expires_at timestamptz,
  p_next_dispatch_at timestamptz,
  p_workflow_last_handoff_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT p_lease_expires_at IS NULL
     AND (
       (p_next_dispatch_at IS NOT NULL AND p_next_dispatch_at <= now() - hive.workflow_handoff_grace_interval())
       OR (
         p_next_dispatch_at IS NULL
         AND p_workflow_last_handoff_at IS NOT NULL
         AND p_workflow_last_handoff_at <= now() - hive.workflow_handoff_grace_interval()
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.reserve_processing_run_handoff(
  p_run_id uuid,
  p_delay_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_delay integer;
BEGIN
  PERFORM hive.require_service_role();
  v_delay := greatest(30, least(coalesce(p_delay_seconds, 300), 600));
  UPDATE hive.processing_runs
     SET next_dispatch_at = now() + make_interval(secs => v_delay),
         workflow_last_handoff_at = now()
   WHERE id = p_run_id
     AND status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     AND lease_expires_at IS NOT NULL
     AND lease_expires_at > now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_processing_run(p_run_id uuid, p_status text, p_delay_seconds integer DEFAULT 0)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
BEGIN
  PERFORM hive.require_service_role();
  UPDATE hive.processing_runs
     SET lease_expires_at = NULL,
         next_dispatch_at = now() + make_interval(secs => greatest(0, least(coalesce(p_delay_seconds, 0), 600))),
         workflow_last_handoff_at = now()
   WHERE id = p_run_id AND status = upper(btrim(coalesce(p_status, '')))
     AND status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
  RETURNING * INTO v_run;
  RETURN json_build_object('released', FOUND);
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_expired_workflow_leases(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_report_ids uuid[] := ARRAY[]::uuid[];
  v_run_ids uuid[] := ARRAY[]::uuid[];
  v_more uuid[];
BEGIN
  PERFORM hive.require_owned_hive(p_hive_id);

  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
    FOR UPDATE;

  UPDATE hive.report_runs r
     SET status = 'FAILED',
         error_code = 'REPORT_INTERRUPTED',
         error_message_safe = 'The report stopped before it finished. You can generate it again.',
         retryable = true,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.status NOT IN ('SUCCEEDED', 'FAILED')
     AND r.lease_expires_at IS NOT NULL
     AND r.lease_expires_at <= now()
     AND r.attempt_count >= r.max_attempts
     AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now());

  UPDATE hive.processing_runs r
     SET status = 'FAILED',
         error_code = 'PREPARATION_INTERRUPTED',
         error_message_safe = 'Analysis stopped before it finished. You can try again.',
         failure_diagnostic = hive.preparation_interrupted_failure_diagnostic(
           r.status, r.stage_attempt, 'preparation_attempt_exhausted'),
         retryable = true,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     AND r.status <> 'READING_DOCUMENTS'
     AND r.lease_expires_at IS NOT NULL
     AND r.lease_expires_at <= now()
     AND r.stage_attempt >= 3
     AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now());

  UPDATE hive.report_runs r
     SET status = 'FAILED',
         error_code = 'REPORT_INTERRUPTED',
         error_message_safe = 'The report stopped before it finished. You can generate it again.',
         retryable = true,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.status NOT IN ('SUCCEEDED', 'FAILED')
     AND hive.is_overdue_workflow_handoff(
       r.lease_expires_at, r.next_dispatch_at, coalesce(r.workflow_last_handoff_at, r.updated_at))
     AND r.attempt_count >= r.max_attempts
     AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now());

  UPDATE hive.processing_runs r
     SET status = 'FAILED',
         error_code = 'PREPARATION_INTERRUPTED',
         error_message_safe = 'Analysis stopped before it finished. You can try again.',
         failure_diagnostic = hive.preparation_interrupted_failure_diagnostic(
           r.status, r.stage_attempt, 'stalled_no_handoff'),
         retryable = true,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     AND r.status <> 'READING_DOCUMENTS'
     AND hive.is_overdue_workflow_handoff(r.lease_expires_at, r.next_dispatch_at, r.workflow_last_handoff_at)
     AND hive.extract_zero_progress_handoff_count(r.stage_outputs) >= 3
     AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now());

  WITH reserved AS (
    UPDATE hive.report_runs r
       SET next_dispatch_at = now() + interval '50 seconds',
           attempt_count = attempt_count + 1
     WHERE r.hive_id = p_hive_id
       AND r.status NOT IN ('SUCCEEDED', 'FAILED')
       AND r.lease_expires_at IS NOT NULL
       AND r.lease_expires_at <= now()
       AND r.attempt_count < r.max_attempts
       AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now())
    RETURNING r.id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_report_ids FROM reserved;

  WITH reserved AS (
    UPDATE hive.processing_runs r
       SET next_dispatch_at = now() + interval '50 seconds',
           workflow_last_handoff_at = now(),
           stage_attempt = CASE WHEN r.status = 'READING_DOCUMENTS' THEN r.stage_attempt ELSE r.stage_attempt + 1 END
     WHERE r.hive_id = p_hive_id
       AND r.status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
       AND r.lease_expires_at IS NOT NULL
       AND r.lease_expires_at <= now()
       AND (r.status = 'READING_DOCUMENTS' OR r.stage_attempt < 3)
       AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now())
    RETURNING r.id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_run_ids FROM reserved;

  WITH reserved AS (
    UPDATE hive.report_runs r
       SET next_dispatch_at = now() + interval '50 seconds'
     WHERE r.hive_id = p_hive_id
       AND r.status NOT IN ('SUCCEEDED', 'FAILED')
       AND hive.is_overdue_workflow_handoff(
         r.lease_expires_at, r.next_dispatch_at, coalesce(r.workflow_last_handoff_at, r.updated_at))
       AND r.attempt_count < r.max_attempts
       AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now())
    RETURNING r.id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_more FROM reserved;
  v_report_ids := v_report_ids || coalesce(v_more, ARRAY[]::uuid[]);

  WITH reserved AS (
    UPDATE hive.processing_runs r
       SET next_dispatch_at = now() + interval '50 seconds',
           workflow_last_handoff_at = now()
     WHERE r.hive_id = p_hive_id
       AND r.status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
       AND hive.is_overdue_workflow_handoff(r.lease_expires_at, r.next_dispatch_at, r.workflow_last_handoff_at)
       AND hive.extract_zero_progress_handoff_count(r.stage_outputs) < 3
       AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now())
    RETURNING r.id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_more FROM reserved;
  v_run_ids := v_run_ids || coalesce(v_more, ARRAY[]::uuid[]);

  RETURN json_build_object(
    'dispatch',
    coalesce((
      SELECT json_agg(item)
        FROM (
          SELECT json_build_object('kind', 'report', 'id', id) AS item
            FROM unnest(v_report_ids) AS id
          UNION ALL
          SELECT json_build_object('kind', 'analysis', 'id', id)
            FROM unnest(v_run_ids) AS id
        ) s
    ), '[]'::json)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_processing_run(p_run_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_attempt integer;
  v_already_counted boolean;
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

  v_already_counted := v_run.status <> 'READING_DOCUMENTS'
    AND v_run.next_dispatch_at IS NOT NULL
    AND (
      (v_run.lease_expires_at IS NOT NULL AND v_run.lease_expires_at <= now())
      OR (v_run.lease_expires_at IS NULL AND v_run.next_dispatch_at > now())
    );
  v_attempt := v_run.stage_attempt + CASE
    WHEN v_already_counted THEN 0
    WHEN v_run.lease_expires_at IS NOT NULL AND v_run.status <> 'READING_DOCUMENTS' THEN 1
    ELSE 0 END;
  IF v_attempt > 3 THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'PREPARATION_INTERRUPTED',
           error_message_safe = 'Analysis stopped before it finished. You can try again.',
           failure_diagnostic = hive.preparation_interrupted_failure_diagnostic(
             v_run.status, v_run.stage_attempt, 'preparation_attempt_exhausted'),
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
         next_dispatch_at = NULL,
         workflow_last_handoff_at = now()
   WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN json_build_object('claimed', true, 'processingRun', hive.processing_run_json(v_run));
END;
$$;

REVOKE ALL ON FUNCTION hive.is_overdue_workflow_handoff(timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_processing_run_handoff(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_processing_run_handoff(uuid, integer) TO service_role;

COMMIT;
