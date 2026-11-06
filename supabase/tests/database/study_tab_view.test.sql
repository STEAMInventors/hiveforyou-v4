-- Study tab RPC: owner read, auth isolation, empty hive, facts + referenced documents (synthetic).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'stv-owner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-0000000000c2', 'stv-other@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES
  ('bbbbbbbb-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000c1', 'Study tab hive', 'bbbbbbbb-0000-4000-8000-0000000000cf1'),
  ('bbbbbbbb-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-0000000000c1', 'No revision hive', 'bbbbbbbb-0000-4000-8000-0000000000cf2');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, created_at
)
VALUES (
  'cccccccc-0000-4000-8000-0000000000c1', 'bbbbbbbb-0000-4000-8000-0000000000c1',
  'aaaaaaaa-0000-4000-8000-0000000000c1', 'synthetic-stv.pdf', 'application/pdf', 2048, repeat('c', 64),
  'hive-source-documents', 'synthetic/stv.pdf', 'UPLOADED', 'ACTIVE', now()
);

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES (
  '99999999-0000-4000-8000-0000000000c1', 'bbbbbbbb-0000-4000-8000-0000000000c1',
  'aaaaaaaa-0000-4000-8000-0000000000c1',
  'Check whether the schedule mentions the missing exhibit.', '99999999-0000-4000-8000-0000000000cf1'
);

-- Pages + digest (same pattern as v5_workflow_part_a.test.sql)
CREATE TEMP TABLE t_pages AS
WITH raw (n, t) AS (VALUES (1, 'Synthetic study tab page one. Referenced missing lease agreement 2024.')),
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
SELECT page_count, pages, hive.compute_page_set_digest(repeat('c', 64), page_count, pages) AS digest FROM built;
GRANT SELECT ON t_pages TO service_role;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.put_document_pages(
         'bbbbbbbb-0000-4000-8000-0000000000c1', 'cccccccc-0000-4000-8000-0000000000c1',
         repeat('c', 64), 'reader-document-read@1:synthetic-stv', p.digest, 'SUCCEEDED',
         p.page_count, p.page_count, p.pages)
  FROM t_pages p;

INSERT INTO hive.document_reads (
  hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
  read_fingerprint, page_set_digest, total_physical_pages, verified_page_count, finished_at
)
SELECT 'bbbbbbbb-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000c1',
       'cccccccc-0000-4000-8000-0000000000c1', 'dddddddd-0000-4000-8000-0000000000d0', 1, 'SUCCEEDED',
       'eeeeeeee-0000-4000-8000-0000000000e0',
       'reader-document-read@1:synthetic-stv', p.digest, p.page_count, p.page_count, now()
  FROM t_pages p;
UPDATE hive.source_documents SET read_status = 'SUCCEEDED' WHERE id = 'cccccccc-0000-4000-8000-0000000000c1';

