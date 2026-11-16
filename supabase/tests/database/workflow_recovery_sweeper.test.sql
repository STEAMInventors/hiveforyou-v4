-- sweep_workflow_recovery: bounded global recovery (service role).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Sweep Hive',
        'bbbbbbbb-0000-4000-8000-0000000000f3');

SELECT pg_temp.qf1a_ensure_owner_memberships();

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('99999999-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001', 'Review the documents.', '99999999-0000-4000-8000-0000000000f3');

SELECT pg_temp.qf1a_insert_frozen_study_preparation_run(
  '44444444-4444-4444-8444-444444444444',
  'bbbbbbbb-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'dddddddd-0000-4000-8000-000000000003',
  'eeeeeeee-0000-4000-8000-000000000003',
  'EXTRACTING',
  1,
  1,
  '{}'::jsonb,
  NULL,
  now() - interval '6 minutes',
  now() - interval '6 minutes',
  now());

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (public.sweep_workflow_recovery(10) ->> 'dispatchCount')::int,
  1,
  'sweep reserves one stale processing run for dispatch'
);

SELECT * FROM finish();
ROLLBACK;
