-- V4-004 — Analyze end to end: reads, frozen snapshot, Canonical Study revision, Writer runs, reports
-- (synthetic data only). Run locally with `supabase test db`; never against a live project.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT * FROM no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
--   Hive 1 (owner A): doc a never read, doc b SUCCEEDED (2 pages); one intent.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'other@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Synthetic Hive',
        'bbbbbbbb-0000-4000-8000-0000000000f1');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, created_at
)
VALUES
  ('cccccccc-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-a.pdf', 'application/pdf', 2048, repeat('a', 64),
   'hive-source-documents', 'synthetic/a.pdf', 'UPLOADED', 'ACTIVE', now() - interval '2 minutes'),
  ('cccccccc-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-b.pdf', 'application/pdf', 2048, repeat('b', 64),
   'hive-source-documents', 'synthetic/b.pdf', 'UPLOADED', 'ACTIVE', now() - interval '1 minute');

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('99999999-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001',
        'Compare the two statements and tell me what changed.', '99999999-0000-4000-8000-0000000000f1');

CREATE TEMP TABLE t_pages AS
WITH raw (n, t) AS (
  VALUES (1, 'Synthetic statement page one.'), (2, 'Synthetic statement page two.')
), built AS (
  SELECT count(*)::int AS page_count,
         jsonb_agg(jsonb_build_object(
           'page_number', n,
           'page_text', t,
           'page_text_sha256', 'sha256:' || encode(sha256(convert_to(t, 'UTF8')), 'hex'),
           'page_byte_length', octet_length(convert_to(t, 'UTF8')),
           'extraction_method', 'pdf_native',
           'provenance_json', jsonb_build_object('synthetic', true)
         ) ORDER BY n) AS pages
    FROM raw
)
SELECT page_count, pages, hive.compute_page_set_digest(repeat('b', 64), page_count, pages) AS digest FROM built;
GRANT SELECT ON t_pages TO service_role;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.put_document_pages(
         'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-00000000000b',
         repeat('b', 64), 'reader-document-read@1:synthetic-b', p.digest, 'SUCCEEDED',
         p.page_count, p.page_count, p.pages)
  FROM t_pages p;
RESET role;

INSERT INTO hive.document_reads (
  hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
  read_fingerprint, page_set_digest, total_physical_pages, verified_page_count, finished_at
)
SELECT 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
       'cccccccc-0000-4000-8000-00000000000b', gen_random_uuid(), 1, 'SUCCEEDED', gen_random_uuid(),
       'reader-document-read@1:synthetic-b', p.digest, p.page_count, p.page_count, now()
  FROM t_pages p;
UPDATE hive.source_documents SET read_status = 'SUCCEEDED' WHERE id = 'cccccccc-0000-4000-8000-00000000000b';

-- ---------------------------------------------------------------------------
-- Analyze with an unread document: reads are queued with the run; nothing is frozen yet
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

CREATE TEMP TABLE t_run1 AS
SELECT public.start_study_preparation(
         'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
         'eeeeeeee-0000-4000-8000-000000000001') AS result;
GRANT SELECT ON t_run1 TO service_role;

SELECT is(
  (SELECT (result -> 'processingRun' ->> 'status') || ':' || json_array_length(result -> 'queuedReadIds') FROM t_run1),
  'READING_DOCUMENTS:1',
  'Analyze queues the unread document and waits for it');

SELECT is(
  (SELECT count(*)::int FROM hive.document_reads
    WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000b'),
  1,
  'the verified read is reused, not repeated');

SELECT is(
  (SELECT (source_snapshot IS NULL) || ':' || (snapshot_frozen_at IS NULL) FROM hive.processing_runs),
  'true:true',
  'no source snapshot is frozen while documents are being read');

SELECT is(
  (SELECT r.request_id::text FROM hive.document_reads r
    WHERE r.source_document_id = 'cccccccc-0000-4000-8000-00000000000a'),
  'dddddddd-0000-4000-8000-000000000001',
  'the queued read carries the Analyze request');

-- ---------------------------------------------------------------------------
-- Server: claim, lease and the hand-off after reading
-- ---------------------------------------------------------------------------
RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (public.claim_processing_run(((SELECT result FROM t_run1) -> 'processingRun' ->> 'id')::uuid) ->> 'claimed')::boolean,
  true,
  'the worker claims the waiting run');

SELECT is(
  (public.claim_processing_run(((SELECT result FROM t_run1) -> 'processingRun' ->> 'id')::uuid) ->> 'claimed')::boolean,
  false,
  'a second invocation cannot claim a leased run');

SELECT is(
  json_array_length(public.get_processing_run_queued_reads(
    ((SELECT result FROM t_run1) -> 'processingRun' ->> 'id')::uuid) -> 'readIds'),
  1,
  'the worker finds the reads the run is waiting for');

SELECT is(
  (public.transition_processing_run(((SELECT result FROM t_run1) -> 'processingRun' ->> 'id')::uuid,
     'READING_DOCUMENTS', 'UNDERSTANDING_REQUEST', '{}'::jsonb) ->> 'waiting')::boolean,
  true,
  'the run waits while a read is active');

RESET role;
UPDATE hive.document_reads
   SET status = 'FAILED', error_code = 'DOCUMENT_UNREADABLE', retryable = false, finished_at = now()
 WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a';
UPDATE hive.source_documents SET read_status = 'FAILED' WHERE id = 'cccccccc-0000-4000-8000-00000000000a';
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

-- ---------------------------------------------------------------------------
-- B5: Analyze is not blanket consent. A material gap found by reading pauses the same run for the
-- owner; acknowledging continues it from what was read, without reading anything again.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_id AS SELECT ((SELECT result FROM t_run1) -> 'processingRun' ->> 'id')::uuid AS id;
GRANT SELECT ON t_id TO service_role, authenticated;

SELECT is(
  (SELECT (r ->> 'awaitingAcknowledgement') || ':' || (r -> 'processingRun' ->> 'status') || ':'
          || (r -> 'processingRun' ->> 'coverageAcknowledgement')
     FROM (SELECT public.transition_processing_run((SELECT id FROM t_id),
             'READING_DOCUMENTS', 'UNDERSTANDING_REQUEST', '{}'::jsonb) AS r) x),
  'true:AWAITING_ACKNOWLEDGEMENT:PENDING',
  'a material gap discovered by reading pauses the run instead of proceeding');

