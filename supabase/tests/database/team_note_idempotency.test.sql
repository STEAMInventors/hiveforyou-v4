-- FL-4b-3: team note idempotency behaviour (synthetic data only).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(10);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('f1b30101-0000-4000-8000-000000000001', 'tn-owner@example.test', 'authenticated', 'authenticated'),
  ('f1b30101-0000-4000-8000-000000000002', 'tn-client@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.user_profiles (user_id, display_name, starting_view, created_at, updated_at)
VALUES ('f1b30101-0000-4000-8000-000000000001', 'Owner', 'clients', now(), now())
ON CONFLICT (user_id) DO NOTHING;

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"f1b30101-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT ok((public.create_firm('TN Law', 'Assistant')->>'firmId') IS NOT NULL, 'create_firm succeeds');

SELECT set_config(
  'app.v_hive',
  (public.create_hive('Client', 'Notes', 'f1b30101-0000-4000-8000-00000000bb1', 'client')->'hive'->>'id'),
  false
);

SELECT set_config(
  'app.v_other',
  (public.create_hive('Other', 'Hive', 'f1b30101-0000-4000-8000-00000000bb2', 'client')->'hive'->>'id'),
  false
);

SELECT set_config('app.v_key', 'f1b30101-0000-4000-8000-00000000cc1', false);
SELECT set_config('app.v_key2', 'f1b30101-0000-4000-8000-00000000cc2', false);

SELECT is(
  (public.add_team_note(
    current_setting('app.v_hive')::uuid, 'first note', NULL, current_setting('app.v_key')::uuid
  )->>'deduplicated')::boolean,
  false,
  'first keyed insert is not deduplicated'
);

SELECT is(
  (public.add_team_note(
    current_setting('app.v_hive')::uuid, 'first note', NULL, current_setting('app.v_key')::uuid
  )->>'teamNoteId'),
  (public.add_team_note(
    current_setting('app.v_hive')::uuid, 'retry note', NULL, current_setting('app.v_key')::uuid
  )->>'teamNoteId'),
  'retry same client_request_id returns first note id'
);

SELECT is(
  (SELECT count(*)::integer FROM hive.team_notes
    WHERE hive_id = current_setting('app.v_hive')::uuid AND client_request_id = current_setting('app.v_key')::uuid),
  1,
  'one row for duplicate client_request_id'
);

SELECT ok(
  (public.add_team_note(current_setting('app.v_hive')::uuid, 'second note', NULL, current_setting('app.v_key2')::uuid)->>'teamNoteId')
    IS DISTINCT FROM
    (public.add_team_note(current_setting('app.v_hive')::uuid, 'first note', NULL, current_setting('app.v_key')::uuid)->>'teamNoteId'),
  'different client_request_id creates another row'
);

SELECT lives_ok(
  format(
    $$SELECT public.add_team_note(%L::uuid, 'cross hive', NULL, %L::uuid)$$,
    current_setting('app.v_other'),
    current_setting('app.v_key')
  ),
  'same client_request_id on a different hive is allowed'
);

INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by)
VALUES (
  current_setting('app.v_hive')::uuid,
  'f1b30101-0000-4000-8000-000000000002',
  'client',
  'active',
  'f1b30101-0000-4000-8000-000000000001'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"f1b30101-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$SELECT public.add_team_note(current_setting('app.v_hive')::uuid, 'client note', NULL, gen_random_uuid())$$,
  'P0001',
  NULL,
  'client member cannot add_team_note'
);

RESET ROLE;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"f1b30101-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT lives_ok(
  $$SELECT public.add_team_note(current_setting('app.v_hive')::uuid, 'null key one', NULL, NULL)$$,
  'null client_request_id first insert'
);

SELECT lives_ok(
  $$SELECT public.add_team_note(current_setting('app.v_hive')::uuid, 'null key two', NULL, NULL)$$,
  'null client_request_id second insert'
);

SELECT finish();
ROLLBACK;