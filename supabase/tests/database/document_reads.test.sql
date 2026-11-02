-- V4-003 — Durable document reads and verified page persistence (synthetic data only).
-- Run locally with `supabase test db`; never against a live project.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(30);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'other@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES (
  'bbbbbbbb-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'Synthetic Hive',
  'bbbbbbbb-0000-4000-8000-0000000000ff'
);

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status
)
VALUES
  ('cccccccc-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-a.pdf', 'application/pdf', 2048, repeat('a', 64),
   'hive-source-documents', 'synthetic/a.pdf', 'UPLOADED', 'ACTIVE'),
  ('cccccccc-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'synthetic-b.pdf', 'application/pdf', 2048, repeat('b', 64),
   'hive-source-documents', 'synthetic/b.pdf', 'UPLOADED', 'ACTIVE');

CREATE TEMP TABLE t_pages AS
SELECT pages, hive.compute_page_set_digest(repeat('a', 64), 2, pages) AS digest
  FROM (
    SELECT jsonb_agg(
             jsonb_build_object(
               'page_number', n,
               'page_text', t,
               'page_text_sha256', 'sha256:' || encode(sha256(convert_to(t, 'UTF8')), 'hex'),
               'page_byte_length', octet_length(convert_to(t, 'UTF8')),
               'extraction_method', 'pdf_native',
               'provenance_json', jsonb_build_object('synthetic', true, 'pageNumber', n)
             )
             ORDER BY n
           ) AS pages
      FROM (VALUES (1, 'Synthetic page one.'), (2, 'Synthetic page two.')) AS v(n, t)
  ) built;
GRANT SELECT ON t_pages TO service_role;

-- ---------------------------------------------------------------------------
-- Owner starts reading; repeats never duplicate work
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (public.start_document_reads(
    'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-000000000001')->>'created')::int,
  2,
  'owner start queues one read per registered document');

SELECT is(
  (public.start_document_reads(
    'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-000000000001')->>'created')::int,
  0,
  'replaying the same request creates nothing');

SELECT is(
  json_array_length(public.start_document_reads(
    'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-000000000001')->'queuedReadIds'),
  2,
  'replay returns the same queued read ids');

SELECT is(
  (public.start_document_reads(
    'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002',
    'eeeeeeee-0000-4000-8000-000000000002')->>'created')::int,
  0,
  'a new click while reads are active does not start duplicate reads');

SELECT is(
  (SELECT count(*)::int FROM hive.document_reads),
  2,
  'owner sees exactly two read attempts');

SELECT is(
  (SELECT array_agg(r->>'status' ORDER BY r->>'sourceDocumentId')
     FROM json_array_elements(
       public.list_document_reads('bbbbbbbb-0000-4000-8000-000000000001')->'documentReads') r),
  ARRAY['QUEUED', 'QUEUED'],
  'list returns the durable QUEUED status for both documents');

SELECT throws_ok(
  $$ SELECT public.transition_document_read(
       (SELECT id FROM hive.document_reads LIMIT 1), 'QUEUED', 'READING', '{}'::jsonb) $$,
  '42501',
  NULL,
  'owners cannot advance read status themselves');

-- ---------------------------------------------------------------------------
-- Another user is denied
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT public.start_document_reads(
       'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000009',
       'eeeeeeee-0000-4000-8000-000000000009') $$,
  'P0002',
  'hive_not_found',
  'another user cannot start reads in the Hive');

SELECT throws_ok(
  $$ SELECT public.list_document_reads('bbbbbbbb-0000-4000-8000-000000000001') $$,
  'P0002',
  'hive_not_found',
  'another user cannot list reads in the Hive');

SELECT is((SELECT count(*)::int FROM hive.document_reads), 0, 'RLS hides reads from another user');

RESET role;
SET LOCAL role anon;
SELECT throws_ok(
  $$ SELECT public.start_document_reads(
       'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000009',
       'eeeeeeee-0000-4000-8000-000000000009') $$,
  '42501',
  NULL,
  'anonymous callers cannot start reads');

