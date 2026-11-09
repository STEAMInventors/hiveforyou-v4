-- sweep_workflow_recovery: bounded global recovery (service role).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Sweep Hive',
        'bbbbbbbb-0000-4000-8000-0000000000f3');

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('99999999-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001', 'Review the documents.', '99999999-0000-4000-8000-0000000000f3');

INSERT INTO hive.processing_runs (
  id, hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
  authorized_source_document_ids, intent_request_ids, stage_attempt,
  lease_expires_at, next_dispatch_at, workflow_last_handoff_at, updated_at
)
VALUES (
  '44444444-4444-4444-8444-444444444444',
  'bbbbbbbb-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'STUDY_PREPARATION',
  'dddddddd-0000-4000-8000-000000000003',
  1,
  'EXTRACTING',
  'eeeeeeee-0000-4000-8000-000000000003',
  ARRAY[]::uuid[],
  ARRAY['99999999-0000-4000-8000-000000000003'::uuid],
  1,
  NULL,
  now() - interval '6 minutes',
  now() - interval '6 minutes',
  now()
);

SET LOCAL role service_role;

SELECT is(
  (public.sweep_workflow_recovery(10) ->> 'dispatchCount')::int,
  1,
  'sweep reserves one stale processing run for dispatch'
);

SELECT * FROM finish();
ROLLBACK;
