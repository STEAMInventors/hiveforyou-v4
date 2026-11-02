-- V4-004 — Analyze / Prompt Preview runs, frozen snapshots and previews (synthetic data only).
-- Run locally with `supabase test db`; never against a live project.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(41);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
--   Hive 1 (owner A): doc a SUCCEEDED (2 pages), doc b PARTIAL (4 physical pages, 3 saved,
--                     page 2 blank), doc c never read; one intent.
--   Hive 2 (owner B): no documents.
--   Hive 3 (owner A): doc d SUCCEEDED (1 page), no intent.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'other@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Synthetic Hive',
   'bbbbbbbb-0000-4000-8000-0000000000f1'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', 'Other Hive',
   'bbbbbbbb-0000-4000-8000-0000000000f2'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'No Intent Hive',
   'bbbbbbbb-0000-4000-8000-0000000000f3');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status
)
VALUES
  ('cccccccc-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-a.pdf', 'application/pdf', 2048, repeat('a', 64),
   'hive-source-documents', 'synthetic/a.pdf', 'UPLOADED', 'ACTIVE'),
  ('cccccccc-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-b.pdf', 'application/pdf', 2048, repeat('b', 64),
   'hive-source-documents', 'synthetic/b.pdf', 'UPLOADED', 'ACTIVE'),
  ('cccccccc-0000-4000-8000-00000000000c', 'bbbbbbbb-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-c.pdf', 'application/pdf', 2048, repeat('c', 64),
   'hive-source-documents', 'synthetic/c.pdf', 'UPLOADED', 'ACTIVE'),
  ('cccccccc-0000-4000-8000-00000000000d', 'bbbbbbbb-0000-4000-8000-000000000003',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-d.pdf', 'application/pdf', 2048, repeat('d', 64),
   'hive-source-documents', 'synthetic/d.pdf', 'UPLOADED', 'ACTIVE');

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('99999999-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001',
        'Compare the two statements and tell me what changed.', '99999999-0000-4000-8000-0000000000f1');

CREATE TEMP TABLE t_page_sets AS
WITH raw (doc, sha, n, t) AS (
  VALUES
    ('a', repeat('a', 64), 1, 'Synthetic statement page one.'),
    ('a', repeat('a', 64), 2, 'Synthetic statement page two.'),
    ('b', repeat('b', 64), 1, 'Synthetic notice page one.'),
    ('b', repeat('b', 64), 2, '   '),
    ('b', repeat('b', 64), 3, 'Synthetic notice page three.'),
    ('d', repeat('d', 64), 1, 'Synthetic letter.')
), built AS (
  SELECT doc, sha, count(*)::int AS page_count,
         jsonb_agg(jsonb_build_object(
           'page_number', n,
           'page_text', t,
           'page_text_sha256', 'sha256:' || encode(sha256(convert_to(t, 'UTF8')), 'hex'),
           'page_byte_length', octet_length(convert_to(t, 'UTF8')),
           'extraction_method', 'pdf_native',
           'provenance_json', jsonb_build_object('synthetic', true)
         ) ORDER BY n) AS pages
    FROM raw GROUP BY doc, sha
)
SELECT doc, sha, page_count, pages, hive.compute_page_set_digest(sha, page_count, pages) AS digest
  FROM built;
GRANT SELECT ON t_page_sets TO service_role, authenticated;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.put_document_pages(
         CASE s.doc WHEN 'd' THEN 'bbbbbbbb-0000-4000-8000-000000000003'::uuid
                    ELSE 'bbbbbbbb-0000-4000-8000-000000000001'::uuid END,
         ('cccccccc-0000-4000-8000-00000000000' || s.doc)::uuid,
         s.sha, 'reader-document-read@1:synthetic-' || s.doc, s.digest,
         CASE s.doc WHEN 'b' THEN 'PARTIAL' ELSE 'SUCCEEDED' END,
         CASE s.doc WHEN 'b' THEN 4 ELSE s.page_count END,
         s.page_count, s.pages)
  FROM t_page_sets s;
RESET role;