SELECT is(
  (SELECT cardinality(authorized_source_document_ids) || ':' || coverage_status || ':'
          || (coverage_gaps -> 0 ->> 'reason') || ':' || (coverage_gaps -> 0 ->> 'material') || ':'
          || (snapshot_frozen_at IS NOT NULL) || ':' || (lease_expires_at IS NULL) || ':' || (next_dispatch_at IS NULL)
     FROM hive.processing_runs WHERE id = (SELECT id FROM t_id)),
  '1:MATERIAL_GAPS:READ_FAILED:true:true:true:true',
  'the paused run persists what was read, the gap, its reason and coverage status, and holds no lease');

SELECT is(
  (public.claim_processing_run((SELECT id FROM t_id)) ->> 'claimed')::boolean,
  false,
  'no worker can claim a run that waits for the owner');

SELECT is(
  (public.release_processing_run((SELECT id FROM t_id), 'AWAITING_ACKNOWLEDGEMENT') ->> 'released')::boolean,
  false,
  'a run that waits for the owner is never scheduled');

RESET role;
SELECT vault.create_secret('https://worker.invalid', 'hive_internal_worker_url');
SELECT vault.create_secret('synthetic-test-token', 'hive_internal_worker_token');
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(public.dispatch_due_work(), 0, 'the sweeper skips a run that waits for the owner');

RESET role;
SELECT throws_ok(
  $$ UPDATE hive.processing_runs SET coverage_complete = true WHERE id = (SELECT id FROM t_id) $$,
  'P0001',
  'hive.processing_runs identity and snapshot columns are immutable',
  'the frozen snapshot cannot be rewritten');
SELECT throws_ok(
  $$ UPDATE hive.processing_runs SET coverage_acknowledgement = 'PRIOR', coverage_acknowledged = true,
            coverage_acknowledged_at = now() WHERE id = (SELECT id FROM t_id) $$,
  'P0001',
  'hive.processing_runs identity and snapshot columns are immutable',
  'an acknowledgement cannot be written except by the owner continuing the run');

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT (r ->> 'created') || ':' || (r -> 'processingRun' ->> 'id')
     FROM (SELECT public.start_study_preparation('bbbbbbbb-0000-4000-8000-000000000001',
             'dddddddd-0000-4000-8000-000000000009', 'eeeeeeee-0000-4000-8000-000000000009') AS r) x),
  'false:' || (SELECT id::text FROM t_id),
  'Analyze again returns the waiting run instead of starting or reading anything');

SELECT is(
  (SELECT string_agg((g ->> 'reason') || '=' || (g ->> 'acknowledged'), ',')
     FROM json_array_elements(public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001', false)
                                -> 'eligibility' -> 'gaps') g),
  'READ_FAILED=false',
  'the poll shows the gap as not yet acknowledged');

SELECT throws_ok(
  $$ SELECT public.acknowledge_study_coverage('bbbbbbbb-0000-4000-8000-000000000001', (SELECT id FROM t_id),
       'sha256:' || repeat('0', 64)) $$,
  'P0001',
  'coverage_unacknowledged',
  'acknowledging coverage other than what the run found is refused');

CREATE TEMP TABLE t_ack AS
SELECT public.acknowledge_study_coverage('bbbbbbbb-0000-4000-8000-000000000001', (SELECT id FROM t_id),
         (SELECT coverage_digest FROM hive.processing_runs WHERE id = (SELECT id FROM t_id))) AS result;
GRANT SELECT ON t_ack TO service_role;

SELECT is(
  (SELECT (result ->> 'resumed') || ':' || (result -> 'processingRun' ->> 'id') || ':'
          || (result -> 'processingRun' ->> 'status') || ':' || (result -> 'processingRun' ->> 'coverageAcknowledgement')
          || ':' || (result -> 'processingRun' ->> 'coverageStatus')
     FROM t_ack),
  'true:' || (SELECT id::text FROM t_id) || ':UNDERSTANDING_REQUEST:OWNER:MATERIAL_GAPS',
  'acknowledging continues the same run with the gap recorded');

SELECT is(
  (public.acknowledge_study_coverage('bbbbbbbb-0000-4000-8000-000000000001', (SELECT id FROM t_id),
     (SELECT coverage_digest FROM hive.processing_runs WHERE id = (SELECT id FROM t_id))) ->> 'resumed')::boolean,
  false,
  'replaying the acknowledgement is harmless');

SELECT is(
  (SELECT count(*)::int FROM hive.document_reads),
  2,
  'continuing reads nothing again: one verified read reused, one failed read kept');

SELECT is(
  (SELECT count(*)::int || ':' || min(reason) || ':' || min(processing_run_id::text)
     FROM hive.coverage_acknowledgements),
  '1:READ_FAILED:' || (SELECT id::text FROM t_id),
  'the acknowledgement is persisted per gap, with the run that recorded it');

RESET role;
SELECT throws_ok(
  $$ UPDATE hive.coverage_acknowledgements SET reason = 'NOT_READ' $$,
  'P0001',
  'coverage_acknowledgements_immutable',
  'a recorded acknowledgement is immutable');
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(public.dispatch_due_work(), 0, 'a resumed run is not dispatched again before its hand-off delay');
RESET role;
UPDATE hive.processing_runs SET next_dispatch_at = now() - interval '1 second' WHERE id = (SELECT id FROM t_id);
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT is(public.dispatch_due_work(), 1, 'the sweeper recovers a resumed run nobody picked up');
RESET role;
DELETE FROM vault.secrets WHERE name IN ('hive_internal_worker_url', 'hive_internal_worker_token');
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (public.claim_processing_run((SELECT id FROM t_id)) -> 'processingRun' ->> 'stageAttempt'),
  '1',
  'the worker claims the resumed run at its first attempt');

SELECT is(
  (public.claim_processing_run((SELECT id FROM t_id)) ->> 'claimed')::boolean,
  false,
  'a second invocation cannot claim the leased stage');

SELECT is(
  (public.release_processing_run((SELECT id FROM t_id), 'UNDERSTANDING_REQUEST') ->> 'released')::boolean,
  true,
  'the stage is released for a fresh invocation');

SELECT is(
  (public.claim_processing_run((SELECT id FROM t_id)) -> 'processingRun' ->> 'stageAttempt'),
  '1',
  'a released stage is claimed without counting an attempt');

RESET role;
UPDATE hive.processing_runs SET lease_expires_at = now() - interval '1 second' WHERE id = (SELECT id FROM t_id);
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (public.claim_processing_run((SELECT id FROM t_id)) -> 'processingRun' ->> 'stageAttempt'),
  '2',
  'a lapsed lease counts as another attempt');

