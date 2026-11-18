-- FL-8a: hive conversation RPCs (synthetic data only).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(54);

-- O firm owner (Attorney), S firm staff, C client on A, X outsider, R removed client on A, CB client on B, T former member.
INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('c0a80101-0000-4000-8000-000000000001', 'conv-owner@example.test', 'authenticated', 'authenticated'),
  ('c0a80101-0000-4000-8000-000000000002', 'conv-staff@example.test', 'authenticated', 'authenticated'),
  ('c0a80101-0000-4000-8000-000000000003', 'conv-client@example.test', 'authenticated', 'authenticated'),
  ('c0a80101-0000-4000-8000-000000000004', 'conv-outsider@example.test', 'authenticated', 'authenticated'),
  ('c0a80101-0000-4000-8000-000000000005', 'conv-removed@example.test', 'authenticated', 'authenticated'),
  ('c0a80101-0000-4000-8000-000000000006', 'conv-client-b@example.test', 'authenticated', 'authenticated'),
  ('c0a80101-0000-4000-8000-000000000007', 'conv-former@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.user_profiles (user_id, display_name, starting_view, created_at, updated_at)
VALUES
  ('c0a80101-0000-4000-8000-000000000001', 'Maria Alvarez', 'clients', now(), now()),
  ('c0a80101-0000-4000-8000-000000000002', 'Sam Lee', 'clients', now(), now()),
  ('c0a80101-0000-4000-8000-000000000003', 'Ruth Ortiz', 'clients', now(), now())
ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name;

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT ok((public.create_firm('Conv Law', 'Conv Assistant')->>'firmId') IS NOT NULL, 'create_firm succeeds');

SELECT set_config('app.hive_a',
  public.create_hive('Ruth Ortiz', 'Intake', 'c0a80101-0000-4000-8000-0000000000a1', 'client')->'hive'->>'id', false);
SELECT set_config('app.hive_b',
  public.create_hive('Other client', 'Intake', 'c0a80101-0000-4000-8000-0000000000b1', 'client')->'hive'->>'id', false);

RESET ROLE;

INSERT INTO hive.firm_members (firm_id, user_id, invited_email, role, title, state)
SELECT h.firm_id, 'c0a80101-0000-4000-8000-000000000002', 'conv-staff@example.test', 'member', 'Onboarding associate', 'active'
  FROM hive.hives h WHERE h.id = current_setting('app.hive_a')::uuid;

INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by)
VALUES
  (current_setting('app.hive_a')::uuid, 'c0a80101-0000-4000-8000-000000000003', 'client', 'active', 'c0a80101-0000-4000-8000-000000000001'),
  (current_setting('app.hive_a')::uuid, 'c0a80101-0000-4000-8000-000000000005', 'client', 'removed', 'c0a80101-0000-4000-8000-000000000001'),
  (current_setting('app.hive_b')::uuid, 'c0a80101-0000-4000-8000-000000000006', 'client', 'active', 'c0a80101-0000-4000-8000-000000000001');

SET LOCAL role authenticated;

-- ---------------------------------------------------------------------------
-- Client, staff and owner post; notify list and window.
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT set_config('app.r1', public.post_hive_message(
  current_setting('app.hive_a')::uuid, '  Hello from the client  ', 'c0a80101-0000-4000-8000-0000000000c1')::text, false);

