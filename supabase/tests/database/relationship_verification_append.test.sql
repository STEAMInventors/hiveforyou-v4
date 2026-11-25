-- Stage 5C.2c.2a: append-only relationship verification. Synthetic data only.
-- Run locally with `supabase test db`. Do not run against a live project.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(70);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('a5c2d001-0000-4000-8000-000000000001', 'rel-owner@example.test', 'authenticated', 'authenticated'),
  ('a5c2d001-0000-4000-8000-000000000002', 'rel-other@example.test', 'authenticated', 'authenticated'),
  ('a5c2d001-0000-4000-8000-000000000003', 'rel-client@example.test', 'authenticated', 'authenticated');

INSERT INTO hive.hives (id, owner_user_id, name, client_request_id)
VALUES
  ('b5c2d001-0000-4000-8000-000000000001', 'a5c2d001-0000-4000-8000-000000000001', 'Relationship Hive', 'b5c2d001-0000-4000-8000-0000000000a1'),
  ('b5c2d001-0000-4000-8000-000000000002', 'a5c2d001-0000-4000-8000-000000000002', 'Other Relationship Hive', 'b5c2d001-0000-4000-8000-0000000000a2'),
  ('b5c2d001-0000-4000-8000-000000000003', 'a5c2d001-0000-4000-8000-000000000001', 'Delete Relationship Hive', 'b5c2d001-0000-4000-8000-0000000000a3');

SELECT pg_temp.qf1a_ensure_owner_memberships();

INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by)
VALUES (
  'b5c2d001-0000-4000-8000-000000000001',
  'a5c2d001-0000-4000-8000-000000000003',
  'client',
  'active',
  'a5c2d001-0000-4000-8000-000000000001'
);

INSERT INTO hive.source_documents (
  id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
  storage_bucket, storage_path, upload_status, lifecycle_status, page_count
)
VALUES
  ('c5c2d001-0000-4000-8000-000000000001', 'b5c2d001-0000-4000-8000-000000000001',
   'a5c2d001-0000-4000-8000-000000000001', 'north.pdf', 'application/pdf', 128, repeat('a', 64),
   'hive-source-documents', 'synthetic/rel-north.pdf', 'UPLOADED', 'ACTIVE', 2),
  ('c5c2d001-0000-4000-8000-000000000002', 'b5c2d001-0000-4000-8000-000000000002',
   'a5c2d001-0000-4000-8000-000000000002', 'other.pdf', 'application/pdf', 128, repeat('b', 64),
   'hive-source-documents', 'synthetic/rel-other.pdf', 'UPLOADED', 'ACTIVE', 2),
  ('c5c2d001-0000-4000-8000-000000000003', 'b5c2d001-0000-4000-8000-000000000003',
   'a5c2d001-0000-4000-8000-000000000001', 'delete.pdf', 'application/pdf', 128, repeat('d', 64),
   'hive-source-documents', 'synthetic/rel-delete.pdf', 'UPLOADED', 'ACTIVE', 2);

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
           FROM (VALUES
             (1, 'North knows South via inst-n->inst-s and HOLDS. North stands alone.'),
             (2, 'South is named on page two.')
           ) AS p(n, t)
       )),
       2, page.n, page.t,
       'sha256:' || encode(sha256(convert_to(page.t, 'UTF8')), 'hex'),
       octet_length(convert_to(page.t, 'UTF8')),
       'pdf_native', 'SUCCEEDED', jsonb_build_object('synthetic', true)
  FROM (
    VALUES
      ('b5c2d001-0000-4000-8000-000000000001'::uuid, 'c5c2d001-0000-4000-8000-000000000001'::uuid, repeat('a', 64), repeat('1', 64)),
      ('b5c2d001-0000-4000-8000-000000000002'::uuid, 'c5c2d001-0000-4000-8000-000000000002'::uuid, repeat('b', 64), repeat('2', 64)),
      ('b5c2d001-0000-4000-8000-000000000003'::uuid, 'c5c2d001-0000-4000-8000-000000000003'::uuid, repeat('d', 64), repeat('3', 64))
  ) AS docs(hive_id, doc_id, sha, fingerprint)
  CROSS JOIN (VALUES
    (1, 'North knows South via inst-n->inst-s and HOLDS. North stands alone.'),
    (2, 'South is named on page two.')
  ) AS page(n, t);

INSERT INTO hive.doc_extractions (
  id, hive_id, source_document_id, content_digest, prompt_id, prompt_digest, model_alias, extraction, stats
)
SELECT docs.id, docs.hive_id, docs.doc_id, 'sha256:' || docs.sha, 'hive-extract/1', 'sha256:' || repeat('p', 64), 'synthetic',
       jsonb_build_object(
         'schema', 'hive.doc-extraction/1',
         'documentId', docs.doc_id,
         'facts', jsonb_build_array(
           jsonb_build_object(
             'id', 'F-H',
             'valueAsWritten', 'HOLDS',
             'evidence', jsonb_build_array(jsonb_build_object('page', 1, 'quote', 'HOLDS'))
           ),
           jsonb_build_object(
             'id', 'F-N',
             'valueAsWritten', 'North',
             'evidence', jsonb_build_array(jsonb_build_object(
               'page', 1,
               'quote', 'North knows South via inst-n->inst-s and HOLDS.'
             ))
           ),
           jsonb_build_object(
             'id', 'F-S',
             'valueAsWritten', 'South',
             'evidence', jsonb_build_array(jsonb_build_object('page', 2, 'quote', 'South is named on page two.'))
           )
         )
       ),
       '{}'::jsonb
  FROM (
    VALUES
      ('e5c2d001-0000-4000-8000-000000000001'::uuid, 'b5c2d001-0000-4000-8000-000000000001'::uuid, 'c5c2d001-0000-4000-8000-000000000001'::uuid, repeat('a', 64)),
      ('e5c2d001-0000-4000-8000-000000000002'::uuid, 'b5c2d001-0000-4000-8000-000000000002'::uuid, 'c5c2d001-0000-4000-8000-000000000002'::uuid, repeat('b', 64)),
      ('e5c2d001-0000-4000-8000-000000000003'::uuid, 'b5c2d001-0000-4000-8000-000000000003'::uuid, 'c5c2d001-0000-4000-8000-000000000003'::uuid, repeat('d', 64))
  ) AS docs(id, hive_id, doc_id, sha);

