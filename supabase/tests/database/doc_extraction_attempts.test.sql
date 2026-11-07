-- doc_extraction_attempts: service-role RPCs and owner RLS (synthetic data only).
-- Run locally with `supabase test db`; never against a live project.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'attempts-owner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-0000000000e2', 'attempts-other@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Attempts Hive',
        'bbbbbbbb-0000-4000-8000-0000000000f1');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, created_at
)
VALUES (
  'cccccccc-0000-4000-8000-0000000000e1', 'bbbbbbbb-0000-4000-8000-0000000000e1',
  'aaaaaaaa-0000-4000-8000-0000000000e1', 'synthetic-attempts.pdf', 'application/pdf', 2048, repeat('f', 64),
  'hive-source-documents', 'synthetic/attempts.pdf', 'UPLOADED', 'ACTIVE', now() - interval '2 minutes'
);

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES (
  '99999999-0000-4000-8000-0000000000e1', 'bbbbbbbb-0000-4000-8000-0000000000e1',
  'aaaaaaaa-0000-4000-8000-0000000000e1',
  'Summarize the document.', '99999999-0000-4000-8000-0000000000f1'
);

CREATE TEMP TABLE t_pages AS
WITH raw (n, t) AS (
  VALUES (1, 'Synthetic attempts page one.')
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
SELECT page_count, pages, hive.compute_page_set_digest(repeat('f', 64), page_count, pages) AS digest FROM built;
GRANT SELECT ON t_pages TO service_role, authenticated;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.put_document_pages(
         'bbbbbbbb-0000-4000-8000-0000000000e1', 'cccccccc-0000-4000-8000-0000000000e1',
         repeat('f', 64), 'reader-document-read@1:synthetic-attempts', p.digest, 'SUCCEEDED',
         p.page_count, p.page_count, p.pages)
  FROM t_pages p;
RESET role;

INSERT INTO hive.document_reads (
  hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
  read_fingerprint, page_set_digest, total_physical_pages, verified_page_count, finished_at
)
SELECT 'bbbbbbbb-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-0000000000e1',
       'cccccccc-0000-4000-8000-0000000000e1', 'dddddddd-0000-4000-8000-0000000000d0', 1, 'SUCCEEDED',
       'eeeeeeee-0000-4000-8000-0000000000e0',
       'reader-document-read@1:synthetic-attempts', p.digest, p.page_count, p.page_count, now()
  FROM t_pages p;
UPDATE hive.source_documents SET read_status = 'SUCCEEDED' WHERE id = 'cccccccc-0000-4000-8000-0000000000e1';

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1","role":"authenticated"}';
CREATE TEMP TABLE t_start AS
SELECT public.start_study_preparation(
         'bbbbbbbb-0000-4000-8000-0000000000e1',
         'dddddddd-0000-4000-8000-0000000000d1',
         'eeeeeeee-0000-4000-8000-0000000000e1') AS result;
GRANT SELECT ON t_start TO service_role, authenticated;

CREATE TEMP TABLE t_run AS
SELECT ((SELECT result FROM t_start) -> 'processingRun' ->> 'id')::uuid AS id;
GRANT SELECT ON t_run TO service_role, authenticated;

RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT public.claim_processing_run((SELECT id FROM t_run));

SELECT is(
  (public.transition_processing_run((SELECT id FROM t_run), 'QUEUED', 'READING_DOCUMENTS', '{}'::jsonb)
     ->> 'applied')::boolean,
  true,
  'QUEUED may advance to READING_DOCUMENTS');

SELECT is(
  (public.transition_processing_run((SELECT id FROM t_run), 'READING_DOCUMENTS', 'EXTRACTING', '{}'::jsonb)
     ->> 'applied')::boolean,
  true,
  'READING_DOCUMENTS may advance to EXTRACTING and freeze source snapshot');

CREATE TEMP TABLE t_begin AS
SELECT public.begin_doc_extraction_attempt(
         (SELECT id FROM t_run),
         'bbbbbbbb-0000-4000-8000-0000000000e1',
         'cccccccc-0000-4000-8000-0000000000e1',
         (SELECT digest FROM t_pages),
         '1',
         'hive-extract/1',
         'sha256:' || repeat('a', 64),
         now()) AS result;
GRANT SELECT ON t_begin TO service_role;

SELECT ok(
  ((SELECT result FROM t_begin) ->> 'id') IS NOT NULL,
  'begin_doc_extraction_attempt returns an attempt id');

SELECT is(
  (SELECT attempt_status FROM hive.doc_extraction_attempts
    WHERE id = ((SELECT result FROM t_begin) ->> 'id')::uuid),
  'IN_FLIGHT',
  'begin inserts IN_FLIGHT row');

SELECT lives_ok(
  $$ SELECT public.update_doc_extraction_attempt_outcome(
       ((SELECT result FROM t_begin) ->> 'id')::uuid,
       (SELECT id FROM t_run),
       'succeeded',
       null,
       null,
       200,
       1200,
       false) $$,
  'update_doc_extraction_attempt_outcome succeeds for in-flight attempt');

SELECT is(
  (SELECT attempt_status FROM hive.doc_extraction_attempts
    WHERE id = ((SELECT result FROM t_begin) ->> 'id')::uuid),
  'SUCCEEDED',
  'outcome update marks attempt SUCCEEDED');

SELECT throws_ok(
  $$ SELECT public.begin_doc_extraction_attempt(
       (SELECT id FROM t_run),
       'bbbbbbbb-0000-0000-0000-000000000099',
       'cccccccc-0000-4000-8000-0000000000e1',
       (SELECT digest FROM t_pages),
       '1',
       'hive-extract/1',
       'sha256:' || repeat('a', 64),
       now()) $$,
  '42501',
  'extract_attempt_hive_mismatch',
  'wrong hive id is refused');

SELECT throws_ok(
  $$ SELECT public.begin_doc_extraction_attempt(
       (SELECT id FROM t_run),
       'bbbbbbbb-0000-4000-8000-0000000000e1',
       'cccccccc-0000-4000-8000-0000000000e1',
       'sha256:' || repeat('9', 64),
       '1',
       'hive-extract/1',
       'sha256:' || repeat('a', 64),
       now()) $$,
  'P0001',
  'extract_attempt_content_digest_mismatch',
  'content digest not in frozen snapshot is refused');

SELECT lives_ok(
  $$ SELECT public.record_doc_extraction_attempt(
       (SELECT id FROM t_run),
       'bbbbbbbb-0000-4000-8000-0000000000e1',
       'cccccccc-0000-4000-8000-0000000000e1',
       'sha256:' || repeat('f', 64),
       '1',
       'hive-extract/1',
       'sha256:' || repeat('a', 64),
       'MODEL_TIMEOUT',
       'planner_timeout',
       504,
       99500,
       false,
       now() - interval '100 seconds') $$,
  'service_role may record a failed extract attempt');

SELECT lives_ok(
  $$ SELECT public.record_doc_extraction_attempt(
       (SELECT id FROM t_run),
       'bbbbbbbb-0000-4000-8000-0000000000e1',
       'cccccccc-0000-4000-8000-0000000000e1',
       'sha256:' || repeat('f', 64),
       '1',
       'hive-extract/1',
       'sha256:' || repeat('a', 64),
       'MODEL_TIMEOUT',
       'planner_timeout',
       504,
       100050,
       false,
       now() - interval '100 seconds') $$,
  'second failure increments attempt_number for same range');

SELECT is(
  (SELECT count(*)::int FROM hive.doc_extraction_attempts
    WHERE processing_run_id = (SELECT id FROM t_run)
      AND page_range = '1'),
  2,
  'two attempt rows persisted for same page range');

SELECT is(
  (SELECT failed_attempt_count::int FROM (
     SELECT elem->>'pageRange' AS page_range,
            (elem->>'failedAttemptCount')::int AS failed_attempt_count
       FROM json_array_elements(
         (public.get_doc_extraction_attempt_totals_for_run(
            (SELECT id FROM t_run)) -> 'totals')) elem
      WHERE elem->>'pageRange' = '1') t),
  2,
  'get_doc_extraction_attempt_totals_for_run aggregates failedAttemptCount');

SELECT is(
  (SELECT cutoff_count::int FROM (
     SELECT (elem->>'cutoffOrTimeoutCount')::int AS cutoff_count
       FROM json_array_elements(
         (public.get_doc_extraction_attempt_totals_for_run(
            (SELECT id FROM t_run)) -> 'totals')) elem
      WHERE elem->>'pageRange' = '1') t),
  2,
  'both rows count as cutoffOrTimeout (MODEL_TIMEOUT)');

RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM hive.doc_extraction_attempts
    WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000e1'),
  2,
  'hive owner can select doc_extraction_attempts');

SELECT throws_ok(
  $$ SELECT public.record_doc_extraction_attempt(
       (SELECT id FROM t_run),
       'bbbbbbbb-0000-4000-8000-0000000000e1',
       'cccccccc-0000-4000-8000-0000000000e1',
       'sha256:' || repeat('f', 64),
       '2',
       'hive-extract/1',
       'sha256:' || repeat('a', 64),
       'MODEL_TIMEOUT',
       'planner_timeout',
       504,
       1000,
       false,
       now()) $$,
  '42501',
  'access_denied',
  'authenticated may not record extract attempts');

SELECT * FROM finish();
ROLLBACK;
