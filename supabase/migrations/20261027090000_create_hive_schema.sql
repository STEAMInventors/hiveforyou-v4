-- V4-002 — Establish private schema `hive`, table `hive.hives`, owner-only RLS,
-- and user-scoped SECURITY INVOKER RPCs for create, list, and get.
-- Authority: HiveForYou-DATA-MODEL.md, HiveForYou-NAMING-CONVENTIONS.md,
-- HiveForYou-SECURITY-AND-PRIVACY.md, HiveForYou-ERROR-HANDLING-OBSERVABILITY.md.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Private application schema (unexposed to direct PostgREST access)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS hive;

COMMENT ON SCHEMA hive IS 'HiveForYou V4 application schema (private; not exposed in PostgREST schemas).';

-- ---------------------------------------------------------------------------
-- 2. Table hive.hives
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.hives (
  id uuid DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  description text,
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT pk_hives PRIMARY KEY (id),
  CONSTRAINT fk_hives__users FOREIGN KEY (owner_user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT uq_hives__owner_client_request UNIQUE (owner_user_id, client_request_id),
  CONSTRAINT ck_hives__name_length CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT ck_hives__description_length CHECK (
    description IS NULL OR (description = btrim(description) AND char_length(description) BETWEEN 1 AND 500)
  )
);

COMMENT ON TABLE hive.hives IS 'User-owned Hive workspace; owner-only RLS; idempotent creation on (owner_user_id, client_request_id).';

CREATE INDEX IF NOT EXISTS idx_hives__owner_created_at
  ON hive.hives (owner_user_id, created_at DESC)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Trigger for updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hives__set_updated_at ON hive.hives;

CREATE TRIGGER trg_hives__set_updated_at
  BEFORE UPDATE ON hive.hives
  FOR EACH ROW
  EXECUTE FUNCTION hive.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security (ENABLE + FORCE) & least-privilege grants
--    V4-002 grants only SELECT and INSERT (no UPDATE or DELETE).
-- ---------------------------------------------------------------------------
ALTER TABLE hive.hives ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.hives FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_hives__select__owner ON hive.hives;
DROP POLICY IF EXISTS pol_hives__insert__owner ON hive.hives;
DROP POLICY IF EXISTS pol_hives__update__owner ON hive.hives;
DROP POLICY IF EXISTS pol_hives__delete__owner ON hive.hives;

CREATE POLICY pol_hives__select__owner
  ON hive.hives
  FOR SELECT
  TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY pol_hives__insert__owner
  ON hive.hives
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

REVOKE ALL ON SCHEMA hive FROM PUBLIC;
REVOKE ALL ON SCHEMA hive FROM anon;
GRANT USAGE ON SCHEMA hive TO authenticated;

REVOKE ALL ON hive.hives FROM PUBLIC;
REVOKE ALL ON hive.hives FROM anon;
REVOKE ALL ON hive.hives FROM authenticated;
GRANT SELECT, INSERT ON hive.hives TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. User-scoped SECURITY INVOKER RPCs in public
--    Public RPCs remain directly callable by authenticated users; they enforce
--    complete authentication, authorization, input normalization/validation,
--    and atomic idempotency at the database boundary.
-- ---------------------------------------------------------------------------
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
        'updatedAt', h.updated_at
      )
      ORDER BY h.created_at DESC, h.id DESC
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
   LIMIT 1;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_hive(
  p_name text,
  p_description text,
  p_client_request_id uuid
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

  INSERT INTO hive.hives (owner_user_id, name, description, client_request_id)
  VALUES (v_uid, v_trimmed_name, v_trimmed_desc, p_client_request_id)
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
       OR v_row.description IS DISTINCT FROM v_trimmed_desc THEN
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
      'clientRequestId', v_row.client_request_id,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at
    ),
    'created', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_hives() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_hive(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_hive_by_client_request_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_hive(text, text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_hives() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hive(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hive_by_client_request_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_hive(text, text, uuid) TO authenticated;

COMMIT;
