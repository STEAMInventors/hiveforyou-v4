-- FL-3: hive kind (own vs client), create/list/get kind, owner RPC set_hive_kind with audit row.
BEGIN;

ALTER TABLE hive.hives
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'own';

ALTER TABLE hive.hives
  DROP CONSTRAINT IF EXISTS ck_hives__kind;

ALTER TABLE hive.hives
  ADD CONSTRAINT ck_hives__kind CHECK (kind IN ('own', 'client'));

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
        'kind', h.kind,
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
    'kind', h.kind,
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
    'kind', h.kind,
    'clientRequestId', h.client_request_id,
    'createdAt', h.created_at,
    'updatedAt', h.updated_at
  )
    INTO v_result
    FROM hive.hives h
   WHERE h.client_request_id = p_client_request_id
     AND h.owner_user_id = v_uid
     AND h.archived_at IS NULL
   LIMIT 1;

  RETURN v_result;
END;
$$;

DROP FUNCTION IF EXISTS public.create_hive(text, text, uuid);

CREATE OR REPLACE FUNCTION public.create_hive(
  p_name text,
  p_description text,
  p_client_request_id uuid,
  p_kind text DEFAULT 'own'
)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_trimmed_name text := btrim(coalesce(p_name, ''));
  v_trimmed_desc text := CASE
    WHEN p_description IS NULL OR btrim(p_description) = '' THEN NULL
    ELSE btrim(p_description)
  END;
  v_kind text := lower(btrim(coalesce(p_kind, 'own')));
  v_row hive.hives%ROWTYPE;
  v_created boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:client_request_id_required' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_trimmed_name) < 1 THEN
    RAISE EXCEPTION 'invalid_request:name_required' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_trimmed_name) > 100 THEN
    RAISE EXCEPTION 'invalid_request:name_too_long' USING ERRCODE = '22023';
  END IF;

  IF v_trimmed_desc IS NOT NULL AND char_length(v_trimmed_desc) > 500 THEN
    RAISE EXCEPTION 'invalid_request:description_too_long' USING ERRCODE = '22023';
  END IF;

  IF v_kind NOT IN ('own', 'client') THEN
    RAISE EXCEPTION 'invalid_request:kind' USING ERRCODE = '22023';
  END IF;

  INSERT INTO hive.hives (owner_user_id, name, description, client_request_id, kind)
  VALUES (v_uid, v_trimmed_name, v_trimmed_desc, p_client_request_id, v_kind)
  ON CONFLICT ON CONSTRAINT uq_hives__owner_client_request DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_created := true;
  ELSE
    SELECT *
      INTO v_row
      FROM hive.hives h
     WHERE h.owner_user_id = v_uid
       AND h.client_request_id = p_client_request_id
       AND h.archived_at IS NULL
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_row.name IS DISTINCT FROM v_trimmed_name
       OR v_row.description IS DISTINCT FROM v_trimmed_desc
       OR v_row.kind IS DISTINCT FROM v_kind THEN
      RAISE EXCEPTION 'idempotency_conflict'
        USING ERRCODE = '23505',
              CONSTRAINT = 'uq_hives__owner_client_request';
    END IF;

    v_created := false;
  END IF;

  RETURN json_build_object(
    'hive', json_build_object(
      'id', v_row.id,
      'hiveId', v_row.id,
      'name', v_row.name,
      'description', v_row.description,
      'kind', v_row.kind,
      'clientRequestId', v_row.client_request_id,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at
    ),
    'created', v_created
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_hive_kind(p_hive_id uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_prev text;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;

  IF v_kind NOT IN ('own', 'client') THEN
    RAISE EXCEPTION 'invalid_request:kind' USING ERRCODE = '22023';
  END IF;

  SELECT h.kind, h.owner_user_id
    INTO v_prev, v_owner
    FROM hive.hives h
   WHERE h.id = p_hive_id
     AND h.archived_at IS NULL
     AND h.deleting_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF v_prev = v_kind THEN
    RETURN;
  END IF;

  UPDATE hive.hives
     SET kind = v_kind,
         updated_at = now()
   WHERE id = p_hive_id;

  INSERT INTO hive.audit_events (
    id,
    owner_user_id,
    case_id,
    event_type,
    actor_user_id,
    actor_type,
    safe_metadata,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_uid,
    p_hive_id,
    'hive_kind_changed',
    v_uid,
    'USER',
    jsonb_build_object('previousKind', v_prev, 'kind', v_kind),
    now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_hive(text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_hive(text, text, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_hive_kind(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_hive_kind(uuid, text) TO authenticated;

COMMIT;