SELECT is((current_setting('app.r1')::json->>'duplicate')::boolean, false, 'first client post is not a duplicate');
SELECT is(current_setting('app.r1')::json->'message'->>'body', 'Hello from the client', 'body is stored trimmed');
SELECT is((current_setting('app.r1')::json->'message'->>'isMine')::boolean, true, 'poster sees the row as theirs');
SELECT is(current_setting('app.r1')::json->'message'->>'authorRoleLabel', 'Client', 'client member is labelled Client');
SELECT is(
  (SELECT array_agg(x ORDER BY x) FROM json_array_elements_text(current_setting('app.r1')::json->'notifyUserIds') x),
  ARRAY['c0a80101-0000-4000-8000-000000000001', 'c0a80101-0000-4000-8000-000000000002'],
  'first message notifies the owner and staff, never the poster'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT set_config('app.r2', public.post_hive_message(
  current_setting('app.hive_a')::uuid, 'Staff reply', 'c0a80101-0000-4000-8000-0000000000c2')::text, false);
SELECT is(current_setting('app.r2')::json->'message'->>'authorRoleLabel', 'Onboarding associate', 'staff label is the firm title');
SELECT is(json_array_length(current_setting('app.r2')::json->'notifyUserIds'), 0,
  'owner inside the 30 minute window and client who already read are not notified');

SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT set_config('app.r3', public.post_hive_message(
  current_setting('app.hive_a')::uuid, 'Owner note', 'c0a80101-0000-4000-8000-0000000000c3')::text, false);
SELECT is(current_setting('app.r3')::json->'message'->>'authorRoleLabel', 'Attorney', 'firm owner label is their title');

SELECT set_config('app.l1', public.list_hive_messages(current_setting('app.hive_a')::uuid)::text, false);
SELECT is(json_array_length(current_setting('app.l1')::json->'messages'), 3, 'owner lists all three messages');
SELECT is((current_setting('app.l1')::json->'participantRoleLabels')::jsonb, '["Client","Attorney","Onboarding associate"]'::jsonb,
  'participant labels: Client, then staff titles');
SELECT is((current_setting('app.l1')::json->>'participantCount')::integer, 3, 'removed members and other hives are not participants');
SELECT is(
  (SELECT count(*)::integer FROM json_array_elements(current_setting('app.l1')::json->'messages') m WHERE (m->>'isMine')::boolean),
  1, 'only the owner''s own row is marked isMine'
);

-- ---------------------------------------------------------------------------
-- Idempotency.
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT set_config('app.r4', public.post_hive_message(
  current_setting('app.hive_a')::uuid, 'Hello from the client', 'c0a80101-0000-4000-8000-0000000000c1')::text, false);
SELECT is((current_setting('app.r4')::json->>'duplicate')::boolean, true, 'replay is a duplicate');
SELECT is(current_setting('app.r4')::json->'message'->>'id', current_setting('app.r1')::json->'message'->>'id', 'replay returns the same row');
SELECT is(json_array_length(current_setting('app.r4')::json->'notifyUserIds'), 0, 'replay notifies nobody');
SELECT throws_ok(
  $$SELECT public.post_hive_message(current_setting('app.hive_a')::uuid, 'Different text', 'c0a80101-0000-4000-8000-0000000000c1')$$,
  '23505', 'idempotency_conflict', 'same key with different text conflicts'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT public.post_hive_message(current_setting('app.hive_a')::uuid, 'Hello from the client', 'c0a80101-0000-4000-8000-0000000000c1')$$,
  '23505', 'idempotency_conflict', 'same key from another author conflicts'
);

-- ---------------------------------------------------------------------------
-- Validation and replies.
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT public.post_hive_message(current_setting('app.hive_a')::uuid, '   ', gen_random_uuid())$$,
  '22023', 'invalid_request:body', 'blank body is rejected'
);
SELECT throws_ok(
  $$SELECT public.post_hive_message(current_setting('app.hive_a')::uuid, repeat('a', 4001), gen_random_uuid())$$,
  '22023', 'invalid_request:body', 'body over 4000 characters is rejected'
);
SELECT throws_ok(
  $$SELECT public.post_hive_message(current_setting('app.hive_a')::uuid, 'x', NULL)$$,
  '22023', 'invalid_request:client_request_id', 'missing client request id is rejected'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT set_config('app.rb', public.post_hive_message(
  current_setting('app.hive_b')::uuid, 'Note on B', 'c0a80101-0000-4000-8000-0000000000d1')::text, false);

SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT throws_ok(
  format(
    $$SELECT public.post_hive_message(%L::uuid, 'reply', gen_random_uuid(), %L::uuid)$$,
    current_setting('app.hive_a'),
    current_setting('app.rb')::json->'message'->>'id'
  ),
  '22023', 'invalid_request:reply_to', 'reply to a message in another hive is rejected'
);
SELECT lives_ok(
  format(
    $$SELECT public.post_hive_message(%L::uuid, 'reply in this hive', gen_random_uuid(), %L::uuid)$$,
    current_setting('app.hive_a'),
    current_setting('app.r2')::json->'message'->>'id'
  ),
  'reply to a message in the same hive is accepted'
);

-- ---------------------------------------------------------------------------
-- Access: outsider, removed member, client of another hive.
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT throws_ok($$SELECT public.post_hive_message(current_setting('app.hive_a')::uuid, 'hi', gen_random_uuid())$$,
  '42501', 'hive_not_found', 'outsider cannot post');
SELECT throws_ok($$SELECT public.list_hive_messages(current_setting('app.hive_a')::uuid)$$,
  '42501', 'hive_not_found', 'outsider cannot list');
SELECT throws_ok($$SELECT public.hive_unread_message_count(current_setting('app.hive_a')::uuid)$$,
  '42501', 'hive_not_found', 'outsider gets no unread count');

SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000005","role":"authenticated"}';
SELECT throws_ok($$SELECT public.list_hive_messages(current_setting('app.hive_a')::uuid)$$,
  '42501', 'hive_not_found', 'removed member cannot list');
SELECT throws_ok($$SELECT public.post_hive_message(current_setting('app.hive_a')::uuid, 'hi', gen_random_uuid())$$,
  '42501', 'hive_not_found', 'removed member cannot post');

SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000006","role":"authenticated"}';
SELECT throws_ok($$SELECT public.list_hive_messages(current_setting('app.hive_a')::uuid)$$,
  '42501', 'hive_not_found', 'client of hive B cannot read hive A');
SELECT throws_ok($$SELECT public.mark_hive_messages_read(current_setting('app.hive_a')::uuid, now())$$,
  '42501', 'hive_not_found', 'client of hive B cannot mark hive A read');

-- ---------------------------------------------------------------------------
-- Unread count and mark read (hive B, controlled timestamps).
-- ---------------------------------------------------------------------------
RESET ROLE;
INSERT INTO hive.hive_messages (hive_id, author_kind, author_user_id, body, client_request_id, created_at)
VALUES
  (current_setting('app.hive_b')::uuid, 'person', 'c0a80101-0000-4000-8000-000000000006', 'Client words', gen_random_uuid(), now() - interval '20 minutes'),
  (current_setting('app.hive_b')::uuid, 'person', 'c0a80101-0000-4000-8000-000000000002', 'Staff words', gen_random_uuid(), now() - interval '10 minutes'),
  (current_setting('app.hive_b')::uuid, 'person', 'c0a80101-0000-4000-8000-000000000001', 'Owner words', gen_random_uuid(), now() - interval '5 minutes');
INSERT INTO hive.hive_message_reads (hive_id, user_id, last_read_at)
VALUES (current_setting('app.hive_b')::uuid, 'c0a80101-0000-4000-8000-000000000006', now() - interval '30 minutes');
SET LOCAL role authenticated;

SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000006","role":"authenticated"}';
SELECT is(public.hive_unread_message_count(current_setting('app.hive_b')::uuid), 3, 'unread excludes the caller''s own message');
SELECT public.mark_hive_messages_read(current_setting('app.hive_b')::uuid, now() - interval '7 minutes');
SELECT is(public.hive_unread_message_count(current_setting('app.hive_b')::uuid), 2, 'mark read moves the line forward');
SELECT is(
  (public.mark_hive_messages_read(current_setting('app.hive_b')::uuid, now() - interval '25 minutes')->>'lastReadAt')::timestamptz,
  now() - interval '7 minutes',
  'mark read never moves backwards'
);
SELECT is(
  (public.mark_hive_messages_read(current_setting('app.hive_b')::uuid, now() + interval '1 day')->>'lastReadAt')::timestamptz,
  now(),
  'mark read is clamped to now'
);
SELECT is(public.hive_unread_message_count(current_setting('app.hive_b')::uuid), 0, 'nothing unread after reading up to now');

-- ---------------------------------------------------------------------------
-- The notify window reopens after 30 minutes for someone who has not read.
-- ---------------------------------------------------------------------------
RESET ROLE;
UPDATE hive.hive_message_notices SET last_notified_at = now() - interval '31 minutes'
 WHERE hive_id = current_setting('app.hive_a')::uuid AND user_id = 'c0a80101-0000-4000-8000-000000000001';
UPDATE hive.hive_message_reads SET last_read_at = now() - interval '1 hour'
 WHERE hive_id = current_setting('app.hive_a')::uuid AND user_id = 'c0a80101-0000-4000-8000-000000000001';
SET LOCAL role authenticated;

SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT set_config('app.r5', public.post_hive_message(
  current_setting('app.hive_a')::uuid, 'Second round', gen_random_uuid())::text, false);
SELECT is(
  (SELECT array_agg(x) FROM json_array_elements_text(current_setting('app.r5')::json->'notifyUserIds') x),
  ARRAY['c0a80101-0000-4000-8000-000000000001'],
  'after 30 minutes only the unread owner is notified again'
);

-- ---------------------------------------------------------------------------
-- Keyset pagination (equal timestamps fall back to id order).
-- ---------------------------------------------------------------------------
SELECT set_config('app.p1', public.list_hive_messages(current_setting('app.hive_a')::uuid, NULL, NULL, 2)::text, false);
SELECT is(json_array_length(current_setting('app.p1')::json->'messages'), 2, 'page size is respected');
SELECT ok(json_typeof(current_setting('app.p1')::json->'nextCursor') = 'object', 'a cursor is returned when more exist');
SELECT set_config('app.p2', public.list_hive_messages(
  current_setting('app.hive_a')::uuid,
  (current_setting('app.p1')::json->'nextCursor'->>'beforeCreatedAt')::timestamptz,
  (current_setting('app.p1')::json->'nextCursor'->>'beforeId')::uuid,
  2
)::text, false);
SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM json_array_elements(current_setting('app.p1')::json->'messages') a
      JOIN json_array_elements(current_setting('app.p2')::json->'messages') b ON a->>'id' = b->>'id'
  ) AND json_array_length(current_setting('app.p2')::json->'messages') > 0,
  'the next page continues without repeating rows'
);
SELECT is(json_array_length(public.list_hive_messages(current_setting('app.hive_a')::uuid, NULL, NULL, 0)->'messages'), 1,
  'limit is clamped to at least 1');

