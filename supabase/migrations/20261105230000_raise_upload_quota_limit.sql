-- D-012 (amended 2026-11-05): raise Free monthly upload quota to 2000 during development.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

CREATE OR REPLACE FUNCTION hive.upload_quota_json(p_owner_user_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_limit constant integer := 2000;
  v_period_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_period_end timestamptz := (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';
  v_used integer;
BEGIN
  SELECT count(*)::integer
    INTO v_used
    FROM hive.source_documents d
   WHERE d.owner_user_id = p_owner_user_id
     AND d.upload_status = 'UPLOADED'
     AND d.lifecycle_status = 'ACTIVE'
     AND d.deleted_at IS NULL
     AND d.created_at >= v_period_start
     AND d.created_at < v_period_end;

  RETURN json_build_object(
    'limit', v_limit,
    'used', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'periodStart', v_period_start,
    'periodEnd', v_period_end
  );
END;
$$;

COMMIT;