SELECT set_config('app.study_revisions', (SELECT count(*)::text FROM hive.study_revisions), false);
SELECT set_config('app.reports', (SELECT count(*)::text FROM hive.reports), false);
SELECT set_config('app.canonical_studies', (SELECT count(*)::text FROM hive.canonical_studies), false);

SELECT is(
  hive.relationship_verification_decided_at('2026-11-25 14:00:00+00'::timestamptz),
  '2026-11-25T14:00:00.000Z',
  'server time uses the verification record timestamp'
);
SELECT ok(
  hive.relationship_verification_contains_phrase('North knows South via inst-n->inst-s and HOLDS.', 'North')
  AND hive.relationship_verification_contains_phrase('North knows South via inst-n->inst-s and HOLDS.', 'South')
  AND hive.relationship_verification_contains_phrase('North knows South via inst-n->inst-s and HOLDS.', 'HOLDS')
  AND hive.relationship_verification_contains_phrase('North knows South via inst-n->inst-s and HOLDS.', 'inst-n->inst-s')
  AND NOT hive.relationship_verification_contains_phrase('North stands alone.', 'South'),
  'identity containment uses alphanumeric boundaries'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.append_relationship_verification(uuid,uuid,text,text,text,text,text,text,timestamptz,text,text)',
    'EXECUTE'
  ),
  'service role can execute relationship append'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.append_relationship_verification(uuid,uuid,text,text,text,text,text,text,timestamptz,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.append_relationship_verification(uuid,uuid,text,text,text,text,text,text,timestamptz,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.append_relationship_verification(uuid,uuid,text,text,text,text,text,text,timestamptz,text,text)', 'EXECUTE'),
  'authenticated, anon, and public cannot execute relationship append'
);
SELECT ok(
  NOT has_table_privilege('service_role', 'hive.relationship_verification_chain', 'INSERT')
  AND NOT has_table_privilege('service_role', 'hive.relationship_verification_chain', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'hive.relationship_verification_chain', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'hive.relationship_verification_chain', 'SELECT')
  AND NOT has_table_privilege('service_role', 'hive.relationship_verification_append_grants', 'INSERT'),
  'direct chain and grant writes stay revoked'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'append_relationship_verification'),
  'relationship append runs with definer rights'
);
SELECT ok(
  position(
    'hive.evidence_pin_lifecycle'
    IN pg_get_functiondef('public.append_relationship_verification(uuid,uuid,text,text,text,text,text,text,timestamptz,text,text)'::regprocedure)
  ) = 0,
  'append authorization does not read the evidence-pin lifecycle flag'
);
SELECT ok(
  position('study_revisions' IN pg_get_functiondef('public.append_relationship_verification(uuid,uuid,text,text,text,text,text,text,timestamptz,text,text)'::regprocedure)) = 0
  AND position('canonical_studies' IN pg_get_functiondef('public.append_relationship_verification(uuid,uuid,text,text,text,text,text,text,timestamptz,text,text)'::regprocedure)) = 0
  AND position('hive.reports' IN pg_get_functiondef('public.append_relationship_verification(uuid,uuid,text,text,text,text,text,text,timestamptz,text,text)'::regprocedure)) = 0,
  'append does not rewrite accepted studies or reports'
);

