-- Stage 5C.2c.1a: immutable evidence pin persistence. Synthetic data only.
-- Run locally with `supabase test db`. Do not run against a live project.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(53);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('a5c2c001-0000-4000-8000-000000000001', 'pin-owner@example.test', 'authenticated', 'authenticated'),
  ('a5c2c001-0000-4000-8000-000000000002', 'pin-other@example.test', 'authenticated', 'authenticated'),
  ('a5c2c001-0000-4000-8000-000000000003', 'pin-client@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES
  ('b5c2c001-0000-4000-8000-000000000001', 'a5c2c001-0000-4000-8000-000000000001', 'Pin Hive', 'b5c2c001-0000-4000-8000-0000000000a1'),
  ('b5c2c001-0000-4000-8000-000000000002', 'a5c2c001-0000-4000-8000-000000000002', 'Other Hive', 'b5c2c001-0000-4000-8000-0000000000a2'),
  ('b5c2c001-0000-4000-8000-000000000003', 'a5c2c001-0000-4000-8000-000000000001', 'Delete Hive', 'b5c2c001-0000-4000-8000-0000000000a3');

SELECT pg_temp.qf1a_ensure_owner_memberships();

INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by)
VALUES (
  'b5c2c001-0000-4000-8000-000000000001',
  'a5c2c001-0000-4000-8000-000000000003',
  'client',
  'active',
  'a5c2c001-0000-4000-8000-000000000001'
);

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, page_count
)
VALUES
  ('c5c2c001-0000-4000-8000-000000000001', 'b5c2c001-0000-4000-8000-000000000001',
   'a5c2c001-0000-4000-8000-000000000001', 'north.pdf', 'application/pdf', 128, repeat('a', 64),
   'hive-source-documents', 'synthetic/pin-north.pdf', 'UPLOADED', 'ACTIVE', 2),
  ('c5c2c001-0000-4000-8000-000000000002', 'b5c2c001-0000-4000-8000-000000000002',
   'a5c2c001-0000-4000-8000-000000000002', 'other.pdf', 'application/pdf', 128, repeat('b', 64),
   'hive-source-documents', 'synthetic/pin-other.pdf', 'UPLOADED', 'ACTIVE', 2),
  ('c5c2c001-0000-4000-8000-000000000003', 'b5c2c001-0000-4000-8000-000000000003',
   'a5c2c001-0000-4000-8000-000000000001', 'delete.pdf', 'application/pdf', 128, repeat('d', 64),
   'hive-source-documents', 'synthetic/pin-delete.pdf', 'UPLOADED', 'ACTIVE', 2);

INSERT INTO hive.document_pages (
  hive_id, source_document_id, source_sha256, read_fingerprint, page_set_digest,
  page_count, page_number, page_text, page_text_sha256, page_byte_length,
  extraction_method, extraction_status, provenance_json
)
SELECT docs.hive_id, docs.doc_id, docs.sha, docs.fingerprint,
       hive.compute_page_set_digest(docs.sha, 2, (
         SELECT jsonb_agg(jsonb_build_object(
                  'page_number', p.n,
                  'page_text_sha256', 'sha256:' || encode(sha256(convert_to(p.t, 'UTF8')), 'hex')
                ) ORDER BY p.n)
           FROM (VALUES (1, 'North page one.'), (2, 'South page two.')) AS p(n, t)
       )),
       2, page.n, page.t,
       'sha256:' || encode(sha256(convert_to(page.t, 'UTF8')), 'hex'),
       octet_length(convert_to(page.t, 'UTF8')),
       'pdf_native', 'SUCCEEDED', jsonb_build_object('synthetic', true)
  FROM (
    VALUES
      ('b5c2c001-0000-4000-8000-000000000001'::uuid, 'c5c2c001-0000-4000-8000-000000000001'::uuid, repeat('a', 64), repeat('1', 64)),
      ('b5c2c001-0000-4000-8000-000000000002'::uuid, 'c5c2c001-0000-4000-8000-000000000002'::uuid, repeat('b', 64), repeat('2', 64)),
      ('b5c2c001-0000-4000-8000-000000000003'::uuid, 'c5c2c001-0000-4000-8000-000000000003'::uuid, repeat('d', 64), repeat('3', 64))
  ) AS docs(hive_id, doc_id, sha, fingerprint)
  CROSS JOIN (VALUES (1, 'North page one.'), (2, 'South page two.')) AS page(n, t);