SELECT is(
  (SELECT (r ->> 'retried') || ':' || (r -> 'processingRun' ->> 'stageAttempt')
     FROM (SELECT public.retry_processing_run_stage((SELECT id FROM t_id), 'UNDERSTANDING_REQUEST',
             '{"error_code":"MODEL_TIMEOUT"}'::jsonb) AS r) x),
  'true:3',
  'a model timeout schedules the same stage again');

SELECT is(
  (public.claim_processing_run((SELECT id FROM t_id)) ->> 'claimed')::boolean,
  false,
  'a retried stage waits for its backoff');

RESET role;
UPDATE hive.processing_runs SET next_dispatch_at = now() - interval '1 second' WHERE id = (SELECT id FROM t_id);
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (SELECT (r ->> 'claimed') || ':' || (r -> 'processingRun' ->> 'stageAttempt')
     FROM (SELECT public.claim_processing_run((SELECT id FROM t_id)) AS r) x),
  'true:3',
  'after the backoff the retry is claimed without counting another attempt');

-- ---------------------------------------------------------------------------
-- Through the stages to an accepted Canonical Study revision
-- ---------------------------------------------------------------------------
SELECT is(
  (public.transition_processing_run((SELECT id FROM t_id), 'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN',
     '{"stage_outputs":{"intentDecomposition":{"schema":"hive.intent-analysis/1"}}}'::jsonb)
     -> 'processingRun' ->> 'stageAttempt'),
  '1',
  'a new stage starts at attempt one');

SELECT public.transition_processing_run((SELECT id FROM t_id), 'IDENTIFYING_DOMAIN', 'DEVELOPING_QUESTIONS',
  '{"stage_outputs":{"domainProposal":{"schema":"hive.domain-proposal/1"},"sampleCoverage":{"sampledPageCount":2}}}'::jsonb);
SELECT public.transition_processing_run((SELECT id FROM t_id), 'DEVELOPING_QUESTIONS', 'BUILDING_PROMPT',
  '{"stage_outputs":{"intentIntelligence":{"schema":"hive.intent-intelligence/1"},"investigationPlan":{"schema":"hive.investigation-plan/1"}}}'::jsonb);
SELECT public.transition_processing_run((SELECT id FROM t_id), 'BUILDING_PROMPT', 'SAVING', '{}'::jsonb);
SELECT public.save_study_prompt_preview((SELECT id FROM t_id), jsonb_build_object(
  'prompt_id', 'hive-study-preview/1', 'prompt_version', '1',
  'prompt_template_digest', 'sha256:' || repeat('1', 64),
  'prompt_text', 'Synthetic prompt',
  'prompt_digest', 'sha256:' || encode(sha256(convert_to('Synthetic prompt', 'UTF8')), 'hex'),
  'execution_manifest', jsonb_build_object(
    'schema', 'hive.study-execution-manifest/1',
    'bindings', jsonb_build_array(jsonb_build_object('format', 'hive.source-page-index/1'))
  )));

SELECT is(
  (public.transition_processing_run((SELECT id FROM t_id), 'SAVING', 'INVESTIGATING',
     jsonb_build_object('prompt_digest', 'sha256:' || encode(sha256(convert_to('Synthetic prompt', 'UTF8')), 'hex')))
     -> 'processingRun' ->> 'status'),
  'INVESTIGATING',
  'the Canonical Study starts from the saved preview');

SELECT is(
  (SELECT json_array_length(r -> 'pages') || ':' || (r -> 'pages' -> 0 ->> 'sourceDocumentId') || ':' || (r ->> 'snapshotCurrent')
     FROM (SELECT public.get_study_source_pages((SELECT id FROM t_id)) AS r) x),
  '2:cccccccc-0000-4000-8000-00000000000b:true',
  'the Study receives only the frozen, authorized pages');

SELECT throws_ok(
  $$ SELECT public.transition_processing_run((SELECT id FROM t_id), 'INVESTIGATING', 'VERIFYING_EVIDENCE', '{}'::jsonb) $$,
  'P0001',
  'stage_output_missing',
  'verification cannot start without the study output');

SELECT public.transition_processing_run((SELECT id FROM t_id), 'INVESTIGATING', 'VERIFYING_EVIDENCE',
  '{"stage_outputs":{"studyInvestigation":{"schema":"hive.study-investigation/1","answers":[]}}}'::jsonb);

SELECT throws_ok(
  $$ SELECT public.accept_study_revision((SELECT id FROM t_id), '{}'::jsonb) $$,
  'P0001',
  'processing_run_transition_invalid',
  'a study revision is accepted only from ACCEPTING_STUDY');

SELECT public.transition_processing_run((SELECT id FROM t_id), 'VERIFYING_EVIDENCE', 'ACCEPTING_STUDY', '{}'::jsonb);

SELECT throws_ok(
  $$ SELECT public.accept_study_revision((SELECT id FROM t_id), jsonb_build_object(
       'investigation', jsonb_build_object('schema', 'something-else'),
       'verification', jsonb_build_object('schema', 'hive.study-verification/1'),
       'audience_configuration', jsonb_build_object('schema', 'hive.audience-configuration/1'),
       'investigation_digest', 'sha256:' || repeat('3', 64))) $$,
  '22023',
  'invalid_request',
  'an investigation with the wrong schema is refused');

CREATE TEMP TABLE t_accept AS
SELECT public.accept_study_revision((SELECT id FROM t_id), jsonb_build_object(
         'investigation', jsonb_build_object('schema', 'hive.study-investigation/1', 'answers', '[]'::jsonb),
         'verification', jsonb_build_object('schema', 'hive.study-verification/1',
                                            'counts', jsonb_build_object('verified', 1, 'unverified', 1)),
         'audience_configuration', jsonb_build_object('schema', 'hive.audience-configuration/1'),
         'investigation_digest', 'sha256:' || repeat('3', 64),
         'model_alias', 'heavy_lifter')) AS result;
GRANT SELECT ON t_accept TO service_role, authenticated;

SELECT is(
  (SELECT (result ->> 'created') || ':' || (result -> 'processingRun' ->> 'status') || ':'
          || (result -> 'studyRevision' ->> 'revisionNumber') || ':' || json_array_length(result -> 'reportRuns')
     FROM t_accept),
  'true:SUCCEEDED:1:2',
  'accepting creates revision 1 and queues both Writer runs');

