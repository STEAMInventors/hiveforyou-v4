-- FL-11: firms, firm membership, hive assignment, team notes, and firm-aware hive RPCs.
BEGIN;

CREATE TABLE IF NOT EXISTS hive.firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  assistant_name text,
  practice_areas text[] NOT NULL DEFAULT '{}',
  places text[] NOT NULL DEFAULT '{}',
  languages text[] NOT NULL DEFAULT '{}',
  bio text,
  listed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_firms__name CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT ck_firms__assistant_name CHECK (
    assistant_name IS NULL OR (assistant_name = btrim(assistant_name) AND char_length(assistant_name) BETWEEN 1 AND 40)
  ),
  CONSTRAINT ck_firms__bio CHECK (bio IS NULL OR char_length(bio) <= 600)
);

CREATE TABLE IF NOT EXISTS hive.firm_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES hive.firms (id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  invited_email text NOT NULL,
  role text NOT NULL,
  title text NOT NULL,
  state text NOT NULL,
  token_hash text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_firm_members__role CHECK (role IN ('owner', 'attorney', 'member')),
  CONSTRAINT ck_firm_members__state CHECK (state IN ('invited', 'active', 'removed')),
  CONSTRAINT ck_firm_members__title CHECK (title = btrim(title) AND char_length(title) BETWEEN 1 AND 40),
  CONSTRAINT ck_firm_members__invited_email CHECK (invited_email = lower(btrim(invited_email)))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_firm_members__one_active_firm_per_user
  ON hive.firm_members (user_id)
  WHERE state = 'active' AND user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_firm_members__open_invite_per_email
  ON hive.firm_members (firm_id, invited_email)
  WHERE state = 'invited';

CREATE UNIQUE INDEX IF NOT EXISTS uq_firm_members__token_hash
  ON hive.firm_members (token_hash)
  WHERE token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_firm_members__firm_active ON hive.firm_members (firm_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_firm_members__user_active ON hive.firm_members (user_id) WHERE state = 'active';

ALTER TABLE hive.hives
  ADD COLUMN IF NOT EXISTS firm_id uuid REFERENCES hive.firms (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignee_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS stage_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage_at timestamptz;

ALTER TABLE hive.hives DROP CONSTRAINT IF EXISTS ck_hives__stage;
ALTER TABLE hive.hives
  ADD CONSTRAINT ck_hives__stage CHECK (stage IN ('open', 'review', 'closed'));

CREATE INDEX IF NOT EXISTS idx_hives__firm_id ON hive.hives (firm_id) WHERE firm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hives__assignee ON hive.hives (assignee_user_id) WHERE assignee_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hive.hive_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL REFERENCES hive.hives (id) ON DELETE CASCADE,
  from_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hive_handovers__note CHECK (note IS NULL OR char_length(note) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_hive_handovers__hive ON hive.hive_handovers (hive_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hive.team_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL REFERENCES hive.hives (id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  body text NOT NULL,
  item_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_team_notes__body CHECK (body = btrim(body) AND char_length(body) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_team_notes__hive ON hive.team_notes (hive_id, created_at DESC);

CREATE OR REPLACE FUNCTION hive.firm_role(p_firm_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT fm.role
    FROM hive.firm_members fm
   WHERE fm.firm_id = p_firm_id
     AND fm.user_id = auth.uid()
     AND fm.state = 'active'
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION hive.caller_active_firm_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT fm.firm_id
    FROM hive.firm_members fm
   WHERE fm.user_id = auth.uid()
     AND fm.state = 'active'
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION hive.is_firm_attorney_or_owner(p_firm_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hive.firm_members fm
     WHERE fm.firm_id = p_firm_id
       AND fm.user_id = auth.uid()
       AND fm.state = 'active'
       AND fm.role IN ('owner', 'attorney')
  );
$$;

CREATE OR REPLACE FUNCTION hive.is_firm_staff(p_hive_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hive.hives h
      JOIN hive.firm_members fm ON fm.firm_id = h.firm_id
     WHERE h.id = p_hive_id
       AND h.firm_id IS NOT NULL
       AND fm.user_id = auth.uid()
       AND fm.state = 'active'
       AND h.archived_at IS NULL
       AND h.deleting_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION hive.can_write_hive(p_hive_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hive.hives h
     WHERE h.id = p_hive_id
       AND h.archived_at IS NULL
       AND h.deleting_at IS NULL
       AND (
         EXISTS (
           SELECT 1
             FROM hive.hive_members m
            WHERE m.hive_id = h.id
              AND m.user_id = auth.uid()
              AND m.role = 'owner'
              AND m.state = 'active'
         )
         OR (
           h.firm_id IS NOT NULL
           AND EXISTS (
             SELECT 1
               FROM hive.firm_members fm
              WHERE fm.firm_id = h.firm_id
                AND fm.user_id = auth.uid()
                AND fm.state = 'active'
           )
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION hive.can_delete_hive(p_hive_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hive.hives h
     WHERE h.id = p_hive_id
       AND h.archived_at IS NULL
       AND (
         EXISTS (
           SELECT 1
             FROM hive.hive_members m
            WHERE m.hive_id = h.id
              AND m.user_id = auth.uid()
              AND m.role = 'owner'
              AND m.state = 'active'
         )
         OR (
           h.firm_id IS NOT NULL
           AND EXISTS (
             SELECT 1
               FROM hive.firm_members fm
              WHERE fm.firm_id = h.firm_id
                AND fm.user_id = auth.uid()
                AND fm.state = 'active'
                AND fm.role IN ('owner', 'attorney')
           )
         )
       )
  );
$$;

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
  )
  OR hive.is_firm_staff(p_hive_id);
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
  IF NOT hive.can_write_hive(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION hive.write_firm_audit(
  p_owner_user_id uuid,
  p_hive_id uuid,
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

ALTER TABLE hive.firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.firms FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.firm_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.firm_members FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.hive_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.hive_handovers FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.team_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.team_notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_firms__select ON hive.firms;
CREATE POLICY pol_firms__select ON hive.firms
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hive.firm_members fm
       WHERE fm.firm_id = id AND fm.user_id = auth.uid() AND fm.state = 'active'
    )
  );

DROP POLICY IF EXISTS pol_firm_members__select ON hive.firm_members;
CREATE POLICY pol_firm_members__select ON hive.firm_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hive.firm_members me
       WHERE me.firm_id = firm_members.firm_id
         AND me.user_id = auth.uid()
         AND me.state = 'active'
    )
  );

DROP POLICY IF EXISTS pol_hive_handovers__select ON hive.hive_handovers;
DROP POLICY IF EXISTS pol_hive_handovers__insert ON hive.hive_handovers;
CREATE POLICY pol_hive_handovers__select ON hive.hive_handovers
  FOR SELECT TO authenticated
  USING (hive.is_firm_staff(hive_id));

DROP POLICY IF EXISTS pol_team_notes__select ON hive.team_notes;
DROP POLICY IF EXISTS pol_team_notes__insert ON hive.team_notes;
CREATE POLICY pol_team_notes__select ON hive.team_notes
  FOR SELECT TO authenticated
  USING (hive.is_firm_staff(hive_id));

REVOKE ALL ON hive.firms FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hive.firm_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hive.hive_handovers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hive.team_notes FROM PUBLIC, anon, authenticated;

GRANT SELECT ON hive.firms TO authenticated;
GRANT SELECT (
  id,
  firm_id,
  user_id,
  invited_email,
  role,
  title,
  state,
  expires_at,
  created_at,
  updated_at
) ON hive.firm_members TO authenticated;
GRANT SELECT ON hive.hive_handovers TO authenticated;
GRANT SELECT ON hive.team_notes TO authenticated;

CREATE OR REPLACE FUNCTION public.create_firm(p_name text, p_assistant_name text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_asst text := nullif(btrim(coalesce(p_assistant_name, '')), '');
  v_row hive.firms%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'invalid_request:name' USING ERRCODE = '22023';
  END IF;
  IF v_asst IS NOT NULL AND char_length(v_asst) > 40 THEN
    RAISE EXCEPTION 'invalid_request:assistant_name' USING ERRCODE = '22023';
  END IF;
  IF hive.caller_active_firm_id() IS NOT NULL THEN
    RAISE EXCEPTION 'firm_membership_exists' USING ERRCODE = '23505';
  END IF;
  INSERT INTO hive.firms (owner_user_id, name, assistant_name)
  VALUES (v_uid, v_name, v_asst)
  RETURNING * INTO v_row;
  INSERT INTO hive.firm_members (firm_id, user_id, invited_email, role, title, state)
  SELECT v_row.id, v_uid, lower(u.email), 'owner', 'Attorney', 'active'
    FROM auth.users u WHERE u.id = v_uid;
  PERFORM hive.write_firm_audit(v_uid, NULL, 'firm_created', jsonb_build_object('firmId', v_row.id));
  RETURN json_build_object(
    'firmId', v_row.id,
    'name', v_row.name,
    'assistantName', coalesce(v_row.assistant_name, 'HiveForYou')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_firm_member(
  p_email text,
  p_title text,
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
  v_firm_id uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_title text := btrim(coalesce(p_title, ''));
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_owner uuid;
  v_row hive.firm_members%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  SELECT fm.firm_id INTO v_firm_id
    FROM hive.firm_members fm
   WHERE fm.user_id = v_uid AND fm.state = 'active' AND fm.role = 'owner'
   LIMIT 1;
  IF v_firm_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_email = '' OR v_hash = '' OR char_length(v_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('attorney', 'member') THEN
    RAISE EXCEPTION 'invalid_request:role' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_title) < 1 OR char_length(v_title) > 40 THEN
    RAISE EXCEPTION 'invalid_request:title' USING ERRCODE = '22023';
  END IF;
  SELECT f.owner_user_id INTO v_owner FROM hive.firms f WHERE f.id = v_firm_id;
  IF EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = v_uid AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'invalid_request:own_email' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM hive.firm_members fm
     WHERE fm.firm_id = v_firm_id AND fm.state = 'active' AND fm.user_id IS NOT NULL
       AND lower((SELECT u.email FROM auth.users u WHERE u.id = fm.user_id)) = v_email
  ) THEN
    RAISE EXCEPTION 'firm_member_exists' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM hive.firm_members fm
     WHERE fm.firm_id = v_firm_id AND fm.invited_email = v_email AND fm.state = 'invited'
  ) THEN
    RAISE EXCEPTION 'firm_invitation_already_open' USING ERRCODE = '23505';
  END IF;
  INSERT INTO hive.firm_members (firm_id, invited_email, role, title, state, token_hash, expires_at)
  VALUES (v_firm_id, v_email, v_role, v_title, 'invited', v_hash, now() + interval '7 days')
  RETURNING * INTO v_row;
  PERFORM hive.write_firm_audit(v_owner, NULL, 'firm_member_invited', jsonb_build_object('firmMemberId', v_row.id, 'role', v_role));
  RETURN json_build_object(
    'firmMemberId', v_row.id,
    'email', v_row.invited_email,
    'role', v_row.role,
    'title', v_row.title,
    'expiresAt', v_row.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_firm_invitation(p_token_hash text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_email text;
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_row hive.firm_members%ROWTYPE;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF v_hash = '' OR char_length(v_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF hive.caller_active_firm_id() IS NOT NULL THEN
    RAISE EXCEPTION 'firm_membership_exists' USING ERRCODE = '23505';
  END IF;

  SELECT lower(u.email) INTO v_user_email FROM auth.users u WHERE u.id = v_uid;

  SELECT * INTO v_row
    FROM hive.firm_members fm
   WHERE fm.token_hash = v_hash AND fm.state = 'invited'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'firm_invitation_invalid' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    RAISE EXCEPTION 'firm_invitation_expired' USING ERRCODE = '42501';
  END IF;
  IF v_user_email IS DISTINCT FROM v_row.invited_email THEN
    RAISE EXCEPTION 'firm_invitation_email_mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT f.owner_user_id INTO v_owner FROM hive.firms f WHERE f.id = v_row.firm_id;

  UPDATE hive.firm_members
     SET user_id = v_uid,
         state = 'active',
         token_hash = NULL,
         expires_at = NULL,
         updated_at = now()
   WHERE id = v_row.id;

  PERFORM hive.write_firm_audit(
    v_owner, NULL, 'firm_invitation_accepted',
    jsonb_build_object('firmId', v_row.firm_id, 'invitationId', v_row.id, 'role', v_row.role)
  );

  RETURN json_build_object('firmId', v_row.firm_id, 'role', v_row.role);
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_firm_invitation(p_token_hash text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_row hive.firm_members%ROWTYPE;
  v_status text;
  v_firm_name text;
BEGIN
  IF v_hash = '' OR char_length(v_hash) <> 64 THEN
    RETURN json_build_object('status', 'invalid');
  END IF;
  SELECT * INTO v_row FROM hive.firm_members fm WHERE fm.token_hash = v_hash LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('status', 'invalid');
  END IF;
  IF v_row.state = 'removed' THEN
    v_status := 'revoked';
  ELSIF v_row.state = 'active' THEN
    v_status := 'used';
  ELSIF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    v_status := 'expired';
  ELSE
    v_status := 'valid';
  END IF;
  SELECT f.name INTO v_firm_name FROM hive.firms f WHERE f.id = v_row.firm_id;
  RETURN json_build_object(
    'status', v_status,
    'firmMemberId', v_row.id,
    'firmId', v_row.firm_id,
    'firmName', v_firm_name,
    'email', v_row.invited_email,
    'role', v_row.role,
    'title', v_row.title
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_firm_member(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_firm_id uuid := hive.caller_active_firm_id();
  v_owner uuid;
  v_role text;
  v_cleared integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF v_firm_id IS NULL OR NOT hive.is_firm_attorney_or_owner(v_firm_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT f.owner_user_id INTO v_owner FROM hive.firms f WHERE f.id = v_firm_id;
  IF p_user_id = v_owner THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT fm.role INTO v_role
    FROM hive.firm_members fm
   WHERE fm.firm_id = v_firm_id AND fm.user_id = p_user_id AND fm.state = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'firm_member_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE hive.firm_members
     SET state = 'removed', updated_at = now()
   WHERE firm_id = v_firm_id AND user_id = p_user_id AND state = 'active';

  UPDATE hive.hives h
     SET assignee_user_id = NULL, updated_at = now()
   WHERE h.firm_id = v_firm_id
     AND h.assignee_user_id = p_user_id
     AND h.archived_at IS NULL;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  PERFORM hive.write_firm_audit(
    v_owner, NULL, 'firm_member_removed',
    jsonb_build_object('firmId', v_firm_id, 'removedUserId', p_user_id, 'assigneesCleared', v_cleared)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_assistant_name(p_assistant_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_firm_id uuid := hive.caller_active_firm_id();
  v_name text := nullif(btrim(coalesce(p_assistant_name, '')), '');
  v_owner uuid;
  v_prev text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF v_firm_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT f.owner_user_id, f.assistant_name INTO v_owner, v_prev
    FROM hive.firms f WHERE f.id = v_firm_id;
  IF v_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NOT NULL AND char_length(v_name) > 40 THEN
    RAISE EXCEPTION 'invalid_request:assistant_name_too_long' USING ERRCODE = '22023';
  END IF;

  UPDATE hive.firms SET assistant_name = v_name, updated_at = now() WHERE id = v_firm_id;

  PERFORM hive.write_firm_audit(
    v_owner, NULL, 'firm_assistant_name_set',
    jsonb_build_object('firmId', v_firm_id, 'previousAssistantName', v_prev, 'assistantName', v_name)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_firm_profile(
  p_name text DEFAULT NULL,
  p_practice_areas text[] DEFAULT NULL,
  p_places text[] DEFAULT NULL,
  p_languages text[] DEFAULT NULL,
  p_bio text DEFAULT NULL,
  p_listed boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_firm_id uuid := hive.caller_active_firm_id();
  v_name text;
  v_bio text;
  v_owner uuid;
  v_row hive.firms%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF v_firm_id IS NULL OR NOT hive.is_firm_attorney_or_owner(v_firm_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT f.owner_user_id INTO v_owner FROM hive.firms f WHERE f.id = v_firm_id FOR UPDATE;

  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF char_length(v_name) < 1 OR char_length(v_name) > 100 THEN
      RAISE EXCEPTION 'invalid_request:name' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_bio IS NOT NULL THEN
    v_bio := nullif(btrim(p_bio), '');
    IF v_bio IS NOT NULL AND char_length(v_bio) > 600 THEN
      RAISE EXCEPTION 'invalid_request:bio_too_long' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE hive.firms f
     SET name = coalesce(v_name, f.name),
         practice_areas = coalesce(p_practice_areas, f.practice_areas),
         places = coalesce(p_places, f.places),
         languages = coalesce(p_languages, f.languages),
         bio = CASE WHEN p_bio IS NULL THEN f.bio ELSE v_bio END,
         listed = coalesce(p_listed, f.listed),
         updated_at = now()
   WHERE f.id = v_firm_id
  RETURNING * INTO v_row;

  PERFORM hive.write_firm_audit(
    v_owner, NULL, 'firm_profile_updated',
    jsonb_build_object('firmId', v_firm_id)
  );

  RETURN json_build_object(
    'firmId', v_row.id,
    'name', v_row.name,
    'assistantName', v_row.assistant_name,
    'practiceAreas', v_row.practice_areas,
    'places', v_row.places,
    'languages', v_row.languages,
    'bio', v_row.bio,
    'listed', v_row.listed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_firm()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_firm_id uuid;
  v_firm json;
  v_members json;
  v_pending json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  v_firm_id := hive.caller_active_firm_id();
  IF v_firm_id IS NULL THEN
    RETURN json_build_object('firm', NULL);
  END IF;

  SELECT json_build_object(
    'firmId', f.id,
    'name', f.name,
    'assistantName', f.assistant_name,
    'practiceAreas', f.practice_areas,
    'places', f.places,
    'languages', f.languages,
    'bio', f.bio,
    'listed', f.listed,
    'ownerUserId', f.owner_user_id,
    'callerRole', hive.firm_role(v_firm_id)
  )
    INTO v_firm
    FROM hive.firms f
   WHERE f.id = v_firm_id;

  SELECT coalesce(json_agg(json_build_object(
    'userId', fm.user_id,
    'email', coalesce(lower(u.email), fm.invited_email),
    'role', fm.role,
    'title', fm.title,
    'state', fm.state,
    'displayName', p.display_name,
    'joined', fm.state = 'active' AND fm.user_id IS NOT NULL
  ) ORDER BY CASE fm.role WHEN 'owner' THEN 0 WHEN 'attorney' THEN 1 ELSE 2 END, fm.created_at), '[]'::json)
    INTO v_members
    FROM hive.firm_members fm
    LEFT JOIN auth.users u ON u.id = fm.user_id
    LEFT JOIN hive.user_profiles p ON p.user_id = fm.user_id
   WHERE fm.firm_id = v_firm_id AND fm.state = 'active';

  SELECT coalesce(json_agg(json_build_object(
    'invitationId', fm.id,
    'email', fm.invited_email,
    'role', fm.role,
    'title', fm.title,
    'expiresAt', fm.expires_at
  ) ORDER BY fm.created_at), '[]'::json)
    INTO v_pending
    FROM hive.firm_members fm
   WHERE fm.firm_id = v_firm_id AND fm.state = 'invited';

  RETURN json_build_object('firm', v_firm, 'members', v_members, 'pendingInvitations', v_pending);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_hive(
  p_hive_id uuid,
  p_assignee_user_id uuid,
  p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hive hive.hives%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_prev uuid;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT hive.is_firm_staff(p_hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'invalid_request:note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_hive
    FROM hive.hives h
   WHERE h.id = p_hive_id
     AND h.archived_at IS NULL
     AND h.deleting_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_hive.firm_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:not_firm_hive' USING ERRCODE = '22023';
  END IF;
  IF v_hive.stage = 'closed' THEN
    RAISE EXCEPTION 'hive_stage_closed' USING ERRCODE = '42501';
  END IF;

  IF p_assignee_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM hive.firm_members fm
     WHERE fm.firm_id = v_hive.firm_id AND fm.user_id = p_assignee_user_id AND fm.state = 'active'
  ) THEN
    RAISE EXCEPTION 'assignee_not_firm_member' USING ERRCODE = '22023';
  END IF;

  v_prev := v_hive.assignee_user_id;
  v_owner := v_hive.owner_user_id;

  IF v_prev IS NOT DISTINCT FROM p_assignee_user_id THEN
    RETURN json_build_object('hiveId', p_hive_id, 'assigneeUserId', p_assignee_user_id, 'changed', false);
  END IF;

  UPDATE hive.hives
     SET assignee_user_id = p_assignee_user_id, updated_at = now()
   WHERE id = p_hive_id;

  IF p_assignee_user_id IS NOT NULL AND (v_prev IS DISTINCT FROM p_assignee_user_id) THEN
    INSERT INTO hive.hive_handovers (hive_id, from_user_id, to_user_id, note)
    VALUES (p_hive_id, v_prev, p_assignee_user_id, v_note);
  END IF;

  PERFORM hive.write_firm_audit(
    v_owner, p_hive_id, 'hive_assigned',
    jsonb_build_object(
      'firmId', v_hive.firm_id,
      'previousAssigneeUserId', v_prev,
      'assigneeUserId', p_assignee_user_id
    )
  );

  RETURN json_build_object('hiveId', p_hive_id, 'assigneeUserId', p_assignee_user_id, 'changed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_all(p_from_user_id uuid, p_to_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_firm_id uuid;
  v_owner uuid;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  SELECT fm.firm_id INTO v_firm_id
    FROM hive.firm_members fm
   WHERE fm.user_id = v_uid AND fm.state = 'active' AND fm.role = 'owner'
   LIMIT 1;
  IF v_firm_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT f.owner_user_id INTO v_owner FROM hive.firms f WHERE f.id = v_firm_id;
  IF NOT EXISTS (
    SELECT 1 FROM hive.firm_members fm
     WHERE fm.firm_id = v_firm_id AND fm.user_id = p_to_user_id AND fm.state = 'active'
  ) THEN
    RAISE EXCEPTION 'invalid_request:assignee_not_staff' USING ERRCODE = '22023';
  END IF;
  UPDATE hive.hives h
     SET assignee_user_id = p_to_user_id, updated_at = now()
   WHERE h.firm_id = v_firm_id AND h.assignee_user_id = p_from_user_id AND h.stage <> 'closed';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM hive.write_firm_audit(v_owner, NULL, 'firm_reassign_all', jsonb_build_object('from', p_from_user_id, 'to', p_to_user_id, 'count', v_count));
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_hive_stage(p_hive_id uuid, p_stage text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_stage text := lower(btrim(coalesce(p_stage, '')));
  v_hive hive.hives%ROWTYPE;
  v_firm_id uuid;
  v_role text;
  v_prev text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;
  IF v_stage NOT IN ('open', 'review', 'closed') THEN
    RAISE EXCEPTION 'invalid_request:stage' USING ERRCODE = '22023';
  END IF;
  IF NOT hive.is_firm_staff(p_hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_hive
    FROM hive.hives h
   WHERE h.id = p_hive_id AND h.archived_at IS NULL AND h.deleting_at IS NULL
   FOR UPDATE;
  IF NOT FOUND OR v_hive.firm_id IS NULL THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_firm_id := v_hive.firm_id;
  v_prev := v_hive.stage;
  v_role := hive.firm_role(v_firm_id);

  IF v_stage = v_prev THEN
    RETURN json_build_object('hiveId', p_hive_id, 'stage', v_stage, 'changed', false);
  END IF;

  IF v_stage IN ('closed', 'open') AND v_prev = 'closed' THEN
    IF NOT hive.is_firm_attorney_or_owner(v_firm_id) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
  ELSIF v_stage = 'closed' THEN
    IF NOT hive.is_firm_attorney_or_owner(v_firm_id) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
  ELSIF v_stage = 'review' AND v_prev = 'open' THEN
    NULL;
  ELSIF v_stage = 'open' AND v_prev = 'review' THEN
    IF NOT hive.is_firm_attorney_or_owner(v_firm_id) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_request:stage_transition' USING ERRCODE = '22023';
  END IF;

  UPDATE hive.hives
     SET stage = v_stage,
         stage_by = v_uid,
         stage_at = now(),
         updated_at = now()
   WHERE id = p_hive_id;

  PERFORM hive.write_firm_audit(
    v_hive.owner_user_id, p_hive_id, 'hive_stage_changed',
    jsonb_build_object(
      'firmId', v_firm_id,
      'previousStage', v_prev,
      'stage', v_stage,
      'firmRole', v_role
    )
  );

  RETURN json_build_object('hiveId', p_hive_id, 'stage', v_stage, 'changed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_team_note(
  p_hive_id uuid,
  p_body text,
  p_item_ref text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_item_ref text := nullif(btrim(coalesce(p_item_ref, '')), '');
  v_owner uuid;
  v_row hive.team_notes%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT hive.is_firm_staff(p_hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'invalid_request:body' USING ERRCODE = '22023';
  END IF;

  SELECT h.owner_user_id INTO v_owner FROM hive.hives h WHERE h.id = p_hive_id;

  INSERT INTO hive.team_notes (hive_id, author_user_id, body, item_ref)
  VALUES (p_hive_id, v_uid, v_body, v_item_ref)
  RETURNING * INTO v_row;

  PERFORM hive.write_firm_audit(
    v_owner, p_hive_id, 'team_note_added',
    jsonb_build_object('teamNoteId', v_row.id, 'itemRef', v_item_ref)
  );

  RETURN json_build_object(
    'teamNoteId', v_row.id,
    'hiveId', v_row.hive_id,
    'authorUserId', v_row.author_user_id,
    'body', v_row.body,
    'itemRef', v_row.item_ref,
    'createdAt', v_row.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_team_notes(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_notes json;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT hive.is_firm_staff(p_hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(json_agg(json_build_object(
    'teamNoteId', n.id,
    'hiveId', n.hive_id,
    'authorUserId', n.author_user_id,
    'authorDisplayName', p.display_name,
    'body', n.body,
    'itemRef', n.item_ref,
    'createdAt', n.created_at
  ) ORDER BY n.created_at DESC, n.id DESC), '[]'::json)
    INTO v_notes
    FROM hive.team_notes n
    LEFT JOIN hive.user_profiles p ON p.user_id = n.author_user_id
   WHERE n.hive_id = p_hive_id;

  RETURN json_build_object('teamNotes', v_notes);
END;
$$;

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
  IF NOT hive.can_write_hive(p_hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT h.owner_user_id INTO v_owner FROM hive.hives h WHERE h.id = p_hive_id;
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

CREATE OR REPLACE FUNCTION public.create_hive(
  p_name text,
  p_description text,
  p_client_request_id uuid,
  p_kind text DEFAULT 'own'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_firm_id uuid := hive.caller_active_firm_id();
  v_trimmed_name text := btrim(coalesce(p_name, ''));
  v_trimmed_desc text := CASE
    WHEN p_description IS NULL OR btrim(p_description) = '' THEN NULL
    ELSE btrim(p_description)
  END;
  v_kind text := lower(btrim(coalesce(p_kind, 'own')));
  v_row hive.hives%ROWTYPE;
  v_created boolean := false;
  v_set_firm boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:client_request_id_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_trimmed_name) < 1 OR char_length(v_trimmed_name) > 100 THEN
    RAISE EXCEPTION 'invalid_request:name_required' USING ERRCODE = '22023';
  END IF;
  IF v_trimmed_desc IS NOT NULL AND char_length(v_trimmed_desc) > 500 THEN
    RAISE EXCEPTION 'invalid_request:description_too_long' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('own', 'client') THEN
    RAISE EXCEPTION 'invalid_request:kind' USING ERRCODE = '22023';
  END IF;

  v_set_firm := v_kind = 'client' AND v_firm_id IS NOT NULL;

  INSERT INTO hive.hives (
    owner_user_id, name, description, client_request_id, kind,
    firm_id, assignee_user_id, stage
  )
  VALUES (
    v_uid, v_trimmed_name, v_trimmed_desc, p_client_request_id, v_kind,
    CASE WHEN v_set_firm THEN v_firm_id ELSE NULL END,
    NULL,
    'open'
  )
  ON CONFLICT ON CONSTRAINT uq_hives__owner_client_request DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_created := true;
    INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by)
    VALUES (v_row.id, v_uid, 'owner', 'active', v_uid)
    ON CONFLICT (hive_id, user_id) DO UPDATE
      SET role = 'owner', state = 'active', updated_at = now()
      WHERE hive.hive_members.state <> 'active' OR hive.hive_members.role <> 'owner';

    IF v_set_firm THEN
      PERFORM hive.write_firm_audit(
        v_uid, v_row.id, 'firm_hive_created',
        jsonb_build_object('firmId', v_firm_id, 'kind', v_kind)
      );
    END IF;
  ELSE
    SELECT * INTO v_row
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
        USING ERRCODE = '23505', CONSTRAINT = 'uq_hives__owner_client_request';
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
      'firmId', v_row.firm_id,
      'assigneeUserId', v_row.assignee_user_id,
      'stage', v_row.stage,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at,
      'membershipRole', 'owner',
      'isOwner', true
    ),
    'created', v_created
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_hives()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result json;
  v_firm_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  v_firm_id := hive.caller_active_firm_id();

  SELECT coalesce(json_agg(row ORDER BY row ->> 'sortKey' DESC), '[]'::json)
    INTO v_result
    FROM (
      SELECT json_build_object(
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
        'isOwner', m.role = 'owner',
        'memberState', m.state,
        'ownerDisplayName', op.display_name,
        'firmId', h.firm_id,
        'assigneeUserId', h.assignee_user_id,
        'stage', h.stage,
        'assigneeDisplayName', ap.display_name,
        'clientShareStatus', CASE WHEN m.role <> 'owner' OR h.kind <> 'client' THEN NULL
          WHEN EXISTS (SELECT 1 FROM hive.hive_members cm WHERE cm.hive_id = h.id AND cm.role = 'client' AND cm.state = 'active') THEN 'client_joined'
          WHEN EXISTS (SELECT 1 FROM hive.hive_invitations i WHERE i.hive_id = h.id AND i.role = 'client' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN 'invited'
          ELSE NULL END,
        'homeKicker', CASE
          WHEN m.role = 'client' AND m.state = 'active' THEN 'Your hive with ' || coalesce(op.display_name, 'the owner')
          WHEN m.role = 'professional' AND m.state = 'pending' THEN 'invited'
          WHEN m.role = 'owner' AND h.kind = 'client' THEN coalesce(h.description, h.name) || coalesce(
            CASE WHEN EXISTS (SELECT 1 FROM hive.hive_members cm WHERE cm.hive_id = h.id AND cm.role = 'client' AND cm.state = 'active') THEN ' · client joined'
                 WHEN EXISTS (SELECT 1 FROM hive.hive_invitations i WHERE i.hive_id = h.id AND i.role = 'client' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN ' · invited'
            END, '')
          ELSE NULL END
          || CASE WHEN h.firm_id IS NOT NULL AND m.state IN ('active', 'pending') THEN
            CASE WHEN h.stage = 'closed' THEN ' · closed'
                 WHEN h.assignee_user_id IS NULL THEN ' · unassigned'
                 WHEN h.assignee_user_id = v_uid THEN ' · you on it'
                 ELSE ' · ' || split_part(btrim(coalesce(nullif(ap.display_name, ''), 'someone')), ' ', 1) || ' on it'
            END
          ELSE '' END,
        'sortKey', (h.deleting_at IS NOT NULL)::text || h.created_at::text || h.id::text
      ) AS row
        FROM hive.hive_members m
        JOIN hive.hives h ON h.id = m.hive_id
        LEFT JOIN hive.user_profiles op ON op.user_id = h.owner_user_id
        LEFT JOIN hive.user_profiles ap ON ap.user_id = h.assignee_user_id
       WHERE m.user_id = v_uid AND m.state IN ('active', 'pending') AND h.archived_at IS NULL

      UNION

      SELECT json_build_object(
        'id', h.id,
        'hiveId', h.id,
        'name', h.name,
        'description', h.description,
        'kind', h.kind,
        'clientRequestId', h.client_request_id,
        'createdAt', h.created_at,
        'updatedAt', h.updated_at,
        'deletingAt', h.deleting_at,
        'membershipRole', 'firm',
        'isOwner', false,
        'memberState', 'active',
        'ownerDisplayName', op.display_name,
        'firmId', h.firm_id,
        'assigneeUserId', h.assignee_user_id,
        'stage', h.stage,
        'assigneeDisplayName', ap.display_name,
        'clientShareStatus', CASE
          WHEN EXISTS (SELECT 1 FROM hive.hive_members cm WHERE cm.hive_id = h.id AND cm.role = 'client' AND cm.state = 'active') THEN 'client_joined'
          WHEN EXISTS (SELECT 1 FROM hive.hive_invitations i WHERE i.hive_id = h.id AND i.role = 'client' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN 'invited'
          ELSE NULL END,
        'homeKicker', coalesce(h.description, h.name)
          || CASE WHEN h.stage = 'closed' THEN ' · closed'
                  WHEN h.assignee_user_id IS NULL THEN ' · unassigned'
                  WHEN h.assignee_user_id = v_uid THEN ' · you on it'
                  ELSE ' · ' || split_part(btrim(coalesce(nullif(ap.display_name, ''), 'someone')), ' ', 1) || ' on it' END,
        'sortKey', (h.deleting_at IS NOT NULL)::text || h.created_at::text || h.id::text
      ) AS row
        FROM hive.hives h
        LEFT JOIN hive.user_profiles op ON op.user_id = h.owner_user_id
        LEFT JOIN hive.user_profiles ap ON ap.user_id = h.assignee_user_id
       WHERE v_firm_id IS NOT NULL
         AND h.firm_id = v_firm_id
         AND h.kind = 'client'
         AND h.archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM hive.hive_members m
            WHERE m.hive_id = h.id AND m.user_id = v_uid AND m.state IN ('active', 'pending')
         )
    ) combined;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hive(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  IF NOT hive.is_hive_member(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT m.role INTO v_role
    FROM hive.hive_members m
   WHERE m.hive_id = p_hive_id AND m.user_id = v_uid AND m.state IN ('active', 'pending');
  IF NOT FOUND THEN
    v_role := 'firm';
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
    'isOwner', v_role = 'owner',
    'firmId', h.firm_id,
    'assigneeUserId', h.assignee_user_id,
    'stage', h.stage,
    'assigneeDisplayName', ap.display_name,
    'stageBy', h.stage_by,
    'stageAt', h.stage_at
  )
    INTO v_result
    FROM hive.hives h
    LEFT JOIN hive.user_profiles ap ON ap.user_id = h.assignee_user_id
   WHERE h.id = p_hive_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_hive_deletion(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
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
  IF NOT hive.can_delete_hive(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_hive
    FROM hive.hives h
   WHERE h.id = p_hive_id AND h.archived_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_hive.deleting_at IS NULL THEN
    UPDATE hive.hives SET deleting_at = now(), updated_at = now() WHERE id = p_hive_id RETURNING * INTO v_hive;
    PERFORM hive.write_firm_audit(
      v_hive.owner_user_id, p_hive_id, 'hive_deletion_started',
      jsonb_build_object('firmId', v_hive.firm_id)
    );
  ELSE
    v_replayed := true;
  END IF;

  IF to_regclass('hive.source_documents') IS NOT NULL THEN
    SELECT coalesce(json_agg(d.storage_path ORDER BY d.created_at), '[]'::json)
      INTO v_paths
      FROM hive.source_documents d
     WHERE d.case_id = p_hive_id AND btrim(d.storage_path) <> '';
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

DROP POLICY IF EXISTS pol_intent_requests__insert__owner ON hive.intent_requests;
DROP POLICY IF EXISTS pol_intent_requests__insert__writer ON hive.intent_requests;
CREATE POLICY pol_intent_requests__insert__writer ON hive.intent_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    hive.can_write_hive(hive_id)
    AND EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = hive_id AND h.archived_at IS NULL AND h.deleting_at IS NULL
    )
  );

REVOKE ALL ON FUNCTION hive.firm_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION hive.caller_active_firm_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION hive.is_firm_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION hive.is_firm_attorney_or_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION hive.can_write_hive(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION hive.can_delete_hive(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION hive.write_firm_audit(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hive.is_hive_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION hive.can_write_hive(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION hive.can_delete_hive(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_firm(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_firm(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.lookup_firm_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_firm_invitation(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.revoke_firm_invitation(p_firm_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_firm_id uuid;
  v_row hive.firm_members%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_firm_member_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT fm.firm_id INTO v_firm_id
    FROM hive.firm_members fm
   WHERE fm.user_id = v_uid AND fm.state = 'active' AND fm.role = 'owner'
   LIMIT 1;
  IF v_firm_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row
    FROM hive.firm_members
   WHERE id = p_firm_member_id AND firm_id = v_firm_id AND state = 'invited'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'firm_invitation_invalid' USING ERRCODE = 'P0002';
  END IF;
  UPDATE hive.firm_members
     SET state = 'removed', token_hash = NULL, expires_at = NULL, updated_at = now()
   WHERE id = v_row.id;
  PERFORM hive.write_firm_audit(
    v_uid, NULL, 'firm_invitation_revoked',
    jsonb_build_object('firmMemberId', v_row.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_firm_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_firm_invitation(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.invite_firm_member(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_firm_member(text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.accept_firm_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_firm_invitation(text) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_firm_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_firm_member(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_assistant_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_assistant_name(text) TO authenticated;
REVOKE ALL ON FUNCTION public.update_firm_profile(text, text[], text[], text[], text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_firm_profile(text, text[], text[], text[], text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.list_firm() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_firm() TO authenticated;
REVOKE ALL ON FUNCTION public.assign_hive(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_hive(uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.reassign_all(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_all(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_hive_stage(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_hive_stage(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.add_team_note(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_team_note(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.list_team_notes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_team_notes(uuid) TO authenticated;

COMMIT;