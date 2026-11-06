-- Permanent Hive deletion: CASCADE removes audit_events while chained study revisions exist.
-- Live Hive: UPDATE and DELETE on audit_events remain blocked. Synthetic data only.
-- Run locally with `supabase test db`; never against a live project.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES ('aaaaaaaa-0000-4000-8000-00000000ad01', 'audit-del-owner@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES ('bbbbbbbb-0000-4000-8000-00000000ad01', 'aaaaaaaa-0000-4000-8000-00000000ad01', 'Audit deletion Hive',
        'bbbbbbbb-0000-4000-8000-00000000adf1');

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, created_at
)
VALUES (
  'cccccccc-0000-4000-8000-00000000ad01', 'bbbbbbbb-0000-4000-8000-00000000ad01',
  'aaaaaaaa-0000-4000-8000-00000000ad01', 'synthetic-audit.pdf', 'application/pdf', 2048, repeat('a', 64),
  'hive-source-documents', 'owner/audit/synthetic.pdf', 'UPLOADED', 'ACTIVE', now() - interval '2 minutes');

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, audience, client_request_id)
VALUES (
  '99999999-0000-4000-8000-00000000ad01', 'bbbbbbbb-0000-4000-8000-00000000ad01',
  'aaaaaaaa-0000-4000-8000-00000000ad01',
  'Test audit cascade.', 'A reader', '99999999-0000-4000-8000-00000000adf1');

CREATE TEMP TABLE t_study AS
SELECT jsonb_build_object(
  'schema', 'hive.canonical-study/1',
  'documents', jsonb_build_array(jsonb_build_object(
    'sourceDocumentId', 'cccccccc-0000-4000-8000-00000000ad01',
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

INSERT INTO hive.audit_events (
  id, owner_user_id, case_id, source_document_id, intake_run_id, event_type,
  actor_user_id, actor_type, correlation_id, safe_metadata, created_at
)
VALUES (
  'f0f0f0f0-0000-4000-8000-00000000ad01', 'aaaaaaaa-0000-4000-8000-00000000ad01',
  'bbbbbbbb-0000-4000-8000-00000000ad01', NULL, NULL, 'test.audit_fixture',
  'aaaaaaaa-0000-4000-8000-00000000ad01', 'USER', NULL, '{}'::jsonb, now()
);

INSERT INTO hive.canonical_studies (id, hive_id, owner_user_id)
VALUES ('abababab-0000-4000-8000-00000000ad01', 'bbbbbbbb-0000-4000-8000-00000000ad01',
        'aaaaaaaa-0000-4000-8000-00000000ad01');

CREATE TEMP TABLE t_runs AS
WITH
  i1 AS (
    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      authorized_source_document_ids, intent_request_ids, source_snapshot,
      source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
      coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement,
      snapshot_frozen_at, stage_attempt, stage_outputs, finished_at
    )
    SELECT
      'bbbbbbbb-0000-4000-8000-00000000ad01', 'aaaaaaaa-0000-4000-8000-00000000ad01', 'STUDY_PREPARATION',
      '11111111-0000-4000-8000-00000000ad01', 1, 'SUCCEEDED', '21111111-0000-4000-8000-00000000ad01',
      ARRAY['cccccccc-0000-4000-8000-00000000ad01'::uuid],
      ARRAY['99999999-0000-4000-8000-00000000ad01'::uuid],
      jsonb_build_object(
        'documents', jsonb_build_array(jsonb_build_object(
          'sourceDocumentId', 'cccccccc-0000-4000-8000-00000000ad01',
          'fileName', 'synthetic-audit.pdf', 'pageSetDigest', 'sha256:' || repeat('a', 64)
        )),
        'excluded', '[]'::jsonb,
        'coverageComplete', true
      ),
      'sha256:' || repeat('1', 64),
      'sha256:' || repeat('2', 64),
      'sha256:' || repeat('3', 64),
      true, true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED',
      now(), 1, jsonb_build_object('canonicalStudy', s.study), now()
    FROM t_study s
    RETURNING id
  ),
  i2 AS (
    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      authorized_source_document_ids, intent_request_ids, source_snapshot,
      source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
      coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement,
      snapshot_frozen_at, stage_attempt, stage_outputs, finished_at
    )
    SELECT
      'bbbbbbbb-0000-4000-8000-00000000ad01', 'aaaaaaaa-0000-4000-8000-00000000ad01', 'STUDY_PREPARATION',
      '22222222-0000-4000-8000-00000000ad01', 2, 'SUCCEEDED', '22222222-0000-4000-8000-00000000ad01',
      ARRAY['cccccccc-0000-4000-8000-00000000ad01'::uuid],
      ARRAY['99999999-0000-4000-8000-00000000ad01'::uuid],
      jsonb_build_object(
        'documents', jsonb_build_array(jsonb_build_object(
          'sourceDocumentId', 'cccccccc-0000-4000-8000-00000000ad01',
          'fileName', 'synthetic-audit.pdf', 'pageSetDigest', 'sha256:' || repeat('a', 64)
        )),
        'excluded', '[]'::jsonb,
        'coverageComplete', true
      ),
      'sha256:' || repeat('1', 64),
      'sha256:' || repeat('2', 64),
      'sha256:' || repeat('3', 64),
      true, true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED',
      now(), 1, jsonb_build_object('canonicalStudy', s.study), now()
    FROM t_study s
    RETURNING id
  ),
  i3 AS (
    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      authorized_source_document_ids, intent_request_ids, source_snapshot,
      source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
      coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement,
      snapshot_frozen_at, stage_attempt, stage_outputs, finished_at
    )
    SELECT
      'bbbbbbbb-0000-4000-8000-00000000ad01', 'aaaaaaaa-0000-4000-8000-00000000ad01', 'STUDY_PREPARATION',
      '33333333-0000-4000-8000-00000000ad01', 3, 'SUCCEEDED', '33333333-0000-4000-8000-00000000ad01',
      ARRAY['cccccccc-0000-4000-8000-00000000ad01'::uuid],
      ARRAY['99999999-0000-4000-8000-00000000ad01'::uuid],
      jsonb_build_object(
        'documents', jsonb_build_array(jsonb_build_object(
          'sourceDocumentId', 'cccccccc-0000-4000-8000-00000000ad01',
          'fileName', 'synthetic-audit.pdf', 'pageSetDigest', 'sha256:' || repeat('a', 64)
        )),
        'excluded', '[]'::jsonb,
        'coverageComplete', true
      ),
      'sha256:' || repeat('1', 64),
      'sha256:' || repeat('2', 64),
      'sha256:' || repeat('3', 64),
      true, true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED',
      now(), 1, jsonb_build_object('canonicalStudy', s.study), now()
    FROM t_study s
    RETURNING id
  )