INSERT INTO hive.document_reads (
  hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
  read_fingerprint, page_set_digest, total_physical_pages, verified_page_count, finished_at
)
SELECT CASE s.doc WHEN 'd' THEN 'bbbbbbbb-0000-4000-8000-000000000003'::uuid
                  ELSE 'bbbbbbbb-0000-4000-8000-000000000001'::uuid END,
       'aaaaaaaa-0000-4000-8000-000000000001',
       ('cccccccc-0000-4000-8000-00000000000' || s.doc)::uuid,
       gen_random_uuid(), 1,
       CASE s.doc WHEN 'b' THEN 'PARTIAL' ELSE 'SUCCEEDED' END,
       gen_random_uuid(),
       'reader-document-read@1:synthetic-' || s.doc, s.digest,
       CASE s.doc WHEN 'b' THEN 4 ELSE s.page_count END, s.page_count, now()
  FROM t_page_sets s;

UPDATE hive.source_documents SET read_status = 'SUCCEEDED'
 WHERE id IN ('cccccccc-0000-4000-8000-00000000000a', 'cccccccc-0000-4000-8000-00000000000d');
UPDATE hive.source_documents SET read_status = 'PARTIAL'
 WHERE id = 'cccccccc-0000-4000-8000-00000000000b';

-- ---------------------------------------------------------------------------
-- Owner sees eligibility and must acknowledge partial coverage
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  json_array_length(public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001', false)
                      -> 'eligibility' -> 'documents'),
  2,
  'documents with verified SUCCEEDED and PARTIAL reads are eligible');

SELECT is(
  (SELECT x ->> 'sourceDocumentId' || ':' || (x ->> 'reason')
     FROM json_array_elements(public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001', false)
                                -> 'eligibility' -> 'excluded') x),
  'cccccccc-0000-4000-8000-00000000000c:NOT_READ',
  'the unread document is excluded with its reason');

SELECT is(
  (public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001', false)
     -> 'eligibility' ->> 'coverageComplete')::boolean,
  false,
  'coverage is not reported complete');

SELECT is(
  (SELECT (d -> 'missingPageNumbers')::text || '|' || (d -> 'emptyPageNumbers')::text
     FROM json_array_elements(public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001', false)
                                -> 'eligibility' -> 'documents') d
    WHERE d ->> 'sourceDocumentId' = 'cccccccc-0000-4000-8000-00000000000b'),
  '[4]|[2]',
  'the partial read discloses its missing and blank pages');

SELECT throws_ok(
  $$ SELECT public.start_study_preparation(
       'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
       'eeeeeeee-0000-4000-8000-000000000001') $$,
  'P0001',
  'coverage_unacknowledged',
  'partial coverage cannot start without acknowledgment');

SELECT throws_ok(
  $$ SELECT public.start_study_preparation(
       'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
       'eeeeeeee-0000-4000-8000-000000000001', 'sha256:' || repeat('0', 64)) $$,
  'P0001',
  'coverage_unacknowledged',
  'an acknowledgment of different coverage is refused');

CREATE TEMP TABLE t_run AS
SELECT public.start_study_preparation(
         'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
         'eeeeeeee-0000-4000-8000-000000000001',
         public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001', false)
           -> 'eligibility' ->> 'coverageDigest') AS result;

SELECT is(
  (SELECT (result ->> 'created') || ':' || (result -> 'processingRun' ->> 'status') FROM t_run),
  'true:QUEUED',
  'acknowledged partial coverage queues one run');

SELECT is(
  (public.start_study_preparation(
     'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
     'eeeeeeee-0000-4000-8000-000000000001') -> 'processingRun' ->> 'id'),
  (SELECT result -> 'processingRun' ->> 'id' FROM t_run),
  'replaying the same click returns the same run');

SELECT is(
  (SELECT (r ->> 'created') || ':' || (r -> 'processingRun' ->> 'id')
     FROM (SELECT public.start_study_preparation(
                    'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002',
                    'eeeeeeee-0000-4000-8000-000000000002')::json AS r) x),
  'false:' || (SELECT result -> 'processingRun' ->> 'id' FROM t_run),
  'a new click while a run is active returns the active run');

SELECT is(
  (SELECT count(*)::int FROM hive.processing_runs),
  1,
  'duplicate clicks created exactly one run');

SELECT is(
  (SELECT cardinality(authorized_source_document_ids) || ':' || cardinality(intent_request_ids)
          || ':' || coverage_acknowledged
     FROM hive.processing_runs),
  '2:1:true',
  'the run freezes the authorized documents, the intent and the acknowledgment');

SELECT throws_ok(
  $$ SELECT public.transition_processing_run(
       (SELECT id FROM hive.processing_runs LIMIT 1), 'QUEUED', 'UNDERSTANDING_REQUEST', '{}'::jsonb) $$,
  '42501',
  NULL,
  'owners cannot advance the run themselves');

