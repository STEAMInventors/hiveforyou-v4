-- Stage 5E.3. Synthetic data only.
-- Run locally with `supabase test db`. Do not run against a live project.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT * FROM no_plan();

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('a5e30001-0000-4000-8000-000000000001', 'pack-owner@example.test', 'authenticated', 'authenticated'),
  ('a5e30001-0000-4000-8000-000000000002', 'pack-other@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES
  ('b5e30001-0000-4000-8000-000000000001', 'a5e30001-0000-4000-8000-000000000001', 'Pinned later', 'b5e30001-0000-4000-8000-0000000000f1'),
  ('b5e30001-0000-4000-8000-000000000002', 'a5e30001-0000-4000-8000-000000000002', 'Already 0.4.0', 'b5e30001-0000-4000-8000-0000000000f2');

SELECT pg_temp.qf1a_ensure_owner_memberships();

INSERT INTO hive.domain_pack_selections (hive_id, pack_id, version, compiled_digest)
VALUES ('b5e30001-0000-4000-8000-000000000002', 'iep-us-federal', '0.4.0', repeat('a', 64));

SELECT throws_ok(
  $$ INSERT INTO hive.domain_pack_selections (hive_id, pack_id, version, compiled_digest)
     VALUES ('b5e30001-0000-4000-8000-000000000001', 'iep-us-federal', '0.6.0', repeat('b', 64)) $$,
  '23514',
  'ck_domain_pack_selections__edition',
  'a version other than 0.4.0 or 0.5.0 is rejected'
);

SELECT is(
  (SELECT version FROM hive.domain_pack_selections WHERE hive_id = 'b5e30001-0000-4000-8000-000000000002'),
  '0.4.0',
  'the existing 0.4.0 selection is unchanged'
);

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT throws_ok(
  $$ SELECT public.set_domain_pack_selection(
       'b5e30001-0000-4000-8000-000000000002',
       'iep-us-federal',
       '0.5.0',
       repeat('c', 64)
     ) $$,
  'P0001',
  'selection_exists',
  'an existing different selection is not replaced'
);

SELECT is(
  (SELECT compiled_digest FROM hive.domain_pack_selections WHERE hive_id = 'b5e30001-0000-4000-8000-000000000002'),
  repeat('a', 64),
  'the 0.4.0 digest stays after a refused replacement'
);

SELECT throws_ok(
  $$ SELECT public.set_domain_pack_selection(
       'b5e30001-0000-4000-8000-000000000001',
       'iep-us-federal',
       '0.4.0',
       repeat('b', 64)
     ) $$,
  '22023',
  'invalid_request',
  'the setter does not write 0.4.0'
);

SELECT throws_ok(
  $$ SELECT public.set_domain_pack_selection(
       'b5e30001-0000-4000-8000-000000000001',
       'iep-us-federal',
       '0.5.0',
       repeat('z', 64)
     ) $$,
  '22023',
  'invalid_request',
  'a digest that is not 64 hex characters is rejected'
);

SELECT is(
  (SELECT count(*) FROM hive.domain_pack_selections WHERE hive_id = 'b5e30001-0000-4000-8000-000000000001'),
  0::bigint,
  'a rejected digest does not insert a row'
);

SELECT ok(
  (public.set_domain_pack_selection(
    'b5e30001-0000-4000-8000-000000000001',
    'iep-us-federal',
    '0.5.0',
    repeat('b', 64)
  ) ->> 'created')::boolean,
  'one Hive can be pinned to 0.5.0'
);

SELECT is(
  (SELECT version FROM hive.domain_pack_selections WHERE hive_id = 'b5e30001-0000-4000-8000-000000000002'),
  '0.4.0',
  'pinning a second Hive does not migrate the first'
);

SELECT is(
  (public.set_domain_pack_selection(
    'b5e30001-0000-4000-8000-000000000001',
    'iep-us-federal',
    '0.5.0',
    repeat('b', 64)
  ) ->> 'created')::boolean,
  false,
  'the same selection replays without writing another row'
);

RESET ROLE;

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"role":"authenticated","sub":"a5e30001-0000-4000-8000-000000000001"}';

SELECT throws_ok(
  $$ SELECT public.set_domain_pack_selection(
       'b5e30001-0000-4000-8000-000000000001',
       'iep-us-federal',
       '0.5.0',
       repeat('b', 64)
     ) $$,
  '42501',
  'permission denied',
  'an authenticated member cannot select a pack'
);

RESET ROLE;

-- Acceptance counts. Revision 6 keeps a measured zero. Revision 10's sentinel zero is not the finding count.
INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, created_at
)
VALUES (
  'c5e30001-0000-4000-8000-000000000001', 'b5e30001-0000-4000-8000-000000000001',
  'a5e30001-0000-4000-8000-000000000001', 'synthetic-iep.pdf', 'application/pdf', 2048, repeat('c', 64),
  'hive-source-documents', 'synthetic/iep.pdf', 'UPLOADED', 'ACTIVE', now() - interval '2 minutes'
);

INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, audience, client_request_id)
VALUES (
  'd5e30001-0000-4000-8000-000000000001', 'b5e30001-0000-4000-8000-000000000001',
  'a5e30001-0000-4000-8000-000000000001', 'Explain the synthetic record.', 'A first-time reader',
  'd5e30001-0000-4000-8000-0000000000f1'
);

INSERT INTO hive.processing_runs (
  id, hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
  authorized_source_document_ids, intent_request_ids, source_snapshot,
  source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
  coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement,
  snapshot_frozen_at, stage_attempt, finished_at
)
VALUES
  (
    'e5e30001-0000-4000-8000-000000000001', 'b5e30001-0000-4000-8000-000000000001',
    'a5e30001-0000-4000-8000-000000000001', 'STUDY_PREPARATION',
    'e5e30001-0000-4000-8000-0000000000a1', 1, 'SUCCEEDED', 'e5e30001-0000-4000-8000-0000000000b1',
    ARRAY['c5e30001-0000-4000-8000-000000000001'::uuid],
    ARRAY['d5e30001-0000-4000-8000-000000000001'::uuid],
    jsonb_build_object('documents', '[]'::jsonb, 'excluded', '[]'::jsonb, 'coverageComplete', true),
    'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64),
    true, true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED', now(), 1, now()
  ),
  (
    'e5e30001-0000-4000-8000-000000000002', 'b5e30001-0000-4000-8000-000000000001',
    'a5e30001-0000-4000-8000-000000000001', 'STUDY_PREPARATION',
    'e5e30001-0000-4000-8000-0000000000a2', 1, 'SUCCEEDED', 'e5e30001-0000-4000-8000-0000000000b2',
    ARRAY['c5e30001-0000-4000-8000-000000000001'::uuid],
    ARRAY['d5e30001-0000-4000-8000-000000000001'::uuid],
    jsonb_build_object('documents', '[]'::jsonb, 'excluded', '[]'::jsonb, 'coverageComplete', true),
    'sha256:' || repeat('4', 64), 'sha256:' || repeat('5', 64), 'sha256:' || repeat('6', 64),
    true, true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED', now(), 1, now()
  );

INSERT INTO hive.canonical_studies (id, hive_id, owner_user_id)
VALUES (
  'f5e30001-0000-4000-8000-000000000001',
  'b5e30001-0000-4000-8000-000000000001',
  'a5e30001-0000-4000-8000-000000000001'
);

INSERT INTO hive.study_revisions (
  id, canonical_study_id, hive_id, owner_user_id, revision_number, processing_run_id,
  format, investigation, verification, audience_configuration, investigation_digest, prompt_digest,
  source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete, coverage_status,
  coverage_gaps, coverage_acknowledgement
)
VALUES (
  'a5e30011-0000-4000-8000-000000000006', 'f5e30001-0000-4000-8000-000000000001',
  'b5e30001-0000-4000-8000-000000000001', 'a5e30001-0000-4000-8000-000000000001', 6,
  'e5e30001-0000-4000-8000-000000000001',
  'investigation-1',
  jsonb_build_object(
    'schema', 'hive.study-investigation/1',
    'documents', jsonb_build_array(jsonb_build_object('sourceDocumentId', 'c5e30001-0000-4000-8000-000000000001')),
    'documentFindings', '[]'::jsonb
  ),
  jsonb_build_object(
    'schema', 'hive.study-verification/1',
    'counts', jsonb_build_object('documentFindings', 0)
  ),
  jsonb_build_object('schema', 'hive.audience-configuration/1'),
  'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64),
  'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64),
  true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED'
);

INSERT INTO hive.study_revisions (
  id, canonical_study_id, hive_id, owner_user_id, revision_number, predecessor_revision_id, processing_run_id,
  format, investigation, verification, audience_configuration, investigation_digest, prompt_digest,
  source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete, coverage_status,
  coverage_gaps, coverage_acknowledgement
)
VALUES (
  'a5e30011-0000-4000-8000-000000000010', 'f5e30001-0000-4000-8000-000000000001',
  'b5e30001-0000-4000-8000-000000000001', 'a5e30001-0000-4000-8000-000000000001', 10,
  'a5e30011-0000-4000-8000-000000000006',
  'e5e30001-0000-4000-8000-000000000002',
  'canonical-study-1',
  jsonb_build_object(
    'schema', 'hive.canonical-study/1',
    'documents', (
      SELECT jsonb_agg(jsonb_build_object('sourceDocumentId', 'doc-' || g))
        FROM generate_series(1, 8) AS g
    ),
    'packRef', jsonb_build_object('id', 'iep-initial', 'version', 7),
    'spine', jsonb_build_array(jsonb_build_object('supportingFactIds', jsonb_build_array('F1')))
  ),
  jsonb_build_object(
    'schema', 'hive.study-verification/1',
    'counts', jsonb_build_object('documentFindings', 0, 'claims', 0, 'verifiedFacts', 11, 'documents', 8)
  ),
  jsonb_build_object('schema', 'hive.audience-configuration/1'),
  'sha256:' || repeat('c', 64), 'sha256:' || repeat('d', 64),
  'sha256:' || repeat('4', 64), 'sha256:' || repeat('5', 64), 'sha256:' || repeat('6', 64),
  true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED'
);