SELECT is(
  (SELECT (result -> 'studyRevision' ->> 'coverageStatus') || ':' || (result -> 'studyRevision' ->> 'coverageAcknowledgement')
          || ':' || json_array_length(result -> 'studyRevision' -> 'coverageGaps')
     FROM t_accept),
  'MATERIAL_GAPS:OWNER:1',
  'the accepted revision carries its coverage status, gaps and acknowledgement');

SELECT is(
  (SELECT count(*)::int FROM hive.study_revisions) || ':'
    || (SELECT count(*)::int FROM hive.report_runs) || ':'
    || (SELECT (current_revision_id IS NOT NULL)::text FROM hive.canonical_studies),
  '1:2:true',
  'the revision, its pointer and both Writer runs were written together');

SELECT is(
  (public.accept_study_revision((SELECT id FROM t_id), jsonb_build_object(
     'investigation_digest', 'sha256:' || repeat('3', 64))) ->> 'created')::boolean,
  false,
  'replaying the acceptance returns the same revision');

SELECT throws_ok(
  $$ SELECT public.accept_study_revision((SELECT id FROM t_id), jsonb_build_object(
       'investigation_digest', 'sha256:' || repeat('4', 64))) $$,
  'P0001',
  'idempotency_conflict',
  'a different study cannot replace the accepted revision');

RESET role;
SELECT throws_ok(
  $$ UPDATE hive.study_revisions SET model_alias = 'other' $$,
  'P0001',
  'study_revisions_immutable',
  'an accepted study revision is immutable');
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

CREATE TEMP TABLE t_reports AS
SELECT (SELECT id FROM hive.report_runs WHERE audience = 'CUSTOMER') AS customer,
       (SELECT id FROM hive.report_runs WHERE audience = 'PRO') AS pro,
       ((SELECT result FROM t_accept) -> 'studyRevision' ->> 'id')::uuid AS revision;
GRANT SELECT ON t_reports TO service_role, authenticated;

SELECT is(
  (SELECT r -> 'studyRevision' ->> 'id' FROM (SELECT public.get_report_generation_inputs((SELECT pro FROM t_reports)) AS r) x),
  (SELECT revision::text FROM t_reports),
  'the Writer reads the accepted revision only');

-- ---------------------------------------------------------------------------
-- Writer runs retry independently and never touch the accepted Study
-- ---------------------------------------------------------------------------
SELECT is(
  (public.claim_report_run((SELECT customer FROM t_reports)) -> 'reportRun' ->> 'attemptCount'),
  '1',
  'the first claim is attempt one');

SELECT is(
  (public.claim_report_run((SELECT customer FROM t_reports)) ->> 'claimed')::boolean,
  false,
  'a leased Writer run cannot be claimed twice');

SELECT is(
  (SELECT (r ->> 'retrying') || ':' || (r -> 'reportRun' ->> 'status')
     FROM (SELECT public.transition_report_run((SELECT customer FROM t_reports), 'WRITING', 'FAILED',
             '{"error_code":"MODEL_TIMEOUT","retryable":true}'::jsonb) AS r) x),
  'true:QUEUED',
  'a retryable Writer failure is queued again');

SELECT is(
  (public.claim_report_run((SELECT customer FROM t_reports)) ->> 'claimed')::boolean,
  false,
  'a retried Writer run waits for its backoff');

RESET role;
UPDATE hive.report_runs SET next_dispatch_at = now() - interval '1 second' WHERE id = (SELECT customer FROM t_reports);
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.claim_report_run((SELECT customer FROM t_reports));
SELECT public.transition_report_run((SELECT customer FROM t_reports), 'WRITING', 'VALIDATING', '{}'::jsonb);
SELECT public.transition_report_run((SELECT customer FROM t_reports), 'VALIDATING', 'FAILED',
  '{"error_code":"WRITER_OUTPUT_INVALID","retryable":true}'::jsonb);
RESET role;
UPDATE hive.report_runs SET next_dispatch_at = now() - interval '1 second' WHERE id = (SELECT customer FROM t_reports);
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (public.claim_report_run((SELECT customer FROM t_reports)) -> 'reportRun' ->> 'attemptCount'),
  '3',
  'the third claim is the last attempt');

SELECT is(
  (SELECT (r ->> 'retrying') || ':' || (r -> 'reportRun' ->> 'status') || ':' || (r -> 'reportRun' ->> 'errorCode')
     FROM (SELECT public.transition_report_run((SELECT customer FROM t_reports), 'WRITING', 'FAILED',
             '{"error_code":"MODEL_TIMEOUT","retryable":true}'::jsonb) AS r) x),
  'false:FAILED:MODEL_TIMEOUT',
  'after three attempts the Writer run fails');

SELECT is(
  (SELECT c.current_revision_id::text || ':' || r.status
     FROM hive.canonical_studies c, hive.processing_runs r WHERE r.id = (SELECT id FROM t_id)),
  (SELECT revision::text FROM t_reports) || ':SUCCEEDED',
  'a failed Writer leaves the accepted Study and its run untouched');

SELECT public.claim_report_run((SELECT pro FROM t_reports));
SELECT public.transition_report_run((SELECT pro FROM t_reports), 'WRITING', 'VALIDATING', '{}'::jsonb);

SELECT throws_ok(
  $$ SELECT public.save_report((SELECT pro FROM t_reports), '{}'::jsonb) $$,
  'P0001',
  'report_run_transition_invalid',
  'a report is saved only from SAVING');

SELECT public.transition_report_run((SELECT pro FROM t_reports), 'VALIDATING', 'SAVING', '{}'::jsonb);

SELECT throws_ok(
  $$ SELECT public.save_report((SELECT pro FROM t_reports), jsonb_build_object(
       'writer_output', jsonb_build_object('schema', 'hive.writer-report/1', 'audience', 'CUSTOMER'),
       'scenario_analysis', jsonb_build_object('schema', 'hive.scenario-analysis/1'),
       'view', jsonb_build_object('schema', 'hive-application-view/1', 'audience', 'PRO', 'title', 'Synthetic'),
       'writer_prompt_digest', 'sha256:' || repeat('5', 64))) $$,
  '22023',
  'invalid_request',
  'a report written for the other audience is refused');

SELECT is(
  (SELECT (r ->> 'created') || ':' || (r -> 'reportRun' ->> 'status')
     FROM (SELECT public.save_report((SELECT pro FROM t_reports), jsonb_build_object(
             'writer_output', jsonb_build_object('schema', 'hive.writer-report/1', 'audience', 'PRO'),
             'scenario_analysis', jsonb_build_object('schema', 'hive.scenario-analysis/1', 'scenarios', '[]'::jsonb),
             'view', jsonb_build_object('schema', 'hive-application-view/1', 'audience', 'PRO',
                                        'title', 'Synthetic professional report', 'components', '[]'::jsonb),
             'writer_prompt_digest', 'sha256:' || repeat('5', 64),
             'model_alias', 'harvester')) AS r) x),
  'true:SUCCEEDED',
  'a validated report is saved and its run succeeds');

