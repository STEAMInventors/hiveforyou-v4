-- Write-ahead hand-off and stall recovery (workflow_last_handoff_at, 5 minute grace).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Stall Hive',
        'bbbbbbbb-0000-4000-8000-0000000000f2');

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('99999999-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001', 'Review the documents.', '99999999-0000-4000-8000-0000000000f2');

INSERT INTO hive.processing_runs (
  id, hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
  authorized_source_document_ids, intent_request_ids, stage_attempt,
  lease_expires_at, next_dispatch_at, workflow_last_handoff_at, updated_at
)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  'bbbbbbbb-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'STUDY_PREPARATION',
  'dddddddd-0000-4000-8000-000000000002',
  1,
  'EXTRACTING',
  'eeeeeeee-0000-4000-8000-000000000002',
  ARRAY[]::uuid[],
  ARRAY['99999999-0000-4000-8000-000000000002'::uuid],
  3,
  NULL,
  NULL,
  now() - interval '6 minutes',
  now()
);

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  json_array_length((public.recover_expired_workflow_leases('bbbbbbbb-0000-4000-8000-000000000001') -> 'dispatch')::json),
  1,
  'stalled EXTRACTING run with stage_attempt 3 still re-dispatches when zero-progress cap not reached'
);

UPDATE hive.processing_runs
   SET stage_outputs = jsonb_build_object('extractZeroProgressHandoffs', jsonb_build_object('count', 3)),
       next_dispatch_at = NULL,
       lease_expires_at = NULL,
       workflow_last_handoff_at = now() - interval '6 minutes'
 WHERE id = '33333333-3333-4333-8333-333333333333';

SELECT public.recover_expired_workflow_leases('bbbbbbbb-0000-4000-8000-000000000001');

SELECT is(
  (SELECT status FROM hive.processing_runs WHERE id = '33333333-3333-4333-8333-333333333333'),
  'FAILED',
  'stalled run fails with PREPARATION_INTERRUPTED after zero-progress handoff cap'
);

SELECT ok(
  hive.is_valid_failure_diagnostic(
    (SELECT failure_diagnostic FROM hive.processing_runs WHERE id = '33333333-3333-4333-8333-333333333333')
  ),
  'stalled failure carries failure_diagnostic'
);

SELECT is(
  (SELECT failure_diagnostic ->> 'diagnosticReason' FROM hive.processing_runs WHERE id = '33333333-3333-4333-8333-333333333333'),
  'stalled_no_handoff',
  'stalled failure diagnostic reason'
);

SELECT * FROM finish();
ROLLBACK;
