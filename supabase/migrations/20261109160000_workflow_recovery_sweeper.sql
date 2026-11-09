-- Global workflow recovery sweep for Vercel Cron (no pg_cron / new triggers).
BEGIN;

CREATE OR REPLACE FUNCTION hive.recover_workflow_leases_for_hive(p_hive_id uuid)
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
  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
      AND h.deleting_at IS NULL
      AND h.archived_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('dispatch', '[]'::json);
  END IF;

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

CREATE OR REPLACE FUNCTION public.recover_expired_workflow_leases(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
BEGIN
  PERFORM hive.require_owned_hive(p_hive_id);
  RETURN hive.recover_workflow_leases_for_hive(p_hive_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_workflow_recovery(p_hive_limit integer DEFAULT 20)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_hive_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_hive_limit, 20), 50));
  v_hives uuid[] := ARRAY[]::uuid[];
  v_dispatch jsonb := '[]'::jsonb;
  v_part jsonb;
  v_payload json;
BEGIN
  PERFORM hive.require_service_role();

  FOR v_hive_id IN
    SELECT s.hive_id
      FROM (
        SELECT DISTINCT r.hive_id
          FROM hive.processing_runs r
          JOIN hive.hives h ON h.id = r.hive_id
         WHERE h.deleting_at IS NULL
           AND h.archived_at IS NULL
           AND r.status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
           AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now())
           AND (
             (r.lease_expires_at IS NOT NULL AND r.lease_expires_at <= now())
             OR hive.is_overdue_workflow_handoff(
               r.lease_expires_at, r.next_dispatch_at, r.workflow_last_handoff_at)
           )
        UNION
        SELECT DISTINCT r.hive_id
          FROM hive.report_runs r
          JOIN hive.hives h ON h.id = r.hive_id
         WHERE h.deleting_at IS NULL
           AND h.archived_at IS NULL
           AND r.status NOT IN ('SUCCEEDED', 'FAILED')
           AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now())
           AND (
             (r.lease_expires_at IS NOT NULL AND r.lease_expires_at <= now())
             OR hive.is_overdue_workflow_handoff(
               r.lease_expires_at, r.next_dispatch_at, coalesce(r.workflow_last_handoff_at, r.updated_at))
           )
      ) s
     ORDER BY s.hive_id
     LIMIT v_limit
  LOOP
    v_hives := array_append(v_hives, v_hive_id);
    v_payload := hive.recover_workflow_leases_for_hive(v_hive_id);
    v_part := coalesce(v_payload::jsonb -> 'dispatch', '[]'::jsonb);
    IF jsonb_typeof(v_part) = 'array' AND jsonb_array_length(v_part) > 0 THEN
      v_dispatch := v_dispatch || v_part;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'hivesScanned', coalesce(array_length(v_hives, 1), 0),
    'hiveIds', to_json(v_hives),
    'dispatch', v_dispatch,
    'dispatchCount', jsonb_array_length(v_dispatch)
  );
END;
$$;

REVOKE ALL ON FUNCTION hive.recover_workflow_leases_for_hive(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_workflow_recovery(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_workflow_recovery(integer) TO service_role;

COMMIT;
