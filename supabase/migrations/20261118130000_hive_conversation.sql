-- FL-8a (D20.1): one conversation per hive between its people. Access only through the RPCs below.
-- Assistant rows (author_kind = 'assistant', no user) are accepted by the table; FL-8b adds their insert path.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.hive_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL REFERENCES hive.hives (id) ON DELETE CASCADE,
  author_kind text NOT NULL,
  author_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  body text NOT NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  reply_to_message_id uuid REFERENCES hive.hive_messages (id) ON DELETE SET NULL,
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hive_messages__author_kind CHECK (author_kind IN ('person', 'assistant')),
  CONSTRAINT ck_hive_messages__assistant_has_no_user CHECK (author_kind = 'person' OR author_user_id IS NULL),
  CONSTRAINT ck_hive_messages__body CHECK (body = btrim(body) AND char_length(body) BETWEEN 1 AND 4000),
  CONSTRAINT ck_hive_messages__source_refs CHECK (jsonb_typeof(source_refs) = 'array'),
  CONSTRAINT uq_hive_messages__hive_client_request UNIQUE (hive_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS idx_hive_messages__hive_created
  ON hive.hive_messages (hive_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS hive.hive_message_reads (
  hive_id uuid NOT NULL REFERENCES hive.hives (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL,
  CONSTRAINT pk_hive_message_reads PRIMARY KEY (hive_id, user_id)
);

CREATE TABLE IF NOT EXISTS hive.hive_message_notices (
  hive_id uuid NOT NULL REFERENCES hive.hives (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  last_notified_at timestamptz NOT NULL,
  CONSTRAINT pk_hive_message_notices PRIMARY KEY (hive_id, user_id)
);

ALTER TABLE hive.hive_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.hive_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.hive_message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.hive_message_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.hive_message_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.hive_message_notices FORCE ROW LEVEL SECURITY;

REVOKE ALL ON hive.hive_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hive.hive_message_reads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hive.hive_message_notices FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers (no grants; called only from the RPCs)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.can_converse(p_hive_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT hive.is_hive_member(p_hive_id) OR hive.is_firm_staff(p_hive_id);
$$;

-- Current participants: active hive members and active staff of the hive's firm.
CREATE OR REPLACE FUNCTION hive.hive_participant_ids(p_hive_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT m.user_id
    FROM hive.hive_members m
   WHERE m.hive_id = p_hive_id
     AND m.state = 'active'
  UNION
  SELECT fm.user_id
    FROM hive.hives h
    JOIN hive.firm_members fm ON fm.firm_id = h.firm_id
   WHERE h.id = p_hive_id
     AND fm.state = 'active'
     AND fm.user_id IS NOT NULL;
$$;

-- Role of one person on one hive. Active staff first, then hive membership, then past staff.
CREATE OR REPLACE FUNCTION hive.hive_participant_role(p_hive_id uuid, p_user_id uuid)
RETURNS TABLE (role_kind text, role_label text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT r.role_kind, r.role_label
    FROM (
      SELECT 'staff'::text AS role_kind, fm.title AS role_label, 1 AS rank
        FROM hive.hives h
        JOIN hive.firm_members fm ON fm.firm_id = h.firm_id
       WHERE h.id = p_hive_id
         AND fm.user_id = p_user_id
         AND fm.state = 'active'
      UNION ALL
      SELECT
        CASE
          WHEN m.role = 'client' THEN 'client'
          WHEN m.role = 'owner' AND h.firm_id IS NULL THEN 'owner'
          ELSE 'professional'
        END,
        CASE
          WHEN m.role = 'client' THEN 'Client'
          WHEN m.role = 'owner' AND h.firm_id IS NULL THEN 'Owner'
          ELSE 'Professional'
        END,
        CASE WHEN m.state = 'active' THEN 2 ELSE 4 END
        FROM hive.hive_members m
        JOIN hive.hives h ON h.id = m.hive_id
       WHERE m.hive_id = p_hive_id
         AND m.user_id = p_user_id
      UNION ALL
      SELECT 'staff'::text, fm.title, 3
        FROM hive.hives h
        JOIN hive.firm_members fm ON fm.firm_id = h.firm_id
       WHERE h.id = p_hive_id
         AND fm.user_id = p_user_id
         AND fm.state <> 'active'
    ) r
   ORDER BY r.rank
   LIMIT 1;
$$;

-- One message in the list-row shape, from p_viewer's side.
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
    'createdAt', m.created_at
  )
    FROM hive.hive_messages m
    JOIN hive.hives h ON h.id = m.hive_id
    LEFT JOIN hive.firms f ON f.id = h.firm_id
    LEFT JOIN hive.user_profiles p ON p.user_id = m.author_user_id
    LEFT JOIN LATERAL hive.hive_participant_role(m.hive_id, m.author_user_id) a ON true
   WHERE m.id = p_message_id;
$$;

-- Replay of an existing client_request_id: same author and body is a duplicate, anything else conflicts.
CREATE OR REPLACE FUNCTION hive.hive_message_replay(p_existing hive.hive_messages, p_uid uuid, p_body text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
BEGIN
  IF p_existing.author_kind <> 'person'
     OR p_existing.author_user_id IS DISTINCT FROM p_uid
     OR p_existing.body IS DISTINCT FROM p_body THEN
    RAISE EXCEPTION 'idempotency_conflict'
      USING ERRCODE = '23505', CONSTRAINT = 'uq_hive_messages__hive_client_request';
  END IF;
  RETURN json_build_object(
    'message', hive.hive_message_json(p_existing.id, p_uid),
    'notifyUserIds', '[]'::json,
    'duplicate', true
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_hive_message(
  p_hive_id uuid,
  p_body text,
  p_client_request_id uuid,
  p_reply_to uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_row hive.hive_messages%ROWTYPE;
  v_recent integer;
  v_notify uuid[];
BEGIN
  IF v_uid IS NULL OR p_hive_id IS NULL OR NOT hive.can_converse(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'invalid_request:body' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:client_request_id' USING ERRCODE = '22023';
  END IF;

  -- Serializes one person's posts on one hive so the rate limit and replay checks are exact.
  PERFORM pg_advisory_xact_lock(hashtext('hive_message:' || p_hive_id::text || ':' || v_uid::text));

  SELECT * INTO v_row
    FROM hive.hive_messages m
   WHERE m.hive_id = p_hive_id AND m.client_request_id = p_client_request_id;
  IF FOUND THEN
    RETURN hive.hive_message_replay(v_row, v_uid, v_body);
  END IF;

  SELECT count(*)::integer INTO v_recent
    FROM hive.hive_messages m
   WHERE m.hive_id = p_hive_id
     AND m.author_kind = 'person'
     AND m.author_user_id = v_uid
     AND m.created_at > now() - interval '10 minutes';
  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;

  IF p_reply_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM hive.hive_messages r WHERE r.id = p_reply_to AND r.hive_id = p_hive_id
  ) THEN
    RAISE EXCEPTION 'invalid_request:reply_to' USING ERRCODE = '22023';
  END IF;

  INSERT INTO hive.hive_messages (hive_id, author_kind, author_user_id, body, reply_to_message_id, client_request_id)
  VALUES (p_hive_id, 'person', v_uid, v_body, p_reply_to, p_client_request_id)
  ON CONFLICT ON CONSTRAINT uq_hive_messages__hive_client_request DO NOTHING
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row
      FROM hive.hive_messages m
     WHERE m.hive_id = p_hive_id AND m.client_request_id = p_client_request_id;
    RETURN hive.hive_message_replay(v_row, v_uid, v_body);
  END IF;

  INSERT INTO hive.hive_message_reads AS r (hive_id, user_id, last_read_at)
  VALUES (p_hive_id, v_uid, now())
  ON CONFLICT (hive_id, user_id) DO UPDATE
    SET last_read_at = greatest(r.last_read_at, excluded.last_read_at);

  -- The conditional upsert claims each notice: a concurrent post re-checks the committed row and skips it.
  WITH eligible AS (
    SELECT pid.user_id
      FROM hive.hive_participant_ids(p_hive_id) AS pid(user_id)
      LEFT JOIN hive.hive_message_reads rd ON rd.hive_id = p_hive_id AND rd.user_id = pid.user_id
      LEFT JOIN hive.hive_message_notices nt ON nt.hive_id = p_hive_id AND nt.user_id = pid.user_id
     WHERE pid.user_id <> v_uid
       AND (nt.last_notified_at IS NULL OR nt.last_notified_at < now() - interval '30 minutes')
       AND (rd.last_read_at IS NULL OR rd.last_read_at < v_row.created_at)
  ),
  noticed AS (
    INSERT INTO hive.hive_message_notices AS n (hive_id, user_id, last_notified_at)
    SELECT p_hive_id, e.user_id, now() FROM eligible e
    ON CONFLICT (hive_id, user_id) DO UPDATE
      SET last_notified_at = excluded.last_notified_at
      WHERE n.last_notified_at < now() - interval '30 minutes'
    RETURNING n.user_id
  )
  SELECT coalesce(array_agg(noticed.user_id ORDER BY noticed.user_id), '{}'::uuid[]) INTO v_notify FROM noticed;

  RETURN json_build_object(
    'message', hive.hive_message_json(v_row.id, v_uid),
    'notifyUserIds', to_json(v_notify),
    'duplicate', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_hive_messages(
  p_hive_id uuid,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_ids uuid[];
  v_has_more boolean;
  v_messages json;
  v_cursor json := NULL;
  v_labels json;
  v_count integer;
  v_last_read timestamptz;
BEGIN
  IF v_uid IS NULL OR p_hive_id IS NULL OR NOT hive.can_converse(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(x.id ORDER BY x.created_at DESC, x.id DESC) INTO v_ids
    FROM (
      SELECT m.id, m.created_at
        FROM hive.hive_messages m
       WHERE m.hive_id = p_hive_id
         AND (
           p_before_created_at IS NULL
           OR m.created_at < p_before_created_at
           OR (p_before_id IS NOT NULL AND m.created_at = p_before_created_at AND m.id < p_before_id)
         )
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT v_limit + 1
    ) x;

  v_has_more := coalesce(array_length(v_ids, 1), 0) > v_limit;
  IF v_has_more THEN
    v_ids := v_ids[1:v_limit];
    SELECT json_build_object('beforeCreatedAt', m.created_at, 'beforeId', m.id) INTO v_cursor
      FROM hive.hive_messages m
     WHERE m.id = v_ids[v_limit];
  END IF;

  SELECT coalesce(json_agg(hive.hive_message_json(t.id, v_uid) ORDER BY t.ord), '[]'::json) INTO v_messages
    FROM unnest(v_ids) WITH ORDINALITY AS t(id, ord);

  SELECT coalesce(json_agg(x.role_label ORDER BY x.grp, x.role_label), '[]'::json), coalesce(sum(x.people), 0)::integer
    INTO v_labels, v_count
    FROM (
      SELECT r.role_label,
             min(CASE r.role_kind WHEN 'client' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END) AS grp,
             count(*) AS people
        FROM hive.hive_participant_ids(p_hive_id) AS pid(user_id)
        CROSS JOIN LATERAL hive.hive_participant_role(p_hive_id, pid.user_id) r
       GROUP BY r.role_label
    ) x;

  SELECT rd.last_read_at INTO v_last_read
    FROM hive.hive_message_reads rd
   WHERE rd.hive_id = p_hive_id AND rd.user_id = v_uid;

  RETURN json_build_object(
    'messages', v_messages,
    'participantRoleLabels', v_labels,
    'participantCount', v_count,
    'viewerLastReadAt', v_last_read,
    'nextCursor', v_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_hive_messages_read(p_hive_id uuid, p_up_to timestamptz)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_last timestamptz;
BEGIN
  IF v_uid IS NULL OR p_hive_id IS NULL OR NOT hive.can_converse(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = '42501';
  END IF;
  IF p_up_to IS NULL THEN
    RAISE EXCEPTION 'invalid_request:up_to' USING ERRCODE = '22023';
  END IF;

  INSERT INTO hive.hive_message_reads AS r (hive_id, user_id, last_read_at)
  VALUES (p_hive_id, v_uid, least(p_up_to, now()))
  ON CONFLICT (hive_id, user_id) DO UPDATE
    SET last_read_at = greatest(r.last_read_at, excluded.last_read_at)
  RETURNING r.last_read_at INTO v_last;

  RETURN json_build_object('lastReadAt', v_last);
END;
$$;

CREATE OR REPLACE FUNCTION public.hive_unread_message_count(p_hive_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_last_read timestamptz;
  v_count integer;
BEGIN
  IF v_uid IS NULL OR p_hive_id IS NULL OR NOT hive.can_converse(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = '42501';
  END IF;

  SELECT rd.last_read_at INTO v_last_read
    FROM hive.hive_message_reads rd
   WHERE rd.hive_id = p_hive_id AND rd.user_id = v_uid;

  SELECT count(*)::integer INTO v_count
    FROM hive.hive_messages m
   WHERE m.hive_id = p_hive_id
     AND m.author_user_id IS DISTINCT FROM v_uid
     AND (v_last_read IS NULL OR m.created_at > v_last_read);

  RETURN coalesce(v_count, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION hive.can_converse(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.hive_participant_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.hive_participant_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.hive_message_json(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.hive_message_replay(hive.hive_messages, uuid, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.post_hive_message(uuid, text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_hive_messages(uuid, timestamptz, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_hive_messages_read(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hive_unread_message_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_hive_message(uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_hive_messages(uuid, timestamptz, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_hive_messages_read(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hive_unread_message_count(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
