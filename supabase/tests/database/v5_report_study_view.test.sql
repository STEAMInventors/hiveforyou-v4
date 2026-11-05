-- V5-005b part B — canonical-study-1 report inputs (format, verified extractions) and hive.study-view/1 reports.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES ('aaaaaaaa-0000-4000-8000-0000000005b1', 'v5b-owner@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-0000000005b1', 'aaaaaaaa-0000-4000-8000-0000000005b1', 'V5 Part B Hive',
        'bbbbbbbb-0000-4000-8000-0000000005f1');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, created_at
)
VALUES (
  'cccccccc-0000-4000-8000-0000000005b1', 'bbbbbbbb-0000-4000-8000-0000000005b1',
  'aaaaaaaa-0000-4000-8000-0000000005b1', 'synthetic-v5b.pdf', 'application/pdf', 2048, repeat('b', 64),
  'hive-source-documents', 'synthetic/v5b.pdf', 'UPLOADED', 'ACTIVE', now() - interval '2 minutes'
);

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, audience, client_request_id)
VALUES (
  '99999999-0000-4000-8000-0000000005b1', 'bbbbbbbb-0000-4000-8000-0000000005b1',
  'aaaaaaaa-0000-4000-8000-0000000005b1',
  'Summarize the document.', 'A first-time reader', '99999999-0000-4000-8000-0000000005f1'
);