CREATE FUNCTION pg_temp.rel_pin_payload(p_doc uuid, p_sha text, p_fingerprint text, p_extraction uuid)
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
  v_long text := 'North knows South via inst-n->inst-s and HOLDS.';
  v_weak text := 'North stands alone.';
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'pageNumber', p.page_number,
           'pageTextSha256', p.page_text_sha256
         ) ORDER BY p.page_number),
         min(p.page_set_digest)
    INTO v_pages, v_set
    FROM hive.document_pages p
   WHERE p.source_document_id = p_doc;

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
    'facts', jsonb_build_array(
      jsonb_build_object(
        'entityId', 'entity.north', 'fieldId', 'polarity', 'id', 'F-H', 'instanceId', 'inst-n',
        'sourceRefs', jsonb_build_array(jsonb_build_object('documentId', p_doc, 'excerptId', 'F-H', 'page', '1')),
        'status', 'VERIFIED', 'value', jsonb_build_object('value', 'HOLDS', 'valueType', 'TEXT')
      ),
      jsonb_build_object(
        'entityId', 'entity.north', 'fieldId', 'name', 'id', 'F-N', 'instanceId', 'inst-n',
        'sourceRefs', jsonb_build_array(jsonb_build_object('documentId', p_doc, 'excerptId', 'F-N', 'page', '1')),
        'status', 'VERIFIED', 'value', jsonb_build_object('value', 'North', 'valueType', 'TEXT')
      ),
      jsonb_build_object(
        'entityId', 'entity.south', 'fieldId', 'name', 'id', 'F-S', 'instanceId', 'inst-s',
        'sourceRefs', jsonb_build_array(jsonb_build_object('documentId', p_doc, 'excerptId', 'F-S', 'page', '2')),
        'status', 'VERIFIED', 'value', jsonb_build_object('value', 'South', 'valueType', 'TEXT')
      )
    ),
    'relationships', '[]'::jsonb,
    'schema', 'hive.verified-case-facts/1'
  );
  v_unresolved := jsonb_build_object(
    'candidates', jsonb_build_array(
      jsonb_build_object(
        'candidateId', 'cand-rel-1',
        'evidence', jsonb_build_array(jsonb_build_object('page', 1, 'quote', v_long, 'sourceDocumentId', p_doc)),
        'fromEntityId', 'entity.north', 'fromInstanceId', 'inst-n',
        'kind', 'RELATIONSHIP',
        'reasons', jsonb_build_array('RELATIONSHIP_SEMANTICS_UNVERIFIED'),
        'relationshipId', 'rel.knows',
        'sourceRefs', jsonb_build_array(jsonb_build_object('documentId', p_doc, 'excerptId', 'F-N', 'page', '1')),
        'toEntityId', 'entity.south', 'toInstanceId', 'inst-s',
        'trust', 'REVIEW_REQUIRED'
      ),
      jsonb_build_object(
        'candidateId', 'cand-rel-2',
        'evidence', jsonb_build_array(jsonb_build_object('page', 1, 'quote', v_long, 'sourceDocumentId', p_doc)),
        'fromEntityId', 'entity.north', 'fromInstanceId', 'inst-n',
        'kind', 'RELATIONSHIP',
        'reasons', jsonb_build_array('RELATIONSHIP_SEMANTICS_UNVERIFIED'),
        'relationshipId', 'rel.knows',
        'sourceRefs', jsonb_build_array(jsonb_build_object('documentId', p_doc, 'excerptId', 'F-N', 'page', '1')),
        'toEntityId', 'entity.south', 'toInstanceId', 'inst-s',
        'trust', 'REVIEW_REQUIRED'
      ),
      jsonb_build_object(
        'candidateId', 'cand-weak',
        'evidence', jsonb_build_array(jsonb_build_object('page', 1, 'quote', v_weak, 'sourceDocumentId', p_doc)),
        'fromEntityId', 'entity.north', 'fromInstanceId', 'inst-n',
        'kind', 'RELATIONSHIP',
        'reasons', jsonb_build_array('RELATIONSHIP_SEMANTICS_UNVERIFIED'),
        'relationshipId', 'rel.knows',
        'sourceRefs', jsonb_build_array(jsonb_build_object('documentId', p_doc, 'excerptId', 'F-N', 'page', '1')),
        'toEntityId', 'entity.south', 'toInstanceId', 'inst-s',
        'trust', 'REVIEW_REQUIRED'
      )
    ),
    'schema', 'hive.investigation-unresolved-candidates/1'
  );
  v_pack := hive.canonical_json(jsonb_build_object(
    'definitions', jsonb_build_array(jsonb_build_object(
      'evidenceRequired', true,
      'fromEntityId', 'entity.north',
      'id', 'rel.knows',
      'kind', 'relationship',
      'toEntityId', 'entity.south'
    )),
    'identity', jsonb_build_object('packId', 'pack.reltest', 'version', '0.0.1'),
    'schema', 'hive.domain-pack-runtime/1'
  ));
  v_plan := hive.canonical_json(jsonb_build_object(
    'schema', 'hive.domain-investigation-plan/1',
    'tasks', jsonb_build_array(
      jsonb_build_object('definitionId', 'entity.north', 'identityKeys', jsonb_build_array('name'), 'taskKind', 'BIND_ENTITY'),
      jsonb_build_object('definitionId', 'entity.south', 'identityKeys', jsonb_build_array('name'), 'taskKind', 'BIND_ENTITY')
    )
  ));
  v_pin := jsonb_build_object(
    'artifacts', jsonb_build_object(
      'pack', jsonb_build_object(
        'digest', hive.sha256_hex(v_pack),
        'packId', 'pack.reltest',
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
  RETURN jsonb_build_object(
    'pack', v_pack,
    'plan', v_plan,
    'pin', hive.canonical_json(v_pin),
    'extractionId', p_extraction
  );
END;
$$;

CREATE FUNCTION pg_temp.rel_structure()
RETURNS text
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_body jsonb := jsonb_build_object(
    'direction', 'AUTHORED_FROM_TO',
    'polarity', 'HOLDS',
    'relationshipId', 'rel.knows',
    'schema', 'hive.relationship-source-structure/1',
    'slots', jsonb_build_array(
      jsonb_build_object('role', 'FROM_IDENTITY', 'value', 'North'),
      jsonb_build_object('role', 'TO_IDENTITY', 'value', 'South'),
      jsonb_build_object('role', 'POLARITY', 'value', 'HOLDS'),
      jsonb_build_object('role', 'DIRECTION', 'value', 'inst-n->inst-s')
    )
  );
BEGIN
  RETURN hive.canonical_json(v_body || jsonb_build_object(
    'structureDigest', hive.sha256_hex(hive.canonical_json(v_body))
  ));
END;
$$;

CREATE FUNCTION public.hfy_test_rel_append(
  p_hive uuid,
  p_owner uuid,
  p_pin text,
  p_request text,
  p_expected text,
  p_candidate text,
  p_decision text,
  p_target text,
  p_body text,
  p_structure text
)
RETURNS json
LANGUAGE sql
SET search_path = hive, public, pg_temp
AS $$
  SELECT public.append_relationship_verification(
    p_hive, p_owner, p_pin, p_request, p_expected, p_candidate, p_decision, p_target,
    timestamptz '2026-11-25 14:00:00+00', p_body, p_structure
  );
$$;

REVOKE ALL ON FUNCTION public.hfy_test_rel_append(uuid, uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hfy_test_rel_append(uuid, uuid, text, text, text, text, text, text, text, text) TO service_role;

SELECT set_config('app.pin_primary', pg_temp.rel_pin_payload(
  'c5c2d001-0000-4000-8000-000000000001', repeat('a', 64), repeat('1', 64),
  'e5c2d001-0000-4000-8000-000000000001'
)::text, false);
SELECT set_config('app.pin_other', pg_temp.rel_pin_payload(
  'c5c2d001-0000-4000-8000-000000000002', repeat('b', 64), repeat('2', 64),
  'e5c2d001-0000-4000-8000-000000000002'
)::text, false);
SELECT set_config('app.pin_delete', pg_temp.rel_pin_payload(
  'c5c2d001-0000-4000-8000-000000000003', repeat('d', 64), repeat('3', 64),
  'e5c2d001-0000-4000-8000-000000000003'
)::text, false);
SELECT set_config('app.structure', pg_temp.rel_structure(), false);

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT set_config('app.receipt_primary', public.create_investigation_evidence_pin(
  'b5c2d001-0000-4000-8000-000000000001',
  'a5c2d001-0000-4000-8000-000000000001',
  'd5c2d001-0000-4000-8000-000000000001',
  current_setting('app.pin_primary')::jsonb->>'pin',
  current_setting('app.pin_primary')::jsonb->>'pack',
  current_setting('app.pin_primary')::jsonb->>'plan',
  ARRAY['e5c2d001-0000-4000-8000-000000000001'::uuid]
)::text, false);
SELECT set_config('app.receipt_other', public.create_investigation_evidence_pin(
  'b5c2d001-0000-4000-8000-000000000002',
  'a5c2d001-0000-4000-8000-000000000002',
  'd5c2d001-0000-4000-8000-000000000002',
  current_setting('app.pin_other')::jsonb->>'pin',
  current_setting('app.pin_other')::jsonb->>'pack',
  current_setting('app.pin_other')::jsonb->>'plan',
  ARRAY['e5c2d001-0000-4000-8000-000000000002'::uuid]
)::text, false);
SELECT set_config('app.receipt_delete', public.create_investigation_evidence_pin(
  'b5c2d001-0000-4000-8000-000000000003',
  'a5c2d001-0000-4000-8000-000000000001',
  'd5c2d001-0000-4000-8000-000000000003',
  current_setting('app.pin_delete')::jsonb->>'pin',
  current_setting('app.pin_delete')::jsonb->>'pack',
  current_setting('app.pin_delete')::jsonb->>'plan',
  ARRAY['e5c2d001-0000-4000-8000-000000000003'::uuid]
)::text, false);

RESET role;

SELECT set_config('app.pin_id', current_setting('app.receipt_primary')::json->>'pinId', false);
SELECT set_config('app.other_pin_id', current_setting('app.receipt_other')::json->>'pinId', false);
SELECT set_config('app.delete_pin_id', current_setting('app.receipt_delete')::json->>'pinId', false);
SELECT set_config('app.zero_head', current_setting('app.receipt_primary')::json->'chainHead'->>'recordId', false);
SELECT set_config(
  'app.pin_canonical',
  (SELECT canonical_json FROM hive.investigation_evidence_pins WHERE pin_id = current_setting('app.pin_id')),
  false
);
SELECT set_config(
  'app.zero_canonical',
  (SELECT canonical_json FROM hive.relationship_verification_chain
    WHERE pin_id = current_setting('app.pin_id') AND sequence = 0),
  false
);

SELECT is(
  (current_setting('app.receipt_primary')::json->>'outcome'),
  'created',
  'the relationship fixture pin is stored before any decision'
);
SELECT is(
  (SELECT count(*)::int FROM hive.relationship_verification_chain WHERE pin_id = current_setting('app.pin_id')),
  1,
  'a new pin still has only the sequence-zero head'
);

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a5c2d001-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-auth', NULL, 'cand-rel-1', 'ACCEPT', NULL, '{}', NULL
    )$$,
  '42501',
  'permission denied',
  'an authenticated caller cannot append a relationship decision'
);
RESET role;

SET LOCAL role anon;
SELECT throws_ok(
  $$SELECT public.append_relationship_verification(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-anon', NULL, 'cand-rel-1', 'ACCEPT', NULL,
      timestamptz '2026-11-25 14:00:00+00', '{}', NULL
    )$$,
  '42501',
  'permission denied',
  'an anonymous caller cannot append a relationship decision'
);
RESET role;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT throws_ok(
  $$INSERT INTO hive.relationship_verification_chain (
      hive_id, pin_id, sequence, record_id, causal_parent_id, canonical_json,
      pack_digest, plan_digest, extraction_digest, binder_digest, evidence_digest
    ) VALUES (
      'b5c2d001-0000-4000-8000-000000000001', current_setting('app.pin_id'), 1,
      repeat('a', 64), NULL, '{}', repeat('a', 64), repeat('b', 64),
      repeat('c', 64), repeat('d', 64), repeat('e', 64)
    )$$,
  '42501',
  'permission denied',
  'service role cannot insert a chain row directly'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000003',
      current_setting('app.pin_id'),
      'req-client', NULL, 'cand-rel-1', 'ACCEPT', NULL, '{}', NULL
    )$$,
  'P0002',
  'hive_not_found',
  'a client member is not the Hive owner'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000002',
      current_setting('app.pin_id'),
      'req-other-owner', NULL, 'cand-rel-1', 'ACCEPT', NULL, '{}', NULL
    )$$,
  'P0002',
  'hive_not_found',
  'another Hive owner cannot append on this Hive'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      repeat('9', 64),
      'req-missing-pin', NULL, 'cand-rel-1', 'ACCEPT', NULL, '{}', NULL
    )$$,
  'P0002',
  'pin_not_found',
  'an unknown pin is not a verification chain'
);
RESET role;

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
       WHERE pin_id = current_setting('app.pin_id') AND sequence = 0;
    END $e$$,
  'P0001',
  'verification_append_unavailable',
  'the evidence-pin lifecycle flag does not authorize a decision append'
);

