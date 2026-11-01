-- Live hive.source_documents has case_id, storage_path, created_at (no deleted_at).
-- Replace begin_hive_deletion document-path query only; all other behavior unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.begin_hive_deletion(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hive hive.hives%ROWTYPE;
  v_paths json := '[]'::json;
  v_replayed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_hive
    FROM hive.hives h
   WHERE h.id = p_hive_id
     AND h.owner_user_id = v_uid
     AND h.archived_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_hive.deleting_at IS NULL THEN
    UPDATE hive.hives
       SET deleting_at = now(), updated_at = now()
     WHERE id = p_hive_id
     RETURNING * INTO v_hive;
  ELSE
    v_replayed := true;
  END IF;

  IF to_regclass('hive.source_documents') IS NOT NULL THEN
    SELECT coalesce(json_agg(d.storage_path ORDER BY d.created_at), '[]'::json)
      INTO v_paths
      FROM hive.source_documents d
     WHERE d.case_id = p_hive_id
       AND btrim(d.storage_path) <> '';
  END IF;

  RETURN json_build_object(
    'hive_id', v_hive.id,
    'owner_user_id', v_hive.owner_user_id,
    'storage_prefix', v_hive.owner_user_id::text || '/' || v_hive.id::text,
    'storage_paths', v_paths,
    'deletion_stage', 'marked',
    'replayed', v_replayed
  );
END;
$$;

COMMIT;