INSERT INTO hive.doc_extractions (
  id, hive_id, source_document_id, content_digest, prompt_id, prompt_digest, model_alias, extraction, stats
)
SELECT ids.id, docs.hive_id, docs.doc_id, 'sha256:' || docs.sha, 'hive-extract/1', 'sha256:' || repeat('p', 64), 'synthetic',
       jsonb_build_object(
         'schema', 'hive.doc-extraction/1',
         'documentId', docs.doc_id,
         'facts', jsonb_build_array(
           jsonb_build_object(
             'id', 'F-1',
             'valueAsWritten', 'North page one.',
             'evidence', jsonb_build_array(jsonb_build_object('page', 1, 'quote', 'North page one.'))
           ),
           jsonb_build_object(
             'id', 'F-2',
             'valueAsWritten', 'South page two.',
             'evidence', jsonb_build_array(jsonb_build_object('page', 2, 'quote', 'South page two.'))
           )
         )
       ),
       '{}'::jsonb
  FROM (
    VALUES
      ('e5c2c001-0000-4000-8000-000000000001'::uuid, 'b5c2c001-0000-4000-8000-000000000001'::uuid, 'c5c2c001-0000-4000-8000-000000000001'::uuid, repeat('a', 64)),
      ('e5c2c001-0000-4000-8000-000000000002'::uuid, 'b5c2c001-0000-4000-8000-000000000002'::uuid, 'c5c2c001-0000-4000-8000-000000000002'::uuid, repeat('b', 64)),
      ('e5c2c001-0000-4000-8000-000000000003'::uuid, 'b5c2c001-0000-4000-8000-000000000003'::uuid, 'c5c2c001-0000-4000-8000-000000000003'::uuid, repeat('d', 64))
  ) AS docs(id, hive_id, doc_id, sha)
  JOIN (VALUES
      ('e5c2c001-0000-4000-8000-000000000001'::uuid),
      ('e5c2c001-0000-4000-8000-000000000002'::uuid),
      ('e5c2c001-0000-4000-8000-000000000003'::uuid)
  ) AS ids(id) ON ids.id = docs.id;

SELECT is(
  hive.canonical_json('{"b":1,"a":"say \\"hi\\""}'::jsonb),
  '{"a":"say \"hi\"","b":1}',
  'canonical json sorts keys and escapes quotes like the pin contract'
);

SELECT is(
  hive.canonical_json(jsonb_build_object(
    'schema', 'hive.relationship-verification-head/1',
    'sequence', 0,
    'causalParentId', NULL,
    'hiveId', 'hive',
    'pinId', 'pin',
    'packDigest', 'pack',
    'planDigest', 'plan',
    'evidenceRevision', jsonb_build_object(
      'extractionDigest', 'x',
      'binderDigest', 'b',
      'evidenceDigest', 'e'
    )
  )),
  '{"causalParentId":null,"evidenceRevision":{"binderDigest":"b","evidenceDigest":"e","extractionDigest":"x"},"hiveId":"hive","packDigest":"pack","pinId":"pin","planDigest":"plan","schema":"hive.relationship-verification-head/1","sequence":0}',
  'sequence-zero chain head canonical preimage matches the persistence contract'
);

SELECT is(
  hive.investigation_evidence_canonical(
    '{"schema":"s","facts":[{"id":"b"},{"id":"a"}]}'::jsonb,
    '{"schema":"u","candidates":[]}'::jsonb
  ),
  '{"unresolved":{"candidates":[],"schema":"u"},"verified":{"facts":[{"id":"a"},{"id":"b"}],"schema":"s"}}',
  'evidence canonical preimage sorts fact ids and does not depend on input order'
);

