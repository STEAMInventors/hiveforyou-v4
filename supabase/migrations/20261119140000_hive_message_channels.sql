-- FL-8h: hive board — people conversation vs per-person assistant threads.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns and indexes
-- ---------------------------------------------------------------------------
ALTER TABLE hive.hive_messages
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'people',
  ADD COLUMN IF NOT EXISTS thread_owner_user_id uuid NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS handoff_from_message_id uuid NULL REFERENCES hive.hive_messages (id) ON DELETE SET NULL;

ALTER TABLE hive.hive_messages DROP CONSTRAINT IF EXISTS ck_hive_messages__channel;
ALTER TABLE hive.hive_messages
  ADD CONSTRAINT ck_hive_messages__channel CHECK (channel IN ('people', 'assistant'));

ALTER TABLE hive.hive_messages DROP CONSTRAINT IF EXISTS ck_hive_messages__assistant_thread;
ALTER TABLE hive.hive_messages
  ADD CONSTRAINT ck_hive_messages__assistant_thread CHECK (
    (channel = 'assistant') = (thread_owner_user_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_hive_messages__hive_channel_thread_created
  ON hive.hive_messages (hive_id, channel, thread_owner_user_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- 2. Deterministic backfill
-- ---------------------------------------------------------------------------
UPDATE hive.hive_messages m
   SET channel = 'assistant',
       thread_owner_user_id = t.author_user_id
  FROM hive.assistant_runs r
  JOIN hive.hive_messages t ON t.id = r.trigger_message_id
 WHERE m.id = r.trigger_message_id
   AND m.channel = 'people'
   AND m.thread_owner_user_id IS NULL;

UPDATE hive.hive_messages m
   SET channel = 'assistant',
       thread_owner_user_id = t.author_user_id
  FROM hive.assistant_runs r
  JOIN hive.hive_messages t ON t.id = r.trigger_message_id
 WHERE m.id = r.reply_message_id
   AND m.author_kind = 'assistant'
   AND m.channel = 'people'
   AND m.thread_owner_user_id IS NULL
   AND t.author_user_id IS NOT NULL;

UPDATE hive.hive_messages m
   SET channel = 'assistant',
       thread_owner_user_id = m.author_user_id
  FROM hive.hives h
 WHERE m.hive_id = h.id
   AND h.firm_id IS NULL
   AND m.author_kind = 'person'
   AND m.author_user_id IS NOT NULL
   AND m.channel = 'people'
   AND m.thread_owner_user_id IS NULL
   AND EXISTS (
     SELECT 1
       FROM hive.hive_members om
      WHERE om.hive_id = h.id
        AND om.user_id = m.author_user_id
        AND om.role = 'owner'
        AND om.state = 'active'
   );

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.is_active_hive_client(p_hive_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hive.hive_members m
     WHERE m.hive_id = p_hive_id
       AND m.user_id = p_user_id
       AND m.role = 'client'
       AND m.state = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION hive.can_read_assistant_thread(p_hive_id uuid, p_thread_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT CASE
    WHEN p_thread_owner IS NULL THEN false
    WHEN p_thread_owner = auth.uid() THEN true
    WHEN hive.is_firm_staff(p_hive_id)
         AND hive.is_active_hive_client(p_hive_id, p_thread_owner) THEN true
    ELSE false
  END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Message JSON (handoff + assistant trigger metadata)
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

DROP FUNCTION IF EXISTS public.post_hive_message(uuid, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.post_hive_message(
  p_hive_id uuid,
  p_body text,
  p_client_request_id uuid,
  p_reply_to uuid DEFAULT NULL,
  p_channel text DEFAULT 'people',
  p_handoff_from uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_channel text := lower(coalesce(p_channel, 'people'));
  v_row hive.hive_messages%ROWTYPE;
  v_recent integer;
  v_notify uuid[];
  v_handoff hive.hive_messages%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR p_hive_id IS NULL OR NOT hive.can_converse(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = '42501';
  END IF;
  IF v_channel NOT IN ('people', 'assistant') THEN
    RAISE EXCEPTION 'invalid_request:channel' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'invalid_request:body' USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:client_request_id' USING ERRCODE = '22023';
  END IF;
  IF v_channel = 'assistant' AND p_handoff_from IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_request:handoff_from' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('hive_message:' || p_hive_id::text || ':' || v_uid::text || ':' || v_channel));

  SELECT * INTO v_row
    FROM hive.hive_messages m
   WHERE m.hive_id = p_hive_id AND m.client_request_id = p_client_request_id;
  IF FOUND THEN
    RETURN hive.hive_message_replay(v_row, v_uid, v_body);
  END IF;

  SELECT count(*)::integer INTO v_recent
    FROM hive.hive_messages m
   WHERE m.hive_id = p_hive_id
     AND m.channel = v_channel
     AND m.author_kind = 'person'
     AND m.author_user_id = v_uid
     AND m.created_at > now() - interval '10 minutes';
  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;

  IF p_reply_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM hive.hive_messages r
     WHERE r.id = p_reply_to AND r.hive_id = p_hive_id AND r.channel = v_channel
  ) THEN
    RAISE EXCEPTION 'invalid_request:reply_to' USING ERRCODE = '22023';
  END IF;

  IF p_handoff_from IS NOT NULL THEN
    IF v_channel <> 'people' THEN
      RAISE EXCEPTION 'invalid_request:handoff_from' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_handoff
      FROM hive.hive_messages hm
     WHERE hm.id = p_handoff_from
       AND hm.hive_id = p_hive_id
       AND hm.channel = 'assistant'
       AND hm.thread_owner_user_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_request:handoff_from' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO hive.hive_messages (
    hive_id, author_kind, author_user_id, body, reply_to_message_id, client_request_id,
    channel, thread_owner_user_id, handoff_from_message_id
  )
  VALUES (
    p_hive_id,
    'person',
    v_uid,
    v_body,
    p_reply_to,
    p_client_request_id,
    v_channel,
    CASE WHEN v_channel = 'assistant' THEN v_uid ELSE NULL END,
    p_handoff_from
  )
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

  IF v_channel = 'assistant' THEN
    RETURN json_build_object(
      'message', hive.hive_message_json(v_row.id, v_uid),
      'notifyUserIds', '[]'::json,
      'duplicate', false
    );
  END IF;

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

DROP FUNCTION IF EXISTS public.list_hive_messages(uuid, timestamptz, uuid, integer);

CREATE OR REPLACE FUNCTION public.list_hive_messages(
  p_hive_id uuid,
  p_channel text DEFAULT 'people',
  p_thread_owner uuid DEFAULT NULL,
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
  v_channel text := lower(coalesce(p_channel, 'people'));
  v_thread_owner uuid := coalesce(p_thread_owner, auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_ids uuid[];
  v_has_more boolean;
  v_messages json;
  v_cursor json := NULL;
  v_labels json;
  v_count integer;
  v_last_read timestamptz;
  v_hive hive.hives%ROWTYPE;
  v_firm hive.firms%ROWTYPE;
  v_assistant_name text;
  v_pending boolean;
  v_failed_ids json;
  v_assistant_threads json;
BEGIN
  IF v_uid IS NULL OR p_hive_id IS NULL OR NOT hive.can_converse(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = '42501';
  END IF;
  IF v_channel NOT IN ('people', 'assistant') THEN
    RAISE EXCEPTION 'invalid_request:channel' USING ERRCODE = '22023';
  END IF;

  IF v_channel = 'assistant' THEN
    IF NOT hive.can_read_assistant_thread(p_hive_id, v_thread_owner) THEN
      RAISE EXCEPTION 'hive_not_found' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_hive FROM hive.hives WHERE id = p_hive_id;
  SELECT f.* INTO v_firm FROM hive.firms f WHERE f.id = v_hive.firm_id;
  v_assistant_name := coalesce(v_firm.assistant_name, 'HiveForYou');

  SELECT array_agg(x.id ORDER BY x.created_at DESC, x.id DESC) INTO v_ids
    FROM (
      SELECT m.id, m.created_at
        FROM hive.hive_messages m
       WHERE m.hive_id = p_hive_id
         AND m.channel = v_channel
         AND (
           v_channel = 'people'
           OR m.thread_owner_user_id = v_thread_owner
         )
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

  IF v_channel = 'people' THEN
    RETURN json_build_object(
      'messages', v_messages,
      'participantRoleLabels', v_labels,
      'participantCount', v_count,
      'viewerLastReadAt', v_last_read,
      'nextCursor', v_cursor
    );
  END IF;

  SELECT coalesce(
    json_agg(
      json_build_object(
        'userId', s.user_id,
        'displayName', coalesce(nullif(btrim(pr.display_name), ''), role.role_label, 'Client'),
        'roleLabel', role.role_label,
        'messageCount', s.message_count,
        'lastAt', s.last_at
      )
      ORDER BY s.last_at DESC NULLS LAST, s.user_id
    ),
    '[]'::json
  ) INTO v_assistant_threads
  FROM (
    SELECT m.thread_owner_user_id AS user_id,
           count(*)::integer AS message_count,
           max(m.created_at) AS last_at
      FROM hive.hive_messages m
     WHERE m.hive_id = p_hive_id
       AND m.channel = 'assistant'
       AND hive.is_active_hive_client(p_hive_id, m.thread_owner_user_id)
     GROUP BY m.thread_owner_user_id
  ) s
  JOIN hive.hive_members hm
    ON hm.hive_id = p_hive_id AND hm.user_id = s.user_id
  LEFT JOIN hive.user_profiles pr ON pr.user_id = s.user_id
  CROSS JOIN LATERAL hive.hive_participant_role(p_hive_id, s.user_id) role
 WHERE hive.is_firm_staff(p_hive_id);

  SELECT EXISTS (
    SELECT 1
      FROM hive.assistant_runs r
      JOIN hive.hive_messages tm ON tm.id = r.trigger_message_id
     WHERE r.hive_id = p_hive_id
       AND r.status = 'pending'
       AND r.created_at > now() - interval '90 seconds'
       AND tm.channel = 'assistant'
       AND tm.thread_owner_user_id = v_thread_owner
  ) INTO v_pending;

  SELECT coalesce(json_agg(r.trigger_message_id ORDER BY r.created_at DESC), '[]'::json) INTO v_failed_ids
    FROM hive.assistant_runs r
    JOIN hive.hive_messages tm ON tm.id = r.trigger_message_id
   WHERE r.hive_id = p_hive_id
     AND r.status = 'failed'
     AND r.finished_at > now() - interval '7 days'
     AND tm.channel = 'assistant'
     AND tm.thread_owner_user_id = v_thread_owner;

  RETURN json_build_object(
    'messages', v_messages,
    'participantRoleLabels', v_labels,
    'participantCount', v_count,
    'viewerLastReadAt', v_last_read,
    'nextCursor', v_cursor,
    'pendingAssistant', v_pending,
    'assistantRepliesOn', v_hive.assistant_replies_on,
    'assistantAvailable', v_hive.content_class = 'synthetic',
    'failedAssistantForMessageIds', v_failed_ids,
    'assistantName', v_assistant_name,
    'assistantThreads', coalesce(v_assistant_threads, '[]'::json),
    'threadOwnerUserId', v_thread_owner
  );
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
     AND m.channel = 'people'
     AND m.author_user_id IS DISTINCT FROM v_uid
     AND (v_last_read IS NULL OR m.created_at > v_last_read);

  RETURN coalesce(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_assistant_run(
  p_run_id uuid,
  p_status text,
  p_body text,
  p_source_refs jsonb,
  p_study_revision_id uuid,
  p_prompt_id text,
  p_model text,
  p_latency_ms integer,
  p_error_code text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.assistant_runs%ROWTYPE;
  v_trigger hive.hive_messages%ROWTYPE;
  v_body text;
  v_reply_id uuid;
  v_refs jsonb := coalesce(p_source_refs, '[]'::jsonb);
BEGIN
  IF p_run_id IS NULL OR p_status IS NULL THEN
    RAISE EXCEPTION 'invalid_request:run' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('answered', 'routed', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'invalid_request:status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM hive.assistant_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'pending' THEN
    RAISE EXCEPTION 'invalid_request:run_state' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_trigger FROM hive.hive_messages WHERE id = v_run.trigger_message_id;

  v_body := nullif(btrim(coalesce(p_body, '')), '');

  IF v_body IS NOT NULL THEN
    IF char_length(v_body) < 1 OR char_length(v_body) > 4000 THEN
      RAISE EXCEPTION 'invalid_request:body' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_refs) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_request:source_refs' USING ERRCODE = '22023';
    END IF;
    INSERT INTO hive.hive_messages (
      hive_id, author_kind, author_user_id, body, source_refs, client_request_id,
      channel, thread_owner_user_id
    )
    VALUES (
      v_run.hive_id,
      'assistant',
      NULL,
      v_body,
      v_refs,
      p_run_id,
      'assistant',
      v_trigger.thread_owner_user_id
    )
    RETURNING id INTO v_reply_id;
  END IF;

  UPDATE hive.assistant_runs
     SET status = p_status,
         study_revision_id = p_study_revision_id,
         prompt_id = nullif(btrim(coalesce(p_prompt_id, '')), ''),
         model = nullif(btrim(coalesce(p_model, '')), ''),
         latency_ms = p_latency_ms,
         error_code = nullif(btrim(coalesce(p_error_code, '')), ''),
         reply_message_id = v_reply_id,
         finished_at = now()
   WHERE id = p_run_id;

  RETURN json_build_object(
    'runId', p_run_id,
    'status', p_status,
    'replyMessageId', v_reply_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION hive.is_active_hive_client(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.can_read_assistant_thread(uuid, uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.post_hive_message(uuid, text, uuid, uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_hive_messages(uuid, text, uuid, timestamptz, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_hive_messages_read(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hive_unread_message_count(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.post_hive_message(uuid, text, uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_hive_messages(uuid, text, uuid, timestamptz, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_hive_messages_read(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hive_unread_message_count(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';