-- ---------------------------------------------------------------------------
-- Another user and anonymous callers are denied
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT public.start_study_preparation(
       'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000009',
       'eeeeeeee-0000-4000-8000-000000000009') $$,
  'P0002',
  'hive_not_found',
  'another user cannot start a preparation in the Hive');

SELECT throws_ok(
  $$ SELECT public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001') $$,
  'P0002',
  'hive_not_found',
  'another user cannot read the preparation');

SELECT is((SELECT count(*)::int FROM hive.processing_runs), 0, 'RLS hides runs from another user');

SELECT throws_ok(
  $$ SELECT public.start_study_preparation(
       'bbbbbbbb-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-00000000000b',
       'eeeeeeee-0000-4000-8000-00000000000b') $$,
  'P0001',
  'no_eligible_documents',
  'a Hive without verified reads cannot be analyzed');

RESET role;
SET LOCAL role anon;
SELECT throws_ok(
  $$ SELECT public.start_study_preparation(
       'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000009',
       'eeeeeeee-0000-4000-8000-000000000009') $$,
  '42501',
  NULL,
  'anonymous callers cannot start a preparation');

-- ---------------------------------------------------------------------------
-- Server advances the run; each stage requires the previous validated output
-- ---------------------------------------------------------------------------
RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT throws_ok(
  $$ SELECT public.transition_processing_run(
       (SELECT id FROM hive.processing_runs LIMIT 1), 'QUEUED', 'SAVING', '{}'::jsonb) $$,
  'P0001',
  'processing_run_transition_invalid',
  'illegal transitions are rejected');

SELECT is(
  (public.transition_processing_run(
     (SELECT id FROM hive.processing_runs LIMIT 1), 'QUEUED', 'UNDERSTANDING_REQUEST', '{}'::jsonb)
     ->> 'applied')::boolean,
  true,
  'QUEUED advances to UNDERSTANDING_REQUEST');

SELECT is(
  (SELECT json_array_length(r -> 'intents') || ':' || (r ->> 'snapshotCurrent')
     FROM (SELECT public.get_study_preparation_inputs((SELECT id FROM hive.processing_runs LIMIT 1)) AS r) x),
  '1:true',
  'the worker receives the frozen intent and a current snapshot');

SELECT throws_ok(
  $$ SELECT public.transition_processing_run(
       (SELECT id FROM hive.processing_runs LIMIT 1), 'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN',
       '{}'::jsonb) $$,
  'P0001',
  'stage_output_missing',
  'a stage cannot start before the previous output is saved');

SELECT throws_ok(
  $$ SELECT public.transition_processing_run(
       (SELECT id FROM hive.processing_runs LIMIT 1), 'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN',
       '{"stage_outputs":{"intentDecomposition":{"schema":"hive.intent-decomposition/1"}},
         "stage_metric":{"stage":"UNDERSTANDING_REQUEST","errorCode":"the user wants to know"}}'::jsonb) $$,
  '22023',
  'invalid_request',
  'stage metrics refuse free text');

SELECT is(
  (public.transition_processing_run(
     (SELECT id FROM hive.processing_runs LIMIT 1), 'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN',
     '{"stage_outputs":{"intentDecomposition":{"schema":"hive.intent-decomposition/1"}},
       "stage_metric":{"stage":"UNDERSTANDING_REQUEST","outcome":"SUCCEEDED","promptId":"hive-intent/1",
                       "modelAliasRequested":"sorter","resolvedModel":"gpt-4o-mini-2024-07-18",
                       "promptTokens":812,"completionTokens":240,"totalTokens":1052,"latencyMs":1830,
                       "finishReason":"stop","retryable":null}}'::jsonb)
     -> 'processingRun' -> 'stageMetrics' -> 0 ->> 'totalTokens')::int,
  1052,
  'validated output and per-stage token usage are recorded');

SELECT is(
  (public.transition_processing_run(
     (SELECT id FROM hive.processing_runs LIMIT 1), 'IDENTIFYING_DOMAIN', 'PLANNING_INVESTIGATION',
     '{"stage_outputs":{"domainProposal":{"schema":"hive.domain-proposal/1"},
                        "sampleCoverage":{"sampledPageCount":2}}}'::jsonb) ->> 'applied')::boolean,
  true,
  'domain proposal and sample coverage advance to planning');