CREATE FUNCTION pg_temp.pin_payload(
  p_doc uuid,
  p_sha text,
  p_fingerprint text,
  p_extraction uuid,
  p_fact_id text,
  p_value_override text,
  p_page_override text,
  p_plan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_pages jsonb;
  v_set text;
  v_generations jsonb;
  v_verified jsonb;
  v_unresolved jsonb;
  v_pack text;
  v_plan text;
  v_pin jsonb;
  v_pin_text text;
  v_fact jsonb;
  v_refs jsonb;
  v_value text;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'pageNumber', p.page_number,
           'pageTextSha256', p.page_text_sha256
         ) ORDER BY p.page_number),
         min(p.page_set_digest)
    INTO v_pages, v_set
    FROM hive.document_pages p
   WHERE p.source_document_id = p_doc;

  SELECT elem INTO v_fact
    FROM hive.doc_extractions e
    CROSS JOIN jsonb_array_elements(e.extraction->'facts') AS elem
   WHERE e.id = p_extraction
     AND elem->>'id' = p_fact_id;
  v_value := coalesce(p_value_override, hive.normalize_quote_text(v_fact->>'valueAsWritten'));
  IF p_page_override IS NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'documentId', p_doc,
             'excerptId', p_fact_id,
             'page', ev->>'page'
           ) ORDER BY ev->>'page'), '[]'::jsonb)
      INTO v_refs
      FROM jsonb_array_elements(v_fact->'evidence') AS ev;
  ELSE
    v_refs := jsonb_build_array(jsonb_build_object(
      'documentId', p_doc,
      'excerptId', p_fact_id,
      'page', p_page_override
    ));
  END IF;

  v_generations := jsonb_build_array(jsonb_build_object(
    'pageCount', jsonb_array_length(v_pages),
    'pageSetDigest', v_set,
    'pages', v_pages,
    'readFingerprint', p_fingerprint,
    'sourceDocumentId', p_doc,
    'sourceSha256', p_sha
  ));
  v_verified := jsonb_build_object(
    'conflicts', '[]'::jsonb,
    'coverage', 'INCOMPLETE',
    'documents', '[]'::jsonb,
    'facts', jsonb_build_array(jsonb_build_object(
      'entityId', 'entity.one',
      'fieldId', 'field.one',
      'id', p_fact_id,
      'instanceId', 'inst-1',
      'sourceRefs', v_refs,
      'status', 'VERIFIED',
      'value', jsonb_build_object('value', v_value, 'valueType', 'TEXT')
    )),
    'relationships', '[]'::jsonb,
    'schema', 'hive.verified-case-facts/1'
  );
  v_unresolved := jsonb_build_object(
    'candidates', '[]'::jsonb,
    'schema', 'hive.investigation-unresolved-candidates/1'
  );
  v_pack := hive.canonical_json(jsonb_build_object(
    'identity', jsonb_build_object('packId', 'pack.test', 'version', '0.0.1'),
    'schema', 'hive.domain-pack-runtime/1'
  ));
  v_plan := hive.canonical_json(p_plan);
  v_pin := jsonb_build_object(
    'artifacts', jsonb_build_object(
      'pack', jsonb_build_object(
        'digest', hive.sha256_hex(v_pack),
        'packId', 'pack.test',
        'retrieval', 'CONTENT_DIGEST',
        'schema', 'hive.domain-pack-runtime/1',
        'version', '0.0.1'
      ),
      'plan', jsonb_build_object(
        'digest', hive.sha256_hex(v_plan),
        'retrieval', 'CONTENT_DIGEST',
        'schema', 'hive.domain-investigation-plan/1'
      )
    ),
    'binderDigest', hive.sha256_hex(hive.canonical_json(jsonb_build_object('unresolved', v_unresolved, 'verified', v_verified))),
    'evidenceDigest', hive.sha256_hex(hive.investigation_evidence_canonical(v_verified, v_unresolved)),
    'extractionDigest', hive.sha256_hex(hive.authorized_extraction_canonical(ARRAY[p_extraction])),
    'schema', 'hive.investigation-evidence-pin/1',
    'sourceGenerations', v_generations,
    'sourceGenerationsDigest', hive.sha256_hex(hive.canonical_json(v_generations)),
    'unresolved', v_unresolved,
    'verified', v_verified
  );
  v_pin_text := hive.canonical_json(v_pin);
  RETURN jsonb_build_object(
    'pack', v_pack,
    'plan', v_plan,
    'pin', v_pin_text,
    'extractionId', p_extraction
  );