SELECT is(
  (public.save_report((SELECT pro FROM t_reports), '{}'::jsonb) ->> 'created')::boolean,
  false,
  'replaying the save returns the saved report');

RESET role;
SELECT throws_ok(
  $$ UPDATE hive.reports SET title = 'Changed' $$,
  'P0001',
  'reports_immutable',
  'a saved report is immutable');

-- ---------------------------------------------------------------------------
-- Owner: reports are freely readable, Generate again reuses the accepted revision
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT json_array_length(r -> 'latest') || ':' || (r -> 'latest' -> 0 ->> 'audience') || ':'
          || json_array_length(r -> 'history') || ':' || json_array_length(r -> 'reportRuns')
     FROM (SELECT public.get_hive_reports('bbbbbbbb-0000-4000-8000-000000000001') AS r) x),
  '1:PRO:1:2',
  'the owner sees the saved report and both Writer runs');

SELECT is(
  (public.get_hive_report('bbbbbbbb-0000-4000-8000-000000000001',
     (SELECT id FROM hive.reports LIMIT 1)) -> 'report' -> 'view' ->> 'title'),
  'Synthetic professional report',
  'the owner reads the bound view');

SELECT is(
  (SELECT (r ->> 'status') || ':' || (r ->> 'errorCode')
     FROM json_array_elements(public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001', false)
                                -> 'reportRuns') r
    WHERE r ->> 'audience' = 'CUSTOMER'),
  'FAILED:MODEL_TIMEOUT',
  'the Analyze poll reports each Writer run separately');

CREATE TEMP TABLE t_generate AS
SELECT public.generate_hive_report('bbbbbbbb-0000-4000-8000-000000000001', (SELECT revision FROM t_reports),
         'customer', 'ffffffff-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1') AS result;

SELECT is(
  (SELECT (result ->> 'created') || ':' || (result -> 'reportRun' ->> 'trigger') || ':'
          || (result -> 'reportRun' ->> 'status') FROM t_generate),
  'true:OWNER_GENERATE:QUEUED',
  'Generate again queues a new Writer run');

SELECT is(
  (public.generate_hive_report('bbbbbbbb-0000-4000-8000-000000000001', (SELECT revision FROM t_reports),
     'CUSTOMER', 'ffffffff-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a2')
     -> 'reportRun' ->> 'id'),
  (SELECT result -> 'reportRun' ->> 'id' FROM t_generate),
  'replaying Generate again returns the same run');

SELECT is(
  (public.generate_hive_report('bbbbbbbb-0000-4000-8000-000000000001', (SELECT revision FROM t_reports),
     'CUSTOMER', 'ffffffff-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-0000000000a3')
     ->> 'created')::boolean,
  false,
  'a second request while a Writer run is active returns the active run');

SELECT is(
  (SELECT count(*)::int FROM hive.study_revisions),
  1,
  'Generate again does not rerun the Study');

SELECT throws_ok(
  $$ SELECT public.generate_hive_report('bbbbbbbb-0000-4000-8000-000000000001', (SELECT revision FROM t_reports),
       'BOTH', 'ffffffff-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-0000000000a4') $$,
  '22023',
  'invalid_request',
  'only the Customer and Pro audiences exist');

SELECT throws_ok(
  $$ SELECT public.claim_report_run((SELECT pro FROM t_reports)) $$,
  '42501',
  NULL,
  'owners cannot run the Writer themselves');

SELECT throws_ok(
  $$ SELECT public.dispatch_due_work() $$,
  '42501',
  NULL,
  'owners cannot dispatch work');

-- ---------------------------------------------------------------------------
-- B5: a later Analyze reuses the acknowledgement; completed reads are not repeated
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_run3 AS
SELECT public.start_study_preparation(
         'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000003',
         'eeeeeeee-0000-4000-8000-000000000003') AS result;
GRANT SELECT ON t_run3 TO service_role;

SELECT is(
  (SELECT (result -> 'processingRun' ->> 'status') || ':' || json_array_length(result -> 'queuedReadIds') FROM t_run3),
  'READING_DOCUMENTS:1',
  'the failed read is tried again without asking first');

SELECT is(
  (SELECT string_agg(r.source_document_id::text || '=' || r.n, ',' ORDER BY r.source_document_id)
     FROM (SELECT source_document_id, count(*) AS n FROM hive.document_reads GROUP BY source_document_id) r),
  'cccccccc-0000-4000-8000-00000000000a=2,cccccccc-0000-4000-8000-00000000000b=1',
  'the completed read is not started again');

RESET role;
UPDATE hive.document_reads
   SET status = 'FAILED', error_code = 'DOCUMENT_UNREADABLE', retryable = false, finished_at = now()
 WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a' AND status = 'QUEUED';
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (SELECT (r ->> 'applied') || ':' || (r -> 'processingRun' ->> 'status') || ':' || (r -> 'processingRun' ->> 'coverageAcknowledgement')
          || ':' || ((r -> 'processingRun' ->> 'coverageAcknowledgedAt') IS NOT NULL)
     FROM (SELECT public.transition_processing_run(((SELECT result FROM t_run3) -> 'processingRun' ->> 'id')::uuid,
             'READING_DOCUMENTS', 'UNDERSTANDING_REQUEST', '{}'::jsonb) AS r) x),
  'true:UNDERSTANDING_REQUEST:PRIOR:true',
  'the same gap acknowledged earlier in this Hive is reused, not asked again');