SELECT set_config(
  'app.accept_body',
  hive.relationship_verification_canonical_record(
    'b5c2d001-0000-4000-8000-000000000001',
    'a5c2d001-0000-4000-8000-000000000001',
    current_setting('app.pin_id'),
    'req-accept-1',
    NULL,
    'cand-rel-1',
    'ACCEPT',
    NULL,
    timestamptz '2026-11-25 14:00:00+00',
    NULL,
    true
  ),
  false
);

SELECT set_config(
  'app.forged_quote',
  hive.canonical_json(jsonb_set(
    current_setting('app.accept_body')::jsonb,
    '{quotations,0,quote}',
    to_jsonb('Forged quotation that is not the pinned evidence.'::text)
  )),
  false
);
SELECT ok(
  hive.canonical_json(current_setting('app.forged_quote')::jsonb) = current_setting('app.forged_quote')
  AND hive.sha256_hex(current_setting('app.forged_quote')) ~ '^[0-9a-f]{64}$',
  'a forged quotation record can still be internally canonical'
);
SELECT set_config(
  'app.forged_pack',
  hive.canonical_json(jsonb_set(
    current_setting('app.accept_body')::jsonb,
    '{packDigest}',
    to_jsonb(repeat('ab', 32))
  )),
  false
);
SELECT set_config(
  'app.forged_actor',
  hive.canonical_json(jsonb_set(
    current_setting('app.accept_body')::jsonb,
    '{actorId}',
    to_jsonb('a5c2d001-0000-4000-8000-000000000002'::text)
  )),
  false
);

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-forged-candidate', NULL, 'cand-missing', 'ACCEPT', NULL,
      current_setting('app.forged_quote'), NULL
    )$$,
  'P0001',
  'CANDIDATE_INVALID',
  'a self-consistent record for a candidate outside the pin is rejected'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-forged-quote', NULL, 'cand-rel-1', 'ACCEPT', NULL,
      current_setting('app.forged_quote'), NULL
    )$$,
  'P0001',
  'CANDIDATE_INVALID',
  'a self-consistent record with a substituted quotation is rejected'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-weak', NULL, 'cand-weak', 'ACCEPT', NULL,
      current_setting('app.accept_body'), NULL
    )$$,
  'P0001',
  'NOT_ELIGIBLE',
  'a page-backed quotation that does not contain both identities is not evidence'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-bad-digest', NULL, 'cand-rel-1', 'ACCEPT', NULL,
      current_setting('app.forged_pack'),
      NULL
    )$$,
  'P0001',
  'DIGEST_MISMATCH',
  'a record whose pack digest is not the pinned artifact is rejected'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-bad-actor', NULL, 'cand-rel-1', 'ACCEPT', NULL,
      current_setting('app.forged_actor'),
      NULL
    )$$,
  'P0001',
  'PERMISSION_DENIED',
  'a record whose actor is not the Hive owner is rejected'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-bad-structure', NULL, 'cand-rel-1', 'ACCEPT', NULL,
      current_setting('app.accept_body'),
      '{"schema":"hive.relationship-source-structure/1"}'
    )$$,
  'P0001',
  'STRUCTURE_UNAPPROVED',
  'a malformed typed-source companion admits nothing'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-zero-head', current_setting('app.zero_head'), 'cand-rel-1', 'ACCEPT', NULL,
      current_setting('app.accept_body'), NULL
    )$$,
  'P0001',
  'CAUSAL_CONFLICT',
  'the sequence-zero head is not the expected head of an empty decision chain'
);
RESET role;

