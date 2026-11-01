-- V4 — Owner-initiated permanent Hive deletion (V3 M1 parity on hive.hives).
-- begin_hive_deletion (authenticated) → Edge storage cleanup → complete_hive_deletion (service_role).

BEGIN;

ALTER TABLE hive.hives
  ADD COLUMN IF NOT EXISTS deleting_at timestamptz;

COMMENT ON COLUMN hive.hives.deleting_at IS
  'Set when owner begins permanent deletion; listed on My Hives until storage + DB finalize succeed.';

GRANT UPDATE (deleting_at, updated_at) ON hive.hives TO authenticated;

DROP POLICY IF EXISTS pol_hives__update__owner_deletion ON hive.hives;
CREATE POLICY pol_hives__update__owner_deletion
  ON hive.hives
  FOR UPDATE
  TO authenticated
  USING (owner_user_id = auth.uid() AND archived_at IS NULL)
  WITH CHECK (owner_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.list_hives()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    json_agg(
      json_build_object(
        'id', h.id,
        'hiveId', h.id,
        'name', h.name,
        'description', h.description,
        'clientRequestId', h.client_request_id,
        'createdAt', h.created_at,
        'updatedAt', h.updated_at,
        'deletingAt', h.deleting_at
      )
      ORDER BY (h.deleting_at IS NOT NULL) DESC, h.created_at DESC, h.id DESC
    ),
    '[]'::json
  )
    INTO v_result
    FROM hive.hives h
   WHERE h.owner_user_id = v_uid
     AND h.archived_at IS NULL;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hive(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT json_build_object(
    'id', h.id,
    'hiveId', h.id,
    'name', h.name,
    'description', h.description,
    'clientRequestId', h.client_request_id,
    'createdAt', h.created_at,
    'updatedAt', h.updated_at
  )
    INTO v_result
    FROM hive.hives h
   WHERE h.id = p_hive_id
     AND h.owner_user_id = v_uid
     AND h.archived_at IS NULL
     AND h.deleting_at IS NULL
   LIMIT 1;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hive_by_client_request_id(p_client_request_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:client_request_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT json_build_object(
    'id', h.id,
    'hiveId', h.id,
    'name', h.name,
    'description', h.description,
    'clientRequestId', h.client_request_id,
    'createdAt', h.created_at,
    'updatedAt', h.updated_at
  )
    INTO v_result
    FROM hive.hives h
   WHERE h.client_request_id = p_client_request_id
     AND h.owner_user_id = v_uid
     AND h.archived_at IS NULL
     AND h.deleting_at IS NULL
   LIMIT 1;

  RETURN v_result;
END;
$$;

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

  IF to_regclass('hive.vault_source_documents') IS NOT NULL THEN
    SELECT coalesce(json_agg(d.storage_path ORDER BY d.created_at), '[]'::json)
      INTO v_paths
      FROM hive.vault_source_documents d
     WHERE d.case_id = p_hive_id
       AND d.deleted_at IS NULL
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

CREATE OR REPLACE FUNCTION public.complete_hive_deletion(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  DELETE FROM hive.hives h
   WHERE h.id = p_hive_id
     AND h.deleting_at IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 1 THEN
    RETURN json_build_object('deleted', true, 'replayed', false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM hive.hives h WHERE h.id = p_hive_id) THEN
    RETURN json_build_object('deleted', true, 'replayed', true);
  END IF;

  IF EXISTS (
    SELECT 1
      FROM hive.hives h
     WHERE h.id = p_hive_id
       AND h.deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hive_not_deleting' USING ERRCODE = '22023';
  END IF;

  RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
END;
$$;

REVOKE ALL ON FUNCTION public.begin_hive_deletion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_hive_deletion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_hive_deletion(uuid) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.begin_hive_deletion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_hive_deletion(uuid) TO service_role;

COMMIT;
