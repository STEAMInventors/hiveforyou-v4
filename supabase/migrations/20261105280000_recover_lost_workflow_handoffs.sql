-- Poll recovery for lost hand-offs: non-terminal runs with no lease whose dispatch time passed
-- without an invocation picking them up (for example a deployment dropped the dispatch).
-- Same 50s reservation as expired leases, but no extra attempt is counted.
BEGIN;

CREATE OR REPLACE FUNCTION hive.is_overdue_workflow_handoff(
  p_lease_expires_at timestamptz,
  p_next_dispatch_at timestamptz,
  p_updated_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT p_lease_expires_at IS NULL
     AND (
       (p_next_dispatch_at IS NOT NULL AND p_next_dispatch_at <= now() - interval '45 seconds')
       OR (p_next_dispatch_at IS NULL AND p_updated_at <= now() - interval '45 seconds')
     );
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
     AND hive.is_overdue_workflow_handoff(r.lease_expires_at, r.next_dispatch_at, r.updated_at)
     AND r.attempt_count >= r.max_attempts
     AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now());

  UPDATE hive.processing_runs r
     SET status = 'FAILED',
         error_code = 'PREPARATION_INTERRUPTED',
         error_message_safe = 'Analysis stopped before it finished. You can try again.',
         retryable = true,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     AND r.status <> 'READING_DOCUMENTS'
     AND hive.is_overdue_workflow_handoff(r.lease_expires_at, r.next_dispatch_at, r.updated_at)
     AND r.stage_attempt >= 3
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
       AND hive.is_overdue_workflow_handoff(r.lease_expires_at, r.next_dispatch_at, r.updated_at)
       AND r.attempt_count < r.max_attempts
       AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now())
    RETURNING r.id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_more FROM reserved;
  v_report_ids := v_report_ids || coalesce(v_more, ARRAY[]::uuid[]);

  WITH reserved AS (
    UPDATE hive.processing_runs r
       SET next_dispatch_at = now() + interval '50 seconds'
     WHERE r.hive_id = p_hive_id
       AND r.status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
       AND hive.is_overdue_workflow_handoff(r.lease_expires_at, r.next_dispatch_at, r.updated_at)
       AND (r.status = 'READING_DOCUMENTS' OR r.stage_attempt < 3)
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

CREATE OR REPLACE FUNCTION public.claim_report_run(p_report_run_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.report_runs%ROWTYPE;
  v_counted boolean;
BEGIN
  PERFORM hive.require_service_role();
  SELECT * INTO v_run FROM hive.report_runs WHERE id = p_report_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status IN ('SUCCEEDED', 'FAILED')
     OR (v_run.status <> 'QUEUED' AND v_run.lease_expires_at > now())
     OR (v_run.status = 'QUEUED' AND v_run.next_dispatch_at IS NOT NULL AND v_run.next_dispatch_at > now()
         AND v_run.attempt_count > 0) THEN
    RETURN json_build_object('claimed', false, 'reportRun', hive.report_run_json(v_run));
  END IF;
  IF v_run.attempt_count >= v_run.max_attempts THEN
    UPDATE hive.report_runs
       SET status = 'FAILED',
           error_code = coalesce(error_code, 'REPORT_INTERRUPTED'),
           error_message_safe = coalesce(error_message_safe, 'The report stopped before it finished. You can generate it again.'),
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = p_report_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('claimed', false, 'reportRun', hive.report_run_json(v_run));
  END IF;
  v_counted := v_run.status <> 'QUEUED'
    AND v_run.next_dispatch_at IS NOT NULL
    AND (
      (v_run.lease_expires_at IS NOT NULL AND v_run.lease_expires_at <= now())
      OR (v_run.lease_expires_at IS NULL AND v_run.next_dispatch_at > now())
    );
  IF v_run.status <> 'QUEUED' THEN
    UPDATE hive.report_runs SET status = 'QUEUED' WHERE id = p_report_run_id;
  END IF;
  UPDATE hive.report_runs
     SET status = 'WRITING',
         attempt_count = CASE WHEN v_counted THEN attempt_count ELSE attempt_count + 1 END,
         started_at = coalesce(started_at, now()),
         lease_expires_at = now() + interval '300 seconds',
         next_dispatch_at = NULL
   WHERE id = p_report_run_id
  RETURNING * INTO v_run;
  RETURN json_build_object('claimed', true, 'reportRun', hive.report_run_json(v_run));
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

REVOKE ALL ON FUNCTION hive.is_overdue_workflow_handoff(timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

COMMIT;
