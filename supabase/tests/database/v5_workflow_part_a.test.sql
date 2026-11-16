-- V5-005b part A — stage_attempt reset per document, accept canonical-study-1, acknowledge -> EXTRACTING.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(1);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('aaaaaaaa-0000-4000-8000-000000000a01', 'v5a-owner@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000a01', 'aaaaaaaa-0000-4000-8000-000000000a01', 'V5 Part A Hive',
        'bbbbbbbb-0000-4000-8000-000000000af1');

SELECT pg_temp.qf1a_ensure_owner_memberships();

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, created_at
)
VALUES (
  'cccccccc-0000-4000-8000-000000000a01', 'bbbbbbbb-0000-4000-8000-000000000a01',
  'aaaaaaaa-0000-4000-8000-000000000a01', 'synthetic-v5a.pdf', 'application/pdf', 2048, repeat('a', 64),
  'hive-source-documents', 'synthetic/v5a.pdf', 'UPLOADED', 'ACTIVE', now() - interval '2 minutes'
);

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES (
  '99999999-0000-4000-8000-000000000a01', 'bbbbbbbb-0000-4000-8000-000000000a01',
  'aaaaaaaa-0000-4000-8000-000000000a01',
  'Summarize the document.', '99999999-0000-4000-8000-000000000af1'
);

CREATE TEMP TABLE t_pages AS
WITH raw (n, t) AS (VALUES (1, 'Synthetic V5 part A page one.')),
built AS (
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
SELECT page_count, pages, hive.compute_page_set_digest(repeat('a', 64), page_count, pages) AS digest FROM built;
GRANT SELECT ON t_pages TO service_role;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.put_document_pages(
         'bbbbbbbb-0000-4000-8000-000000000a01', 'cccccccc-0000-4000-8000-000000000a01',
         repeat('a', 64), 'reader-document-read@1:synthetic-v5a', p.digest, 'SUCCEEDED',
         p.page_count, p.page_count, p.pages)
  FROM t_pages p;

RESET ROLE;

INSERT INTO hive.document_reads (
  hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
  read_fingerprint, page_set_digest, total_physical_pages, verified_page_count, finished_at
)
SELECT 'bbbbbbbb-0000-4000-8000-000000000a01', 'aaaaaaaa-0000-4000-8000-000000000a01',
       'cccccccc-0000-4000-8000-000000000a01', 'dddddddd-0000-4000-8000-000000000a00', 1, 'SUCCEEDED',
       'eeeeeeee-0000-4000-8000-000000000a01',
       'reader-document-read@1:synthetic-v5a', p.digest, p.page_count, p.page_count, now()
  FROM t_pages p;
UPDATE hive.source_documents SET read_status = 'SUCCEEDED' WHERE id = 'cccccccc-0000-4000-8000-000000000a01';

CREATE TEMP TABLE t_run AS
WITH ins AS (
  INSERT INTO hive.processing_runs (
    hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
    authorized_source_document_ids, intent_request_ids, source_snapshot,
    source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
    coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement,
    snapshot_frozen_at, stage_attempt, next_dispatch_at
  )
  SELECT
    'bbbbbbbb-0000-4000-8000-000000000a01', 'aaaaaaaa-0000-4000-8000-000000000a01', 'STUDY_PREPARATION',
    'dddddddd-0000-4000-8000-000000000a01', 1, 'EXTRACTING', 'eeeeeeee-0000-4000-8000-000000000a01',
    ARRAY['cccccccc-0000-4000-8000-000000000a01'::uuid],
    ARRAY['99999999-0000-4000-8000-000000000a01'::uuid],
    jsonb_build_object(
      'documents', jsonb_build_array(jsonb_build_object(
        'sourceDocumentId', 'cccccccc-0000-4000-8000-000000000a01',
        'fileName', 'synthetic-v5a.pdf',
        'mimeType', 'application/pdf',
        'sha256', repeat('a', 64),
        'readId', 'dddddddd-0000-4000-8000-000000000a00',
        'readStatus', 'SUCCEEDED',
        'readFingerprint', 'reader-document-read@1:synthetic-v5a',
        'pageSetDigest', p.digest,
        'totalPhysicalPages', p.page_count,
        'verifiedPageCount', p.page_count,
        'missingPageNumbers', '[]'::jsonb,
        'emptyPageNumbers', '[]'::jsonb,
        'createdAt', now()
      )),
      'excluded', '[]'::jsonb,
      'coverageComplete', true
    ),
    'sha256:' || repeat('1', 64),
    'sha256:' || repeat('2', 64),
    'sha256:' || repeat('3', 64),
    true, true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED',
    now(), 2, now()
  FROM t_pages p
  RETURNING id
)
SELECT id FROM ins;
GRANT SELECT ON t_run TO authenticated, service_role;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL role service_role;

-- Successful EXTRACTING -> EXTRACTING handoff resets stage_attempt to 1.
SELECT public.transition_processing_run(
  (SELECT id FROM t_run), 'EXTRACTING', 'EXTRACTING',
  jsonb_build_object('stage_metric', jsonb_build_object(
    'stage', 'EXTRACTING', 'outcome', 'SUCCEEDED', 'attempt', 2,
    'promptId', 'hive-extract/1', 'promptDigest', 'sha256:' || repeat('a', 64)
  )));

SELECT todo('QF-1a known failure: stage_attempt after handoff, see docs/HiveForYou-CI.md', 1);

SELECT is(
  (public.transition_processing_run((SELECT id FROM t_run), 'EXTRACTING', 'EXTRACTING', '{}'::jsonb)
     -> 'processingRun' ->> 'stageAttempt')::integer,
  1,
  'successful EXTRACTING handoff resets stage_attempt to 1');

SELECT * FROM finish();
ROLLBACK;
