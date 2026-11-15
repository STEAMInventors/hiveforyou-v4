-- FL-5 (F-028): hive membership, invitations, membership-based authorization helpers and RPCs.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. hive.hive_members
-- ---------------------------------------------------------------------------
CREATE TABLE hive.hive_members (
  hive_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  state text NOT NULL,
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_hive_members PRIMARY KEY (hive_id, user_id),
  CONSTRAINT fk_hive_members__hive FOREIGN KEY (hive_id) REFERENCES hive.hives (id) ON DELETE CASCADE,
  CONSTRAINT fk_hive_members__user FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT fk_hive_members__invited_by FOREIGN KEY (invited_by) REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT ck_hive_members__role CHECK (role IN ('owner', 'professional', 'client')),
  CONSTRAINT ck_hive_members__state CHECK (state IN ('active', 'left', 'removed', 'pending'))
);

CREATE INDEX idx_hive_members__user_active ON hive.hive_members (user_id) WHERE state = 'active';

-- ---------------------------------------------------------------------------
-- 2. hive.hive_invitations
-- ---------------------------------------------------------------------------
CREATE TABLE hive.hive_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL REFERENCES hive.hives (id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  invited_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hive_invitations__role CHECK (role IN ('professional', 'client')),
  CONSTRAINT ck_hive_invitations__email CHECK (email = lower(btrim(email)))
);