SELECT is(
  (SELECT count(*)::int FROM hive.relationship_verification_chain WHERE pin_id = current_setting('app.pin_id')),
  1,
  'rejected submissions do not append'
);

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT set_config('app.accept_receipt', public.hfy_test_rel_append(
  'b5c2d001-0000-4000-8000-000000000001',
  'a5c2d001-0000-4000-8000-000000000001',
  current_setting('app.pin_id'),
  'req-accept-1', NULL, 'cand-rel-1', 'ACCEPT', NULL,
  current_setting('app.accept_body'), NULL
)::text, false);
RESET role;

SELECT is((current_setting('app.accept_receipt')::json->>'outcome'), 'appended', 'an owner acceptance appends one decision');
SELECT is((current_setting('app.accept_receipt')::json->>'code'), 'APPENDED', 'the receipt uses the verification append code');
SELECT is((current_setting('app.accept_receipt')::json->>'sequence')::int, 1, 'the first decision is sequence 1');
SELECT ok(
  (current_setting('app.accept_receipt')::json->>'causalParentId') IS NULL,
  'the first decision causal parent is null'
);
SELECT is(
  (current_setting('app.accept_receipt')::json->>'method'),
  'AUTHORIZED_HUMAN',
  'a human acceptance records the authorized human method'
);
SELECT is(
  (current_setting('app.accept_receipt')::json->>'effect'),
  'SUPPORTS',
  'a human acceptance supports the candidate'
);
SELECT ok(
  position('North knows South' IN current_setting('app.accept_receipt')) = 0,
  'the append receipt does not return quotations'
);
SELECT is(
  (SELECT canonical_json FROM hive.investigation_evidence_pins WHERE pin_id = current_setting('app.pin_id')),
  current_setting('app.pin_canonical'),
  'append does not rewrite the pinned evidence'
);
SELECT is(
  (SELECT canonical_json FROM hive.relationship_verification_chain
    WHERE pin_id = current_setting('app.pin_id') AND sequence = 0),
  current_setting('app.zero_canonical'),
  'append leaves the sequence-zero head unchanged'
);
SELECT is(
  (SELECT jsonb_array_length(verified->'relationships') FROM hive.investigation_evidence_pins WHERE pin_id = current_setting('app.pin_id')),
  0,
  'append does not write a relationship fact into the pin'
);
SELECT ok(
  position('North knows South' IN (
    SELECT coalesce(string_agg(safe_metadata::text, ''), '')
      FROM hive.audit_events
     WHERE case_id = 'b5c2d001-0000-4000-8000-000000000001'
       AND event_type LIKE 'relationship_verification_%'
  )) = 0,
  'relationship audit metadata stores digests without quotations'
);
SELECT set_config(
  'app.accept_canonical',
  (SELECT canonical_json FROM hive.relationship_verification_chain
    WHERE pin_id = current_setting('app.pin_id') AND sequence = 1),
  false
);
SELECT is(
  (SELECT record_id FROM hive.relationship_verification_chain
    WHERE pin_id = current_setting('app.pin_id') AND sequence = 1),
  hive.sha256_hex(current_setting('app.accept_canonical')),
  'the stored decision id is the digest of its canonical body'
);

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT is(
  (public.hfy_test_rel_append(
    'b5c2d001-0000-4000-8000-000000000001',
    'a5c2d001-0000-4000-8000-000000000001',
    current_setting('app.pin_id'),
    'req-accept-1', NULL, 'cand-rel-1', 'ACCEPT', NULL,
    NULL, NULL
  )->>'outcome'),
  'replayed',
  'the same acceptance request replays and appends nothing'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-accept-1', NULL, 'cand-rel-1', 'REJECT', NULL, NULL, NULL
    )$$,
  'P0001',
  'idempotency_conflict',
  'reusing an acceptance request id for a rejection conflicts'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-stale', NULL, 'cand-rel-2', 'REJECT', NULL,
      current_setting('app.accept_body'), NULL
    )$$,
  'P0001',
  'CAUSAL_CONFLICT',
  'a stale empty head appends nothing after a decision exists'
);
RESET role;

