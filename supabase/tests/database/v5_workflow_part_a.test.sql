-- V5-005b part A — stage_attempt reset per document, accept canonical-study-1, acknowledge -> EXTRACTING.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES ('aaaaaaaa-0000-4000-8000-000000000a01', 'v5a-owner@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000a01', 'aaaaaaaa-0000-4000-8000-000000000a01', 'V5 Part A Hive',
        'bbbbbbbb-0000-4000-8000-000000000af1');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, created_at
)
VALUES (
  'cccccccc-0000-4000-8000-000000000a01', 'bbbbbbbb-0000-4000-8000-000000000a01',
  'aaaaaaaa-0000-4000-8000-000000000a01', 'synthetic-v5a.pdf', 'application/pdf', 2048, repeat('w', 64),
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
SELECT page_count, pages, hive.compute_page_set_digest(repeat('w', 64), page_count, pages) AS digest FROM built;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.put_document_pages(
         'bbbbbbbb-0000-4000-8000-000000000a01', 'cccccccc-0000-4000-8000-000000000a01',
         repeat('w', 64), 'reader-document-read@1:synthetic-v5a', p.digest, 'SUCCEEDED',
         p.page_count, p.page_count, p.pages)
  FROM t_pages p;

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
      'sha256', repeat('w', 64),
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
RETURNING id;

-- Successful EXTRACTING -> EXTRACTING handoff resets stage_attempt to 1.
SELECT public.transition_processing_run(
  (SELECT id FROM t_run), 'EXTRACTING', 'EXTRACTING',
  jsonb_build_object('stage_metric', jsonb_build_object(
    'stage', 'EXTRACTING', 'outcome', 'SUCCEEDED', 'attempt', 2,
    'promptId', 'hive-extract/1', 'promptDigest', 'sha256:' || repeat('a', 64)
  )));

SELECT is(
  (public.transition_processing_run((SELECT id FROM t_run), 'EXTRACTING', 'EXTRACTING', '{}'::jsonb)
     -> 'processingRun' ->> 'stageAttempt')::integer,
  1,
  'successful EXTRACTING handoff resets stage_attempt to 1');

-- V5 path: EXTRACTING -> CANONICALIZING -> ACCEPTING_STUDY before accept_study_revision.
SELECT public.transition_processing_run(
  (SELECT id FROM t_run), 'EXTRACTING', 'CANONICALIZING',
  jsonb_build_object('stage_outputs', jsonb_build_object(
    'canonicalStudy', jsonb_build_object(
      'schema', 'hive.canonical-study/1',
      'documents', jsonb_build_array(jsonb_build_object(
        'sourceDocumentId', 'cccccccc-0000-4000-8000-000000000a01',
        'role', 'REFERENCE', 'typeInPlainWords', 'statement', 'date', null, 'version', null, 'chainPosition', null
      )),
      'spineSource', null,
      'spine', '[]'::jsonb,
      'outsideSpine', '[]'::jsonb,
      'conflicts', '[]'::jsonb,
      'timeline', '[]'::jsonb,
      'gaps', '[]'::jsonb,
      'domainLabel', 'unknown'
    ))));

SELECT public.transition_processing_run((SELECT id FROM t_run), 'CANONICALIZING', 'ACCEPTING_STUDY', '{}'::jsonb);

SELECT is(
  (public.accept_study_revision((SELECT id FROM t_run), jsonb_build_object(
     'format', 'canonical-study-1',
     'investigation', jsonb_build_object(
       'schema', 'hive.canonical-study/1',
       'documents', jsonb_build_array(jsonb_build_object(
         'sourceDocumentId', 'cccccccc-0000-4000-8000-000000000a01',
         'role', 'REFERENCE', 'typeInPlainWords', 'statement', 'date', null, 'version', null, 'chainPosition', null
       )),
       'spineSource', null,
       'spine', '[]'::jsonb,
       'outsideSpine', '[]'::jsonb,
       'conflicts', '[]'::jsonb,
       'timeline', '[]'::jsonb,
       'gaps', '[]'::jsonb,
       'domainLabel', 'unknown'
     ),
     'verification', jsonb_build_object(
       'schema', 'hive.study-verification/1',
       'counts', jsonb_build_object('documentFindings', 0, 'claims', 0),
       'findings', '[]'::jsonb,
       'documentCoverage', '[]'::jsonb
     ),
     'audience_configuration', jsonb_build_object(
       'schema', 'hive.audience-configuration/1',
       'source', 'FALLBACK',
       'customer', jsonb_build_object(
         'role', null, 'status', 'UNKNOWN', 'confidence', 'LOW',
         'basis', jsonb_build_object('kind', 'NONE', 'statedAs', null, 'intentRequestId', null, 'contextRefs', '[]'::jsonb),
         'tone', 'Clear and calm', 'detailLevel', 'STANDARD'
       ),
       'pro', jsonb_build_object(
         'primaryRole', null, 'alternativeRoles', '[]'::jsonb, 'status', 'UNKNOWN', 'confidence', 'LOW',
         'basis', jsonb_build_object('kind', 'NONE', 'statedAs', null, 'intentRequestId', null, 'contextRefs', '[]'::jsonb),
         'tone', 'Precise', 'detailLevel', 'DETAILED'
       ),
       'studyGuidance', '[]'::jsonb,
       'writerGuidance', jsonb_build_object('customer', '[]'::jsonb, 'pro', '[]'::jsonb)
     ),
     'investigation_digest', 'sha256:' || repeat('c', 64),
     'prompt_digest', 'sha256:' || repeat('d', 64)
   )) ->> 'created')::boolean,
  true,
  'accept_study_revision accepts canonical-study-1 without preview');

SELECT is(
  (SELECT format FROM hive.study_revisions WHERE processing_run_id = (SELECT id FROM t_run)),
  'canonical-study-1',
  'revision format is canonical-study-1');

SELECT * FROM finish();
ROLLBACK;
