-- FL-8b (D19.2, D20.1): hive board AI assistant (synthetic hives only). Service-role run lifecycle; staff toggle.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Hive flags
-- ---------------------------------------------------------------------------
ALTER TABLE hive.hives
  ADD COLUMN IF NOT EXISTS content_class text NOT NULL DEFAULT 'real',
  ADD COLUMN IF NOT EXISTS assistant_replies_on boolean NOT NULL DEFAULT true;

ALTER TABLE hive.hives DROP CONSTRAINT IF EXISTS ck_hives__content_class;
ALTER TABLE hive.hives
  ADD CONSTRAINT ck_hives__content_class CHECK (content_class IN ('synthetic', 'real'));

-- ---------------------------------------------------------------------------
-- 2. Assistant runs (idempotency per triggering message)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.assistant_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL REFERENCES hive.hives (id) ON DELETE CASCADE,
  trigger_message_id uuid NOT NULL UNIQUE REFERENCES hive.hive_messages (id) ON DELETE CASCADE,
  status text NOT NULL,
  study_revision_id uuid NULL,
  prompt_id text NULL,
  model text NULL,
  latency_ms integer NULL,
  error_code text NULL,
  reply_message_id uuid NULL REFERENCES hive.hive_messages (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  CONSTRAINT ck_assistant_runs__status CHECK (
    status IN ('pending', 'answered', 'routed', 'failed', 'skipped')
  )
);

CREATE INDEX IF NOT EXISTS idx_assistant_runs__hive_created
  ON hive.assistant_runs (hive_id, created_at DESC);

ALTER TABLE hive.assistant_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.assistant_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON hive.assistant_runs FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_hive_assistant_replies(p_hive_id uuid, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_on boolean := coalesce(p_on, true);
BEGIN
  IF v_uid IS NULL
     OR p_hive_id IS NULL
     OR NOT (hive.is_firm_staff(p_hive_id) OR hive.is_hive_owner(p_hive_id)) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = '42501';
  END IF;
  UPDATE hive.hives SET assistant_replies_on = v_on, updated_at = now() WHERE id = p_hive_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = '42501';
  END IF;
  RETURN v_on;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_assistant_run(p_trigger_message_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_msg hive.hive_messages%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_trigger_message_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:trigger_message_id' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_msg FROM hive.hive_messages WHERE id = p_trigger_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_request:trigger_message_id' USING ERRCODE = '22023';
  END IF;
  INSERT INTO hive.assistant_runs (hive_id, trigger_message_id, status)
  VALUES (v_msg.hive_id, p_trigger_message_id, 'pending')
  ON CONFLICT (trigger_message_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM hive.assistant_runs r WHERE r.trigger_message_id = p_trigger_message_id;
    RETURN json_build_object('runId', v_id, 'claimed', false);
  END IF;
  RETURN json_build_object('runId', v_id, 'claimed', true);
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

  v_body := nullif(btrim(coalesce(p_body, '')), '');

  IF v_body IS NOT NULL THEN
    IF char_length(v_body) < 1 OR char_length(v_body) > 4000 THEN
      RAISE EXCEPTION 'invalid_request:body' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_refs) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_request:source_refs' USING ERRCODE = '22023';
    END IF;
    INSERT INTO hive.hive_messages (
      hive_id, author_kind, author_user_id, body, source_refs, client_request_id
    )
    VALUES (v_run.hive_id, 'assistant', NULL, v_body, v_refs, p_run_id)
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
  v_hive hive.hives%ROWTYPE;
  v_firm hive.firms%ROWTYPE;
  v_assistant_name text;
  v_pending boolean;
  v_failed_ids json;
  v_assistant_label text;
  v_has_assistant_label boolean;
BEGIN
  IF v_uid IS NULL OR p_hive_id IS NULL OR NOT hive.can_converse(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_hive FROM hive.hives WHERE id = p_hive_id;
  SELECT f.* INTO v_firm FROM hive.firms f WHERE f.id = v_hive.firm_id;
  v_assistant_name := coalesce(v_firm.assistant_name, 'HiveForYou');

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

  v_assistant_label := v_assistant_name || ' (AI assistant)';
  IF v_hive.content_class = 'synthetic' AND v_hive.assistant_replies_on THEN
    IF v_labels IS NULL THEN
      v_labels := json_build_array(v_assistant_label);
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM json_array_elements_text(v_labels) AS e(txt) WHERE e.txt = v_assistant_label
      ) INTO v_has_assistant_label;
      IF NOT v_has_assistant_label THEN
        v_labels := v_labels::jsonb || jsonb_build_array(v_assistant_label);
      END IF;
    END IF;
  END IF;

  SELECT rd.last_read_at INTO v_last_read
    FROM hive.hive_message_reads rd
   WHERE rd.hive_id = p_hive_id AND rd.user_id = v_uid;

  SELECT EXISTS (
    SELECT 1 FROM hive.assistant_runs r
     WHERE r.hive_id = p_hive_id
       AND r.status = 'pending'
       AND r.created_at > now() - interval '90 seconds'
  ) INTO v_pending;

  SELECT coalesce(json_agg(r.trigger_message_id ORDER BY r.created_at DESC), '[]'::json) INTO v_failed_ids
    FROM hive.assistant_runs r
   WHERE r.hive_id = p_hive_id
     AND r.status = 'failed'
     AND r.finished_at > now() - interval '7 days';

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
    'assistantName', v_assistant_name
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.set_hive_assistant_replies(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_hive_assistant_replies(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_assistant_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_assistant_run(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.finish_assistant_run(
  uuid, text, text, jsonb, uuid, text, text, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_assistant_run(
  uuid, text, text, jsonb, uuid, text, text, integer, text
) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';