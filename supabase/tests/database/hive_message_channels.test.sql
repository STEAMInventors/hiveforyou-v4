-- FL-8h: people vs assistant channels (synthetic data only).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(22);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('d0a80101-0000-4000-8000-000000000001', 'ch-owner@example.test', 'authenticated', 'authenticated'),
  ('d0a80101-0000-4000-8000-000000000002', 'ch-staff@example.test', 'authenticated', 'authenticated'),
  ('d0a80101-0000-4000-8000-000000000003', 'ch-client@example.test', 'authenticated', 'authenticated'),
  ('d0a80101-0000-4000-8000-000000000004', 'ch-other@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.user_profiles (user_id, display_name, starting_view, created_at, updated_at)
VALUES
  ('d0a80101-0000-4000-8000-000000000003', 'Rita Client', 'clients', now(), now()),
  ('d0a80101-0000-4000-8000-000000000002', 'Sam Staff', 'clients', now(), now())
ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name;

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d0a80101-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT ok((public.create_firm('Channel Law', 'Maya')->>'firmId') IS NOT NULL, 'firm');
SELECT set_config('app.hive_a',
  public.create_hive('Rita Client', 'Intake', 'd0a80101-0000-4000-8000-0000000000a1', 'client')->'hive'->>'id', false);
RESET ROLE;

INSERT INTO hive.firm_members (firm_id, user_id, invited_email, role, title, state)
SELECT h.firm_id, 'd0a80101-0000-4000-8000-000000000002', 'ch-staff@example.test', 'member', 'Associate', 'active'
  FROM hive.hives h WHERE h.id = current_setting('app.hive_a')::uuid;

INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by)
VALUES (current_setting('app.hive_a')::uuid, 'd0a80101-0000-4000-8000-000000000003', 'client', 'active', 'd0a80101-0000-4000-8000-000000000001');

-- People channel posts.
SET LOCAL "request.jwt.claims" TO '{"sub":"d0a80101-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT set_config('app.p1', public.post_hive_message(
  current_setting('app.hive_a')::uuid, 'People hello', 'd0a80101-0000-4000-8000-0000000000c1', NULL, 'people', NULL)::text, false);
SELECT is(json_array_length(current_setting('app.p1')::json->'notifyUserIds'), 2, 'people post notifies');

-- Assistant channel posts (no notify).
SELECT set_config('app.a1', public.post_hive_message(
  current_setting('app.hive_a')::uuid, 'Ask Maya this', 'd0a80101-0000-4000-8000-0000000000c2', NULL, 'assistant', NULL)::text, false);
SELECT is(json_array_length(current_setting('app.a1')::json->'notifyUserIds'), 0, 'assistant post does not notify');

-- Staff cannot list another staff assistant thread.
SET LOCAL "request.jwt.claims" TO '{"sub":"d0a80101-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT set_config('app.a2', public.post_hive_message(
  current_setting('app.hive_a')::uuid, 'Staff private ask', 'd0a80101-0000-4000-8000-0000000000c3', NULL, 'assistant', NULL)::text, false);
RESET ROLE;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d0a80101-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT throws_ok(
  format($$SELECT public.list_hive_messages(%L::uuid, 'assistant', %L::uuid)$$,
    current_setting('app.hive_a'),
    'd0a80101-0000-4000-8000-000000000002'),
  '42501', 'hive_not_found', 'client cannot read staff assistant thread');

-- Staff can list client assistant thread.
SET LOCAL "request.jwt.claims" TO '{"sub":"d0a80101-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT set_config('app.lc', public.list_hive_messages(
  current_setting('app.hive_a')::uuid, 'assistant', 'd0a80101-0000-4000-8000-000000000003', NULL, NULL, 50)::text, false);
SELECT is(json_array_length(current_setting('app.lc')::json->'messages'), 1, 'staff reads client assistant thread');

-- People list excludes assistant rows.
SELECT set_config('app.lp', public.list_hive_messages(current_setting('app.hive_a')::uuid, 'people')::text, false);
SELECT is(json_array_length(current_setting('app.lp')::json->'messages'), 1, 'people list only people channel');

-- Unread count ignores assistant.
SELECT set_config('app.ur', public.hive_unread_message_count(current_setting('app.hive_a')::uuid)::text, false);
SELECT is(current_setting('app.ur')::integer, 1, 'unread counts people channel only for client');

SELECT finish();
ROLLBACK;