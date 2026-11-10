-- patch_processing_run_workflow_state: the only writer of mutable workflow keys in stage_outputs.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES ('aaaaaaaa-0000-4000-8000-0000000000a1', 'owner-ws@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'Workflow State Hive',
        'bbbbbbbb-0000-4000-8000-0000000000a2');

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('99999999-0000-4000-8000-0000000000a1', 'bbbbbbbb-0000-4000-8000-0000000000a1',
        'aaaaaaaa-0000-4000-8000-0000000000a1', 'Review the documents.', '99999999-0000-4000-8000-0000000000a2');

INSERT INTO hive.processing_runs (
  id, hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
  authorized_source_document_ids, intent_request_ids, stage_attempt,
  stage_outputs, lease_expires_at, next_dispatch_at
)
VALUES (
  '44444444-4444-4444-8444-4444444444a1',
  'bbbbbbbb-0000-4000-8000-0000000000a1',
  'aaaaaaaa-0000-4000-8000-0000000000a1',
  'STUDY_PREPARATION',
  'dddddddd-0000-4000-8000-0000000000a1',
  1,
  'CANONICALIZING',
  'eeeeeeee-0000-4000-8000-0000000000a1',
  ARRAY[]::uuid[],
  ARRAY['99999999-0000-4000-8000-0000000000a1'::uuid],
  1,
  '{"extractZeroProgressHandoffs": {"count": 1}}'::jsonb,
  now() + interval '200 seconds',
  NULL
);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL role service_role;

SELECT is(
  (public.patch_processing_run_workflow_state('44444444-4444-4444-8444-4444444444a1', 'CANONICALIZING',
     '{"plannerJobs": {"canonicalize": {"jobId": "job-1", "lostJobRetried": false}}}'::jsonb) ->> 'applied'),
  'true',
  'canonicalize job id can be recorded while CANONICALIZING'
);

SELECT is(
  (SELECT stage_outputs -> 'plannerJobs' -> 'canonicalize' ->> 'jobId' FROM hive.processing_runs
    WHERE id = '44444444-4444-4444-8444-4444444444a1'),
  'job-1',
  'job id is stored'
);

SELECT is(
  (SELECT stage_outputs -> 'extractZeroProgressHandoffs' ->> 'count' FROM hive.processing_runs
    WHERE id = '44444444-4444-4444-8444-4444444444a1'),
  '1',
  'other keys are kept'
);

SELECT public.patch_processing_run_workflow_state('44444444-4444-4444-8444-4444444444a1', 'CANONICALIZING',
  '{"plannerJobs": {"canonicalize": {"jobId": "job-2"}}}'::jsonb);

SELECT is(
  (SELECT stage_outputs -> 'plannerJobs' -> 'canonicalize' ->> 'jobId' FROM hive.processing_runs
    WHERE id = '44444444-4444-4444-8444-4444444444a1'),
  'job-2',
  'an existing key can be overwritten (stage outputs proper cannot)'
);

SELECT public.patch_processing_run_workflow_state('44444444-4444-4444-8444-4444444444a1', 'CANONICALIZING',
  '{"plannerJobs": null}'::jsonb);

SELECT ok(
  (SELECT NOT (stage_outputs ? 'plannerJobs') FROM hive.processing_runs
    WHERE id = '44444444-4444-4444-8444-4444444444a1'),
  'null removes the key'
);

SELECT is(
  (SELECT lease_expires_at > now() + interval '100 seconds' AND next_dispatch_at IS NULL
     FROM hive.processing_runs WHERE id = '44444444-4444-4444-8444-4444444444a1'),
  true,
  'no lease or dispatch side effects'
);

SELECT is(
  (public.patch_processing_run_workflow_state('44444444-4444-4444-8444-4444444444a1', 'EXTRACTING',
     '{"extractZeroProgressHandoffs": {"count": 2}}'::jsonb) ->> 'applied'),
  'false',
  'wrong expected status applies nothing'
);

SELECT throws_ok(
  $$SELECT public.patch_processing_run_workflow_state('44444444-4444-4444-8444-4444444444a1', 'CANONICALIZING',
      '{"canonicalStudy": {}}'::jsonb)$$,
  '22023',
  NULL,
  'immutable stage outputs cannot be written through this function'
);

SELECT * FROM finish();
ROLLBACK;
