-- V5-005 (partial) — doc_extractions cache, V5 run stages, study_revisions.format (synthetic data only).
-- Run locally with `supabase test db`; never against a live project.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'v5-owner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-0000000000e2', 'v5-other@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'V5 Pipeline Hive',
        'bbbbbbbb-0000-4000-8000-0000000000f1');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, created_at
)
VALUES (
  'cccccccc-0000-4000-8000-0000000000e1', 'bbbbbbbb-0000-4000-8000-0000000000e1',
  'aaaaaaaa-0000-4000-8000-0000000000e1', 'synthetic-v5.pdf', 'application/pdf', 2048, repeat('f', 64),
  'hive-source-documents', 'synthetic/v5.pdf', 'UPLOADED', 'ACTIVE', now() - interval '2 minutes'
);

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES (
  '99999999-0000-4000-8000-0000000000e1', 'bbbbbbbb-0000-4000-8000-0000000000e1',
  'aaaaaaaa-0000-4000-8000-0000000000e1',
  'Summarize the document.', '99999999-0000-4000-8000-0000000000f1'
);

CREATE TEMP TABLE t_pages AS
WITH raw (n, t) AS (
  VALUES (1, 'Synthetic V5 page one.')
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
         repeat('f', 64), 'reader-document-read@1:synthetic-v5', p.digest, 'SUCCEEDED',
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
       'reader-document-read@1:synthetic-v5', p.digest, p.page_count, p.page_count, now()
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

-- ---------------------------------------------------------------------------
-- V5 processing_run transitions
-- ---------------------------------------------------------------------------
RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT public.claim_processing_run((SELECT id FROM t_run));

SELECT is(
  (public.transition_processing_run((SELECT id FROM t_run), 'QUEUED', 'READING_DOCUMENTS', '{}'::jsonb)
     ->> 'applied')::boolean,
  true,
  'QUEUED may advance to READING_DOCUMENTS');

SELECT throws_ok(
  $$ SELECT public.transition_processing_run((SELECT id FROM t_run), 'READING_DOCUMENTS', 'CANONICALIZING', '{}'::jsonb) $$,
  'P0001',
  'processing_run_transition_invalid',
  'READING_DOCUMENTS cannot skip EXTRACTING');

SELECT is(
  (public.transition_processing_run((SELECT id FROM t_run), 'READING_DOCUMENTS', 'EXTRACTING', '{}'::jsonb)
     ->> 'applied')::boolean,
  true,
  'READING_DOCUMENTS may advance to EXTRACTING');

SELECT is(
  (public.transition_processing_run((SELECT id FROM t_run), 'EXTRACTING', 'EXTRACTING', '{}'::jsonb)
     ->> 'applied')::boolean,
  true,
  'EXTRACTING may stay EXTRACTING for the next document');

SELECT is(
  (public.transition_processing_run((SELECT id FROM t_run), 'EXTRACTING', 'CANONICALIZING', '{}'::jsonb)
     ->> 'applied')::boolean,
  true,
  'EXTRACTING may advance to CANONICALIZING');

SELECT throws_ok(
  $$ SELECT public.transition_processing_run((SELECT id FROM t_run), 'CANONICALIZING', 'EXTRACTING', '{}'::jsonb) $$,
  'P0001',
  'processing_run_transition_invalid',
  'CANONICALIZING cannot return to EXTRACTING');

SELECT is(
  (public.transition_processing_run((SELECT id FROM t_run), 'CANONICALIZING', 'ACCEPTING_STUDY', '{}'::jsonb)
     ->> 'applied')::boolean,
  true,
  'CANONICALIZING may advance to ACCEPTING_STUDY');

SELECT throws_ok(
  $$ SELECT public.transition_processing_run((SELECT id FROM t_run), 'ACCEPTING_STUDY', 'EXTRACTING', '{}'::jsonb) $$,
  'P0001',
  'processing_run_transition_invalid',
  'ACCEPTING_STUDY cannot jump back to EXTRACTING');

-- ---------------------------------------------------------------------------
-- put_doc_extraction cache and get_doc_extractions_for_run (frozen snapshot only)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_extraction AS
SELECT jsonb_build_object(
         'schema', 'hive.doc-extraction/1',
         'documentId', 'cccccccc-0000-4000-8000-0000000000e1',
         'fileName', 'synthetic-v5.pdf',
         'pageRange', null,
         'document', jsonb_build_object(
           'titleAsPrinted', 'Synthetic', 'documentType', 'statement', 'summary', 'Synthetic summary.',
           'domain', jsonb_build_object('label', 'unknown', 'confidence', null),
           'issuer', null, 'aboutPeople', '[]'::jsonb, 'keyDates', '[]'::jsonb),
         'facts', '[]'::jsonb,
         'emptyFields', '[]'::jsonb,
         'referencedDocuments', '[]'::jsonb,
         'glossary', '[]'::jsonb,
         'instructionsIgnored', '[]'::jsonb,
         'coverage', jsonb_build_object(
           'pageCount', 1, 'pagesRead', jsonb_build_array(1),
           'pagesBlankOrUnreadable', '[]'::jsonb, 'truncated', false, 'lastPageCompleted', 1)
       ) AS body;
GRANT SELECT ON t_extraction TO service_role;

CREATE TEMP TABLE t_put1 AS
SELECT public.put_doc_extraction(
         'bbbbbbbb-0000-4000-8000-0000000000e1',
         'cccccccc-0000-4000-8000-0000000000e1',
         p.digest,
         'hive-extract/1',
         'sha256:' || repeat('a', 64),
         'harvester',
         e.body,
         '{"factsKept":0}'::jsonb) AS result
  FROM t_pages p, t_extraction e;
GRANT SELECT ON t_put1 TO service_role, authenticated;

SELECT is(
  (SELECT (result ->> 'inserted') || ':' || (result ->> 'replayed') FROM t_put1),
  'true:false',
  'first put_doc_extraction inserts a row');

CREATE TEMP TABLE t_put2 AS
SELECT public.put_doc_extraction(
         'bbbbbbbb-0000-4000-8000-0000000000e1',
         'cccccccc-0000-4000-8000-0000000000e1',
         p.digest,
         'hive-extract/1',
         'sha256:' || repeat('a', 64),
         'harvester',
         e.body,
         '{"factsKept":0}'::jsonb) AS result
  FROM t_pages p, t_extraction e;
GRANT SELECT ON t_put2 TO service_role;

SELECT is(
  (SELECT (result ->> 'inserted') || ':' || (result ->> 'replayed') FROM t_put2),
  'false:true',
  'identical cache key replays without a second row');

SELECT is(
  (SELECT count(*)::int FROM hive.doc_extractions
    WHERE source_document_id = 'cccccccc-0000-4000-8000-0000000000e1'),
  1,
  'cache uniqueness keeps one row per document content, prompt and model');

SELECT throws_ok(
  $$ SELECT public.put_doc_extraction(
       'bbbbbbbb-0000-4000-8000-0000000000e1',
       'cccccccc-0000-4000-8000-0000000000e1',
       (SELECT digest FROM t_pages),
       'hive-extract/1',
       'sha256:' || repeat('a', 64),
       'harvester',
       (SELECT body FROM t_extraction) || jsonb_build_object('fileName', 'changed.pdf'),
       '{"factsKept":0}'::jsonb) $$,
  'P0001',
  'doc_extraction_hash_conflict',
  'conflicting payload at the same cache key is rejected');

SELECT is(
  json_array_length((public.get_doc_extractions_for_run((SELECT id FROM t_run)) -> 'extractions')),
  1,
  'get_doc_extractions_for_run returns rows bound to the frozen snapshot page set digest');

-- ---------------------------------------------------------------------------
-- RLS: owner can read; other authenticated users cannot
-- ---------------------------------------------------------------------------
RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM hive.doc_extractions
    WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000e1'),
  1,
  'hive owner can select doc_extractions');

RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e2","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM hive.doc_extractions
    WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000e1'),
  0,
  'non-owner cannot see another hive doc_extractions');

SELECT has_column('hive', 'study_revisions', 'format', 'study_revisions exposes format for V5 canonical payloads');
SELECT col_has_default('hive', 'study_revisions', 'format', 'study_revisions.format defaults for legacy rows');

SELECT * FROM finish();
ROLLBACK;