-- ---------------------------------------------------------------------------
-- Assistant rows fit the table; deleted users read as Former member.
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT lives_ok(
  $$INSERT INTO hive.hive_messages (hive_id, author_kind, author_user_id, body, source_refs, client_request_id)
    VALUES (current_setting('app.hive_a')::uuid, 'assistant', NULL, 'Assistant words',
            '[{"sourceDocumentId":"c0a80101-0000-4000-8000-0000000000e1","pageNumber":2}]', gen_random_uuid())$$,
  'an assistant row without a user is accepted'
);
SELECT throws_ok(
  $$INSERT INTO hive.hive_messages (hive_id, author_kind, author_user_id, body, client_request_id)
    VALUES (current_setting('app.hive_a')::uuid, 'assistant', 'c0a80101-0000-4000-8000-000000000001', 'x', gen_random_uuid())$$,
  '23514', NULL, 'an assistant row with a user is rejected'
);
INSERT INTO hive.hive_messages (hive_id, author_kind, author_user_id, body, client_request_id)
VALUES (current_setting('app.hive_a')::uuid, 'person', 'c0a80101-0000-4000-8000-000000000007', 'Former words', gen_random_uuid());
DELETE FROM auth.users WHERE id = 'c0a80101-0000-4000-8000-000000000007';
SET LOCAL role authenticated;

SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT set_config('app.l2', public.list_hive_messages(current_setting('app.hive_a')::uuid, NULL, NULL, 100)::text, false);
SELECT is(
  (SELECT m->>'authorDisplayName' FROM json_array_elements(current_setting('app.l2')::json->'messages') m WHERE m->>'body' = 'Former words'),
  'Former member', 'a deleted author reads as Former member'
);
SELECT is(
  (SELECT m->>'authorRoleLabel' FROM json_array_elements(current_setting('app.l2')::json->'messages') m WHERE m->>'authorKind' = 'assistant'),
  'Conv Assistant', 'assistant label is the firm assistant name'
);

-- ---------------------------------------------------------------------------
-- Rate limit: 30 person messages per user per hive per 10 minutes.
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::integer FROM (
     SELECT public.post_hive_message(current_setting('app.hive_a')::uuid, 'burst ' || g, gen_random_uuid())
       FROM generate_series(1, 29) g
   ) x),
  29, 'staff can post up to 30 messages in 10 minutes'
);
SELECT throws_ok($$SELECT public.post_hive_message(current_setting('app.hive_a')::uuid, 'one too many', gen_random_uuid())$$,
  'P0001', 'rate_limited', 'the 31st message is rate limited');

-- ---------------------------------------------------------------------------
-- Individual hive with only its owner.
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claims" TO '{"sub":"c0a80101-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT set_config('app.hive_solo',
  public.create_hive('Solo', NULL, 'c0a80101-0000-4000-8000-0000000000f1', 'own')->'hive'->>'id', false);
SELECT is((public.list_hive_messages(current_setting('app.hive_solo')::uuid)->'participantRoleLabels')::jsonb, '["Owner"]'::jsonb,
  'owner of a hive with no firm is labelled Owner');
SELECT is((public.list_hive_messages(current_setting('app.hive_solo')::uuid)->>'participantCount')::integer, 1, 'only the owner so far');
SELECT is(public.hive_unread_message_count(current_setting('app.hive_solo')::uuid), 0, 'unread is 0 when there are no messages');

-- ---------------------------------------------------------------------------
-- Structure: no triggers, RLS forced, no table grants, no anon execute.
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'hive'
      AND c.relname IN ('hive_messages', 'hive_message_reads', 'hive_message_notices')
      AND NOT t.tgisinternal),
  0, 'no triggers on conversation tables'
);
SELECT ok(
  (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'hive' AND c.relname IN ('hive_messages', 'hive_message_reads', 'hive_message_notices')),
  'RLS enabled and forced on conversation tables'
);
SELECT ok(NOT has_table_privilege('authenticated', 'hive.hive_messages', 'SELECT'), 'authenticated has no table access');
SELECT ok(NOT has_function_privilege('anon', 'public.post_hive_message(uuid, text, uuid, uuid)', 'EXECUTE'), 'anon cannot post');
SELECT ok(NOT has_function_privilege('authenticated', 'hive.can_converse(uuid)', 'EXECUTE'), 'can_converse has no grant');

SELECT finish();
ROLLBACK;