-- Processing run with frozen snapshot
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
    'bbbbbbbb-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000c1', 'STUDY_PREPARATION',
    'dddddddd-0000-4000-8000-0000000000c1', 1, 'EXTRACTING', 'eeeeeeee-0000-4000-8000-0000000000c1',
    ARRAY['cccccccc-0000-4000-8000-0000000000c1'::uuid],
    ARRAY['99999999-0000-4000-8000-0000000000c1'::uuid],
    jsonb_build_object(
      'documents', jsonb_build_array(jsonb_build_object(
        'sourceDocumentId', 'cccccccc-0000-4000-8000-0000000000c1',
        'fileName', 'synthetic-stv.pdf',
        'mimeType', 'application/pdf',
        'sha256', repeat('c', 64),
        'readId', 'dddddddd-0000-4000-8000-0000000000d0',
        'readStatus', 'SUCCEEDED',
        'readFingerprint', 'reader-document-read@1:synthetic-stv',
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
    now(), 1, now()
  FROM t_pages p
  RETURNING id
)
SELECT id FROM ins;

SELECT public.transition_processing_run((SELECT id FROM t_run), 'EXTRACTING', 'CANONICALIZING',
  jsonb_build_object('stage_outputs', jsonb_build_object(
    'canonicalStudy', jsonb_build_object(
      'schema', 'hive.canonical-study/1',
      'documents', jsonb_build_array(jsonb_build_object(
        'sourceDocumentId', 'cccccccc-0000-4000-8000-0000000000c1',
        'role', 'REFERENCE', 'typeInPlainWords', 'statement', 'date', null, 'version', null, 'chainPosition', null
      )),
      'spineSource', null,
      'spine', '[]'::jsonb,
      'outsideSpine', '[]'::jsonb,
      'conflicts', '[]'::jsonb,
      'timeline', '[]'::jsonb,
      'gaps', jsonb_build_array(jsonb_build_object(
        'id', 'X1',
        'statement', 'The 2024 lease agreement that is mentioned on page one is not in the file.',
        'relatedSpineIds', '[]'::jsonb,
        'factIds', jsonb_build_array('F-cccccccc-001')
      )),
      'domainLabel', 'unknown'
    ))));

SELECT public.transition_processing_run((SELECT id FROM t_run), 'CANONICALIZING', 'ACCEPTING_STUDY', '{}'::jsonb);

SELECT is(
  (public.accept_study_revision((SELECT id FROM t_run), jsonb_build_object(
     'format', 'canonical-study-1',
     'investigation', jsonb_build_object(
       'schema', 'hive.canonical-study/1',
       'documents', jsonb_build_array(jsonb_build_object(
         'sourceDocumentId', 'cccccccc-0000-4000-8000-0000000000c1',
         'role', 'REFERENCE', 'typeInPlainWords', 'statement', 'date', null, 'version', null, 'chainPosition', null
       )),
       'spineSource', null,
       'spine', '[]'::jsonb,
       'outsideSpine', '[]'::jsonb,
       'conflicts', '[]'::jsonb,
       'timeline', '[]'::jsonb,
       'gaps', jsonb_build_array(jsonb_build_object(
         'id', 'X1',
         'statement', 'The 2024 lease agreement that is mentioned on page one is not in the file.',
         'relatedSpineIds', '[]'::jsonb,
         'factIds', jsonb_build_array('F-cccccccc-001')
       )),
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
     'investigation_digest', 'sha256:' || repeat('e', 64),
     'prompt_digest', 'sha256:' || repeat('f', 64)
   )) ->> 'created')::boolean,
  true,
  'accept canonical-study-1 for study tab fixture');

-- Doc extraction with one fact (F-cccccccc-001) and a referenced missing document
CREATE TEMP TABLE t_extraction AS
SELECT jsonb_build_object(
         'schema', 'hive.doc-extraction/1',
         'documentId', 'cccccccc-0000-4000-8000-0000000000c1',
         'fileName', 'synthetic-stv.pdf',
         'pageRange', null,
         'document', jsonb_build_object(
           'titleAsPrinted', 'Synthetic', 'documentType', 'statement', 'summary', 'Synthetic summary.',
           'domain', jsonb_build_object('label', 'unknown', 'confidence', null),
           'issuer', null, 'aboutPeople', '[]'::jsonb, 'keyDates', '[]'::jsonb),
         'facts', jsonb_build_array(jsonb_build_object(
           'id', 'F-cccccccc-001',
           'modelId', 'F1',
           'category', 'note',
           'subject', 'Referenced document',
           'attribute', 'mentioned',
           'value', null,
           'valueAsWritten', '2024 lease agreement',
           'unit', null,
           'per', null,
           'timeframe', jsonb_build_object('from', null, 'to', null, 'asWritten', null),
           'modality', 'stated',
           'attributedTo', null,
           'aboutPersonRef', null,
           'tableContext', null,
           'evidence', jsonb_build_array(jsonb_build_object('page', 1, 'printedPageLabel', null, 'quote', 'Referenced missing lease agreement 2024.')),
           'confidence', 'high'
         )),
         'emptyFields', '[]'::jsonb,
         'referencedDocuments', jsonb_build_array(jsonb_build_object(
           'id', 'R1',
           'modelId', null,
           'description', 'lease agreement 2024',
           'date', null,
           'page', 1,
           'quote', 'Referenced missing lease agreement 2024.'
         )),
         'glossary', '[]'::jsonb,
         'instructionsIgnored', '[]'::jsonb,
         'coverage', jsonb_build_object(
           'pageCount', 1, 'pagesRead', jsonb_build_array(1),
           'pagesBlankOrUnreadable', '[]'::jsonb, 'truncated', false, 'lastPageCompleted', 1)
       ) AS body;
GRANT SELECT ON t_extraction TO service_role;

SELECT public.put_doc_extraction(
         'bbbbbbbb-0000-4000-8000-0000000000c1',
         'cccccccc-0000-4000-8000-0000000000c1',
         (SELECT digest FROM t_pages),
         'hive-extract/1',
         'sha256:' || repeat('a', 64),
         'harvester',
         (SELECT body FROM t_extraction),
         '{"factsKept":1}'::jsonb);

RESET role;

-- ---------------------------------------------------------------------------
-- Invoker helpers: authenticated must EXECUTE every function invoked along
-- public.get_study_tab_view (otherwise superuser-only pgTAP passes while production fails for the owner).
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('authenticated', 'public.get_study_tab_view(uuid)', 'EXECUTE'),
  'authenticated may EXECUTE public.get_study_tab_view'
);
SELECT ok(
  has_function_privilege('authenticated', 'hive.build_study_tab_view(uuid, uuid)', 'EXECUTE'),
  'authenticated may EXECUTE hive.build_study_tab_view'
);
SELECT ok(
  has_function_privilege('authenticated', 'hive.canonical_study_cited_fact_ids(jsonb)', 'EXECUTE'),
  'authenticated may EXECUTE hive.canonical_study_cited_fact_ids'
);

-- ---------------------------------------------------------------------------
-- Owner can read facts and referenced documents (as authenticated, not bootstrap superuser)
-- ---------------------------------------------------------------------------
RESET role;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c1","role":"authenticated"}';

SELECT is(
  (public.get_study_tab_view('bbbbbbbb-0000-4000-8000-0000000000c1') -> 'intent')::text,
  '"Check whether the schedule mentions the missing exhibit."',
  'intent is aggregated from intent_requests');

SELECT is(
  (public.get_study_tab_view('bbbbbbbb-0000-4000-8000-0000000000c1') -> 'facts' -> 0 ->> 'id')::text,
  'F-cccccccc-001',
  'fact id is returned for cited gap');

SELECT is(
  (public.get_study_tab_view('bbbbbbbb-0000-4000-8000-0000000000c1') -> 'referencedDocuments' -> 0 ->> 'description')::text,
  'lease agreement 2024',
  'referenced document description for missing exhibit');

-- Hive with no current revision returns empty payload (no error)
SELECT is(
  (public.get_study_tab_view('bbbbbbbb-0000-4000-8000-0000000000c2') -> 'revision') IS NULL
  AND json_array_length((public.get_study_tab_view('bbbbbbbb-0000-4000-8000-0000000000c2') -> 'facts')::json) = 0,
  true,
  'hive without accepted revision returns empty revision and facts');

-- ---------------------------------------------------------------------------
-- Other user and anon
-- ---------------------------------------------------------------------------
RESET role;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT public.get_study_tab_view('bbbbbbbb-0000-4000-8000-0000000000c1') $$,
  'P0002',
  'hive_not_found',
  'non-owner cannot read study tab payload');

RESET role;
SET LOCAL role anon;
SELECT throws_ok(
  $$ SELECT public.get_study_tab_view('bbbbbbbb-0000-4000-8000-0000000000c1') $$,
  '42501',
  'auth_required',
  'anon is denied');
RESET role;

SELECT * FROM finish();
ROLLBACK;