SELECT (SELECT id FROM i1) AS r1, (SELECT id FROM i2) AS r2, (SELECT id FROM i3) AS r3;

INSERT INTO hive.study_revisions (
  id, canonical_study_id, hive_id, owner_user_id, revision_number, predecessor_revision_id, processing_run_id,
  format, investigation, verification, audience_configuration, investigation_digest, prompt_digest,
  source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete, coverage_status,
  coverage_gaps, coverage_acknowledgement
)
SELECT
  'a1a1a1a1-0000-4000-8000-00000000ad01', 'abababab-0000-4000-8000-00000000ad01',
  'bbbbbbbb-0000-4000-8000-00000000ad01', 'aaaaaaaa-0000-4000-8000-00000000ad01', 1, NULL, t.r1,
  'canonical-study-1',
  s.study,
  jsonb_build_object('schema', 'hive.study-verification/1', 'counts', jsonb_build_object('documentFindings', 0, 'claims', 0),
                     'findings', '[]'::jsonb, 'documentCoverage', '[]'::jsonb),
  jsonb_build_object('schema', 'hive.audience-configuration/1'),
  'sha256:' || repeat('b', 64), 'sha256:' || repeat('e', 64),
  'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64),
  true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED'
FROM t_runs t, t_study s;

INSERT INTO hive.study_revisions (
  id, canonical_study_id, hive_id, owner_user_id, revision_number, predecessor_revision_id, processing_run_id,
  format, investigation, verification, audience_configuration, investigation_digest, prompt_digest,
  source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete, coverage_status,
  coverage_gaps, coverage_acknowledgement
)
SELECT
  'a2a2a2a2-0000-4000-8000-00000000ad01', 'abababab-0000-4000-8000-00000000ad01',
  'bbbbbbbb-0000-4000-8000-00000000ad01', 'aaaaaaaa-0000-4000-8000-00000000ad01', 2,
  'a1a1a1a1-0000-4000-8000-00000000ad01'::uuid, t.r2,
  'canonical-study-1',
  s.study,
  jsonb_build_object('schema', 'hive.study-verification/1', 'counts', jsonb_build_object('documentFindings', 0, 'claims', 0),
                     'findings', '[]'::jsonb, 'documentCoverage', '[]'::jsonb),
  jsonb_build_object('schema', 'hive.audience-configuration/1'),
  'sha256:' || repeat('b', 64), 'sha256:' || repeat('e', 64),
  'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64),
  true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED'