-- ---------------------------------------------------------------------------
-- Server advances document A; success requires verified persisted pages
-- ---------------------------------------------------------------------------
RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT throws_ok(
  $$ SELECT public.transition_document_read(
       (SELECT id FROM hive.document_reads WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a'),
       'QUEUED', 'SAVING', '{}'::jsonb) $$,
  'P0001',
  'document_read_transition_invalid',
  'illegal transitions are rejected');

SELECT is(
  (public.transition_document_read(
     (SELECT id FROM hive.document_reads WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a'),
     'READING', 'SAVING', '{}'::jsonb)->>'applied')::boolean,
  false,
  'a stale compare-and-set is not applied');

SELECT is(
  public.transition_document_read(
    (SELECT id FROM hive.document_reads WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a'),
    'QUEUED', 'READING', '{}'::jsonb)->'source'->>'storage_path',
  'synthetic/a.pdf',
  'claiming READING returns the stored file to read');

SELECT is(
  (public.transition_document_read(
     (SELECT id FROM hive.document_reads WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a'),
     'QUEUED', 'READING', '{}'::jsonb)->>'applied')::boolean,
  false,
  'a second claim of the same read is refused');

SELECT is(
  (public.transition_document_read(
     (SELECT id FROM hive.document_reads WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a'),
     'READING', 'SAVING',
     jsonb_build_object('total_physical_pages', 2, 'read_fingerprint', 'reader-document-read@1:synthetic'))->>'applied')::boolean,
  true,
  'READING advances to SAVING');

SELECT is(
  (public.put_document_pages(
     'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-00000000000a', repeat('a', 64),
     'reader-document-read@1:synthetic', (SELECT digest FROM t_pages), 'SUCCEEDED', 2, 2,
     (SELECT pages FROM t_pages))->>'inserted_count')::int,
  2,
  'both pages are saved');

SELECT is(
  (SELECT read_status FROM hive.source_documents WHERE id = 'cccccccc-0000-4000-8000-00000000000a'),
  'PENDING',
  'saving pages alone does not mark the document read');

SELECT is(
  (public.transition_document_read(
     (SELECT id FROM hive.document_reads WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a'),
     'SAVING', 'VERIFYING', jsonb_build_object('saved_page_count', 2))->>'applied')::boolean,
  true,
  'SAVING advances to VERIFYING');

SELECT throws_ok(
  format(
    $$ SELECT public.transition_document_read(
         (SELECT id FROM hive.document_reads WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a'),
         'VERIFYING', 'SUCCEEDED', jsonb_build_object('page_set_digest', %L, 'verified_page_count', 3)) $$,
    (SELECT digest FROM t_pages)),
  'P0001',
  'page_generation_incomplete',
  'success is refused when the verified count does not match the saved pages');

SELECT throws_ok(
  $$ SELECT public.transition_document_read(
       (SELECT id FROM hive.document_reads WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a'),
       'VERIFYING', 'SUCCEEDED',
       jsonb_build_object('page_set_digest', 'sha256:' || repeat('0', 64), 'verified_page_count', 2)) $$,
  'P0001',
  'page_generation_incomplete',
  'success is refused for a page set that was never saved');

SELECT is(
  (SELECT array_agg((p->>'page_number')::int || ':' || (p->>'page_text_sha256')
                    ORDER BY (p->>'page_number')::int)
     FROM json_array_elements(public.list_document_pages(
       'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-00000000000a',
       'reader-document-read@1:synthetic', (SELECT digest FROM t_pages))->'pages') p),
  (SELECT array_agg((p->>'page_number')::int || ':' || (p->>'page_text_sha256')
                    ORDER BY (p->>'page_number')::int)
     FROM jsonb_array_elements((SELECT pages FROM t_pages)) p),
  'pages read back in order with the hashes that were written');

SELECT is(
  (public.transition_document_read(
     (SELECT id FROM hive.document_reads WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a'),
     'VERIFYING', 'SUCCEEDED',
     jsonb_build_object('page_set_digest', (SELECT digest FROM t_pages), 'verified_page_count', 2))->>'applied')::boolean,
  true,
  'success is recorded once the saved pages are verified');

SELECT is(
  (SELECT read_status || ':' || page_count FROM hive.source_documents
    WHERE id = 'cccccccc-0000-4000-8000-00000000000a'),
  'SUCCEEDED:2',
  'the document read outcome and page count are durable');

SELECT throws_ok(
  $$ SELECT public.transition_document_read(
       (SELECT id FROM hive.document_reads WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000a'),
       'SUCCEEDED', 'FAILED', '{}'::jsonb) $$,
  'P0001',
  'document_read_finished',
  'finished reads are immutable');

-- ---------------------------------------------------------------------------
-- Document B: a lapsed lease becomes a retryable failure; retry; unreadable
-- ---------------------------------------------------------------------------
RESET role;
UPDATE hive.document_reads
   SET lease_expires_at = now() - interval '1 second'
 WHERE source_document_id = 'cccccccc-0000-4000-8000-00000000000b';

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT r->>'status' || ':' || (r->>'retryable') || ':' || (r->>'errorCode')
     FROM json_array_elements(
       public.list_document_reads('bbbbbbbb-0000-4000-8000-000000000001')->'documentReads') r
    WHERE r->>'sourceDocumentId' = 'cccccccc-0000-4000-8000-00000000000b'),
  'FAILED:true:PAGE_READ_FAILED',
  'a read whose lease lapsed is reported as a retryable failure');

SELECT is(
  (public.start_document_reads(
    'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000003',
    'eeeeeeee-0000-4000-8000-000000000003',
    ARRAY['cccccccc-0000-4000-8000-00000000000b']::uuid[])->>'created')::int,
  1,
  'retrying the failed document queues a new attempt for it only');

RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT is(
  (SELECT (public.transition_document_read(r.id, 'QUEUED', 'READING', '{}'::jsonb)->>'applied')::boolean
     FROM hive.document_reads r
    WHERE r.source_document_id = 'cccccccc-0000-4000-8000-00000000000b' AND r.attempt_number = 2),
  true,
  'the retry attempt can be claimed');

SELECT is(
  (SELECT public.transition_document_read(
            r.id, 'READING', 'UNREADABLE',
            jsonb_build_object(
              'error_code', 'DOCUMENT_UNREADABLE',
              'error_message_safe', 'We couldn''t find readable text in this document.',
              'retryable', false))->'documentRead'->>'status'
     FROM hive.document_reads r
    WHERE r.source_document_id = 'cccccccc-0000-4000-8000-00000000000b' AND r.attempt_number = 2),
  'UNREADABLE',
  'a Reader rejection records the document as unreadable');

RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (public.start_document_reads(
    'bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000004',
    'eeeeeeee-0000-4000-8000-000000000004')->>'created')::int,
  0,
  'read and unreadable documents are not read again');

SELECT * FROM finish();
ROLLBACK;