INSERT INTO hive.processing_runs (
  id, hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
  authorized_source_document_ids, intent_request_ids, source_snapshot,
  source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
  coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement,
  snapshot_frozen_at, stage_attempt, finished_at
)
VALUES (
  'e5e30001-0000-4000-8000-000000000003', 'b5e30001-0000-4000-8000-000000000001',
  'a5e30001-0000-4000-8000-000000000001', 'STUDY_PREPARATION',
  'e5e30001-0000-4000-8000-0000000000a3', 1, 'SUCCEEDED', 'e5e30001-0000-4000-8000-0000000000b3',
  ARRAY['c5e30001-0000-4000-8000-000000000001'::uuid],
  ARRAY['d5e30001-0000-4000-8000-000000000001'::uuid],
  jsonb_build_object(
    'documents', jsonb_build_array(jsonb_build_object(
      'sourceDocumentId', 'c5e30001-0000-4000-8000-000000000001',
      'fileName', 'synthetic-iep.pdf', 'pageSetDigest', 'sha256:' || repeat('c', 64)
    )),
    'excluded', '[]'::jsonb,
    'coverageComplete', true
  ),
  'sha256:' || repeat('7', 64), 'sha256:' || repeat('8', 64), 'sha256:' || repeat('9', 64),
  true, true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED', now(), 1, now()
);

INSERT INTO hive.study_revisions (
  id, canonical_study_id, hive_id, owner_user_id, revision_number, predecessor_revision_id, processing_run_id,
  format, investigation, verification, audience_configuration, investigation_digest, prompt_digest,
  source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete, coverage_status,
  coverage_gaps, coverage_acknowledgement
)
VALUES (
  'a5e30011-0000-4000-8000-000000000011', 'f5e30001-0000-4000-8000-000000000001',
  'b5e30001-0000-4000-8000-000000000001', 'a5e30001-0000-4000-8000-000000000001', 11,
  'a5e30011-0000-4000-8000-000000000010',
  'e5e30001-0000-4000-8000-000000000003',
  'canonical-study-1',
  jsonb_build_object(
    'schema', 'hive.canonical-study/1',
    'packRef', jsonb_build_object('id', 'iep-initial', 'version', 7)
  ),
  jsonb_build_object('schema', 'hive.study-verification/1', 'counts', '{}'::jsonb),
  jsonb_build_object('schema', 'hive.audience-configuration/1'),
  'sha256:' || repeat('e', 64), 'sha256:' || repeat('f', 64),
  'sha256:' || repeat('7', 64), 'sha256:' || repeat('8', 64), 'sha256:' || repeat('9', 64),
  true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED'
);

SELECT is(
  (hive.study_revision_summary_json(s) ->> 'documentFindingCount')::integer,
  0,
  'an investigation revision keeps a measured zero'
)
FROM hive.study_revisions s
WHERE s.id = 'a5e30011-0000-4000-8000-000000000006';

SELECT is(
  (hive.study_revision_summary_json(s) ->> 'documentFindingCount')::integer,
  11,
  'a canonical sentinel zero yields the stored verified fact count'
)
FROM hive.study_revisions s
WHERE s.id = 'a5e30011-0000-4000-8000-000000000010';

SELECT is(
  hive.study_revision_summary_json(s) ->> 'investigationEngine',
  'hive-canonicalize/1',
  'legacy IEP v7 is not labeled as the domain investigation engine'
)
FROM hive.study_revisions s
WHERE s.id = 'a5e30011-0000-4000-8000-000000000010';

SELECT is(
  hive.study_revision_summary_json(s) ->> 'domainPackVersion',
  '7',
  'the stored pack version stays 7'
)
FROM hive.study_revisions s
WHERE s.id = 'a5e30011-0000-4000-8000-000000000010';

SELECT is(
  (SELECT investigation_digest FROM hive.study_revisions WHERE id = 'a5e30011-0000-4000-8000-000000000006'),
  'sha256:' || repeat('a', 64),
  'reading the later revision does not change the earlier one'
);

SELECT is(
  hive.study_revision_summary_json(s) ->> 'sourceCount',
  NULL::text,
  'a missing source count stays null'
)
FROM hive.study_revisions s
WHERE s.id = 'a5e30011-0000-4000-8000-000000000011';

SELECT is(
  hive.study_revision_summary_json(s) ->> 'documentFindingCount',
  NULL::text,
  'a missing verified-fact count stays null'
)
FROM hive.study_revisions s
WHERE s.id = 'a5e30011-0000-4000-8000-000000000011';

SELECT * FROM finish();
ROLLBACK;