-- ---------------------------------------------------------------------------
-- B5: known material gaps need acknowledgement up front; nonmaterial gaps proceed (Hive 2)
-- ---------------------------------------------------------------------------
RESET role;
INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Synthetic Hive 2',
        'bbbbbbbb-0000-4000-8000-0000000000f2');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, read_status, created_at
)
VALUES
  ('cccccccc-0000-4000-8000-00000000000d', 'bbbbbbbb-0000-4000-8000-000000000002',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-d.pdf', 'application/pdf', 2048, repeat('d', 64),
   'hive-source-documents', 'synthetic/d.pdf', 'UPLOADED', 'ACTIVE', 'PENDING', now() - interval '3 minutes'),
  ('cccccccc-0000-4000-8000-00000000000e', 'bbbbbbbb-0000-4000-8000-000000000002',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-e.png', 'image/png', 2048, repeat('e', 64),
   'hive-source-documents', 'synthetic/e.png', 'UPLOADED', 'ACTIVE', 'UNREADABLE', now() - interval '2 minutes'),
  ('cccccccc-0000-4000-8000-00000000000f', 'bbbbbbbb-0000-4000-8000-000000000002',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-f.pdf', 'application/pdf', 2048, repeat('f', 64),
   'hive-source-documents', 'synthetic/f.pdf', 'UPLOADED', 'ACTIVE', 'PENDING', now() - interval '1 minute');

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('99999999-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000001',
        'Summarise what these synthetic notes say.', '99999999-0000-4000-8000-0000000000f2');

-- doc d: two pages, the second blank (a nonmaterial limitation of a complete read)
CREATE TEMP TABLE t_pages_d AS
WITH raw (n, t) AS (
  VALUES (1, 'Synthetic note page one.'), (2, '')
), built AS (
  SELECT count(*)::int AS page_count,
         jsonb_agg(jsonb_build_object(
           'page_number', n,
           'page_text', t,
           'page_text_sha256', 'sha256:' || encode(sha256(convert_to(t, 'UTF8')), 'hex'),
           'page_byte_length', octet_length(convert_to(t, 'UTF8')),
           'extraction_method', 'pdf_native',
           'provenance_json', jsonb_build_object('synthetic', true)
         ) ORDER BY n) AS pages
    FROM raw
)
SELECT page_count, pages, hive.compute_page_set_digest(repeat('d', 64), page_count, pages) AS digest FROM built;
GRANT SELECT ON t_pages_d TO service_role;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.put_document_pages(
         'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-00000000000d',
         repeat('d', 64), 'reader-document-read@1:synthetic-d', p.digest, 'SUCCEEDED',
         p.page_count, p.page_count, p.pages)
  FROM t_pages_d p;
RESET role;

INSERT INTO hive.document_reads (
  hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
  read_fingerprint, page_set_digest, total_physical_pages, verified_page_count, finished_at
)
SELECT 'bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001',
       'cccccccc-0000-4000-8000-00000000000d', gen_random_uuid(), 1, 'SUCCEEDED', gen_random_uuid(),
       'reader-document-read@1:synthetic-d', p.digest, p.page_count, p.page_count, now()
  FROM t_pages_d p;
UPDATE hive.source_documents SET read_status = 'SUCCEEDED' WHERE id = 'cccccccc-0000-4000-8000-00000000000d';

SELECT is(
  (SELECT string_agg((g ->> 'reason') || '=' || (g ->> 'material'), ',' ORDER BY g ->> 'reason')
     FROM jsonb_array_elements(hive.classify_coverage_gaps(
            hive.compute_study_source_snapshot('bbbbbbbb-0000-4000-8000-000000000002'))) g),
  'NOT_READ=true,PAGES_WITHOUT_TEXT=false,UNREADABLE=true',
  'gaps are classified deterministically: a blank page in a complete read is nonmaterial');

SELECT is(
  hive.coverage_status_for(hive.classify_coverage_gaps(jsonb_build_object('documents', jsonb_build_array(
    jsonb_build_object('sourceDocumentId', 'cccccccc-0000-4000-8000-00000000000d', 'fileName', 'synthetic-d.pdf',
                       'readStatus', 'SUCCEEDED', 'pageSetDigest', 'sha256:' || repeat('9', 64),
                       'verifiedPageCount', 2, 'missingPageNumbers', '[]'::jsonb, 'emptyPageNumbers', '[2]'::jsonb)),
    'excluded', '[]'::jsonb))),
  'NONMATERIAL_GAPS',
  'only nonmaterial gaps never need an acknowledgement');

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT public.start_study_preparation('bbbbbbbb-0000-4000-8000-000000000002',
       'dddddddd-0000-4000-8000-000000000021', 'eeeeeeee-0000-4000-8000-000000000021') $$,
  'P0001',
  'coverage_unacknowledged',
  'a known material gap never acknowledged in this Hive is not passed by clicking Analyze');

CREATE TEMP TABLE t_h2 AS
SELECT public.start_study_preparation('bbbbbbbb-0000-4000-8000-000000000002',
         'dddddddd-0000-4000-8000-000000000022', 'eeeeeeee-0000-4000-8000-000000000022',
         public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000002', false) -> 'eligibility' ->> 'coverageDigest')
         AS result;
GRANT SELECT ON t_h2 TO service_role;

SELECT is(
  (SELECT (result -> 'processingRun' ->> 'status') || ':' || json_array_length(result -> 'queuedReadIds') FROM t_h2),
  'READING_DOCUMENTS:1',
  'with the acknowledgement Analyze reads the unread document');

SELECT is(
  (SELECT string_agg(a.reason || '=' || (a.processing_run_id::text = (SELECT result -> 'processingRun' ->> 'id' FROM t_h2)), ',')
     FROM hive.coverage_acknowledgements a WHERE a.hive_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'UNREADABLE=true',
  'only the known material gap is recorded, not the read still to come');

RESET role;
UPDATE hive.document_reads
   SET status = 'FAILED', error_code = 'DOCUMENT_UNREADABLE', retryable = false, finished_at = now()
 WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000f' AND status = 'QUEUED';
UPDATE hive.source_documents SET read_status = 'FAILED' WHERE id = 'cccccccc-0000-4000-8000-00000000000f';
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (SELECT (r -> 'processingRun' ->> 'status') || ':' || json_array_length(r -> 'processingRun' -> 'coverageGaps')
     FROM (SELECT public.transition_processing_run(((SELECT result FROM t_h2) -> 'processingRun' ->> 'id')::uuid,
             'READING_DOCUMENTS', 'UNDERSTANDING_REQUEST', '{}'::jsonb) AS r) x),
  'AWAITING_ACKNOWLEDGEMENT:3',
  'a newly discovered material gap still needs acknowledgement after others were acknowledged');

RESET role;
ALTER TABLE hive.processing_runs DISABLE TRIGGER trg_processing_runs__transition;
UPDATE hive.processing_runs SET updated_at = now() - interval '25 hours'
 WHERE id = ((SELECT result FROM t_h2) -> 'processingRun' ->> 'id')::uuid;
ALTER TABLE hive.processing_runs ENABLE TRIGGER trg_processing_runs__transition;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT (r -> 'processingRun' ->> 'status') || ':' || (r -> 'processingRun' ->> 'errorCode') || ':'
          || (r -> 'processingRun' ->> 'retryable') || ':' || (r -> 'processingRun' ->> 'coverageAcknowledgement')
     FROM (SELECT public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000002', false) AS r) x),
  'FAILED:COVERAGE_INCOMPLETE:true:PENDING',
  'a run left waiting for a day stops, keeping the unacknowledged coverage for the record');

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- V4-004E: Resumable Analyze and Report Reuse (D-046)
--   Hive 3 (owner A): doc g SUCCEEDED (1 page); one intent.
-- ---------------------------------------------------------------------------
RESET role;
INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'Synthetic Hive 3',
        'bbbbbbbb-0000-4000-8000-0000000000f3');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, read_status, created_at
)
VALUES
  ('cccccccc-0000-4000-8000-000000000009', 'bbbbbbbb-0000-4000-8000-000000000003',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-9.pdf', 'application/pdf', 2048, repeat('9', 64),
   'hive-source-documents', 'synthetic/9.pdf', 'UPLOADED', 'ACTIVE', 'SUCCEEDED', now() - interval '1 minute');

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('99999999-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000003',
        'aaaaaaaa-0000-4000-8000-000000000001',
        'Review this synthetic record.', '99999999-0000-4000-8000-0000000000f3');