SELECT throws_ok(
  $$ SELECT public.transition_processing_run(
       (SELECT id FROM hive.processing_runs LIMIT 1), 'PLANNING_INVESTIGATION', 'BUILDING_PROMPT',
       '{"stage_outputs":{"domainProposal":{"schema":"replaced"},
                          "investigationPlan":{"schema":"hive.investigation-plan/1"}}}'::jsonb) $$,
  'P0001',
  'stage_output_exists',
  'saved stage outputs cannot be replaced');

SELECT is(
  (public.transition_processing_run(
     (SELECT id FROM hive.processing_runs LIMIT 1), 'PLANNING_INVESTIGATION', 'BUILDING_PROMPT',
     '{"stage_outputs":{"investigationPlan":{"schema":"hive.investigation-plan/1"}}}'::jsonb)
     ->> 'applied')::boolean,
  true,
  'the investigation plan advances to building the prompt');

SELECT is(
  (public.transition_processing_run(
     (SELECT id FROM hive.processing_runs LIMIT 1), 'BUILDING_PROMPT', 'SAVING', '{}'::jsonb)
     ->> 'applied')::boolean,
  true,
  'BUILDING_PROMPT advances to SAVING');

SELECT throws_ok(
  $$ SELECT public.transition_processing_run(
       (SELECT id FROM hive.processing_runs LIMIT 1), 'SAVING', 'SUCCEEDED',
       jsonb_build_object('prompt_digest',
         'sha256:' || encode(sha256(convert_to('Synthetic prompt', 'UTF8')), 'hex'))) $$,
  'P0001',
  'preview_not_saved',
  'success is refused before the preview is saved');

SELECT throws_ok(
  $$ SELECT public.save_study_prompt_preview(
       (SELECT id FROM hive.processing_runs LIMIT 1),
       jsonb_build_object(
         'prompt_id', 'hive-study-preview/1', 'prompt_version', '1',
         'prompt_template_digest', 'sha256:' || repeat('1', 64),
         'prompt_text', 'Synthetic prompt',
         'prompt_digest', 'sha256:' || repeat('2', 64),
         'execution_manifest', jsonb_build_object('schema', 'hive.study-execution-manifest/1'))) $$,
  '22023',
  'invalid_request',
  'a preview whose digest does not match its prompt text is refused');

SELECT is(
  (public.save_study_prompt_preview(
     (SELECT id FROM hive.processing_runs LIMIT 1),
     jsonb_build_object(
       'prompt_id', 'hive-study-preview/1', 'prompt_version', '1',
       'prompt_template_digest', 'sha256:' || repeat('1', 64),
       'prompt_text', 'Synthetic prompt',
       'prompt_digest', 'sha256:' || encode(sha256(convert_to('Synthetic prompt', 'UTF8')), 'hex'),
       'execution_manifest', jsonb_build_object('schema', 'hive.study-execution-manifest/1')))
     -> 'preview' -> 'sourceSnapshot' -> 'documents' -> 1 ->> 'sourceDocumentId'),
  'cccccccc-0000-4000-8000-00000000000b',
  'the saved preview carries the frozen source snapshot from the run');

SELECT is(
  (public.transition_processing_run(
     (SELECT id FROM hive.processing_runs LIMIT 1), 'SAVING', 'SUCCEEDED',
     jsonb_build_object('prompt_digest',
       'sha256:' || encode(sha256(convert_to('Synthetic prompt', 'UTF8')), 'hex')))
     -> 'processingRun' ->> 'status'),
  'SUCCEEDED',
  'success is recorded once the preview is saved with the matching digest');

SELECT throws_ok(
  $$ UPDATE hive.study_prompt_previews SET prompt_version = '2' $$,
  'P0001',
  'study_prompt_preview_immutable',
  'saved previews are immutable');

-- ---------------------------------------------------------------------------
-- Staleness and a source change mid-run
-- ---------------------------------------------------------------------------
RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001') -> 'staleness' ->> 'stale')::boolean,
  false,
  'a fresh preview is not stale');

CREATE TEMP TABLE t_run2 AS
SELECT public.start_study_preparation(
         'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000003',
         'eeeeeeee-0000-4000-8000-000000000003',
         public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001', false)
           -> 'eligibility' ->> 'coverageDigest') AS result;
GRANT SELECT ON t_run2 TO service_role;

