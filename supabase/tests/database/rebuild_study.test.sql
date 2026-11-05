-- V4-004H — Rebuild Study (synthetic data only).
-- Run locally with `supabase test db`. Do not run against a live project.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'rebuild-owner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 'rebuild-other@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'Rebuild Hive',
        'bbbbbbbb-0000-4000-8000-0000000000f1');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, created_at
)
VALUES (
  'cccccccc-0000-4000-8000-0000000000c1', 'bbbbbbbb-0000-4000-8000-0000000000b1',
  'aaaaaaaa-0000-4000-8000-0000000000a1', 'synthetic-read.pdf', 'application/pdf', 2048, repeat('c', 64),
  'hive-source-documents', 'synthetic/read.pdf', 'UPLOADED', 'ACTIVE', now() - interval '2 minutes'
);

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
VALUES (
  '99999999-0000-4000-8000-0000000000c1', 'bbbbbbbb-0000-4000-8000-0000000000b1',
  'aaaaaaaa-0000-4000-8000-0000000000a1',
  'Explain what changed between the statements.', '99999999-0000-4000-8000-0000000000f1'
);

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
SELECT page_count, pages, hive.compute_page_set_digest(repeat('c', 64), page_count, pages) AS digest FROM built;
GRANT SELECT ON t_pages TO service_role, authenticated;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT public.put_document_pages(
         'bbbbbbbb-0000-4000-8000-0000000000b1', 'cccccccc-0000-4000-8000-0000000000c1',
         repeat('c', 64), 'reader-document-read@1:synthetic-c', p.digest, 'SUCCEEDED',
         p.page_count, p.page_count, p.pages)
  FROM t_pages p;
RESET role;

INSERT INTO hive.document_reads (
  hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
  read_fingerprint, page_set_digest, total_physical_pages, verified_page_count, finished_at
)
SELECT 'bbbbbbbb-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-0000000000a1',
       'cccccccc-0000-4000-8000-0000000000c1', 'dddddddd-0000-4000-8000-0000000000d0', 1, 'SUCCEEDED',
       'eeeeeeee-0000-4000-8000-0000000000e0',
       'reader-document-read@1:synthetic-c', p.digest, p.page_count, p.page_count, now()
  FROM t_pages p;
UPDATE hive.source_documents SET read_status = 'SUCCEEDED' WHERE id = 'cccccccc-0000-4000-8000-0000000000c1';

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}';

CREATE TEMP TABLE t_analyze AS
SELECT public.start_study_preparation(
         'bbbbbbbb-0000-4000-8000-0000000000b1',
         'dddddddd-0000-4000-8000-0000000000d1',
         'eeeeeeee-0000-4000-8000-0000000000e1') AS result;
GRANT SELECT ON t_analyze TO service_role, authenticated;

SELECT is(
  (SELECT (result ->> 'created') || ':' || (result -> 'processingRun' ->> 'status') || ':' || (result -> 'processingRun' ->> 'preparationMode')
     FROM t_analyze),
  'true:QUEUED:ANALYZE',
  'Analyze starts a frozen run when the only document is already read');

RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

CREATE TEMP TABLE t_analyze_id AS
SELECT ((SELECT result FROM t_analyze) -> 'processingRun' ->> 'id')::uuid AS id;
GRANT SELECT ON t_analyze_id TO service_role, authenticated;

SELECT public.claim_processing_run((SELECT id FROM t_analyze_id));
SELECT public.transition_processing_run((SELECT id FROM t_analyze_id), 'QUEUED', 'EXTRACTING', '{}'::jsonb);
SELECT public.put_doc_extraction(
         'bbbbbbbb-0000-4000-8000-0000000000b1', 'cccccccc-0000-4000-8000-0000000000c1',
         p.digest, 'hive-extract/1', 'sha256:' || repeat('a', 64), 'harvester',
         jsonb_build_object('schema', 'hive.doc-extraction/1', 'documentId', 'cccccccc-0000-4000-8000-0000000000c1'),
         '{}'::jsonb)
  FROM t_pages p;
SELECT public.transition_processing_run((SELECT id FROM t_analyze_id), 'EXTRACTING', 'CANONICALIZING',
  jsonb_build_object('stage_outputs', jsonb_build_object(
    'canonicalStudy', jsonb_build_object(
      'schema', 'hive.canonical-study/1',
      'documents', jsonb_build_array(jsonb_build_object(
        'sourceDocumentId', 'cccccccc-0000-4000-8000-0000000000c1',
        'role', 'ANCHOR', 'typeInPlainWords', 'statement', 'date', null, 'version', null, 'chainPosition', null
      )),
      'spineSource', 'ANCHOR',
      'spine', '[]'::jsonb,
      'outsideSpine', '[]'::jsonb,
      'conflicts', '[]'::jsonb,
      'timeline', '[]'::jsonb,
      'gaps', '[]'::jsonb,
      'domainLabel', 'unknown'
    ))));