CREATE TEMP TABLE t_study AS
SELECT jsonb_build_object(
  'schema', 'hive.canonical-study/1',
  'documents', jsonb_build_array(jsonb_build_object(
    'sourceDocumentId', 'cccccccc-0000-4000-8000-0000000005b1',
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
    'bbbbbbbb-0000-4000-8000-0000000005b1', 'aaaaaaaa-0000-4000-8000-0000000005b1', 'STUDY_PREPARATION',
    'dddddddd-0000-4000-8000-0000000005b1', 1, 'ACCEPTING_STUDY', 'eeeeeeee-0000-4000-8000-0000000005b1',
    ARRAY['cccccccc-0000-4000-8000-0000000005b1'::uuid],
    ARRAY['99999999-0000-4000-8000-0000000005b1'::uuid],
    jsonb_build_object(
      'documents', jsonb_build_array(jsonb_build_object(
        'sourceDocumentId', 'cccccccc-0000-4000-8000-0000000005b1',
        'fileName', 'synthetic-v5b.pdf',
        'pageSetDigest', 'sha256:' || repeat('5', 64)
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
VALUES ('abababab-0000-4000-8000-0000000005b1', 'bbbbbbbb-0000-4000-8000-0000000005b1',
        'aaaaaaaa-0000-4000-8000-0000000005b1');

INSERT INTO hive.study_revisions (
  id, canonical_study_id, hive_id, owner_user_id, revision_number, processing_run_id, format,
  investigation, verification, audience_configuration, investigation_digest, prompt_digest,
  source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete, coverage_status,
  coverage_gaps, coverage_acknowledgement
)
SELECT
  'acacacac-0000-4000-8000-0000000005b1', 'abababab-0000-4000-8000-0000000005b1',
  'bbbbbbbb-0000-4000-8000-0000000005b1', 'aaaaaaaa-0000-4000-8000-0000000005b1', 1, r.id, 'canonical-study-1',
  s.study,
  jsonb_build_object('schema', 'hive.study-verification/1', 'counts', jsonb_build_object('documentFindings', 0, 'claims', 0),
                     'findings', '[]'::jsonb, 'documentCoverage', '[]'::jsonb),
  jsonb_build_object('schema', 'hive.audience-configuration/1'),
  'sha256:' || repeat('c', 64), 'sha256:' || repeat('d', 64),
  'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64),
  true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED'
FROM t_run r, t_study s;

INSERT INTO hive.report_runs (id, hive_id, owner_user_id, study_revision_id, audience, trigger, correlation_id)
VALUES
  ('adadadad-0000-4000-8000-0000000005b1', 'bbbbbbbb-0000-4000-8000-0000000005b1',
   'aaaaaaaa-0000-4000-8000-0000000005b1', 'acacacac-0000-4000-8000-0000000005b1', 'CUSTOMER', 'STUDY_ACCEPTED',
   'aeaeaeae-0000-4000-8000-0000000005b1'),
  ('adadadad-0000-4000-8000-0000000005b2', 'bbbbbbbb-0000-4000-8000-0000000005b1',
   'aaaaaaaa-0000-4000-8000-0000000005b1', 'acacacac-0000-4000-8000-0000000005b1', 'PRO', 'STUDY_ACCEPTED',
   'aeaeaeae-0000-4000-8000-0000000005b2');

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

-- One extraction bound to the frozen snapshot digest, one for a different content digest.
SELECT public.put_doc_extraction(
  'bbbbbbbb-0000-4000-8000-0000000005b1', 'cccccccc-0000-4000-8000-0000000005b1',
  'sha256:' || repeat('5', 64), 'hive-extract/1', 'sha256:' || repeat('e', 64), 'harvester',
  jsonb_build_object('schema', 'hive.doc-extraction/1', 'documentId', 'cccccccc-0000-4000-8000-0000000005b1',
                     'facts', jsonb_build_array(jsonb_build_object('id', 'F-cccccccc-001'))),
  '{}'::jsonb);
SELECT public.put_doc_extraction(
  'bbbbbbbb-0000-4000-8000-0000000005b1', 'cccccccc-0000-4000-8000-0000000005b1',
  'sha256:' || repeat('6', 64), 'hive-extract/1', 'sha256:' || repeat('e', 64), 'harvester',
  jsonb_build_object('schema', 'hive.doc-extraction/1', 'documentId', 'stale'),
  '{}'::jsonb);

CREATE TEMP TABLE t_inputs AS
SELECT public.get_report_generation_inputs('adadadad-0000-4000-8000-0000000005b1')::jsonb AS payload;

SELECT is((SELECT payload -> 'studyRevision' ->> 'format' FROM t_inputs), 'canonical-study-1',
  'get_report_generation_inputs returns the revision format');
SELECT is((SELECT payload -> 'studyRevision' -> 'investigation' ->> 'schema' FROM t_inputs), 'hive.canonical-study/1',
  'get_report_generation_inputs returns the canonical study');
SELECT is((SELECT jsonb_array_length(payload -> 'extractions') FROM t_inputs), 1,
  'only extractions bound to the frozen snapshot digest are returned');
SELECT is((SELECT payload -> 'extractions' -> 0 -> 'facts' -> 0 ->> 'id' FROM t_inputs), 'F-cccccccc-001',
  'the returned extraction carries its verified facts');
SELECT is((SELECT payload -> 'intents' -> 0 ->> 'audience' FROM t_inputs), 'A first-time reader',
  'stated audience text is returned as free text');

-- A study-view report saves with an explicit title and returns its citation index.
SELECT public.claim_report_run('adadadad-0000-4000-8000-0000000005b1');
SELECT public.transition_report_run('adadadad-0000-4000-8000-0000000005b1', 'WRITING', 'VALIDATING', '{}'::jsonb);
SELECT public.transition_report_run('adadadad-0000-4000-8000-0000000005b1', 'VALIDATING', 'SAVING', '{}'::jsonb);

SELECT throws_ok(
  $$SELECT public.save_report('adadadad-0000-4000-8000-0000000005b1', jsonb_build_object(
      'title', 'Overview',
      'view', jsonb_build_object('schema', 'hive.study-view/1', 'sections', '[]'::jsonb, 'blocks', '[]'::jsonb),
      'writer_output', jsonb_build_object('schema', 'hive.writer-report/1', 'audience', 'CUSTOMER'),
      'scenario_analysis', '{}'::jsonb,
      'writer_prompt_digest', 'sha256:' || repeat('f', 64)))$$,
  '22023', 'invalid_request',
  'a study view with a legacy writer output is rejected');

SELECT throws_ok(
  $$SELECT public.save_report('adadadad-0000-4000-8000-0000000005b1', jsonb_build_object(
      'view', jsonb_build_object('schema', 'hive.study-view/1', 'sections', '[]'::jsonb, 'blocks', '[]'::jsonb),
      'writer_output', jsonb_build_object('schema', 'hive.write-run/1', 'audience', 'CUSTOMER',
                                          'calls', '[]'::jsonb, 'drops', '{}'::jsonb, 'sources', '{}'::jsonb),
      'scenario_analysis', '{}'::jsonb,
      'writer_prompt_digest', 'sha256:' || repeat('f', 64)))$$,
  '22023', 'invalid_request',
  'a study view without any title is rejected');

SELECT is(
  (public.save_report('adadadad-0000-4000-8000-0000000005b1', jsonb_build_object(
     'title', 'Overview',
     'view', jsonb_build_object('schema', 'hive.study-view/1', 'sections', '[]'::jsonb, 'blocks', '[]'::jsonb),
     'writer_output', jsonb_build_object(
       'schema', 'hive.write-run/1', 'audience', 'CUSTOMER',
       'calls', jsonb_build_array(jsonb_build_object('attempt', 1, 'outcome', 'ok')),
       'drops', jsonb_build_object('sentencesDropped', 0),
       'sources', jsonb_build_object('documents', '{}'::jsonb, 'facts', jsonb_build_object(
         'F-cccccccc-001', jsonb_build_object('sourceDocumentId', 'cccccccc-0000-4000-8000-0000000005b1',
                                              'pageNumber', 1, 'quote', 'q'))))),
     'scenario_analysis', '{}'::jsonb,
     'writer_prompt_digest', 'sha256:' || repeat('f', 64),
     'model_alias', 'harvester',
     'resolved_model', 'model-w')) ->> 'created')::boolean,
  true,
  'save_report stores a hive.study-view/1 report');

SELECT is((SELECT title FROM hive.reports WHERE report_run_id = 'adadadad-0000-4000-8000-0000000005b1'), 'Overview',
  'the explicit title is used when the view has none');
SELECT is(
  (SELECT hive.report_json(p)::jsonb -> 'studyViewSources' -> 'facts' -> 'F-cccccccc-001' ->> 'pageNumber'
     FROM hive.reports p WHERE p.report_run_id = 'adadadad-0000-4000-8000-0000000005b1'),
  '1',
  'report_json returns the study-view citation index');
SELECT ok(
  (SELECT hive.report_json(p)::jsonb -> 'scenarioAnalysis' = 'null'::jsonb
     FROM hive.reports p WHERE p.report_run_id = 'adadadad-0000-4000-8000-0000000005b1'),
  'study-view reports have no scenario analysis');

-- The legacy shape is still enforced: an unknown view schema is rejected.
SELECT public.claim_report_run('adadadad-0000-4000-8000-0000000005b2');
SELECT public.transition_report_run('adadadad-0000-4000-8000-0000000005b2', 'WRITING', 'VALIDATING', '{}'::jsonb);
SELECT public.transition_report_run('adadadad-0000-4000-8000-0000000005b2', 'VALIDATING', 'SAVING', '{}'::jsonb);
SELECT throws_ok(
  $$SELECT public.save_report('adadadad-0000-4000-8000-0000000005b2', jsonb_build_object(
      'title', 'Overview',
      'view', jsonb_build_object('schema', 'hive.unknown-view/1', 'audience', 'PRO'),
      'writer_output', jsonb_build_object('schema', 'hive.writer-report/1', 'audience', 'PRO'),
      'scenario_analysis', jsonb_build_object('schema', 'hive.scenario-analysis/1'),
      'writer_prompt_digest', 'sha256:' || repeat('f', 64)))$$,
  '22023', 'invalid_request',
  'an unknown view schema is rejected');

SELECT * FROM finish();
ROLLBACK;