FROM t_runs t, t_study s;

INSERT INTO hive.study_revisions (
  id, canonical_study_id, hive_id, owner_user_id, revision_number, predecessor_revision_id, processing_run_id,
  format, investigation, verification, audience_configuration, investigation_digest, prompt_digest,
  source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete, coverage_status,
  coverage_gaps, coverage_acknowledgement
)
SELECT
  'a3a3a3a3-0000-4000-8000-00000000ad01', 'abababab-0000-4000-8000-00000000ad01',
  'bbbbbbbb-0000-4000-8000-00000000ad01', 'aaaaaaaa-0000-4000-8000-00000000ad01', 3,
  'a2a2a2a2-0000-4000-8000-00000000ad01'::uuid, t.r3,
  'canonical-study-1',
  s.study,
  jsonb_build_object('schema', 'hive.study-verification/1', 'counts', jsonb_build_object('documentFindings', 0, 'claims', 0),
                     'findings', '[]'::jsonb, 'documentCoverage', '[]'::jsonb),
  jsonb_build_object('schema', 'hive.audience-configuration/1'),
  'sha256:' || repeat('b', 64), 'sha256:' || repeat('e', 64),
  'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64),
  true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED'
FROM t_runs t, t_study s;

UPDATE hive.canonical_studies
   SET current_revision_id = 'a3a3a3a3-0000-4000-8000-00000000ad01'
 WHERE id = 'abababab-0000-4000-8000-00000000ad01';

RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT ok(
  (SELECT count(*)::int FROM hive.audit_events WHERE case_id = 'bbbbbbbb-0000-4000-8000-00000000ad01') = 1,
  'fixture has one audit event for the Hive');

SELECT throws_ok(
  $$ DELETE FROM hive.audit_events WHERE id = 'f0f0f0f0-0000-4000-8000-00000000ad01' $$,
  'P0001',
  'hive.audit_events is append-only',
  'DELETE audit event blocked while Hive is live');
SELECT throws_ok(
  $$ UPDATE hive.audit_events SET safe_metadata = '{"mutated":true}'::jsonb
     WHERE id = 'f0f0f0f0-0000-4000-8000-00000000ad01' $$,
  'P0001',
  'hive.audit_events is append-only',
  'UPDATE audit event blocked while Hive is live');

RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-00000000ad01","role":"authenticated"}';

SELECT is(
  (public.begin_hive_deletion('bbbbbbbb-0000-4000-8000-00000000ad01') ->> 'deletion_stage'),
  'marked',
  'begin_hive_deletion marks the Hive for deletion');

RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (public.complete_hive_deletion('bbbbbbbb-0000-4000-8000-00000000ad01') ->> 'deleted')::boolean,
  true,
  'complete_hive_deletion succeeds with audit events and chained study revisions');

SELECT is((SELECT count(*)::int FROM hive.hives WHERE id = 'bbbbbbbb-0000-4000-8000-00000000ad01'), 0,
  'hive row is removed');
SELECT is((SELECT count(*)::int FROM hive.audit_events WHERE id = 'f0f0f0f0-0000-4000-8000-00000000ad01'), 0,
  'audit events are removed with the Hive');
SELECT is((SELECT count(*)::int FROM hive.study_revisions WHERE hive_id = 'bbbbbbbb-0000-4000-8000-00000000ad01'), 0,
  'chained study revisions are removed');

SELECT * FROM finish();
ROLLBACK;