SELECT public.transition_processing_run((SELECT id FROM t_analyze_id), 'CANONICALIZING', 'ACCEPTING_STUDY', '{}'::jsonb);
SELECT public.accept_study_revision((SELECT id FROM t_analyze_id), jsonb_build_object(
  'format', 'canonical-study-1',
  'investigation', jsonb_build_object(
    'schema', 'hive.canonical-study/1',
    'documents', jsonb_build_array(jsonb_build_object(
      'sourceDocumentId', 'cccccccc-0000-4000-8000-0000000000c1',
      'role', 'ANCHOR', 'typeInPlainWords', 'statement', 'date', null, 'version', null, 'chainPosition', null
    )),
    'spineSource', 'ANCHOR',
    'spine', '[]'::jsonb,
    'outsideSpine', '[]'::jsonb,
    'conflicts', '[]'::jsonb,
    'timeline', '[]'::jsonb,
    'gaps', '[]'::jsonb,
    'domainLabel', 'unknown'
  ),
  'verification', jsonb_build_object('schema', 'hive.study-verification/1', 'counts', jsonb_build_object('documentFindings', 0, 'claims', 0),
                                     'findings', '[]'::jsonb, 'documentCoverage', '[]'::jsonb),
  'audience_configuration', jsonb_build_object('schema', 'hive.audience-configuration/1'),
  'investigation_digest', 'sha256:' || repeat('6', 64),
  'prompt_digest', 'sha256:' || repeat('7', 64),
  'model_alias', 'heavy_lifter'));

CREATE TEMP TABLE t_reports AS
SELECT (SELECT id FROM hive.report_runs WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000b1' AND audience = 'CUSTOMER') AS customer,
       (SELECT id FROM hive.report_runs WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000b1' AND audience = 'PRO') AS pro;
GRANT SELECT ON t_reports TO service_role, authenticated;

SELECT public.claim_report_run((SELECT customer FROM t_reports));
SELECT public.transition_report_run((SELECT customer FROM t_reports), 'WRITING', 'VALIDATING', '{}'::jsonb);
SELECT public.transition_report_run((SELECT customer FROM t_reports), 'VALIDATING', 'SAVING', '{}'::jsonb);
SELECT public.save_report((SELECT customer FROM t_reports), jsonb_build_object(
  'writer_output', jsonb_build_object('schema', 'hive.writer-report/1', 'audience', 'CUSTOMER'),
  'scenario_analysis', jsonb_build_object('schema', 'hive.scenario-analysis/1', 'scenarios', '[]'::jsonb),
  'view', jsonb_build_object('schema', 'hive-application-view/1', 'audience', 'CUSTOMER', 'title', 'Customer revision 6', 'components', '[]'::jsonb),
  'writer_prompt_digest', 'sha256:' || repeat('8', 64),
  'model_alias', 'harvester'));

SELECT public.claim_report_run((SELECT pro FROM t_reports));
SELECT public.transition_report_run((SELECT pro FROM t_reports), 'WRITING', 'VALIDATING', '{}'::jsonb);
SELECT public.transition_report_run((SELECT pro FROM t_reports), 'VALIDATING', 'SAVING', '{}'::jsonb);
SELECT public.save_report((SELECT pro FROM t_reports), jsonb_build_object(
  'writer_output', jsonb_build_object('schema', 'hive.writer-report/1', 'audience', 'PRO'),
  'scenario_analysis', jsonb_build_object('schema', 'hive.scenario-analysis/1', 'scenarios', '[]'::jsonb),
  'view', jsonb_build_object('schema', 'hive-application-view/1', 'audience', 'PRO', 'title', 'Pro revision 6', 'components', '[]'::jsonb),
  'writer_prompt_digest', 'sha256:' || repeat('8', 64),
  'model_alias', 'harvester'));

RESET role;
ALTER TABLE hive.study_revisions DISABLE TRIGGER trg_study_revisions__immutable;
UPDATE hive.study_revisions
   SET revision_number = 6
 WHERE processing_run_id = (SELECT id FROM t_analyze_id);
ALTER TABLE hive.study_revisions ENABLE TRIGGER trg_study_revisions__immutable;

CREATE TEMP TABLE t_rev6 AS
SELECT id FROM hive.study_revisions WHERE processing_run_id = (SELECT id FROM t_analyze_id);
GRANT SELECT ON t_rev6 TO service_role, authenticated;

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}';

SELECT is(
  (SELECT (r ->> 'created') || ':' || (r ->> 'reusedStudy') || ':' || (r ->> 'reportsReady') || ':' || (r -> 'studyRevision' ->> 'revisionNumber')
     FROM (SELECT public.start_study_preparation(
                    'bbbbbbbb-0000-4000-8000-0000000000b1',
                    'dddddddd-0000-4000-8000-0000000000d2',
                    'eeeeeeee-0000-4000-8000-0000000000e2') AS r) x),
  'false:true:true:6',
  'Analyze reuses revision 6 and both reports');

CREATE TEMP TABLE t_reads AS
SELECT count(*)::int AS n FROM hive.document_reads WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000b1';
GRANT SELECT ON t_reads TO authenticated, service_role;

RESET role;
INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, read_status
)
VALUES (
  'cccccccc-0000-4000-8000-0000000000c2', 'bbbbbbbb-0000-4000-8000-0000000000b1',
  'aaaaaaaa-0000-4000-8000-0000000000a1', 'synthetic-unread.pdf', 'application/pdf', 1024, repeat('d', 64),
  'hive-source-documents', 'synthetic/unread.pdf', 'UPLOADED', 'ACTIVE', 'PENDING'
);

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT public.rebuild_study(
       'bbbbbbbb-0000-4000-8000-0000000000b1',
       'dddddddd-0000-4000-8000-0000000000d3',
       'eeeeeeee-0000-4000-8000-0000000000e3') $$,
  'P0001',
  'documents_not_read',
  'Rebuild does not read an unread file');