CREATE TEMP TABLE t_pages_9 AS
WITH raw (n, t) AS (
  VALUES (1, 'Synthetic record page one.')
), built AS (
  SELECT count(*)::int AS page_count,
         jsonb_agg(jsonb_build_object(
           'page_number', n,
           'page_text', t,
           'page_text_sha256', 'sha256:' || encode(sha256(convert_to(t, 'UTF8')), 'hex'),
           'page_byte_length', octet_length(convert_to(t, 'UTF8')),
           'extraction_method', 'pdf_native',
           'provenance_json', jsonb_build_object('synthetic', true)
         ) ORDER BY n) AS pages
    FROM raw
)
SELECT page_count, pages, hive.compute_page_set_digest(repeat('9', 64), page_count, pages) AS digest FROM built;
GRANT SELECT ON t_pages_9 TO service_role;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.put_document_pages(
         'bbbbbbbb-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000009',
         repeat('9', 64), 'reader-document-read@1:synthetic-9', p.digest, 'SUCCEEDED',
         p.page_count, p.page_count, p.pages)
  FROM t_pages_9 p;
RESET role;

INSERT INTO hive.document_reads (
  hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
  read_fingerprint, page_set_digest, total_physical_pages, verified_page_count, finished_at
)
SELECT 'bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001',
       'cccccccc-0000-4000-8000-000000000009', gen_random_uuid(), 1, 'SUCCEEDED', gen_random_uuid(),
       'reader-document-read@1:synthetic-9', p.digest, p.page_count, p.page_count, now()
  FROM t_pages_9 p;

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

CREATE TEMP TABLE t_h3_run1 AS
SELECT public.start_study_preparation(
         'bbbbbbbb-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000031',
         'eeeeeeee-0000-4000-8000-000000000031') AS result;
GRANT SELECT ON t_h3_run1 TO service_role, authenticated;

RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

CREATE TEMP TABLE t_h3_id AS SELECT ((SELECT result FROM t_h3_run1) -> 'processingRun' ->> 'id')::uuid AS id;
GRANT SELECT ON t_h3_id TO service_role, authenticated;

SELECT public.claim_processing_run((SELECT id FROM t_h3_id));
SELECT public.transition_processing_run((SELECT id FROM t_h3_id), 'QUEUED', 'UNDERSTANDING_REQUEST', '{}'::jsonb);
SELECT public.transition_processing_run((SELECT id FROM t_h3_id), 'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN',
  '{"stage_outputs":{"intentDecomposition":{"schema":"hive.intent-analysis/1"}}}'::jsonb);
SELECT public.transition_processing_run((SELECT id FROM t_h3_id), 'IDENTIFYING_DOMAIN', 'DEVELOPING_QUESTIONS',
  '{"stage_outputs":{"domainProposal":{"schema":"hive.domain-proposal/1"},"sampleCoverage":{"sampledPageCount":1}}}'::jsonb);
SELECT public.transition_processing_run((SELECT id FROM t_h3_id), 'DEVELOPING_QUESTIONS', 'BUILDING_PROMPT',
  '{"stage_outputs":{"intentIntelligence":{"schema":"hive.intent-intelligence/1"},"investigationPlan":{"schema":"hive.investigation-plan/1"}}}'::jsonb);
SELECT public.transition_processing_run((SELECT id FROM t_h3_id), 'BUILDING_PROMPT', 'SAVING', '{}'::jsonb);
SELECT public.save_study_prompt_preview((SELECT id FROM t_h3_id), jsonb_build_object(
  'prompt_id', 'hive-study-preview/1', 'prompt_version', '1',
  'prompt_template_digest', 'sha256:' || repeat('1', 64),
  'prompt_text', 'Synthetic prompt 3',
  'prompt_digest', 'sha256:' || encode(sha256(convert_to('Synthetic prompt 3', 'UTF8')), 'hex'),
  'execution_manifest', jsonb_build_object(
    'schema', 'hive.study-execution-manifest/1',
    'bindings', jsonb_build_array(jsonb_build_object('format', 'hive.source-page-index/1'))
  )));
SELECT public.transition_processing_run((SELECT id FROM t_h3_id), 'SAVING', 'INVESTIGATING',
  jsonb_build_object('prompt_digest', 'sha256:' || encode(sha256(convert_to('Synthetic prompt 3', 'UTF8')), 'hex')));
SELECT public.transition_processing_run((SELECT id FROM t_h3_id), 'INVESTIGATING', 'VERIFYING_EVIDENCE',
  '{"stage_outputs":{"studyInvestigation":{"schema":"hive.study-investigation/1","answers":[]}}}'::jsonb);
SELECT public.transition_processing_run((SELECT id FROM t_h3_id), 'VERIFYING_EVIDENCE', 'ACCEPTING_STUDY', '{}'::jsonb);

CREATE TEMP TABLE t_h3_accept AS
SELECT public.accept_study_revision((SELECT id FROM t_h3_id), jsonb_build_object(
         'investigation', jsonb_build_object('schema', 'hive.study-investigation/1', 'answers', '[]'::jsonb),
         'verification', jsonb_build_object('schema', 'hive.study-verification/1', 'counts', '{}'::jsonb),
         'audience_configuration', jsonb_build_object('schema', 'hive.audience-configuration/1'),
         'investigation_digest', 'sha256:' || repeat('7', 64),
         'model_alias', 'heavy_lifter')) AS result;