SELECT set_config(
  'app.reject_body',
  hive.relationship_verification_canonical_record(
    'b5c2d001-0000-4000-8000-000000000001',
    'a5c2d001-0000-4000-8000-000000000001',
    current_setting('app.pin_id'),
    'req-reject-2',
    current_setting('app.accept_receipt')::json->>'recordId',
    'cand-rel-2',
    'REJECT',
    NULL,
    timestamptz '2026-11-25 14:00:00+00',
    NULL,
    true
  ),
  false
);

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT set_config('app.reject_receipt', public.hfy_test_rel_append(
  'b5c2d001-0000-4000-8000-000000000001',
  'a5c2d001-0000-4000-8000-000000000001',
  current_setting('app.pin_id'),
  'req-reject-2',
  current_setting('app.accept_receipt')::json->>'recordId',
  'cand-rel-2', 'REJECT', NULL,
  current_setting('app.reject_body'), NULL
)::text, false);
RESET role;

SELECT is((current_setting('app.reject_receipt')::json->>'effect'), 'WITHHOLDS', 'a human rejection withholds and does not support');
SELECT is((current_setting('app.reject_receipt')::json->>'sequence')::int, 2, 'the rejection is the next sequence');

SELECT set_config(
  'app.revoke_body',
  hive.relationship_verification_canonical_record(
    'b5c2d001-0000-4000-8000-000000000001',
    'a5c2d001-0000-4000-8000-000000000001',
    current_setting('app.pin_id'),
    'req-revoke-1',
    current_setting('app.reject_receipt')::json->>'recordId',
    'cand-rel-1',
    'REVOKE',
    current_setting('app.accept_receipt')::json->>'recordId',
    timestamptz '2026-11-25 14:00:00+00',
    NULL,
    true
  ),
  false
);

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT set_config('app.revoke_receipt', public.hfy_test_rel_append(
  'b5c2d001-0000-4000-8000-000000000001',
  'a5c2d001-0000-4000-8000-000000000001',
  current_setting('app.pin_id'),
  'req-revoke-1',
  current_setting('app.reject_receipt')::json->>'recordId',
  'cand-rel-1',
  'REVOKE',
  current_setting('app.accept_receipt')::json->>'recordId',
  current_setting('app.revoke_body'),
  NULL
)::text, false);
RESET role;