END;
$$;

CREATE FUNCTION public.hfy_test_pin_create(p_hive uuid, p_owner uuid, p_request uuid, p_key text)
RETURNS json
LANGUAGE plpgsql
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_payload jsonb := current_setting(p_key)::jsonb;
BEGIN
  RETURN public.create_investigation_evidence_pin(
    p_hive,
    p_owner,
    p_request,
    v_payload->>'pin',
    v_payload->>'pack',
    v_payload->>'plan',
    ARRAY[(v_payload->>'extractionId')::uuid]
  );
END;
$$;

SELECT is(
  hive.authorized_extraction_canonical(ARRAY['e5c2c001-0000-4000-8000-000000000001'::uuid]),
  '[{"documentId":"c5c2c001-0000-4000-8000-000000000001","facts":[{"evidence":[{"page":1,"quote":"North page one."}],"id":"F-1","valueAsWritten":"North page one."},{"evidence":[{"page":2,"quote":"South page two."}],"id":"F-2","valueAsWritten":"South page two."}]}]',
  'authorized extraction canonical preimage matches the binder digest projection'
);

SELECT set_config('app.pin_a', pg_temp.pin_payload(
  'c5c2c001-0000-4000-8000-000000000001', repeat('a', 64), repeat('1', 64),
  'e5c2c001-0000-4000-8000-000000000001', 'F-1', NULL, NULL,
  '{"schema":"hive.domain-investigation-plan/1"}'::jsonb
)::text, false);
SELECT set_config('app.pin_b', pg_temp.pin_payload(
  'c5c2c001-0000-4000-8000-000000000002', repeat('b', 64), repeat('2', 64),
  'e5c2c001-0000-4000-8000-000000000002', 'F-1', NULL, NULL,
  '{"schema":"hive.domain-investigation-plan/1"}'::jsonb
)::text, false);
SELECT set_config('app.pin_d', pg_temp.pin_payload(
  'c5c2c001-0000-4000-8000-000000000003', repeat('d', 64), repeat('3', 64),
  'e5c2c001-0000-4000-8000-000000000003', 'F-1', NULL, NULL,
  '{"note":"hive-d","schema":"hive.domain-investigation-plan/1"}'::jsonb
)::text, false);
SELECT set_config('app.pin_conflict', pg_temp.pin_payload(
  'c5c2c001-0000-4000-8000-000000000001', repeat('a', 64), repeat('1', 64),
  'e5c2c001-0000-4000-8000-000000000001', 'F-2', NULL, NULL,
  '{"schema":"hive.domain-investigation-plan/1"}'::jsonb
)::text, false);
SELECT set_config('app.pin_bad_generation', pg_temp.pin_payload(
  'c5c2c001-0000-4000-8000-000000000001', repeat('a', 64), repeat('9', 64),
  'e5c2c001-0000-4000-8000-000000000001', 'F-1', NULL, NULL,
  '{"schema":"hive.domain-investigation-plan/1"}'::jsonb
)::text, false);
SELECT set_config('app.pin_missing', pg_temp.pin_payload(
  'c5c2c001-0000-4000-8000-000000000001', repeat('a', 64), repeat('1', 64),
  'e5c2c001-0000-4000-8000-000000000001', 'F-1', NULL, '9',
  '{"schema":"hive.domain-investigation-plan/1"}'::jsonb
)::text, false);
SELECT set_config('app.pin_invented', pg_temp.pin_payload(
  'c5c2c001-0000-4000-8000-000000000001', repeat('a', 64), repeat('1', 64),
  'e5c2c001-0000-4000-8000-000000000001', 'F-1', 'SECRET QUOTATION', NULL,
  '{"schema":"hive.domain-investigation-plan/1"}'::jsonb
)::text, false);

