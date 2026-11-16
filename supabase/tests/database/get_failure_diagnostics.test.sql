-- QF-1a-10: get_failure_diagnostics alias fix; owner lookup and stranger refusal.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'gfd-owner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-0000000000d2', 'gfd-stranger@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Diagnostics hive',
        'bbbbbbbb-0000-4000-8000-0000000000f1');

SELECT pg_temp.qf1a_ensure_owner_memberships();

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('99999999-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d1',
        'aaaaaaaa-0000-4000-8000-0000000000d1', 'Synthetic failure lookup.', '99999999-0000-4000-8000-0000000000f1');

SELECT pg_temp.qf1a_insert_frozen_study_preparation_run(
  '33333333-3333-4333-8333-33333333333d',
  'bbbbbbbb-0000-4000-8000-0000000000d1',
  'aaaaaaaa-0000-4000-8000-0000000000d1',
  'dddddddd-0000-4000-8000-0000000000d1',
  'eeeeeeee-0000-4000-8000-0000000000d1',
  'FAILED',
  1,
  1,
  '{}'::jsonb,
  NULL,
  NULL,
  NULL,
  now());

UPDATE hive.processing_runs
   SET error_code = 'MODEL_TIMEOUT',
       retryable = true
 WHERE id = '33333333-3333-4333-8333-33333333333d';

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d1","role":"authenticated"}';

SELECT is(
  json_array_length(
    (public.get_failure_diagnostics(
       'bbbbbbbb-0000-4000-8000-0000000000d1',
       'eeeeeeee-0000-4000-8000-0000000000d1'
     ) -> 'diagnostics')::json
  ),
  1,
  'owner with FAILED processing run sees one diagnostic row for correlation id');

SELECT is(
  public.get_failure_diagnostics(
    'bbbbbbbb-0000-4000-8000-0000000000d1',
    'eeeeeeee-0000-4000-8000-0000000000d1'
  ) -> 'diagnostics' -> 0 ->> 'kind',
  'processing_run',
  'diagnostic kind is processing_run');

SELECT is(
  (public.get_failure_diagnostics(
     'bbbbbbbb-0000-4000-8000-0000000000d1',
     'eeeeeeee-0000-4000-8000-0000000000d1'
   ) -> 'diagnostics' -> 0 ->> 'operationId')::uuid,
  '33333333-3333-4333-8333-33333333333d'::uuid,
  'diagnostic operationId is the failed processing run');

RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT public.get_failure_diagnostics(
       'bbbbbbbb-0000-4000-8000-0000000000d1',
       'eeeeeeee-0000-4000-8000-0000000000d1'
     ) $$,
  'P0002',
  'hive_not_found',
  'stranger cannot read failure diagnostics');

RESET role;

SELECT * FROM finish();
ROLLBACK;