GRANT SELECT ON t_h3_accept TO service_role, authenticated;

-- Complete CUSTOMER report, fail PRO report (all 3 attempts)
CREATE TEMP TABLE t_h3_reports AS
SELECT (SELECT id FROM hive.report_runs WHERE hive_id = 'bbbbbbbb-0000-4000-8000-000000000003' AND audience = 'CUSTOMER') AS customer,
       (SELECT id FROM hive.report_runs WHERE hive_id = 'bbbbbbbb-0000-4000-8000-000000000003' AND audience = 'PRO') AS pro;
GRANT SELECT ON t_h3_reports TO service_role, authenticated;

SELECT public.claim_report_run((SELECT customer FROM t_h3_reports));
SELECT public.transition_report_run((SELECT customer FROM t_h3_reports), 'WRITING', 'VALIDATING', '{}'::jsonb);
SELECT public.transition_report_run((SELECT customer FROM t_h3_reports), 'VALIDATING', 'SAVING', '{}'::jsonb);
SELECT public.save_report((SELECT customer FROM t_h3_reports), jsonb_build_object(
  'writer_output', jsonb_build_object('schema', 'hive.writer-report/1', 'audience', 'CUSTOMER'),
  'scenario_analysis', jsonb_build_object('schema', 'hive.scenario-analysis/1', 'scenarios', '[]'::jsonb),
  'view', jsonb_build_object('schema', 'hive-application-view/1', 'audience', 'CUSTOMER', 'title', 'Customer report 1', 'components', '[]'::jsonb),
  'writer_prompt_digest', 'sha256:' || repeat('8', 64),
  'model_alias', 'harvester'));

SELECT public.claim_report_run((SELECT pro FROM t_h3_reports));
SELECT public.transition_report_run((SELECT pro FROM t_h3_reports), 'WRITING', 'FAILED',
  '{"error_code":"MODEL_OUTPUT_INVALID","retryable":false}'::jsonb);

-- Owner clicks Analyze when CUSTOMER succeeded and PRO failed: reuses Study, preserves CUSTOMER, queues only PRO
RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

CREATE TEMP TABLE t_h3_resume_partial AS
SELECT public.start_study_preparation(
         'bbbbbbbb-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000032',
         'eeeeeeee-0000-4000-8000-000000000032') AS result;
GRANT SELECT ON t_h3_resume_partial TO service_role, authenticated;

SELECT is(
  (SELECT (result ->> 'created') || ':' || (result ->> 'reusedStudy') || ':' || (result ->> 'reportsReady') || ':'
          || json_array_length(result -> 'queuedReportRunIds')
     FROM t_h3_resume_partial),
  'false:true:false:1',
  'Analyze reuses the compatible Study, preserves the Customer report, and queues only the failed Pro report');

-- Clicking Analyze again while the Pro Writer is leased and active reattaches without creating another run
RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.claim_report_run(((SELECT result FROM t_h3_resume_partial) -> 'queuedReportRunIds' ->> 0)::uuid);

RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT (r ->> 'reusedStudy') || ':' || (r ->> 'reportsReady') || ':' || json_array_length(r -> 'queuedReportRunIds')
     FROM (SELECT public.start_study_preparation(
                    'bbbbbbbb-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000033',
                    'eeeeeeee-0000-4000-8000-000000000033') AS r) x),
  'true:false:0',
  'Analyze reattaches to the active leased Pro Writer run without creating duplicates');

-- Finish the Pro report, then click Analyze: both reports exist -> reportsReady = true, zero runs queued
RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.transition_report_run(((SELECT result FROM t_h3_resume_partial) -> 'queuedReportRunIds' ->> 0)::uuid, 'WRITING', 'VALIDATING', '{}'::jsonb);
SELECT public.transition_report_run(((SELECT result FROM t_h3_resume_partial) -> 'queuedReportRunIds' ->> 0)::uuid, 'VALIDATING', 'SAVING', '{}'::jsonb);
SELECT public.save_report(((SELECT result FROM t_h3_resume_partial) -> 'queuedReportRunIds' ->> 0)::uuid, jsonb_build_object(
  'writer_output', jsonb_build_object('schema', 'hive.writer-report/1', 'audience', 'PRO'),
  'scenario_analysis', jsonb_build_object('schema', 'hive.scenario-analysis/1', 'scenarios', '[]'::jsonb),
  'view', jsonb_build_object('schema', 'hive-application-view/1', 'audience', 'PRO', 'title', 'Pro report 1', 'components', '[]'::jsonb),
  'writer_prompt_digest', 'sha256:' || repeat('8', 64),
  'model_alias', 'harvester'));

RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT (r ->> 'created') || ':' || (r ->> 'reusedStudy') || ':' || (r ->> 'reportsReady') || ':'
          || json_array_length(r -> 'queuedReportRunIds')
     FROM (SELECT public.start_study_preparation(
                    'bbbbbbbb-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000034',
                    'eeeeeeee-0000-4000-8000-000000000034') AS r) x),
  'false:true:true:0',
  'when both Customer and Pro reports exist for the compatible Study, Analyze returns reportsReady=true with zero new runs');

-- Another user is denied
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT public.get_hive_reports('bbbbbbbb-0000-4000-8000-000000000001') $$,
  'P0002',
  'hive_not_found',
  'another user cannot list the reports');

SELECT throws_ok(
  $$ SELECT public.get_hive_report('bbbbbbbb-0000-4000-8000-000000000001', (SELECT id FROM hive.reports LIMIT 1)) $$,
  'P0002',
  'hive_not_found',
  'another user cannot read a report');

SELECT is(
  (SELECT count(*)::int FROM hive.reports) + (SELECT count(*)::int FROM hive.study_revisions)
    + (SELECT count(*)::int FROM hive.report_runs) + (SELECT count(*)::int FROM hive.canonical_studies),
  0,
  'RLS hides studies, Writer runs and reports from another user');

-- ---------------------------------------------------------------------------
-- Optional manual recovery helper: inert until both Vault secrets exist; no Cron schedule
-- ---------------------------------------------------------------------------
RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(public.dispatch_due_work(), 0, 'without the worker URL and token nothing is dispatched');

RESET role;
SELECT ok(
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN true
    ELSE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hive-dispatch-due-work')
  END,
  'Analyze does not depend on a pg_cron dispatcher');

SELECT * FROM finish();
ROLLBACK;