CREATE UNIQUE INDEX uq_hive_invitations__open_per_email
  ON hive.hive_invitations (hive_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX uq_hive_invitations__token_hash ON hive.hive_invitations (token_hash);

-- ---------------------------------------------------------------------------
-- 3. Membership helpers (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.is_hive_member(p_hive_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hive.hive_members m
      JOIN hive.hives h ON h.id = m.hive_id
     WHERE m.hive_id = p_hive_id
       AND m.user_id = auth.uid()
       AND m.state = 'active'
       AND h.archived_at IS NULL
       AND h.deleting_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION hive.is_hive_owner(p_hive_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hive.hive_members m
      JOIN hive.hives h ON h.id = m.hive_id
     WHERE m.hive_id = p_hive_id
       AND m.user_id = auth.uid()
       AND m.role = 'owner'
       AND m.state = 'active'
       AND h.archived_at IS NULL
       AND h.deleting_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION hive.require_hive_member(p_hive_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT hive.is_hive_member(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT h.owner_user_id INTO v_owner FROM hive.hives h WHERE h.id = p_hive_id;
  RETURN v_owner;
END;
$$;

CREATE OR REPLACE FUNCTION hive.require_hive_owner(p_hive_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT hive.is_hive_owner(p_hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT h.owner_user_id INTO v_owner FROM hive.hives h WHERE h.id = p_hive_id;
  RETURN v_owner;
END;
$$;

CREATE OR REPLACE FUNCTION hive.require_owned_hive(p_hive_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT hive.is_hive_owner(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION hive.insert_owner_member(p_hive_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
BEGIN
  INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by)
  VALUES (p_hive_id, p_user_id, 'owner', 'active', p_user_id)
  ON CONFLICT (hive_id, user_id) DO UPDATE
    SET role = 'owner',
        state = 'active',
        updated_at = now()
    WHERE hive.hive_members.state <> 'active' OR hive.hive_members.role <> 'owner';
END;
$$;

CREATE OR REPLACE FUNCTION hive.write_membership_audit(
  p_hive_id uuid,
  p_owner_user_id uuid,
  p_event_type text,
  p_safe_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  INSERT INTO hive.audit_events (
    id, owner_user_id, case_id, event_type, actor_user_id, actor_type, safe_metadata, created_at
  ) VALUES (
    gen_random_uuid(),
    p_owner_user_id,
    p_hive_id,
    p_event_type,
    v_uid,
    'USER',
    coalesce(p_safe_metadata, '{}'::jsonb),
    now()
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Backfill owner members
-- ---------------------------------------------------------------------------
INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by, created_at, updated_at)
SELECT h.id, h.owner_user_id, 'owner', 'active', h.owner_user_id, h.created_at, h.updated_at
  FROM hive.hives h
ON CONFLICT (hive_id, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Invitation and membership RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_invitation(
  p_hive_id uuid,
  p_email text,
  p_role text,
  p_token_hash text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_row hive.hive_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  v_owner := hive.require_hive_owner(p_hive_id);
  IF v_email = '' OR v_hash = '' OR char_length(v_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('professional', 'client') THEN
    RAISE EXCEPTION 'invalid_request:role' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = v_uid AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'invalid_request:owner_email' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM hive.hive_members m
      JOIN auth.users u ON u.id = m.user_id
     WHERE m.hive_id = p_hive_id
       AND m.state IN ('active', 'pending')
       AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'invitation_member_exists' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM hive.hive_invitations i
     WHERE i.hive_id = p_hive_id AND i.email = v_email
       AND i.accepted_at IS NULL AND i.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'invitation_already_open' USING ERRCODE = '23505';
  END IF;
  INSERT INTO hive.hive_invitations (
    hive_id, email, role, invited_by, token_hash, expires_at
  ) VALUES (
    p_hive_id, v_email, v_role, v_uid, v_hash, now() + interval '7 days'
  )
  RETURNING * INTO v_row;

  PERFORM hive.write_membership_audit(
    p_hive_id, v_owner, 'invitation_created',
    jsonb_build_object('invitationId', v_row.id, 'role', v_role)
  );

  RETURN json_build_object(
    'invitationId', v_row.id,
    'hiveId', v_row.hive_id,
    'email', v_row.email,
    'role', v_row.role,
    'expiresAt', v_row.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_invitation(p_token_hash text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_row hive.hive_invitations%ROWTYPE;
  v_status text;
  v_hive_name text;
BEGIN
  IF v_hash = '' OR char_length(v_hash) <> 64 THEN
    RETURN json_build_object('status', 'invalid');
  END IF;
  SELECT * INTO v_row FROM hive.hive_invitations i WHERE i.token_hash = v_hash LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('status', 'invalid');
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    v_status := 'revoked';
  ELSIF v_row.accepted_at IS NOT NULL THEN
    v_status := 'used';
  ELSIF v_row.expires_at <= now() THEN
    v_status := 'expired';
  ELSE
    v_status := 'valid';
  END IF;
  SELECT h.name INTO v_hive_name FROM hive.hives h WHERE h.id = v_row.hive_id;
  RETURN json_build_object(
    'status', v_status,
    'invitationId', v_row.id,
    'hiveId', v_row.hive_id,
    'hiveName', v_hive_name,
    'email', v_row.email,
    'role', v_row.role
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token_hash text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_email text;
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_row hive.hive_invitations%ROWTYPE;
  v_owner uuid;
  v_starting_view text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF v_hash = '' OR char_length(v_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT lower(u.email) INTO v_user_email FROM auth.users u WHERE u.id = v_uid;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
    FROM hive.hive_invitations i
   WHERE i.token_hash = v_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_invalid' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invitation_revoked' USING ERRCODE = '42501';
  END IF;
  IF v_row.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invitation_used' USING ERRCODE = '42501';
  END IF;
  IF v_row.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation_expired' USING ERRCODE = '42501';
  END IF;
  IF v_user_email IS DISTINCT FROM v_row.email THEN
    RAISE EXCEPTION 'invitation_email_mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT h.owner_user_id INTO v_owner FROM hive.hives h WHERE h.id = v_row.hive_id;

  INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by)
  VALUES (v_row.hive_id, v_uid, v_row.role, 'active', v_row.invited_by)
  ON CONFLICT (hive_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        state = 'active',
        invited_by = EXCLUDED.invited_by,
        updated_at = now();

  UPDATE hive.hive_invitations
     SET accepted_at = now(), accepted_by = v_uid
   WHERE id = v_row.id;

  v_starting_view := CASE WHEN v_row.role = 'client' THEN 'own' ELSE 'clients' END;
  INSERT INTO hive.user_profiles (user_id, starting_view, created_at, updated_at)
  VALUES (v_uid, v_starting_view, now(), now())
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM hive.write_membership_audit(
    v_row.hive_id, v_owner, 'invitation_accepted',
    jsonb_build_object('invitationId', v_row.id, 'role', v_row.role)
  );

  RETURN json_build_object(
    'hiveId', v_row.hive_id,
    'role', v_row.role
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row hive.hive_invitations%ROWTYPE;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM hive.hive_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_owner := hive.require_hive_owner(v_row.hive_id);
  IF v_row.accepted_at IS NOT NULL OR v_row.revoked_at IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE hive.hive_invitations SET revoked_at = now() WHERE id = p_invitation_id;
  PERFORM hive.write_membership_audit(
    v_row.hive_id, v_owner, 'invitation_revoked',
    jsonb_build_object('invitationId', v_row.id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_member(p_hive_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_role text;
BEGIN
  v_owner := hive.require_hive_owner(p_hive_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT m.role INTO v_role
    FROM hive.hive_members m
   WHERE m.hive_id = p_hive_id AND m.user_id = p_user_id AND m.state = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  UPDATE hive.hive_members
     SET state = 'removed', updated_at = now()
   WHERE hive_id = p_hive_id AND user_id = p_user_id;
  PERFORM hive.write_membership_audit(
    p_hive_id, v_owner, 'member_removed',
    jsonb_build_object('removedUserId', p_user_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_hive(p_hive_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  v_owner := hive.require_hive_member(p_hive_id);
  SELECT m.role INTO v_role
    FROM hive.hive_members m
   WHERE m.hive_id = p_hive_id AND m.user_id = v_uid AND m.state = 'active';
  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  UPDATE hive.hive_members
     SET state = 'left', updated_at = now()
   WHERE hive_id = p_hive_id AND user_id = v_uid;
  PERFORM hive.write_membership_audit(
    p_hive_id, v_owner, 'member_left',
    jsonb_build_object('userId', v_uid)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_hive_people(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_people json;
  v_pending json;
BEGIN
  v_owner := hive.require_hive_member(p_hive_id);

  SELECT coalesce(json_agg(json_build_object(
    'userId', m.user_id,
    'role', m.role,
    'state', m.state,
    'displayName', p.display_name,
    'joined', true
  ) ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'professional' THEN 1 ELSE 2 END), '[]'::json)
    INTO v_people
    FROM hive.hive_members m
    LEFT JOIN hive.user_profiles p ON p.user_id = m.user_id
   WHERE m.hive_id = p_hive_id AND m.state = 'active';

  SELECT coalesce(json_agg(json_build_object(
    'invitationId', i.id,
    'email', i.email,
    'role', i.role,
    'invitedName', NULL,
    'joined', false,
    'expiresAt', i.expires_at
  ) ORDER BY i.created_at), '[]'::json)
    INTO v_pending
    FROM hive.hive_invitations i
   WHERE i.hive_id = p_hive_id
     AND i.accepted_at IS NULL
     AND i.revoked_at IS NULL
     AND i.expires_at > now();

  RETURN json_build_object('people', v_people, 'pendingInvitations', v_pending);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Core hive RPCs (membership-aware)
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
        'kind', h.kind,
        'clientRequestId', h.client_request_id,
        'createdAt', h.created_at,
        'updatedAt', h.updated_at,
        'deletingAt', h.deleting_at,
        'membershipRole', m.role,
        'isOwner', m.role = 'owner'
      )
      ORDER BY (h.deleting_at IS NOT NULL) DESC, h.created_at DESC, h.id DESC
    ),
    '[]'::json
  )
    INTO v_result
    FROM hive.hive_members m
    JOIN hive.hives h ON h.id = m.hive_id
   WHERE m.user_id = v_uid
     AND m.state = 'active'
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
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT m.role
    INTO v_role
    FROM hive.hive_members m
    JOIN hive.hives h ON h.id = m.hive_id
   WHERE m.hive_id = p_hive_id
     AND m.user_id = v_uid
     AND m.state = 'active'
     AND h.archived_at IS NULL
     AND h.deleting_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT json_build_object(
    'id', h.id,
    'hiveId', h.id,
    'name', h.name,
    'description', h.description,
    'kind', h.kind,
    'clientRequestId', h.client_request_id,
    'createdAt', h.created_at,
    'updatedAt', h.updated_at,
    'membershipRole', v_role,
    'isOwner', v_role = 'owner'
  )
    INTO v_result
    FROM hive.hives h
   WHERE h.id = p_hive_id;

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
    JOIN hive.hive_members m ON m.hive_id = h.id AND m.user_id = v_uid AND m.state = 'active'
   WHERE h.client_request_id = p_client_request_id
     AND h.archived_at IS NULL
   LIMIT 1;

  RETURN v_result;
END;
$$;

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
    PERFORM hive.insert_owner_member(v_row.id, v_uid);
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
      'updatedAt', v_row.updated_at,
      'membershipRole', 'owner',
      'isOwner', true
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

  v_owner := hive.require_hive_owner(p_hive_id);

  SELECT h.kind INTO v_prev
    FROM hive.hives h
   WHERE h.id = p_hive_id
     AND h.archived_at IS NULL
     AND h.deleting_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_prev = v_kind THEN
    RETURN;
  END IF;

  UPDATE hive.hives
     SET kind = v_kind,
         updated_at = now()
   WHERE id = p_hive_id;

  PERFORM hive.write_membership_audit(
    p_hive_id, v_owner, 'hive_kind_changed',
    jsonb_build_object('previousKind', v_prev, 'kind', v_kind)
  );
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

  IF NOT hive.is_hive_owner(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
    INTO v_hive
    FROM hive.hives h
   WHERE h.id = p_hive_id
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

CREATE OR REPLACE FUNCTION public.list_hive_source_documents(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_docs json;
BEGIN
  v_owner := hive.require_hive_member(p_hive_id);

  SELECT COALESCE(json_agg(row ORDER BY row->>'createdAt' DESC), '[]'::json)
    INTO v_docs
    FROM (
      SELECT json_build_object(
        'id', d.id,
        'hiveId', d.case_id,
        'clientRequestId', COALESCE(u.client_request_id, d.id),
        'fileName', d.original_filename,
        'mimeType', d.mime_type,
        'byteSize', d.byte_size,
        'status', 'REGISTERED',
        'failureReason', NULL,
        'scanStatus', 'UNKNOWN_TO_SCANNER',
        'readStatus', COALESCE(d.read_status, 'PENDING'),
        'registeredAt', d.created_at,
        'createdAt', d.created_at,
        'updatedAt', d.created_at,
        'canonicalGapId', d.canonical_gap_id,
        'canonicalGapStudyRevisionId', d.canonical_gap_study_revision_id,
        'canonicalGapTitle', d.canonical_gap_title
      ) AS row
        FROM hive.source_documents d
        LEFT JOIN hive.upload_operations u
          ON u.source_document_id = d.id AND u.status = 'REGISTERED'
       WHERE d.case_id = p_hive_id
         AND d.owner_user_id = v_owner
         AND d.lifecycle_status = 'ACTIVE'
         AND d.deleted_at IS NULL
      UNION ALL
      SELECT json_build_object(
        'id', u.source_document_id,
        'hiveId', u.case_id,
        'clientRequestId', u.client_request_id,
        'fileName', u.original_filename,
        'mimeType', u.mime_type,
        'byteSize', u.byte_size,
        'status', CASE WHEN u.status = 'FAILED' THEN 'REJECTED' ELSE 'PENDING' END,
        'failureReason', CASE WHEN u.status = 'FAILED' THEN 'TYPE_MISMATCH' ELSE NULL END,
        'scanStatus', 'UNKNOWN_TO_SCANNER',
        'readStatus', 'PENDING',
        'registeredAt', NULL,
        'createdAt', u.created_at,
        'updatedAt', u.updated_at,
        'canonicalGapId', NULL,
        'canonicalGapStudyRevisionId', NULL,
        'canonicalGapTitle', NULL
      ) AS row
        FROM hive.upload_operations u
       WHERE u.case_id = p_hive_id
         AND u.owner_user_id = v_owner
         AND u.status IN ('PENDING', 'STORED')
         AND NOT EXISTS (
           SELECT 1 FROM hive.source_documents d WHERE d.id = u.source_document_id
         )
    ) combined;

  RETURN json_build_object('sourceDocuments', v_docs);
END;
$$;

REVOKE ALL ON FUNCTION hive.is_hive_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION hive.is_hive_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION hive.require_hive_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hive.is_hive_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION hive.is_hive_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION hive.require_hive_member(uuid) TO authenticated;
REVOKE ALL ON FUNCTION hive.require_hive_owner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.insert_owner_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.write_membership_audit(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_invitation(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invitation(uuid, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.lookup_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_invitation(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_invitation(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.leave_hive(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_hive(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.list_hive_people(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_hive_people(uuid) TO authenticated;

COMMIT;