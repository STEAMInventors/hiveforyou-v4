-- Lost workflow hand-offs: recover_expired_workflow_leases re-dispatches once without extra attempts.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Handoff Hive',
        'bbbbbbbb-0000-4000-8000-0000000000f1');

SELECT pg_temp.qf1a_ensure_owner_memberships();

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('99999999-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001', 'Review the documents.', '99999999-0000-4000-8000-0000000000f1');

SELECT pg_temp.qf1a_insert_frozen_study_preparation_run(
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'dddddddd-0000-4000-8000-000000000001',
  'eeeeeeee-0000-4000-8000-000000000001',
  'EXTRACTING',
  1,
  2,
  '{}'::jsonb,
  NULL,
  now() - interval '6 minutes',
  now() - interval '6 minutes',
  now());

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  json_array_length((public.recover_expired_workflow_leases('bbbbbbbb-0000-4000-8000-000000000001') -> 'dispatch')::json),
  1,
  'lost EXTRACTING hand-off is reserved for re-dispatch once'
);

SELECT is(
  (public.recover_expired_workflow_leases('bbbbbbbb-0000-4000-8000-000000000001') -> 'dispatch')::json::text,
  '[]',
  'second poll during reservation dispatches nothing'
);

SELECT is(
  (SELECT stage_attempt::int FROM hive.processing_runs WHERE id = '22222222-2222-4222-8222-222222222222'),
  2,
  'lost hand-off recovery does not increment stage_attempt'
);

SELECT * FROM finish();
ROLLBACK;
