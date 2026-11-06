-- Permanent Hive deletion with V5 doc_extractions, canonical-study-1 revision, and study-view report.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES ('aaaaaaaa-0000-4000-8000-0000000000d1', 'del-owner@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Deletion V5 Hive',
        'bbbbbbbb-0000-4000-8000-0000000000df');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, created_at
)
VALUES (
  'cccccccc-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d1',
  'aaaaaaaa-0000-4000-8000-0000000000d1', 'synthetic-del.pdf', 'application/pdf', 2048, repeat('d', 64),
  'hive-source-documents', 'owner/del/synthetic-del.pdf', 'UPLOADED', 'ACTIVE', now() - interval '2 minutes'
);

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, audience, client_request_id)
VALUES (
  '99999999-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d1',
  'aaaaaaaa-0000-4000-8000-0000000000d1',
  'Summarize the document.', 'A first-time reader', '99999999-0000-4000-8000-0000000000df');

CREATE TEMP TABLE t_study AS
SELECT jsonb_build_object(
  'schema', 'hive.canonical-study/1',
  'documents', jsonb_build_array(jsonb_build_object(
    'sourceDocumentId', 'cccccccc-0000-4000-8000-0000000000d1',
    'role', 'ANCHOR', 'typeInPlainWords', 'statement', 'date', null, 'version', null, 'chainPosition', null
  )),
  'spineSource', 'ANCHOR',
  'spine', '[]'::jsonb,
  'outsideSpine', '[]'::jsonb,
  'conflicts', '[]'::jsonb,
  'timeline', '[]'::jsonb,
  'gaps', '[]'::jsonb,
  'domainLabel', 'unknown'
) AS study;

CREATE TEMP TABLE t_run AS
WITH ins AS (
  INSERT INTO hive.processing_runs (
    hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
    authorized_source_document_ids, intent_request_ids, source_snapshot,
    source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
    coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement,
    snapshot_frozen_at, stage_attempt, stage_outputs
  )
  SELECT
    'bbbbbbbb-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'STUDY_PREPARATION',
    'dddddddd-0000-4000-8000-0000000000d1', 1, 'SUCCEEDED', 'eeeeeeee-0000-4000-8000-0000000000d1',
    ARRAY['cccccccc-0000-4000-8000-0000000000d1'::uuid],
    ARRAY['99999999-0000-4000-8000-0000000000d1'::uuid],
    jsonb_build_object(
      'documents', jsonb_build_array(jsonb_build_object(
        'sourceDocumentId', 'cccccccc-0000-4000-8000-0000000000d1',
        'fileName', 'synthetic-del.pdf',
        'pageSetDigest', 'sha256:' || repeat('d', 64)
      )),
      'excluded', '[]'::jsonb,
      'coverageComplete', true
    ),
    'sha256:' || repeat('1', 64),
    'sha256:' || repeat('2', 64),
    'sha256:' || repeat('3', 64),
    true, true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED',
    now(), 1, jsonb_build_object('canonicalStudy', s.study)
  FROM t_study s
  RETURNING id
)
SELECT id FROM ins;

INSERT INTO hive.canonical_studies (id, hive_id, owner_user_id)
VALUES ('abababab-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d1',
        'aaaaaaaa-0000-4000-8000-0000000000d1');

INSERT INTO hive.study_revisions (
  id, canonical_study_id, hive_id, owner_user_id, revision_number, processing_run_id, format,
  investigation, verification, audience_configuration, investigation_digest, prompt_digest,
  source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete, coverage_status,
  coverage_gaps, coverage_acknowledgement
)
SELECT
  'acacacac-0000-4000-8000-0000000000d1', 'abababab-0000-4000-8000-0000000000d1',
  'bbbbbbbb-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000d1', 1, r.id, 'canonical-study-1',
  s.study,
  jsonb_build_object('schema', 'hive.study-verification/1', 'counts', jsonb_build_object('documentFindings', 0, 'claims', 0),
                     'findings', '[]'::jsonb, 'documentCoverage', '[]'::jsonb),
  jsonb_build_object('schema', 'hive.audience-configuration/1'),
  'sha256:' || repeat('c', 64), 'sha256:' || repeat('e', 64),
  'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64),
  true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED'