SELECT is(
  (SELECT count(*)::int FROM hive.document_reads WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000b1'),
  (SELECT n FROM t_reads),
  'a refused rebuild does not insert a document read');

RESET role;
UPDATE hive.source_documents SET deleted_at = now() WHERE id = 'cccccccc-0000-4000-8000-0000000000c2';
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}';

CREATE TEMP TABLE t_rebuild AS
SELECT public.rebuild_study(
         'bbbbbbbb-0000-4000-8000-0000000000b1',
         'dddddddd-0000-4000-8000-0000000000d4',
         'eeeeeeee-0000-4000-8000-0000000000e4') AS result;
GRANT SELECT ON t_rebuild TO service_role, authenticated;

SELECT is(
  (SELECT (result ->> 'created') || ':' || (result -> 'processingRun' ->> 'preparationMode') || ':'
          || (result -> 'processingRun' ->> 'status') || ':' || json_array_length(result -> 'queuedReadIds')
          || ':' || json_array_length(result -> 'queuedReportRunIds')
     FROM t_rebuild),
  'true:REBUILD:QUEUED:0:0',
  'Rebuild bypasses the accepted study and does not queue reads or Writer');

SELECT is(
  (SELECT (r ->> 'created') || ':' || (r -> 'processingRun' ->> 'id')
     FROM (SELECT public.rebuild_study(
                    'bbbbbbbb-0000-4000-8000-0000000000b1',
                    'dddddddd-0000-4000-8000-0000000000d4',
                    'eeeeeeee-0000-4000-8000-0000000000e5') AS r) x),
  'false:' || ((SELECT result FROM t_rebuild) -> 'processingRun' ->> 'id'),
  'the same rebuild request replays the same run');

SELECT is(
  (SELECT (r ->> 'created') || ':' || (r -> 'processingRun' ->> 'id')
     FROM (SELECT public.rebuild_study(
                    'bbbbbbbb-0000-4000-8000-0000000000b1',
                    'dddddddd-0000-4000-8000-0000000000d5',
                    'eeeeeeee-0000-4000-8000-0000000000e6') AS r) x),
  'false:' || ((SELECT result FROM t_rebuild) -> 'processingRun' ->> 'id'),
  'a second rebuild request reattaches instead of starting another run');

SELECT is(
  (SELECT count(*)::int FROM hive.document_reads WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000b1'),
  (SELECT n FROM t_reads),
  'rebuild reuses the persisted reader pages');

SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.rebuild_study(
       'bbbbbbbb-0000-4000-8000-0000000000b1',
       'dddddddd-0000-4000-8000-0000000000d6',
       'eeeeeeee-0000-4000-8000-0000000000e7') $$,
  'P0002',
  'hive_not_found',
  'another owner cannot rebuild the study');

SET LOCAL "request.jwt.claims" TO '{"role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.rebuild_study(
       'bbbbbbbb-0000-4000-8000-0000000000b1',
       'dddddddd-0000-4000-8000-0000000000d7',
       'eeeeeeee-0000-4000-8000-0000000000e8') $$,
  '42501',
  'auth_required',
  'a signed-out caller cannot rebuild the study');

RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

CREATE TEMP TABLE t_rebuild_id AS
SELECT ((SELECT result FROM t_rebuild) -> 'processingRun' ->> 'id')::uuid AS id;
GRANT SELECT ON t_rebuild_id TO service_role, authenticated;