RESET role;
UPDATE hive.source_documents SET read_status = 'FAILED'
 WHERE id = 'cccccccc-0000-4000-8000-00000000000a';

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (SELECT (r ->> 'sourceChanged') || ':' || (r -> 'processingRun' ->> 'status') || ':'
          || (r -> 'processingRun' ->> 'errorCode') || ':' || (r -> 'processingRun' ->> 'retryable')
     FROM (SELECT public.transition_processing_run(
                    ((SELECT result FROM t_run2) -> 'processingRun' ->> 'id')::uuid,
                    'QUEUED', 'UNDERSTANDING_REQUEST', '{}'::jsonb) AS r) x),
  'true:FAILED:SOURCE_CHANGED:true',
  'a source change mid-run fails the run as retryable SOURCE_CHANGED');

RESET role;
INSERT INTO hive.intent_requests (hive_id, owner_user_id, intent_text, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
        'Also list any deadlines.', '99999999-0000-4000-8000-0000000000f2');

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT string_agg(r ->> 'kind' || ':' || coalesce(r ->> 'sourceDocumentId', '-'), ',' ORDER BY r ->> 'kind')
     FROM json_array_elements(
       public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001') -> 'staleness' -> 'reasons') r),
  'DOCUMENT_READ_CHANGED:cccccccc-0000-4000-8000-00000000000a,INTENT_ADDED:-',
  'the earlier preview reports why it is stale');

SELECT is(
  (public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001') -> 'preview' ->> 'processingRunId'),
  (SELECT result -> 'processingRun' ->> 'id' FROM t_run),
  'the last successful preview stays readable after a failed run');

-- A lapsed lease becomes a retryable interruption.
CREATE TEMP TABLE t_run3 AS
SELECT public.start_study_preparation(
         'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000004',
         'eeeeeeee-0000-4000-8000-000000000004',
         public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001', false)
           -> 'eligibility' ->> 'coverageDigest') AS result;

RESET role;
UPDATE hive.processing_runs SET lease_expires_at = now() - interval '1 second'
 WHERE id = ((SELECT result FROM t_run3) -> 'processingRun' ->> 'id')::uuid;

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT r ->> 'status' || ':' || (r ->> 'errorCode') || ':' || (r ->> 'retryable')
     FROM (SELECT public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000001', false)
                    -> 'processingRun' AS r) x),
  'FAILED:PREPARATION_INTERRUPTED:true',
  'a run whose lease lapsed is reported as a retryable interruption');

-- ---------------------------------------------------------------------------
-- No stored intent: clarification state, no model stages; active reads block start
-- ---------------------------------------------------------------------------
RESET role;
INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status
)
VALUES ('cccccccc-0000-4000-8000-00000000000e', 'bbbbbbbb-0000-4000-8000-000000000003',
        'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-e.pdf', 'application/pdf', 2048, repeat('e', 64),
        'hive-source-documents', 'synthetic/e.pdf', 'UPLOADED', 'ACTIVE');
INSERT INTO hive.document_reads (
  hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
  lease_expires_at
)
VALUES ('bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001',
        'cccccccc-0000-4000-8000-00000000000e', gen_random_uuid(), 1, 'QUEUED', gen_random_uuid(),
        now() + interval '5 minutes');

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT public.start_study_preparation(
       'bbbbbbbb-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000005',
       'eeeeeeee-0000-4000-8000-000000000005') $$,
  'P0001',
  'document_read_active',
  'analysis cannot start while a document read is active');

RESET role;
DELETE FROM hive.document_reads WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000e';
DELETE FROM hive.source_documents WHERE id = 'cccccccc-0000-4000-8000-00000000000e';

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (public.get_study_preparation('bbbbbbbb-0000-4000-8000-000000000003', false)
     -> 'eligibility' ->> 'coverageComplete')::boolean,
  true,
  'a fully read Hive reports complete coverage');

SELECT is(
  (SELECT r ->> 'status' || ':' || (r ->> 'errorCode')
     FROM (SELECT public.start_study_preparation(
                    'bbbbbbbb-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000006',
                    'eeeeeeee-0000-4000-8000-000000000006') -> 'processingRun' AS r) x),
  'NEEDS_CLARIFICATION:INTENT_MISSING',
  'without a stored intent the run asks for clarification instead of inventing one');

SELECT is(
  (SELECT jsonb_array_length(stage_metrics) || ':' || (stage_outputs = '{}'::jsonb)
     FROM hive.processing_runs WHERE hive_id = 'bbbbbbbb-0000-4000-8000-000000000003'),
  '0:true',
  'the clarification run made no model stage');

SELECT * FROM finish();
ROLLBACK;
