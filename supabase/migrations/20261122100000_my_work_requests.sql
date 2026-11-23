-- HB-1 Addendum (D-059): My Work & Pro Requests.
-- Request history readable by every Hive member; client responses; replies linked to requests.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE hive.request_events
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'state',
  ADD COLUMN IF NOT EXISTS response text NULL,
  ADD COLUMN IF NOT EXISTS message_id uuid NULL REFERENCES hive.hive_messages (id) ON DELETE SET NULL;

ALTER TABLE hive.request_events DROP CONSTRAINT IF EXISTS ck_request_events__kind;
ALTER TABLE hive.request_events
  ADD CONSTRAINT ck_request_events__kind CHECK (kind IN ('state', 'response', 'reply'));

ALTER TABLE hive.request_events DROP CONSTRAINT IF EXISTS ck_request_events__response;
ALTER TABLE hive.request_events
  ADD CONSTRAINT ck_request_events__response CHECK (
    (kind = 'response') = (response IS NOT NULL)
    AND (response IS NULL OR response IN ('DONT_HAVE', 'DOESNT_APPLY'))
  );

ALTER TABLE hive.request_events DROP CONSTRAINT IF EXISTS ck_request_events__reply_message;
ALTER TABLE hive.request_events
  ADD CONSTRAINT ck_request_events__reply_message CHECK (kind <> 'reply' OR message_id IS NOT NULL);

ALTER TABLE hive.hive_messages
  ADD COLUMN IF NOT EXISTS request_id uuid NULL REFERENCES hive.requests (id) ON DELETE SET NULL;

ALTER TABLE hive.hive_messages DROP CONSTRAINT IF EXISTS ck_hive_messages__request_people;
ALTER TABLE hive.hive_messages
  ADD CONSTRAINT ck_hive_messages__request_people CHECK (request_id IS NULL OR channel = 'people');

CREATE INDEX IF NOT EXISTS idx_hive_messages__request
  ON hive.hive_messages (request_id, created_at)
  WHERE request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Request history visible to every Hive member (supersedes FL-6a staff/owner-only)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS request_events_select_staff_owner ON hive.request_events;