SELECT is((current_setting('app.revoke_receipt')::json->>'effect'), 'REVOKES', 'revocation appends a new record');
SELECT is(
  (SELECT canonical_json FROM hive.relationship_verification_chain
    WHERE pin_id = current_setting('app.pin_id') AND sequence = 1),
  current_setting('app.accept_canonical'),
  'revocation leaves the accepted record bytes unchanged'
);
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT is(
  (public.hfy_test_rel_append(
    'b5c2d001-0000-4000-8000-000000000001',
    'a5c2d001-0000-4000-8000-000000000001',
    current_setting('app.pin_id'),
    'req-accept-1',
    current_setting('app.revoke_receipt')::json->>'recordId',
    'cand-rel-1', 'ACCEPT', NULL, NULL, NULL
  )->>'recordId'),
  current_setting('app.accept_receipt')::json->>'recordId',
  'replaying the revoked acceptance returns the historical record'
);
RESET role;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-revoke-again',
      current_setting('app.revoke_receipt')::json->>'recordId',
      'cand-rel-1', 'REVOKE',
      current_setting('app.accept_receipt')::json->>'recordId',
      NULL, NULL
    )$$,
  'P0001',
  'CAUSAL_CONFLICT',
  'a second revocation of the same acceptance conflicts'
);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000001',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.pin_id'),
      'req-revoke-reject',
      current_setting('app.revoke_receipt')::json->>'recordId',
      'cand-rel-2', 'REVOKE',
      current_setting('app.reject_receipt')::json->>'recordId',
      NULL, NULL
    )$$,
  'P0001',
  'NOT_ELIGIBLE',
  'revocation does not apply to a rejection'
);
RESET role;

SELECT is(
  (SELECT count(*)::int FROM hive.relationship_verification_chain WHERE pin_id = current_setting('app.pin_id')),
  4,
  'replay and conflicting revocation do not add chain rows'
);

SELECT set_config(
  'app.accept_again_body',
  hive.relationship_verification_canonical_record(
    'b5c2d001-0000-4000-8000-000000000001',
    'a5c2d001-0000-4000-8000-000000000001',
    current_setting('app.pin_id'),
    'req-accept-2',
    current_setting('app.revoke_receipt')::json->>'recordId',
    'cand-rel-1',
    'ACCEPT',
    NULL,
    timestamptz '2026-11-25 14:00:00+00',
    NULL,
    true
  ),
  false
);

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT is(
  (public.hfy_test_rel_append(
    'b5c2d001-0000-4000-8000-000000000001',
    'a5c2d001-0000-4000-8000-000000000001',
    current_setting('app.pin_id'),
    'req-accept-2',
    current_setting('app.revoke_receipt')::json->>'recordId',
    'cand-rel-1', 'ACCEPT', NULL,
    current_setting('app.accept_again_body'), NULL
  )->>'sequence')::int,
  4,
  'a later acceptance after revocation appends at the current head'
);
RESET role;

SELECT set_config(
  'app.typed_body',
  hive.relationship_verification_canonical_record(
    'b5c2d001-0000-4000-8000-000000000002',
    'a5c2d001-0000-4000-8000-000000000002',
    current_setting('app.other_pin_id'),
    'req-typed-ignored',
    NULL,
    'cand-rel-1',
    'ACCEPT',
    NULL,
    timestamptz '2026-11-25 14:00:00+00',
    current_setting('app.structure'),
    true
  ),
  false
);

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT set_config('app.typed_receipt', public.hfy_test_rel_append(
  'b5c2d001-0000-4000-8000-000000000002',
  'a5c2d001-0000-4000-8000-000000000002',
  current_setting('app.other_pin_id'),
  current_setting('app.typed_body')::jsonb->>'requestId',
  NULL,
  'cand-rel-1', 'ACCEPT', NULL,
  current_setting('app.typed_body'),
  current_setting('app.structure')
)::text, false);
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000002',
      'a5c2d001-0000-4000-8000-000000000002',
      current_setting('app.other_pin_id'),
      'req-human-after-typed', NULL, 'cand-rel-1', 'ACCEPT', NULL, NULL,
      current_setting('app.structure')
    )$$,
  'P0001',
  'HUMAN_WITHHELD',
  'a later human request cannot replace a typed decision'
);
RESET role;

SELECT is((current_setting('app.typed_receipt')::json->>'method'), 'TYPED_SOURCE', 'a matching typed source appends without a human method');
SELECT is((current_setting('app.typed_receipt')::json->>'effect'), 'SUPPORTS', 'a holding typed source supports the relationship');
SELECT is(
  (SELECT count(*)::int FROM hive.relationship_verification_chain WHERE pin_id = current_setting('app.other_pin_id')),
  2,
  'the other Hive keeps its typed decision and its sequence-zero head'
);

SELECT throws_ok(
  $$UPDATE hive.relationship_verification_chain
       SET request_id = request_id
     WHERE pin_id = current_setting('app.pin_id') AND sequence = 1$$,
  'P0001',
  'evidence_pin_immutable',
  'a stored decision cannot be updated'
);
SELECT throws_ok(
  $$DELETE FROM hive.relationship_verification_chain
    WHERE pin_id = current_setting('app.pin_id') AND sequence = 1$$,
  'P0001',
  'evidence_pin_immutable',
  'a stored decision cannot be deleted outside Hive deletion'
);

