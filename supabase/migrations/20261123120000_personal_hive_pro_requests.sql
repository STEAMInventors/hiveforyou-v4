-- HB-2 (D-060): an accepted professional on a personal Hive can create and review
-- requests; the owner can respond. Does not change can_write_hive, message privacy,
-- documents, or accepted Studies. Not applied.
BEGIN;

CREATE OR REPLACE FUNCTION hive.can_review_requests(p_hive_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT hive.is_firm_staff(p_hive_id)
    OR EXISTS (
      SELECT 1
        FROM hive.hive_members m
        JOIN hive.hives h ON h.id = m.hive_id
       WHERE m.hive_id = p_hive_id
         AND m.user_id = auth.uid()
         AND m.role = 'professional'
         AND m.state = 'active'
         AND h.firm_id IS NULL
         AND h.archived_at IS NULL
         AND h.deleting_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION hive.can_review_requests(uuid) FROM PUBLIC, anon, authenticated;

-- Firm staff keep add_request. A personal-Hive owner does not; the invited Pro does.
CREATE OR REPLACE FUNCTION public.add_request(
  p_hive_id uuid,
  p_title text,
  p_detail text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_title text := nullif(btrim(p_title), '');
  v_detail text := nullif(btrim(coalesce(p_detail, '')), '');
  v_row hive.requests%ROWTYPE;
  v_position integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT hive.can_review_requests(p_hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_title IS NULL OR char_length(v_title) > 500 THEN
    RAISE EXCEPTION 'invalid_request:title' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(r.position), 0) + 1 INTO v_position FROM hive.requests r WHERE r.hive_id = p_hive_id;

  INSERT INTO hive.requests (
    hive_id, source, pack_row_key, title, detail, position, state, created_by
  ) VALUES (
    p_hive_id, 'staff', NULL, v_title, v_detail, v_position, 'WAITING', v_uid
  )
  RETURNING * INTO v_row;

  PERFORM hive.append_request_event(v_row.id, NULL, 'WAITING', v_uid, 'person', NULL);

  RETURN json_build_object(
    'requestId', v_row.id,
    'hiveId', v_row.hive_id,
    'title', v_row.title,
    'state', v_row.state,
    'position', v_row.position
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_resolve_request(
  p_request_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req hive.requests%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_to text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM hive.requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT hive.can_review_requests(v_req.hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('ACCEPT', 'NOT_NEEDED', 'ASK_AGAIN') THEN
    RAISE EXCEPTION 'invalid_request:action' USING ERRCODE = '22023';
  END IF;

  v_to := CASE p_action
    WHEN 'ACCEPT' THEN 'CHECKED'
    WHEN 'NOT_NEEDED' THEN 'NOT_NEEDED'
    WHEN 'ASK_AGAIN' THEN 'WAITING'
  END;

  UPDATE hive.requests
  SET
    state = v_to,
    state_note = CASE
      WHEN p_action = 'ASK_AGAIN' THEN v_note
      WHEN p_action IN ('ACCEPT', 'NOT_NEEDED') THEN NULL
      ELSE state_note
    END,
    accepted_by = CASE WHEN p_action = 'ACCEPT' THEN v_uid ELSE accepted_by END,
    updated_at = now()
  WHERE id = p_request_id;

  PERFORM hive.append_request_event(
    p_request_id, v_req.state, v_to, v_uid, 'person', v_note
  );

  RETURN json_build_object('requestId', p_request_id, 'state', v_to, 'stateNote', v_note);
END;
$$;

-- The personal-Hive owner can respond even though can_write_hive is true.
-- Reviewers (firm staff and the invited Pro) still cannot.
CREATE OR REPLACE FUNCTION public.respond_to_request(
  p_request_id uuid,
  p_response text,
  p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req hive.requests%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_last hive.request_events%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_response IS NULL OR p_response NOT IN ('DONT_HAVE', 'DOESNT_APPLY') THEN
    RAISE EXCEPTION 'invalid_request:response' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'invalid_request:note' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req FROM hive.requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT hive.can_upload_to_hive(v_req.hive_id) OR hive.can_review_requests(v_req.hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF v_req.state = 'NEEDS_REVIEW' THEN
    SELECT * INTO v_last
      FROM hive.request_events e
     WHERE e.request_id = p_request_id
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 1;
    IF v_last.kind = 'response'
       AND v_last.actor_user_id = v_uid
       AND v_last.response = p_response
       AND v_last.note IS NOT DISTINCT FROM v_note THEN
      RETURN json_build_object(
        'requestId', p_request_id, 'state', v_req.state, 'stateNote', v_req.state_note, 'duplicate', true
      );
    END IF;
  END IF;

  IF v_req.state NOT IN ('WAITING', 'NEEDS_FIX', 'DOESNT_MATCH') THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023';
  END IF;

  UPDATE hive.requests
     SET state = 'NEEDS_REVIEW', state_note = v_note, updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO hive.request_events (
    request_id, from_state, to_state, actor_user_id, actor_kind, note, kind, response
  ) VALUES (
    p_request_id, v_req.state, 'NEEDS_REVIEW', v_uid, 'person', v_note, 'response', p_response
  );

  RETURN json_build_object(
    'requestId', p_request_id, 'state', 'NEEDS_REVIEW', 'stateNote', v_note, 'duplicate', false
  );
END;
$$;

-- Accepting a professional invitation stays pending (existing contract).
-- Joining a personal Hive is a separate step that establishes membership.
CREATE OR REPLACE FUNCTION public.activate_professional_membership(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_member hive.hive_members%ROWTYPE;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_member
    FROM hive.hive_members m
   WHERE m.hive_id = p_hive_id
     AND m.user_id = v_uid
     AND m.role = 'professional'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_member.state = 'active' THEN
    RETURN json_build_object('hiveId', p_hive_id, 'memberState', 'active', 'duplicate', true);
  END IF;
  IF v_member.state <> 'pending' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM hive.hives h
     WHERE h.id = p_hive_id
       AND h.firm_id IS NULL
       AND h.archived_at IS NULL
       AND h.deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  UPDATE hive.hive_members
     SET state = 'active', updated_at = now()
   WHERE hive_id = p_hive_id AND user_id = v_uid;

  SELECT h.owner_user_id INTO v_owner FROM hive.hives h WHERE h.id = p_hive_id;
  PERFORM hive.write_membership_audit(
    p_hive_id, v_owner, 'member_activated',
    jsonb_build_object('userId', v_uid, 'role', 'professional')
  );

  RETURN json_build_object('hiveId', p_hive_id, 'memberState', 'active', 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.activate_professional_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_professional_membership(uuid) TO authenticated;

-- Owner can see a professional who accepted but has not joined yet.
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
    'joined', m.state = 'active'
  ) ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'professional' THEN 1 ELSE 2 END), '[]'::json)
    INTO v_people
    FROM hive.hive_members m
    LEFT JOIN hive.user_profiles p ON p.user_id = m.user_id
   WHERE m.hive_id = p_hive_id
     AND (m.state = 'active' OR (m.state = 'pending' AND m.role = 'professional'));

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

COMMIT;

NOTIFY pgrst, 'reload schema';