DROP POLICY IF EXISTS request_events_select_member ON hive.request_events;
CREATE POLICY request_events_select_member ON hive.request_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hive.requests r
       WHERE r.id = request_id AND hive.is_hive_member(r.hive_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Display name of one person on one Hive
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.hive_person_json(p_hive_id uuid, p_user_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN NULL
    ELSE (
      SELECT json_build_object(
        'userId', p_user_id,
        'displayName', coalesce(nullif(btrim(p.display_name), ''), role.role_label, 'Member'),
        'roleKind', role.role_kind,
        'roleLabel', role.role_label
      )
        FROM (SELECT 1) one
        LEFT JOIN hive.user_profiles p ON p.user_id = p_user_id
        LEFT JOIN LATERAL hive.hive_participant_role(p_hive_id, p_user_id) role ON true
    )
  END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Message JSON gains requestId
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.hive_message_json(p_message_id uuid, p_viewer uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT json_build_object(
    'id', m.id,
    'authorKind', m.author_kind,
    'authorRole', CASE
      WHEN m.author_kind = 'assistant' THEN 'assistant'
      WHEN m.author_user_id IS NULL THEN 'former'
      ELSE coalesce(a.role_kind, 'professional')
    END,
    'authorUserId', m.author_user_id,
    'authorDisplayName', CASE
      WHEN m.author_kind = 'assistant' THEN coalesce(f.assistant_name, 'HiveForYou')
      WHEN m.author_user_id IS NULL THEN 'Former member'
      ELSE coalesce(nullif(btrim(p.display_name), ''), a.role_label, 'Member')
    END,
    'authorRoleLabel', CASE
      WHEN m.author_kind = 'assistant' THEN coalesce(f.assistant_name, 'HiveForYou')
      WHEN m.author_user_id IS NULL THEN NULL
      ELSE a.role_label
    END,
    'isMine', m.author_user_id IS NOT NULL AND m.author_user_id = p_viewer,
    'body', m.body,
    'sourceRefs', m.source_refs,
    'replyToMessageId', m.reply_to_message_id,
    'handoffFromMessageId', m.handoff_from_message_id,
    'requestId', m.request_id,
    'triggerMessageId', (
      SELECT r.trigger_message_id
        FROM hive.assistant_runs r
       WHERE r.reply_message_id = m.id
       LIMIT 1
    ),
    'assistantRunStatus', (
      SELECT r.status
        FROM hive.assistant_runs r
       WHERE r.reply_message_id = m.id
       LIMIT 1
    ),
    'createdAt', m.created_at
  )
    FROM hive.hive_messages m
    JOIN hive.hives h ON h.id = m.hive_id
    LEFT JOIN hive.firms f ON f.id = h.firm_id
    LEFT JOIN hive.user_profiles p ON p.user_id = m.author_user_id
    LEFT JOIN LATERAL hive.hive_participant_role(m.hive_id, m.author_user_id) a ON true
   WHERE m.id = p_message_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. list_requests: requester, document uploader, history, linked messages
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_requests(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_items json;
  v_counts json;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT hive.is_hive_member(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(json_agg(row_to_json(req_row) ORDER BY req_row.position, req_row.id), '[]'::json)
    INTO v_items
    FROM (
      SELECT
        r.id,
        r.hive_id AS "hiveId",
        r.source,
        r.pack_row_key AS "packRowKey",
        r.title,
        r.detail,
        r.position,
        r.state,
        r.state_note AS "stateNote",
        r.accepted_by AS "acceptedBy",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        hive.hive_person_json(r.hive_id, r.created_by) AS "requestedBy",
        coalesce(docs.documents, '[]'::json) AS documents,
        chk.latest AS "latestCheck",
        coalesce(hist.events, '[]'::json) AS history,
        coalesce(msgs.messages, '[]'::json) AS messages
        FROM hive.requests r
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object(
            'id', sd.id,
            'fileName', sd.original_filename,
            'pageCount', sd.page_count,
            'createdAt', sd.created_at,
            'uploadedByDisplayName', up.display_name,
            'uploadedByUserId', sd.uploaded_by_user_id,
            'addedAt', rd.added_at,
            'addedByUserId', rd.added_by
          ) ORDER BY rd.added_at, sd.id) AS documents
            FROM hive.request_documents rd
            JOIN hive.source_documents sd ON sd.id = rd.source_document_id
            LEFT JOIN hive.user_profiles up ON up.user_id = sd.uploaded_by_user_id
           WHERE rd.request_id = r.id
        ) docs ON true
        LEFT JOIN LATERAL (
          SELECT json_build_object(
            'verdict', c.verdict,
            'sentence', c.sentence,
            'pageRefs', c.page_refs
          ) AS latest
            FROM hive.request_checks c
           WHERE c.request_id = r.id
           ORDER BY c.created_at DESC, c.id DESC
           LIMIT 1
        ) chk ON true
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object(
            'id', e.id,
            'kind', e.kind,
            'fromState', e.from_state,
            'toState', e.to_state,
            'response', e.response,
            'note', e.note,
            'actorKind', e.actor_kind,
            'actor', hive.hive_person_json(r.hive_id, e.actor_user_id),
            'messageId', e.message_id,
            'createdAt', e.created_at
          ) ORDER BY e.created_at, e.id) AS events
            FROM hive.request_events e
           WHERE e.request_id = r.id
        ) hist ON true
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object(
            'id', x.id,
            'body', x.body,
            'author', hive.hive_person_json(r.hive_id, x.author_user_id),
            'createdAt', x.created_at
          ) ORDER BY x.created_at, x.id) AS messages
            FROM (
              SELECT m.id, m.body, m.author_user_id, m.created_at
                FROM hive.hive_messages m
               WHERE m.request_id = r.id
                 AND m.hive_id = r.hive_id
                 AND m.channel = 'people'
               ORDER BY m.created_at DESC, m.id DESC
               LIMIT 50
            ) x
        ) msgs ON true
       WHERE r.hive_id = p_hive_id
    ) req_row;

  SELECT coalesce(json_object_agg(state, cnt), '{}'::json)
    INTO v_counts
    FROM (
      SELECT r.state, count(*)::integer AS cnt
        FROM hive.requests r
       WHERE r.hive_id = p_hive_id
       GROUP BY r.state
    ) s;

  RETURN json_build_object('requests', v_items, 'countsByState', v_counts);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Client response: "I don't have it" / "Doesn't apply" → NEEDS_REVIEW
-- ---------------------------------------------------------------------------
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
  IF NOT hive.can_upload_to_hive(v_req.hive_id) OR hive.can_write_hive(v_req.hive_id) THEN
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

-- ---------------------------------------------------------------------------
-- 7. Reply about a request: one people-channel message + one reply event
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reply_to_request(
  p_request_id uuid,
  p_body text,
  p_client_request_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req hive.requests%ROWTYPE;
  v_posted json;
  v_message_id uuid;
  v_linked uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM hive.requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT hive.can_converse(v_req.hive_id) THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_posted := public.post_hive_message(v_req.hive_id, p_body, p_client_request_id, NULL, 'people', NULL);
  v_message_id := (v_posted->'message'->>'id')::uuid;

  IF (v_posted->>'duplicate')::boolean THEN
    SELECT m.request_id INTO v_linked FROM hive.hive_messages m WHERE m.id = v_message_id;
    IF v_linked IS DISTINCT FROM p_request_id THEN
      RAISE EXCEPTION 'idempotency_conflict'
        USING ERRCODE = '23505', CONSTRAINT = 'uq_hive_messages__hive_client_request';
    END IF;
    RETURN json_build_object(
      'requestId', p_request_id,
      'message', hive.hive_message_json(v_message_id, v_uid),
      'notifyUserIds', '[]'::json,
      'duplicate', true
    );
  END IF;

  UPDATE hive.hive_messages SET request_id = p_request_id WHERE id = v_message_id;

  INSERT INTO hive.request_events (
    request_id, from_state, to_state, actor_user_id, actor_kind, note, kind, message_id
  ) VALUES (
    p_request_id, v_req.state, v_req.state, v_uid, 'person', NULL, 'reply', v_message_id
  );

  RETURN json_build_object(
    'requestId', p_request_id,
    'message', hive.hive_message_json(v_message_id, v_uid),
    'notifyUserIds', v_posted->'notifyUserIds',
    'duplicate', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION hive.hive_person_json(uuid, uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.respond_to_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_request(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.reply_to_request(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reply_to_request(uuid, text, uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
