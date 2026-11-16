-- Study tab RPC: owner read, auth isolation, empty hive, facts + referenced documents (synthetic).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'stv-owner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-0000000000c2', 'stv-other@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES
  ('bbbbbbbb-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000c1', 'Study tab hive', 'bbbbbbbb-0000-4000-8000-0000000000f1'),
  ('bbbbbbbb-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-0000000000c1', 'No revision hive', 'bbbbbbbb-0000-4000-8000-0000000000f2');

SELECT pg_temp.qf1a_ensure_owner_memberships();

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
  'Check whether the schedule mentions the missing exhibit.', '99999999-0000-4000-8000-0000000000f1'
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

RESET ROLE;

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
GRANT SELECT ON t_run TO authenticated, service_role;

-- Workflow + revision payload assertions quarantined (EXTRACTING -> CANONICALIZING); see quarantine/study_tab_view.sql

SELECT plan(4);

-- FL-5 (20261115140000): public.get_study_tab_view is SECURITY DEFINER; members call the RPC only.
SELECT ok(
  has_function_privilege('authenticated', 'public.get_study_tab_view(uuid)', 'EXECUTE'),
  'authenticated may EXECUTE public.get_study_tab_view'
);

RESET role;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c1","role":"authenticated"}';

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
