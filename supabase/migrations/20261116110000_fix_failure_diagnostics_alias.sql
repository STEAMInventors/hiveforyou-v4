-- QF-1a-10: PL/pgSQL FOUND conflicts with subquery alias "found" in get_failure_diagnostics.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_failure_diagnostics(p_hive_id uuid, p_correlation_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_rows json;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  v_owner := hive.require_hive_member(p_hive_id);

  SELECT coalesce(json_agg(row_to_json(diag) ORDER BY diag.sort_at DESC), '[]'::json)
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
         AND r.owner_user_id = v_owner
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
         AND r.owner_user_id = v_owner
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
         AND r.owner_user_id = v_owner
         AND r.correlation_id = p_correlation_id
         AND (r.failure_diagnostic IS NOT NULL OR r.error_code IS NOT NULL OR r.status IN ('FAILED', 'UNREADABLE'))
    ) diag
   WHERE diag.diagnostic IS NOT NULL;

  RETURN json_build_object('correlationId', p_correlation_id, 'diagnostics', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_failure_diagnostics(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_failure_diagnostics(uuid, uuid) TO authenticated;

COMMIT;