SELECT ok(
  NOT has_table_privilege('authenticated', 'hive.investigation_evidence_pins', 'SELECT'),
  'authenticated cannot read pin rows'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'hive.investigation_evidence_pins', 'INSERT'),
  'authenticated cannot insert pin rows'
);
SELECT ok(
  NOT has_table_privilege('anon', 'hive.investigation_artifact_preimages', 'SELECT'),
  'anon cannot read artifact preimages'
);
SELECT ok(
  NOT has_table_privilege('service_role', 'hive.investigation_evidence_pins', 'INSERT'),
  'service role cannot bypass the pin RPC'
);
SELECT ok(
  has_function_privilege('service_role', 'public.create_investigation_evidence_pin(uuid,uuid,uuid,text,text,text,uuid[])', 'EXECUTE'),
  'service role can execute pin creation'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.create_investigation_evidence_pin(uuid,uuid,uuid,text,text,text,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.create_investigation_evidence_pin(uuid,uuid,uuid,text,text,text,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.create_investigation_evidence_pin(uuid,uuid,uuid,text,text,text,uuid[])', 'EXECUTE'),
  'authenticated, anon, and public cannot execute pin creation'
);
SELECT ok(
  position('pg_advisory_xact_lock' IN pg_get_functiondef('public.create_investigation_evidence_pin(uuid,uuid,uuid,text,text,text,uuid[])'::regprocedure)) > 0
  AND position('FOR UPDATE' IN pg_get_functiondef('public.create_investigation_evidence_pin(uuid,uuid,uuid,text,text,text,uuid[])'::regprocedure)) > 0
  AND position('require_service_role' IN pg_get_functiondef('public.create_investigation_evidence_pin(uuid,uuid,uuid,text,text,text,uuid[])'::regprocedure)) > 0,
  'pin creation is service-role only and locks the Hive row'
);

REVOKE ALL ON FUNCTION public.hfy_test_pin_create(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hfy_test_pin_create(uuid, uuid, uuid, text) TO service_role;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT set_config('app.receipt', public.hfy_test_pin_create(
  'b5c2c001-0000-4000-8000-000000000001',
  'a5c2c001-0000-4000-8000-000000000001',
  'd5c2c001-0000-4000-8000-000000000001',
  'app.pin_a'
)::text, false);

SELECT is(current_setting('app.receipt')::json->>'outcome', 'created', 'first pin insert is created');
SELECT is(current_setting('app.receipt')::json->'chainHead'->>'sequence', '0', 'chain head sequence is zero');
SELECT ok(current_setting('app.receipt')::json->'chainHead'->>'causalParentId' IS NULL, 'chain head has no causal parent');
SELECT ok(position('SECRET QUOTATION' IN current_setting('app.receipt')) = 0, 'receipt does not return the quotation');
SELECT ok(position('North page one.' IN current_setting('app.receipt')) = 0, 'receipt does not return page text');

SELECT is(
  (public.hfy_test_pin_create(
    'b5c2c001-0000-4000-8000-000000000001',
    'a5c2c001-0000-4000-8000-000000000001',
    'd5c2c001-0000-4000-8000-000000000001',
    'app.pin_a'
  )->>'outcome'),
  'replayed',
  'same request and same pin replays'
);

SELECT is(
  (public.hfy_test_pin_create(
    'b5c2c001-0000-4000-8000-000000000001',
    'a5c2c001-0000-4000-8000-000000000001',
    'd5c2c001-0000-4000-8000-000000000002',
    'app.pin_a'
  )->>'outcome'),
  'aliased',
  'a new request for the existing pin aliases it'
);

SELECT throws_ok(
  $$SELECT public.hfy_test_pin_create(
      'b5c2c001-0000-4000-8000-000000000001',
      'a5c2c001-0000-4000-8000-000000000001',
      'd5c2c001-0000-4000-8000-000000000001',
      'app.pin_conflict'
    )$$,
  'P0001',
  'idempotency_conflict',
  'same request and a different body conflicts'
);

SELECT throws_ok(
  $$SELECT public.hfy_test_pin_create(
      'b5c2c001-0000-4000-8000-000000000001',
      'a5c2c001-0000-4000-8000-000000000001',
      'd5c2c001-0000-4000-8000-00000000000c',
      'app.pin_bad_generation'
    )$$,
  'P0001',
  'source_generation_mismatch',
  'a read fingerprint that does not match the stored generation is rejected'
);

SELECT throws_ok(
  $$SELECT public.hfy_test_pin_create(
      'b5c2c001-0000-4000-8000-000000000001',
      'a5c2c001-0000-4000-8000-000000000001',
      'd5c2c001-0000-4000-8000-000000000003',
      'app.pin_missing'
    )$$,
  'P0001',
  'incomplete_evidence',
  'a source page that is not in the retained generation is incomplete evidence'
);

SELECT throws_ok(
  $$SELECT public.hfy_test_pin_create(
      'b5c2c001-0000-4000-8000-000000000001',
      'a5c2c001-0000-4000-8000-000000000001',
      'd5c2c001-0000-4000-8000-000000000004',
      'app.pin_b'
    )$$,
  'P0001',
  'unauthorized_source',
  'another Hive''s document cannot be pinned here'
);

SELECT throws_ok(
  $$SELECT public.create_investigation_evidence_pin(
      'b5c2c001-0000-4000-8000-000000000001',
      'a5c2c001-0000-4000-8000-000000000001',
      'd5c2c001-0000-4000-8000-000000000005',
      current_setting('app.pin_a')::jsonb->>'pin',
      '{"schema":"hive.domain-pack-runtime/1","identity":{"packId":"pack.test","version":"0.0.1"}}',
      current_setting('app.pin_a')::jsonb->>'plan',
      ARRAY[(current_setting('app.pin_a')::jsonb->>'extractionId')::uuid]
    )$$,
  'P0001',
  'artifact_preimage_invalid',
  'a non-canonical pack preimage is rejected'
);

SELECT throws_ok(
  $$SELECT public.hfy_test_pin_create(
      'b5c2c001-0000-4000-8000-000000000001',
      'a5c2c001-0000-4000-8000-000000000001',
      'd5c2c001-0000-4000-8000-000000000010',
      'app.pin_invented'
    )$$,
  'P0001',
  'untrusted_verified_fact',
  'a self-consistent fact that is not the stored extraction fact is rejected'
);

SELECT throws_ok(
  $$SELECT public.hfy_test_pin_create(
      'b5c2c001-0000-4000-8000-000000000001',
      'a5c2c001-0000-4000-8000-000000000002',
      'd5c2c001-0000-4000-8000-000000000006',
      'app.pin_a'
    )$$,
  'P0002',
  'hive_not_found',
  'a service call for another owner cannot pin this Hive'
);

SELECT is(
  (public.hfy_test_pin_create(
    'b5c2c001-0000-4000-8000-000000000002',
    'a5c2c001-0000-4000-8000-000000000002',
    'd5c2c001-0000-4000-8000-000000000007',
    'app.pin_b'
  )->>'outcome'),
  'created',
  'the named owner can pin only their own Hive'
);

SELECT throws_ok(
  $$SELECT public.hfy_test_pin_create(
      'b5c2c001-0000-4000-8000-000000000001',
      'a5c2c001-0000-4000-8000-000000000003',
      'd5c2c001-0000-4000-8000-000000000008',
      'app.pin_a'
    )$$,
  'P0002',
  'hive_not_found',
  'a client member is not the Hive owner'
);

RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a5c2c001-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT public.create_investigation_evidence_pin(
      'b5c2c001-0000-4000-8000-000000000001',
      'a5c2c001-0000-4000-8000-000000000001',
      'd5c2c001-0000-4000-8000-000000000009',
      current_setting('app.pin_a')::jsonb->>'pin',
      current_setting('app.pin_a')::jsonb->>'pack',
      current_setting('app.pin_a')::jsonb->>'plan',
      ARRAY['e5c2c001-0000-4000-8000-000000000001'::uuid]
    )$$,
  '42501',
  'permission denied',
  'an authenticated caller cannot invoke pin creation'
);

SELECT throws_ok(
  $$INSERT INTO hive.investigation_evidence_pins (hive_id, owner_user_id, pin_id, pack_digest, plan_digest, extraction_digest, binder_digest, evidence_digest, source_generations_digest, canonical_json, verified, unresolved, source_generations)
    VALUES ('b5c2c001-0000-4000-8000-000000000001', 'a5c2c001-0000-4000-8000-000000000003', repeat('a', 64), repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('d', 64), repeat('e', 64), repeat('f', 64), '{}', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb)$$,
  '42501',
  NULL,
  'authenticated direct insert is rejected'
);

RESET role;

SELECT is(
  (SELECT count(*)::int FROM hive.investigation_evidence_pins WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000001'),
  1,
  'conflict and failed writes leave one pin'
);
SELECT is(
  (SELECT count(*)::int FROM hive.investigation_evidence_pin_requests WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000001'),
  2,
  'the original request and its alias are the only request rows'
);
SELECT is(
  (SELECT count(*)::int FROM hive.relationship_verification_chain WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000001'),
  1,
  'alias and replay do not append another chain head'
);
SELECT is(
  (SELECT count(*)::int FROM hive.investigation_evidence_pin_pages WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000001'),
  2,
  'both pages of the cited generation are retained'
);
SELECT ok(
  position('North page one.' IN (SELECT canonical_json FROM hive.investigation_evidence_pins WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000001')) > 0,
  'the quotation stays in authorized Hive pin storage'
);
SELECT ok(
  position('SECRET QUOTATION' IN (SELECT string_agg(safe_metadata::text, '') FROM hive.audit_events WHERE case_id = 'b5c2c001-0000-4000-8000-000000000001')) = 0
  AND position('North page one.' IN (SELECT string_agg(safe_metadata::text, '') FROM hive.audit_events WHERE case_id = 'b5c2c001-0000-4000-8000-000000000001')) = 0,
  'audit metadata stores digests without page text or quotations'
);
SELECT is(
  (SELECT count(*)::int FROM hive.investigation_artifact_preimages),
  2,
  'the shared pack and plan preimages are stored once'
);

SELECT throws_ok(
  $$UPDATE hive.investigation_evidence_pins SET evidence_digest = repeat('0', 64) WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000001'$$,
  'P0001',
  'evidence_pin_immutable',
  'a stored pin cannot be updated'
);
SELECT throws_ok(
  $$DELETE FROM hive.investigation_evidence_pins WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000001'$$,
  'P0001',
  'evidence_pin_immutable',
  'a stored pin cannot be deleted outside Hive deletion'
);
SELECT throws_ok(
  $$DELETE FROM hive.document_pages WHERE source_document_id = 'c5c2c001-0000-4000-8000-000000000001' AND page_number = 1$$,
  'P0001',
  'pinned_page_generation_retained',
  'a referenced page generation cannot be deleted while the pin remains'
);
SELECT throws_ok(
  $$DELETE FROM hive.source_documents WHERE id = 'c5c2c001-0000-4000-8000-000000000001'$$,
  'P0001',
  'pinned_page_generation_retained',
  'deleting the source document cannot remove a pinned generation'
);
SELECT throws_ok(
  $$DO $e$ BEGIN
      PERFORM set_config('hive.evidence_pin_lifecycle', 'insert', true);
      INSERT INTO hive.investigation_artifact_preimages (digest, kind, schema_id, pack_id, version, canonical_json)
      VALUES (repeat('a', 64), 'PACK', 'hive.domain-pack-runtime/1', 'pack.test', '0.0.1', '{"schema":"no"}');
    END $e$$,
  '23514',
  NULL,
  'an artifact digest that does not match its preimage is rejected'
);
SELECT throws_ok(
  $$DO $e$ BEGIN
      PERFORM set_config('hive.evidence_pin_lifecycle', 'insert', true);
      INSERT INTO hive.investigation_evidence_pin_requests (hive_id, request_id, pin_id, outcome)
      SELECT hive_id, request_id, pin_id, 'created'
        FROM hive.investigation_evidence_pin_requests
       WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000001'
         AND request_id = 'd5c2c001-0000-4000-8000-000000000001';
    END $e$$,
  '23505',
  NULL,
  'a concurrent duplicate request cannot insert a second row'
);
SELECT throws_ok(
  $$DO $e$ BEGIN
      PERFORM set_config('hive.evidence_pin_lifecycle', 'insert', true);
      INSERT INTO hive.relationship_verification_chain (
        hive_id, pin_id, sequence, record_id, causal_parent_id, canonical_json,
        pack_digest, plan_digest, extraction_digest, binder_digest, evidence_digest
      )
      SELECT hive_id, pin_id, 1, repeat('a', 64), record_id, canonical_json,
             pack_digest, plan_digest, extraction_digest, binder_digest, evidence_digest
        FROM hive.relationship_verification_chain
       WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000001';
    END $e$$,
  'P0001',
  'verification_append_unavailable',
  'a decision append is rejected in this gate'
);

SET LOCAL role service_role;
SELECT throws_ok(
  $$INSERT INTO hive.investigation_evidence_pins (hive_id, owner_user_id, pin_id, pack_digest, plan_digest, extraction_digest, binder_digest, evidence_digest, source_generations_digest, canonical_json, verified, unresolved, source_generations)
    VALUES ('b5c2c001-0000-4000-8000-000000000001', 'a5c2c001-0000-4000-8000-000000000001', repeat('9', 64), repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('d', 64), repeat('e', 64), repeat('f', 64), '{}', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb)$$,
  '42501',
  NULL,
  'service role direct insert is rejected'
);
RESET role;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT is(
  (public.hfy_test_pin_create(
    'b5c2c001-0000-4000-8000-000000000003',
    'a5c2c001-0000-4000-8000-000000000001',
    'd5c2c001-0000-4000-8000-00000000000a',
    'app.pin_d'
  )->>'outcome'),
  'created',
  'a second Hive stores its own pin'
);
RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a5c2c001-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT is(
  (public.begin_hive_deletion('b5c2c001-0000-4000-8000-000000000003')->>'deletion_stage'),
  'marked',
  'owner can mark the Hive for deletion'
);
RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT throws_ok(
  $$SELECT public.hfy_test_pin_create(
      'b5c2c001-0000-4000-8000-000000000003',
      'a5c2c001-0000-4000-8000-000000000001',
      'd5c2c001-0000-4000-8000-00000000000b',
      'app.pin_d'
    )$$,
  'P0002',
  'hive_not_found',
  'a deleting Hive accepts no new pin'
);
RESET role;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a5c2c001-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$DELETE FROM hive.document_pages WHERE source_document_id = 'c5c2c001-0000-4000-8000-000000000003'$$,
  '42501',
  NULL,
  'the owner still cannot delete a pinned generation directly'
);

RESET role;
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT is(
  (public.complete_hive_deletion('b5c2c001-0000-4000-8000-000000000003')->>'deleted')::boolean,
  true,
  'authorized Hive deletion removes the pin and its pages'
);
RESET role;
SELECT is((SELECT count(*)::int FROM hive.investigation_evidence_pins WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000003'), 0,
  'the deleted Hive has no pin');
SELECT is((SELECT count(*)::int FROM hive.document_pages WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000003'), 0,
  'page generations are removed with the Hive after the pin is removed');
SELECT is((SELECT count(*)::int FROM hive.investigation_evidence_pins WHERE hive_id = 'b5c2c001-0000-4000-8000-000000000001'), 1,
  'another Hive''s pin remains');
SELECT ok(
  EXISTS (
    SELECT 1 FROM hive.investigation_artifact_preimages
     WHERE kind = 'PACK' AND pack_id = 'pack.test'
  )
  AND NOT EXISTS (
    SELECT 1 FROM hive.investigation_artifact_preimages
     WHERE canonical_json LIKE '%hive-d%'
  ),
  'unreferenced plan preimages are removed and the shared pack preimage remains'
);

SELECT finish();
ROLLBACK;