SELECT throws_ok(
  $$DO $e$
    DECLARE
      v_json text := '{"schema":"hive.relationship-verification/1"}';
      v_id text := hive.sha256_hex(v_json);
      v_nonce text := repeat('c', 64);
    BEGIN
      INSERT INTO hive.relationship_verification_append_grants (
        nonce, hive_id, pin_id, sequence, record_id, canonical_json
      ) VALUES (
        v_nonce,
        'b5c2d001-0000-4000-8000-000000000001',
        current_setting('app.pin_id'),
        99,
        v_id,
        v_json
      );
      PERFORM set_config('hive.evidence_pin_lifecycle', 'insert', true);
      PERFORM set_config('hive.relationship_verification_append_nonce', v_nonce, true);
      INSERT INTO hive.relationship_verification_chain (
        hive_id, pin_id, sequence, record_id, causal_parent_id, canonical_json,
        pack_digest, plan_digest, extraction_digest, binder_digest, evidence_digest, request_id
      ) VALUES (
        'b5c2d001-0000-4000-8000-000000000001',
        current_setting('app.pin_id'),
        99,
        v_id,
        NULL,
        v_json,
        repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('d', 64), repeat('e', 64),
        'req-forged-grant'
      );
    END $e$$,
  'P0001',
  'CHAIN_INVALID',
  'a grant plus the lifecycle flag still cannot insert a forged decision'
);

SELECT set_config(
  'app.delete_body',
  hive.relationship_verification_canonical_record(
    'b5c2d001-0000-4000-8000-000000000003',
    'a5c2d001-0000-4000-8000-000000000001',
    current_setting('app.delete_pin_id'),
    'req-delete-accept',
    NULL,
    'cand-rel-1',
    'ACCEPT',
    NULL,
    timestamptz '2026-11-25 14:00:00+00',
    NULL,
    true
  ),
  false
);

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT is(
  (public.hfy_test_rel_append(
    'b5c2d001-0000-4000-8000-000000000003',
    'a5c2d001-0000-4000-8000-000000000001',
    current_setting('app.delete_pin_id'),
    'req-delete-accept', NULL, 'cand-rel-1', 'ACCEPT', NULL,
    current_setting('app.delete_body'), NULL
  )->>'outcome'),
  'appended',
  'a second Hive can append its own decision'
);
RESET role;

SELECT set_config(
  'app.primary_rows',
  (SELECT count(*)::text FROM hive.relationship_verification_chain WHERE hive_id = 'b5c2d001-0000-4000-8000-000000000001'),
  false
);

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a5c2d001-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT is(
  (public.begin_hive_deletion('b5c2d001-0000-4000-8000-000000000003')->>'deletion_stage'),
  'marked',
  'the owner can mark the Hive for deletion'
);
RESET role;

SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';
SELECT throws_ok(
  $$SELECT public.hfy_test_rel_append(
      'b5c2d001-0000-4000-8000-000000000003',
      'a5c2d001-0000-4000-8000-000000000001',
      current_setting('app.delete_pin_id'),
      'req-while-deleting', NULL, 'cand-rel-2', 'REJECT', NULL, NULL, NULL
    )$$,
  'P0002',
  'hive_not_found',
  'a deleting Hive accepts no further relationship decision'
);
SELECT is(
  (public.complete_hive_deletion('b5c2d001-0000-4000-8000-000000000003')->>'deleted')::boolean,
  true,
  'authorized Hive deletion removes the Hive'
);
RESET role;

SELECT is(
  (SELECT count(*)::int FROM hive.relationship_verification_chain WHERE hive_id = 'b5c2d001-0000-4000-8000-000000000003'),
  0,
  'Hive deletion removes that Hive''s verification chain'
);
SELECT is(
  (SELECT count(*)::int FROM hive.investigation_evidence_pins WHERE hive_id = 'b5c2d001-0000-4000-8000-000000000003'),
  0,
  'Hive deletion removes that Hive''s pin'
);
SELECT is(
  (SELECT count(*)::text FROM hive.relationship_verification_chain WHERE hive_id = 'b5c2d001-0000-4000-8000-000000000001'),
  current_setting('app.primary_rows'),
  'deleting one Hive leaves another Hive''s historical decisions in place'
);
SELECT is(
  (SELECT count(*)::int FROM hive.relationship_verification_chain WHERE pin_id = current_setting('app.other_pin_id') AND sequence = 1),
  1,
  'the other Hive''s typed decision remains after a different Hive is deleted'
);
SELECT is(
  (SELECT count(*)::int FROM hive.relationship_verification_append_grants),
  0,
  'append grants do not remain after a decision is stored'
);
SELECT is((SELECT count(*)::text FROM hive.study_revisions), current_setting('app.study_revisions'), 'append does not change study revisions');
SELECT is((SELECT count(*)::text FROM hive.reports), current_setting('app.reports'), 'append does not change reports');
SELECT is(
  (SELECT count(*)::text FROM hive.canonical_studies),
  current_setting('app.canonical_studies'),
  'append does not change canonical studies'
);
SELECT is(
  (SELECT canonical_json FROM hive.relationship_verification_chain
    WHERE pin_id = current_setting('app.pin_id') AND sequence = 1),
  current_setting('app.accept_canonical'),
  'the original acceptance remains after a later acceptance and a Hive deletion'
);

SELECT finish();
ROLLBACK;
