-- Lost workflow hand-offs: recover_expired_workflow_leases re-dispatches once without extra attempts.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Handoff Hive',
        'bbbbbbbb-0000-4000-8000-0000000000f1');

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('99999999-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001', 'Review the documents.', '99999999-0000-4000-8000-0000000000f1');

INSERT INTO hive.processing_runs (
  id, hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
  authorized_source_document_ids, intent_request_ids, stage_attempt,
  lease_expires_at, next_dispatch_at, updated_at
)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'STUDY_PREPARATION',
  'dddddddd-0000-4000-8000-000000000001',
  1,
  'EXTRACTING',
  'eeeeeeee-0000-4000-8000-000000000001',
  ARRAY[]::uuid[],
  ARRAY['99999999-0000-4000-8000-000000000001'::uuid],
  2,
  NULL,
  now() - interval '4 minutes',
  now() - interval '4 minutes'
);

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