FROM t_run r, t_study s;

UPDATE hive.canonical_studies
   SET current_revision_id = 'acacacac-0000-4000-8000-0000000000d1'
 WHERE id = 'abababab-0000-4000-8000-0000000000d1';

INSERT INTO hive.report_runs (
  id, hive_id, owner_user_id, study_revision_id, audience, trigger, correlation_id, status, finished_at
)
VALUES (
  'adadadad-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d1',
  'aaaaaaaa-0000-4000-8000-0000000000d1', 'acacacac-0000-4000-8000-0000000000d1', 'CUSTOMER', 'STUDY_ACCEPTED',
  'aeaeaeae-0000-4000-8000-0000000000d1', 'SUCCEEDED', now());

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT public.put_doc_extraction(
  'bbbbbbbb-0000-4000-8000-0000000000d1', 'cccccccc-0000-4000-8000-0000000000d1',
  'sha256:' || repeat('d', 64), 'hive-extract/1', 'sha256:' || repeat('f', 64), 'harvester',
  jsonb_build_object('schema', 'hive.doc-extraction/1', 'documentId', 'cccccccc-0000-4000-8000-0000000000d1',
                     'facts', jsonb_build_array(jsonb_build_object('id', 'F-cccccccc-001'))),
  '{}'::jsonb);

INSERT INTO hive.reports (
  report_run_id, hive_id, owner_user_id, study_revision_id, audience, title,
  writer_output, scenario_analysis, view, writer_prompt_digest, model_alias, resolved_model
)
VALUES (
  'adadadad-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d1',
  'aaaaaaaa-0000-4000-8000-0000000000d1', 'acacacac-0000-4000-8000-0000000000d1', 'CUSTOMER', 'Overview',
  jsonb_build_object(
    'schema', 'hive.write-run/1', 'audience', 'CUSTOMER',
    'calls', '[]'::jsonb, 'drops', '{}'::jsonb, 'sources', '{}'::jsonb),
  '{}'::jsonb,
  jsonb_build_object('schema', 'hive.study-view/1', 'sections', '[]'::jsonb, 'blocks', '[]'::jsonb),
  'sha256:' || repeat('a', 64), 'harvester', 'model-w');

SELECT ok(
  (SELECT count(*)::int FROM hive.doc_extractions WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000d1') = 1,
  'fixture includes a doc_extractions row');

SELECT throws_ok(
  $$ UPDATE hive.doc_extractions SET stats = '{"mutated":true}'::jsonb
     WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000d1' $$,
  'P0001',
  'hive.doc_extractions rows are immutable',
  'doc_extractions remain insert-only (UPDATE blocked)');

RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d1","role":"authenticated"}';

SELECT is(
  (public.begin_hive_deletion('bbbbbbbb-0000-4000-8000-0000000000d1') ->> 'deletion_stage'),
  'marked',
  'begin_hive_deletion marks the Hive for deletion');

RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (public.complete_hive_deletion('bbbbbbbb-0000-4000-8000-0000000000d1') ->> 'deleted')::boolean,
  true,
  'complete_hive_deletion removes the Hive');

SELECT is((SELECT count(*)::int FROM hive.hives WHERE id = 'bbbbbbbb-0000-4000-8000-0000000000d1'), 0,
  'hive row is gone');
SELECT is((SELECT count(*)::int FROM hive.source_documents WHERE case_id = 'bbbbbbbb-0000-4000-8000-0000000000d1'), 0,
  'source documents are gone');
SELECT is((SELECT count(*)::int FROM hive.doc_extractions WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000d1'), 0,
  'doc_extractions are gone');
SELECT is((SELECT count(*)::int FROM hive.study_revisions WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000d1'), 0,
  'canonical-study-1 study revisions are gone');
SELECT is((SELECT count(*)::int FROM hive.reports WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000d1'), 0,
  'study-view reports are gone');
SELECT is((SELECT count(*)::int FROM hive.processing_runs WHERE hive_id = 'bbbbbbbb-0000-4000-8000-0000000000d1'), 0,
  'processing runs are gone');

SELECT * FROM finish();
ROLLBACK;