SELECT public.claim_processing_run((SELECT id FROM t_rebuild_id));
SELECT public.transition_processing_run((SELECT id FROM t_rebuild_id), 'QUEUED', 'EXTRACTING', '{}'::jsonb);
SELECT public.transition_processing_run((SELECT id FROM t_rebuild_id), 'EXTRACTING', 'CANONICALIZING',
  jsonb_build_object('stage_outputs', jsonb_build_object(
    'canonicalStudy', jsonb_build_object(
      'schema', 'hive.canonical-study/1',
      'documents', jsonb_build_array(jsonb_build_object(
        'sourceDocumentId', 'cccccccc-0000-4000-8000-0000000000c1',
        'role', 'ANCHOR', 'typeInPlainWords', 'statement', 'date', null, 'version', null, 'chainPosition', null
      )),
      'spineSource', 'ANCHOR',
      'spine', '[]'::jsonb,
      'outsideSpine', '[]'::jsonb,
      'conflicts', '[]'::jsonb,
      'timeline', '[]'::jsonb,
      'gaps', '[]'::jsonb,
      'domainLabel', 'unknown'
    ))));
SELECT public.transition_processing_run((SELECT id FROM t_rebuild_id), 'CANONICALIZING', 'ACCEPTING_STUDY', '{}'::jsonb);

SELECT throws_ok(
  $$ SELECT public.accept_study_revision((SELECT id FROM t_rebuild_id), jsonb_build_object(
       'format', 'canonical-study-1',
       'investigation', jsonb_build_object('schema', 'hive.canonical-study/1', 'documents', '[]'::jsonb),
       'verification', jsonb_build_object('schema', 'hive.study-verification/1', 'counts', '{}'::jsonb),
       'audience_configuration', jsonb_build_object('schema', 'hive.audience-configuration/1'),
       'investigation_digest', 'sha256:' || repeat('7', 64),
       'prompt_digest', 'sha256:' || repeat('8', 64))) $$,
  'P0001',
  'study_documents_incomplete',
  'a rebuild without a document inventory is not accepted');

SELECT is(
  (SELECT s.revision_number::text || ':' || (SELECT count(*) FROM hive.reports p WHERE p.study_revision_id = s.id)::text
     FROM hive.study_revisions s WHERE s.id = (SELECT id FROM t_rev6)),
  '6:2',
  'a failed rebuild leaves revision 6 and both reports in place');

SELECT public.accept_study_revision((SELECT id FROM t_rebuild_id), jsonb_build_object(
  'format', 'canonical-study-1',
  'investigation', jsonb_build_object(
    'schema', 'hive.canonical-study/1',
    'documents', jsonb_build_array(jsonb_build_object(
      'sourceDocumentId', 'cccccccc-0000-4000-8000-0000000000c1',
      'role', 'ANCHOR', 'typeInPlainWords', 'statement', 'date', null, 'version', null, 'chainPosition', null
    )),
    'spineSource', 'ANCHOR',
    'spine', '[]'::jsonb,
    'outsideSpine', '[]'::jsonb,
    'conflicts', '[]'::jsonb,
    'timeline', '[]'::jsonb,
    'gaps', '[]'::jsonb,
    'domainLabel', 'rebuilt'
  ),
  'verification', jsonb_build_object(
    'schema', 'hive.study-verification/1',
    'counts', jsonb_build_object('documentFindings', 0, 'claims', 0),
    'findings', '[]'::jsonb,
    'documentCoverage', '[]'::jsonb
  ),
  'audience_configuration', jsonb_build_object('schema', 'hive.audience-configuration/1'),
  'investigation_digest', 'sha256:' || repeat('7', 64),
  'prompt_digest', 'sha256:' || repeat('8', 64),
  'model_alias', 'heavy_lifter'));

SELECT is(
  (SELECT s.revision_number::text || ':' || coalesce(s.predecessor_revision_id = (SELECT id FROM t_rev6), false)::text
          || ':' || (SELECT count(*) FROM hive.report_runs r WHERE r.study_revision_id = s.id)::text
          || ':' || (s.format = 'canonical-study-1')::text
     FROM hive.study_revisions s
    WHERE s.processing_run_id = (SELECT id FROM t_rebuild_id)),
  '7:true:0:true',
  'the accepted rebuild is revision 7, cites revision 6, and has no Writer runs');

SELECT is(
  (SELECT current_revision_id = (SELECT id FROM hive.study_revisions WHERE revision_number = 7)
     FROM hive.canonical_studies WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000b1'),
  true,
  'the current pointer advances to the new revision');

SELECT is(
  (SELECT count(*)::int FROM hive.reports WHERE study_revision_id = (SELECT id FROM t_rev6)),
  2,
  'revision 6 reports are still stored');

SELECT is(
  (SELECT count(*)::int FROM hive.document_reads WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000b1'),
  (SELECT n FROM t_reads),
  'acceptance does not re-read the file');

SELECT * FROM finish();
ROLLBACK;
