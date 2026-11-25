-- Stage 5C.2c.2a — Append-only relationship verification persistence.
-- One service-role RPC appends hive.relationship-verification/1 records onto
-- the chain created with an investigation evidence pin. Sequence 0 remains the
-- non-decision head from 20261124220000. Decision records start at sequence 1.
-- The first decision's causalParentId is null: that head is not a decision.
-- Later decisions name the previous decision record.
--
-- Authorization is the recomputation below. hive.evidence_pin_lifecycle is not
-- consulted for sequence > 0. A session setting alone cannot append. The
-- ephemeral grant row only lets this RPC's insert reach the trigger; the
-- trigger binds the row to the pin, the candidate or revoke target, and the
-- authorized page text. A self-consistent hash is not admission.
--
-- The RPC does not rewrite pin bytes, study revisions, reports, or an earlier
-- chain row. Revocation appends. Hive deletion still removes a pin, and the
-- chain leaves with that pin, only after the Hive is marked deleting.
--
-- Extraction ids are not stored on the pin. This gate rechecks the stored
-- extraction digest against the pin preimage and rechecks quotations against
-- the retained page generation. It does not invent a second extraction list.
-- decidedAt is the server timestamp supplied by service_role. Sequence, not
-- that timestamp, orders the chain.
--
-- Do not apply to a live Supabase project without explicit founder authorization.
-- This migration does not add an HTTP route, a server module, or a Domain Pack.

BEGIN;

ALTER TABLE hive.relationship_verification_chain
  ADD COLUMN IF NOT EXISTS request_id text;

ALTER TABLE hive.relationship_verification_chain
  DROP CONSTRAINT IF EXISTS ck_relationship_verification_chain__record_kind;

ALTER TABLE hive.relationship_verification_chain
  ADD CONSTRAINT ck_relationship_verification_chain__record_kind CHECK (
    (
      sequence = 0
      AND request_id IS NULL
      AND (canonical_json::jsonb->>'schema') = 'hive.relationship-verification-head/1'
    )
    OR (
      sequence > 0
      AND request_id IS NOT NULL
      AND char_length(request_id) BETWEEN 1 AND 200
      AND request_id = (canonical_json::jsonb->>'requestId')
      AND (canonical_json::jsonb->>'schema') = 'hive.relationship-verification/1'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_relationship_verification_chain__request
  ON hive.relationship_verification_chain (hive_id, pin_id, request_id)
  WHERE request_id IS NOT NULL;

COMMENT ON TABLE hive.relationship_verification_chain IS
  'Append-only relationship verification chain. Sequence 0 is the non-decision head. Sequence 1 and later are immutable hive.relationship-verification/1 decisions inserted only by append_relationship_verification.';

-- Ephemeral latch for the append insert. Presence is not authorization.
CREATE TABLE IF NOT EXISTS hive.relationship_verification_append_grants (
  nonce text NOT NULL,
  hive_id uuid NOT NULL,
  pin_id text NOT NULL,
  sequence integer NOT NULL,
  record_id text NOT NULL,
  canonical_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_relationship_verification_append_grants PRIMARY KEY (nonce),
  CONSTRAINT ck_relationship_verification_append_grants__shape CHECK (
    nonce ~ '^[0-9a-f]{64}$'
    AND sequence > 0
    AND record_id ~ '^[0-9a-f]{64}$'
    AND pin_id ~ '^[0-9a-f]{64}$'
    AND record_id = encode(sha256(convert_to(canonical_json, 'UTF8')), 'hex')
  )
);

COMMENT ON TABLE hive.relationship_verification_append_grants IS
  'Transaction-local latch so the append RPC can insert one chain row. The lifecycle flag cannot create this row, and the row does not make a forged record true.';

ALTER TABLE hive.relationship_verification_append_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.relationship_verification_append_grants FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION hive.relationship_verification_raise(p_code text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_code IS NULL OR p_code NOT IN (
    'invalid_request',
    'hive_not_found',
    'pin_not_found',
    'PERMISSION_DENIED',
    'DIGEST_MISMATCH',
    'REQUEST_INVALID',
    'CAUSAL_CONFLICT',
    'CANDIDATE_INVALID',
    'CHAIN_INVALID',
    'STRUCTURE_UNAPPROVED',
    'HUMAN_WITHHELD',
    'NOT_ELIGIBLE',
    'idempotency_conflict'
  ) THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF p_code = 'invalid_request' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  ELSIF p_code IN ('hive_not_found', 'pin_not_found') THEN
    RAISE EXCEPTION '%', p_code USING ERRCODE = 'P0002';
  ELSE
    RAISE EXCEPTION '%', p_code USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_plain(p_text text, p_max integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_text IS NOT NULL
    AND char_length(p_text) BETWEEN 1 AND p_max
    AND p_text !~ '[[:cntrl:]]';
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_decided_at(p_at timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN p_at IS NULL OR p_at IS DISTINCT FROM date_trunc('milliseconds', p_at) THEN NULL
    ELSE to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_contains_phrase(p_text text, p_phrase text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = hive, pg_catalog, pg_temp
AS $$
DECLARE
  v_text text := hive.normalize_quote_text(p_text);
  v_phrase text := hive.normalize_quote_text(p_phrase);
  v_hay text;
  v_from integer := 1;
  v_rel integer;
  v_at integer;
  v_before text;
  v_after text;
BEGIN
  IF v_phrase = '' OR v_text = '' OR position(v_phrase IN v_text) = 0 THEN
    RETURN false;
  END IF;
  v_hay := ' ' || v_text || ' ';
  LOOP
    v_rel := position(v_phrase IN substring(v_hay FROM v_from));
    IF v_rel = 0 THEN
      RETURN false;
    END IF;
    v_at := v_from + v_rel - 1;
    v_before := substring(v_hay FROM v_at - 1 FOR 1);
    v_after := substring(v_hay FROM v_at + char_length(v_phrase) FOR 1);
    IF v_before !~ '^[A-Za-z0-9]$' AND v_after !~ '^[A-Za-z0-9]$' THEN
      RETURN true;
    END IF;
    v_from := v_at + 1;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_excerpt_id(
  p_document_id text,
  p_page integer,
  p_quote text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT hive.sha256_hex(hive.canonical_json(jsonb_build_object(
    'documentId', p_document_id,
    'page', p_page,
    'quote', hive.normalize_quote_text(p_quote)
  )));
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_content_digest(
  p_relationship_id text,
  p_from_entity_id text,
  p_to_entity_id text,
  p_from_instance_id text,
  p_to_instance_id text,
  p_excerpt_ids jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT hive.sha256_hex(hive.canonical_json(jsonb_build_object(
    'excerptIds', p_excerpt_ids,
    'fromEntityId', p_from_entity_id,
    'fromInstanceId', p_from_instance_id,
    'relationshipId', p_relationship_id,
    'toEntityId', p_to_entity_id,
    'toInstanceId', p_to_instance_id
  )));
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_exact_keys(p_value jsonb, p_allowed text[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_key text;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_value) LOOP
    IF NOT (v_key = ANY (p_allowed)) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_identity_values(
  p_plan jsonb,
  p_verified jsonb,
  p_entity_id text,
  p_instance_id text
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_task jsonb;
  v_keys jsonb;
  v_key text;
  v_values text[] := ARRAY[]::text[];
  v_distinct text[];
BEGIN
  FOR v_task IN
    SELECT value FROM jsonb_array_elements(coalesce(p_plan->'tasks', '[]'::jsonb))
  LOOP
    IF v_task->>'taskKind' = 'BIND_ENTITY' AND v_task->>'definitionId' = p_entity_id THEN
      v_keys := v_task->'identityKeys';
      EXIT;
    END IF;
  END LOOP;
  IF v_keys IS NULL OR jsonb_typeof(v_keys) IS DISTINCT FROM 'array' OR jsonb_array_length(v_keys) < 1 THEN
    RETURN NULL;
  END IF;
  FOR v_key IN SELECT value FROM jsonb_array_elements_text(v_keys) LOOP
    SELECT coalesce(array_agg(DISTINCT val), ARRAY[]::text[])
      INTO v_distinct
      FROM (
        SELECT fact->'value'->>'value' AS val
          FROM jsonb_array_elements(coalesce(p_verified->'facts', '[]'::jsonb)) AS fact
         WHERE fact->>'entityId' = p_entity_id
           AND fact->>'instanceId' = p_instance_id
           AND fact->>'fieldId' = v_key
           AND fact->>'status' = 'VERIFIED'
           AND coalesce(fact->'value'->>'value', '') <> ''
           AND EXISTS (
             SELECT 1
               FROM jsonb_array_elements(coalesce(fact->'sourceRefs', '[]'::jsonb)) AS ref
              WHERE coalesce(ref->>'documentId', '') <> ''
           )
      ) AS found;
    IF v_distinct IS NULL OR coalesce(array_length(v_distinct, 1), 0) IS DISTINCT FROM 1 THEN
      RETURN NULL;
    END IF;
    v_values := array_append(v_values, v_distinct[1]);
  END LOOP;
  IF coalesce(array_length(v_values, 1), 0) < 1 THEN
    RETURN NULL;
  END IF;
  RETURN v_values;
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_quote_on_pin(
  p_pin hive.investigation_evidence_pins,
  p_document_id text,
  p_page integer,
  p_quote text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_doc uuid;
  v_page_text text;
BEGIN
  BEGIN
    v_doc := p_document_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  SELECT page.page_text
    INTO v_page_text
    FROM hive.investigation_evidence_pin_pages bound
    JOIN hive.document_pages page ON page.id = bound.document_page_id
   WHERE bound.hive_id = p_pin.hive_id
     AND bound.pin_id = p_pin.pin_id
     AND bound.source_document_id = v_doc
     AND bound.page_number = p_page
     AND page.hive_id = p_pin.hive_id
     AND page.source_document_id = v_doc
     AND page.page_number = p_page;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN hive.quote_on_page(p_quote, v_page_text);
END;
$$;

-- Null means the candidate may be decided. Otherwise the failure code.
CREATE OR REPLACE FUNCTION hive.relationship_verification_candidate_block(
  p_pin hive.investigation_evidence_pins,
  p_candidate jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_pack jsonb;
  v_plan jsonb;
  v_pack_text text;
  v_plan_text text;
  v_key text;
  v_item jsonb;
  v_ref jsonb;
  v_def jsonb;
  v_page numeric;
  v_from text[];
  v_to text[];
  v_swapped_from text[];
  v_swapped_to text[];
  v_value text;
  v_found boolean;
  v_quote text;
  v_allowed text[] := ARRAY[
    'candidateId', 'kind', 'trust', 'reasons', 'entityId', 'instanceId', 'fieldId', 'documentId',
    'documentKindId', 'extractionFactId', 'relationshipId', 'fromEntityId', 'toEntityId',
    'fromInstanceId', 'toInstanceId', 'sourceRefs', 'evidence'
  ];
BEGIN
  IF jsonb_typeof(p_candidate) IS DISTINCT FROM 'object' THEN
    RETURN 'CANDIDATE_INVALID';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_candidate) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RETURN 'CANDIDATE_INVALID';
    END IF;
  END LOOP;
  IF NOT hive.relationship_verification_plain(p_candidate->>'candidateId', 200)
     OR p_candidate->>'kind' IS DISTINCT FROM 'RELATIONSHIP'
     OR p_candidate->>'trust' IS DISTINCT FROM 'REVIEW_REQUIRED'
     OR jsonb_typeof(p_candidate->'reasons') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_candidate->'reasons') IS DISTINCT FROM 1
     OR p_candidate->'reasons'->>0 IS DISTINCT FROM 'RELATIONSHIP_SEMANTICS_UNVERIFIED'
     OR NOT hive.relationship_verification_plain(p_candidate->>'relationshipId', 200)
     OR NOT hive.relationship_verification_plain(p_candidate->>'fromEntityId', 200)
     OR NOT hive.relationship_verification_plain(p_candidate->>'toEntityId', 200)
     OR NOT hive.relationship_verification_plain(p_candidate->>'fromInstanceId', 200)
     OR NOT hive.relationship_verification_plain(p_candidate->>'toInstanceId', 200)
     OR jsonb_typeof(p_candidate->'evidence') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_candidate->'evidence') < 1 THEN
    RETURN 'NOT_ELIGIBLE';
  END IF;
  IF p_candidate ? 'sourceRefs' THEN
    IF jsonb_typeof(p_candidate->'sourceRefs') IS DISTINCT FROM 'array' THEN
      RETURN 'CANDIDATE_INVALID';
    END IF;
    FOR v_ref IN SELECT value FROM jsonb_array_elements(p_candidate->'sourceRefs') LOOP
      IF NOT hive.relationship_verification_exact_keys(v_ref, ARRAY['documentId', 'page', 'excerptId'])
         OR NOT hive.relationship_verification_plain(v_ref->>'documentId', 200) THEN
        RETURN 'CANDIDATE_INVALID';
      END IF;
    END LOOP;
  END IF;

  SELECT canonical_json INTO v_pack_text
    FROM hive.investigation_artifact_preimages
   WHERE digest = p_pin.pack_digest AND kind = 'PACK';
  SELECT canonical_json INTO v_plan_text
    FROM hive.investigation_artifact_preimages
   WHERE digest = p_pin.plan_digest AND kind = 'PLAN';
  IF v_pack_text IS NULL OR v_plan_text IS NULL
     OR hive.sha256_hex(v_pack_text) IS DISTINCT FROM p_pin.pack_digest
     OR hive.sha256_hex(v_plan_text) IS DISTINCT FROM p_pin.plan_digest THEN
    RETURN 'DIGEST_MISMATCH';
  END IF;
  v_pack := v_pack_text::jsonb;
  v_plan := v_plan_text::jsonb;
  SELECT value INTO v_def
    FROM jsonb_array_elements(coalesce(v_pack->'definitions', '[]'::jsonb)) AS value
   WHERE value->>'id' = p_candidate->>'relationshipId'
     AND value->>'kind' = 'relationship'
   LIMIT 1;
  IF v_def IS NULL
     OR v_def->>'fromEntityId' IS DISTINCT FROM p_candidate->>'fromEntityId'
     OR v_def->>'toEntityId' IS DISTINCT FROM p_candidate->>'toEntityId' THEN
    RETURN 'NOT_ELIGIBLE';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_candidate->'evidence') LOOP
    IF NOT hive.relationship_verification_exact_keys(v_item, ARRAY['sourceDocumentId', 'page', 'quote'])
       OR NOT hive.relationship_verification_plain(v_item->>'sourceDocumentId', 200)
       OR NOT hive.relationship_verification_plain(v_item->>'quote', 20000)
       OR jsonb_typeof(v_item->'page') IS DISTINCT FROM 'number' THEN
      RETURN 'CANDIDATE_INVALID';
    END IF;
    v_page := (v_item->>'page')::numeric;
    IF v_page IS NULL OR v_page < 1 OR v_page <> trunc(v_page) THEN
      RETURN 'CANDIDATE_INVALID';
    END IF;
    IF NOT hive.relationship_verification_quote_on_pin(p_pin, v_item->>'sourceDocumentId', v_page::integer, v_item->>'quote') THEN
      RETURN 'NOT_ELIGIBLE';
    END IF;
  END LOOP;

  v_from := hive.relationship_verification_identity_values(
    v_plan, p_pin.verified, p_candidate->>'fromEntityId', p_candidate->>'fromInstanceId'
  );
  v_to := hive.relationship_verification_identity_values(
    v_plan, p_pin.verified, p_candidate->>'toEntityId', p_candidate->>'toInstanceId'
  );
  IF v_from IS NULL OR v_to IS NULL THEN
    RETURN 'NOT_ELIGIBLE';
  END IF;
  v_swapped_from := hive.relationship_verification_identity_values(
    v_plan, p_pin.verified, p_candidate->>'fromEntityId', p_candidate->>'toInstanceId'
  );
  v_swapped_to := hive.relationship_verification_identity_values(
    v_plan, p_pin.verified, p_candidate->>'toEntityId', p_candidate->>'fromInstanceId'
  );
  IF v_swapped_from IS NOT NULL OR v_swapped_to IS NOT NULL THEN
    RETURN 'NOT_ELIGIBLE';
  END IF;
  FOREACH v_value IN ARRAY (v_from || v_to) LOOP
    v_found := false;
    FOR v_quote IN
      SELECT value->>'quote' FROM jsonb_array_elements(p_candidate->'evidence') AS value
    LOOP
      IF hive.relationship_verification_contains_phrase(v_quote, v_value) THEN
        v_found := true;
      END IF;
    END LOOP;
    IF NOT v_found THEN
      RETURN 'NOT_ELIGIBLE';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_quotations(p_candidate jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_quotes jsonb := '[]'::jsonb;
  v_page integer;
BEGIN
  FOR v_item IN
    SELECT value
      FROM jsonb_array_elements(coalesce(p_candidate->'evidence', '[]'::jsonb))
  LOOP
    v_page := (v_item->>'page')::integer;
    v_quotes := v_quotes || jsonb_build_array(jsonb_build_object(
      'documentId', v_item->>'sourceDocumentId',
      'excerptId', hive.relationship_verification_excerpt_id(v_item->>'sourceDocumentId', v_page, v_item->>'quote'),
      'page', v_page,
      'quote', v_item->>'quote'
    ));
  END LOOP;
  RETURN v_quotes;
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_excerpt_ids(p_quotations jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(value->>'excerptId' ORDER BY ordinality), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(p_quotations, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality);
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_find_candidate(
  p_pin hive.investigation_evidence_pins,
  p_candidate_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT value
    FROM jsonb_array_elements(coalesce(p_pin.unresolved->'candidates', '[]'::jsonb)) AS value
   WHERE value->>'candidateId' = p_candidate_id
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_pin_digests_ok(
  p_pin hive.investigation_evidence_pins
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_body jsonb;
BEGIN
  IF hive.sha256_hex(p_pin.canonical_json) IS DISTINCT FROM p_pin.pin_id THEN
    RETURN false;
  END IF;
  v_body := p_pin.canonical_json::jsonb;
  IF v_body->>'schema' IS DISTINCT FROM 'hive.investigation-evidence-pin/1'
     OR v_body->>'extractionDigest' IS DISTINCT FROM p_pin.extraction_digest
     OR v_body->>'binderDigest' IS DISTINCT FROM p_pin.binder_digest
     OR v_body->>'evidenceDigest' IS DISTINCT FROM p_pin.evidence_digest
     OR v_body->>'sourceGenerationsDigest' IS DISTINCT FROM p_pin.source_generations_digest
     OR v_body->'artifacts'->'pack'->>'digest' IS DISTINCT FROM p_pin.pack_digest
     OR v_body->'artifacts'->'plan'->>'digest' IS DISTINCT FROM p_pin.plan_digest THEN
    RETURN false;
  END IF;
  IF hive.sha256_hex(hive.canonical_json(jsonb_build_object(
       'unresolved', p_pin.unresolved,
       'verified', p_pin.verified
     ))) IS DISTINCT FROM p_pin.binder_digest
     OR hive.sha256_hex(hive.investigation_evidence_canonical(p_pin.verified, p_pin.unresolved))
        IS DISTINCT FROM p_pin.evidence_digest
     OR hive.sha256_hex(hive.canonical_json(p_pin.source_generations))
        IS DISTINCT FROM p_pin.source_generations_digest THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_pin.verified->'relationships') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_pin.verified->'relationships') <> 0 THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM hive.investigation_artifact_preimages
     WHERE digest = p_pin.pack_digest AND kind = 'PACK'
  ) AND EXISTS (
    SELECT 1 FROM hive.investigation_artifact_preimages
     WHERE digest = p_pin.plan_digest AND kind = 'PLAN'
  );
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_structure(
  p_structure_json text,
  p_relationship_id text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_parsed jsonb;
  v_body jsonb;
  v_slot jsonb;
  v_roles text[] := ARRAY[]::text[];
  v_role text;
  v_digest text;
BEGIN
  IF p_structure_json IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_parsed := p_structure_json::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    PERFORM hive.relationship_verification_raise('STRUCTURE_UNAPPROVED');
  END;
  IF jsonb_typeof(v_parsed) IS DISTINCT FROM 'object'
     OR NOT hive.relationship_verification_exact_keys(
       v_parsed, ARRAY['schema', 'relationshipId', 'structureDigest', 'direction', 'polarity', 'slots']
     )
     OR v_parsed->>'schema' IS DISTINCT FROM 'hive.relationship-source-structure/1'
     OR v_parsed->>'direction' IS DISTINCT FROM 'AUTHORED_FROM_TO'
     OR v_parsed->>'polarity' NOT IN ('HOLDS', 'DOES_NOT_HOLD')
     OR NOT hive.relationship_verification_plain(v_parsed->>'relationshipId', 200)
     OR coalesce(v_parsed->>'structureDigest', '') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(v_parsed->'slots') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_parsed->'slots') IS DISTINCT FROM 4 THEN
    PERFORM hive.relationship_verification_raise('STRUCTURE_UNAPPROVED');
  END IF;
  FOR v_slot IN SELECT value FROM jsonb_array_elements(v_parsed->'slots') LOOP
    IF NOT hive.relationship_verification_exact_keys(v_slot, ARRAY['role', 'value'])
       OR v_slot->>'role' NOT IN ('FROM_IDENTITY', 'TO_IDENTITY', 'POLARITY', 'DIRECTION')
       OR NOT hive.relationship_verification_plain(v_slot->>'value', 2000) THEN
      PERFORM hive.relationship_verification_raise('STRUCTURE_UNAPPROVED');
    END IF;
    v_roles := array_append(v_roles, v_slot->>'role');
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['FROM_IDENTITY', 'TO_IDENTITY', 'POLARITY', 'DIRECTION'] LOOP
    IF (SELECT count(*) FROM unnest(v_roles) AS role WHERE role = v_role) IS DISTINCT FROM 1 THEN
      PERFORM hive.relationship_verification_raise('STRUCTURE_UNAPPROVED');
    END IF;
  END LOOP;
  v_body := v_parsed - 'structureDigest';
  v_digest := hive.sha256_hex(hive.canonical_json(v_body));
  IF v_digest IS DISTINCT FROM v_parsed->>'structureDigest' THEN
    PERFORM hive.relationship_verification_raise('STRUCTURE_UNAPPROVED');
  END IF;
  IF v_parsed->>'relationshipId' IS DISTINCT FROM p_relationship_id THEN
    RETURN NULL;
  END IF;
  RETURN v_parsed;
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_typed_effect(
  p_pin hive.investigation_evidence_pins,
  p_candidate jsonb,
  p_structure jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_plan text;
  v_plan_json jsonb;
  v_from text[];
  v_to text[];
  v_quote text;
  v_presented boolean;
  v_from_slot text;
  v_to_slot text;
  v_polarity_slot text;
  v_direction_slot text;
  v_from_token text;
  v_to_token text;
  v_direction text;
  v_scalar boolean;
BEGIN
  IF p_structure IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT canonical_json INTO v_plan
    FROM hive.investigation_artifact_preimages
   WHERE digest = p_pin.plan_digest AND kind = 'PLAN';
  IF v_plan IS NULL THEN
    PERFORM hive.relationship_verification_raise('DIGEST_MISMATCH');
  END IF;
  v_plan_json := v_plan::jsonb;
  v_from := hive.relationship_verification_identity_values(
    v_plan_json, p_pin.verified, p_candidate->>'fromEntityId', p_candidate->>'fromInstanceId'
  );
  v_to := hive.relationship_verification_identity_values(
    v_plan_json, p_pin.verified, p_candidate->>'toEntityId', p_candidate->>'toInstanceId'
  );
  IF v_from IS NULL OR v_to IS NULL THEN
    RETURN 'WITHHOLDS';
  END IF;
  SELECT string_agg(hive.normalize_quote_text(value), E'\u001f' ORDER BY ordinality)
    INTO v_from_token
    FROM unnest(v_from) WITH ORDINALITY AS item(value, ordinality);
  SELECT string_agg(hive.normalize_quote_text(value), E'\u001f' ORDER BY ordinality)
    INTO v_to_token
    FROM unnest(v_to) WITH ORDINALITY AS item(value, ordinality);
  SELECT value->>'value' INTO v_from_slot
    FROM jsonb_array_elements(p_structure->'slots') AS value
   WHERE value->>'role' = 'FROM_IDENTITY' LIMIT 1;
  SELECT value->>'value' INTO v_to_slot
    FROM jsonb_array_elements(p_structure->'slots') AS value
   WHERE value->>'role' = 'TO_IDENTITY' LIMIT 1;
  SELECT value->>'value' INTO v_polarity_slot
    FROM jsonb_array_elements(p_structure->'slots') AS value
   WHERE value->>'role' = 'POLARITY' LIMIT 1;
  SELECT value->>'value' INTO v_direction_slot
    FROM jsonb_array_elements(p_structure->'slots') AS value
   WHERE value->>'role' = 'DIRECTION' LIMIT 1;
  v_presented := true;
  FOREACH v_quote IN ARRAY ARRAY[v_polarity_slot, v_direction_slot, v_from_slot, v_to_slot] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p_candidate->'evidence') AS evidence
       WHERE hive.relationship_verification_contains_phrase(evidence->>'quote', v_quote)
    ) THEN
      v_presented := false;
    END IF;
  END LOOP;
  IF NOT v_presented THEN
    RETURN NULL;
  END IF;
  v_direction := (p_candidate->>'fromInstanceId') || '->' || (p_candidate->>'toInstanceId');
  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(coalesce(p_pin.verified->'facts', '[]'::jsonb)) AS fact
     WHERE fact->>'status' = 'VERIFIED'
       AND hive.normalize_quote_text(fact->'value'->>'value') = hive.normalize_quote_text(v_polarity_slot)
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(coalesce(fact->'sourceRefs', '[]'::jsonb)) AS ref
          WHERE coalesce(ref->>'documentId', '') <> ''
       )
  ) INTO v_scalar;
  IF NOT (
    hive.normalize_quote_text(v_from_slot) = v_from_token
    AND hive.normalize_quote_text(v_to_slot) = v_to_token
    AND v_scalar
    AND hive.normalize_quote_text(v_direction_slot) = hive.normalize_quote_text(v_direction)
  ) THEN
    RETURN 'WITHHOLDS';
  END IF;
  IF p_structure->>'polarity' = 'HOLDS' THEN
    RETURN 'SUPPORTS';
  END IF;
  RETURN 'OPPOSES';
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_typed_request_id(
  p_content_digest text,
  p_structure_digest text,
  p_pin hive.investigation_evidence_pins,
  p_effect text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT hive.sha256_hex(hive.canonical_json(jsonb_build_object(
    'candidateContentDigest', p_content_digest,
    'effect', p_effect,
    'evidenceRevision', jsonb_build_object(
      'binderDigest', p_pin.binder_digest,
      'evidenceDigest', p_pin.evidence_digest,
      'extractionDigest', p_pin.extraction_digest
    ),
    'structureDigest', p_structure_digest
  )));
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_render(
  p_request_id text,
  p_sequence integer,
  p_parent text,
  p_candidate_id text,
  p_content_digest text,
  p_relationship_id text,
  p_endpoints jsonb,
  p_quotations jsonb,
  p_method text,
  p_effect text,
  p_actor_id text,
  p_decision text,
  p_target_record_id text,
  p_structure_digest text,
  p_polarity text,
  p_decided_at text,
  p_pin hive.investigation_evidence_pins
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_body jsonb;
BEGIN
  v_body := jsonb_build_object(
    'actorId', p_actor_id,
    'candidateContentDigest', p_content_digest,
    'candidateId', p_candidate_id,
    'causalParentId', p_parent,
    'decision', p_decision,
    'decidedAt', p_decided_at,
    'effect', p_effect,
    'endpoints', p_endpoints,
    'evidenceRevision', jsonb_build_object(
      'binderDigest', p_pin.binder_digest,
      'evidenceDigest', p_pin.evidence_digest,
      'extractionDigest', p_pin.extraction_digest
    ),
    'method', p_method,
    'packDigest', p_pin.pack_digest,
    'permission', 'HIVE_OWNER',
    'planDigest', p_pin.plan_digest,
    'quotations', p_quotations,
    'relationshipId', p_relationship_id,
    'requestId', p_request_id,
    'schema', 'hive.relationship-verification/1',
    'sequence', p_sequence
  );
  IF p_target_record_id IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('targetRecordId', p_target_record_id);
  END IF;
  IF p_structure_digest IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('structureDigest', p_structure_digest, 'polarity', p_polarity);
  END IF;
  RETURN hive.canonical_json(v_body);
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_chain_head(
  p_hive_id uuid,
  p_pin_id text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT record_id
    FROM hive.relationship_verification_chain
   WHERE hive_id = p_hive_id
     AND pin_id = p_pin_id
     AND sequence > 0
   ORDER BY sequence DESC
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_next_sequence(
  p_hive_id uuid,
  p_pin_id text
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT coalesce(max(sequence), 0) + 1
    FROM hive.relationship_verification_chain
   WHERE hive_id = p_hive_id
     AND pin_id = p_pin_id;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_parent_id(
  p_hive_id uuid,
  p_pin_id text,
  p_sequence integer
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT CASE
    WHEN p_sequence = 1 THEN NULL
    ELSE (
      SELECT record_id
        FROM hive.relationship_verification_chain
       WHERE hive_id = p_hive_id
         AND pin_id = p_pin_id
         AND sequence = p_sequence - 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_support_open(
  p_hive_id uuid,
  p_pin_id text,
  p_candidate_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hive.relationship_verification_chain support
     WHERE support.hive_id = p_hive_id
       AND support.pin_id = p_pin_id
       AND support.sequence > 0
       AND support.canonical_json::jsonb->>'effect' = 'SUPPORTS'
       AND support.canonical_json::jsonb->>'candidateId' = p_candidate_id
       AND NOT EXISTS (
         SELECT 1
           FROM hive.relationship_verification_chain revoke_row
          WHERE revoke_row.hive_id = support.hive_id
            AND revoke_row.pin_id = support.pin_id
            AND revoke_row.canonical_json::jsonb->>'effect' = 'REVOKES'
            AND revoke_row.canonical_json::jsonb->>'targetRecordId' = support.record_id
       )
  );
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_opposition(
  p_hive_id uuid,
  p_pin_id text,
  p_relationship_id text,
  p_from_instance_id text,
  p_to_instance_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hive.relationship_verification_chain chain
     WHERE chain.hive_id = p_hive_id
       AND chain.pin_id = p_pin_id
       AND chain.sequence > 0
       AND chain.canonical_json::jsonb->>'effect' = 'OPPOSES'
       AND chain.canonical_json::jsonb->>'relationshipId' = p_relationship_id
       AND chain.canonical_json::jsonb->'endpoints'->0->>'instanceId' = p_from_instance_id
       AND chain.canonical_json::jsonb->'endpoints'->1->>'instanceId' = p_to_instance_id
  );
$$;

-- Builds the only record body this pin and decision can append.
CREATE OR REPLACE FUNCTION hive.relationship_verification_canonical_record(
  p_hive_id uuid,
  p_owner_user_id uuid,
  p_pin_id text,
  p_request_id text,
  p_expected_head text,
  p_candidate_id text,
  p_decision text,
  p_target_record_id text,
  p_decided_at timestamptz,
  p_structure_json text,
  p_check_head boolean
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_pin hive.investigation_evidence_pins%ROWTYPE;
  v_candidate jsonb;
  v_block text;
  v_structure jsonb;
  v_typed text;
  v_quotes jsonb;
  v_endpoints jsonb;
  v_content text;
  v_method text;
  v_effect text;
  v_decision text;
  v_target text;
  v_structure_digest text;
  v_polarity text;
  v_request text;
  v_sequence integer;
  v_parent text;
  v_head text;
  v_decided text;
  v_actor text;
  v_target_row hive.relationship_verification_chain%ROWTYPE;
  v_target_body jsonb;
BEGIN
  SELECT * INTO v_pin
    FROM hive.investigation_evidence_pins
   WHERE hive_id = p_hive_id
     AND pin_id = p_pin_id
     AND owner_user_id = p_owner_user_id;
  IF NOT FOUND THEN
    PERFORM hive.relationship_verification_raise('pin_not_found');
  END IF;
  IF NOT hive.relationship_verification_pin_digests_ok(v_pin) THEN
    PERFORM hive.relationship_verification_raise('DIGEST_MISMATCH');
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM hive.relationship_verification_chain
     WHERE hive_id = p_hive_id
       AND pin_id = p_pin_id
       AND sequence = 0
  ) OR (
    SELECT count(*) FROM hive.relationship_verification_chain
     WHERE hive_id = p_hive_id AND pin_id = p_pin_id
  ) IS DISTINCT FROM (
    SELECT coalesce(max(sequence), 0) + 1
      FROM hive.relationship_verification_chain
     WHERE hive_id = p_hive_id AND pin_id = p_pin_id
  ) THEN
    PERFORM hive.relationship_verification_raise('CHAIN_INVALID');
  END IF;

  v_candidate := hive.relationship_verification_find_candidate(v_pin, p_candidate_id);
  IF v_candidate IS NULL THEN
    PERFORM hive.relationship_verification_raise('CANDIDATE_INVALID');
  END IF;
  v_block := hive.relationship_verification_candidate_block(v_pin, v_candidate);
  IF v_block IS NOT NULL THEN
    PERFORM hive.relationship_verification_raise(v_block);
  END IF;

  v_structure := hive.relationship_verification_structure(p_structure_json, v_candidate->>'relationshipId');
  v_typed := hive.relationship_verification_typed_effect(v_pin, v_candidate, v_structure);
  v_quotes := hive.relationship_verification_quotations(v_candidate);
  v_endpoints := jsonb_build_array(
    jsonb_build_object('entityId', v_candidate->>'fromEntityId', 'instanceId', v_candidate->>'fromInstanceId'),
    jsonb_build_object('entityId', v_candidate->>'toEntityId', 'instanceId', v_candidate->>'toInstanceId')
  );
  v_content := hive.relationship_verification_content_digest(
    v_candidate->>'relationshipId',
    v_candidate->>'fromEntityId',
    v_candidate->>'toEntityId',
    v_candidate->>'fromInstanceId',
    v_candidate->>'toInstanceId',
    hive.relationship_verification_excerpt_ids(v_quotes)
  );
  v_decided := hive.relationship_verification_decided_at(p_decided_at);
  IF v_decided IS NULL OR v_decided !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' THEN
    PERFORM hive.relationship_verification_raise('invalid_request');
  END IF;
  v_actor := lower(p_owner_user_id::text);
  v_sequence := hive.relationship_verification_next_sequence(p_hive_id, p_pin_id);
  v_parent := hive.relationship_verification_parent_id(p_hive_id, p_pin_id, v_sequence);
  v_head := hive.relationship_verification_chain_head(p_hive_id, p_pin_id);

  IF v_typed IN ('SUPPORTS', 'OPPOSES', 'WITHHOLDS') AND v_structure IS NOT NULL THEN
    v_method := 'TYPED_SOURCE';
    v_effect := v_typed;
    v_decision := CASE WHEN v_typed = 'SUPPORTS' THEN 'ACCEPT' ELSE 'REJECT' END;
    v_target := NULL;
    v_structure_digest := v_structure->>'structureDigest';
    v_polarity := v_structure->>'polarity';
    v_request := hive.relationship_verification_typed_request_id(v_content, v_structure_digest, v_pin, v_effect);
  ELSE
    IF p_decision NOT IN ('ACCEPT', 'REJECT', 'REVOKE') THEN
      PERFORM hive.relationship_verification_raise('REQUEST_INVALID');
    END IF;
    IF p_check_head AND p_expected_head IS DISTINCT FROM v_head THEN
      PERFORM hive.relationship_verification_raise('CAUSAL_CONFLICT');
    END IF;
    IF p_decision = 'ACCEPT' AND hive.relationship_verification_opposition(
      p_hive_id, p_pin_id, v_candidate->>'relationshipId',
      v_candidate->>'fromInstanceId', v_candidate->>'toInstanceId'
    ) THEN
      PERFORM hive.relationship_verification_raise('HUMAN_WITHHELD');
    END IF;
    IF p_decision IN ('ACCEPT', 'REJECT')
       AND hive.relationship_verification_support_open(p_hive_id, p_pin_id, p_candidate_id) THEN
      PERFORM hive.relationship_verification_raise('NOT_ELIGIBLE');
    END IF;
    IF p_decision = 'REVOKE' THEN
      IF NOT hive.relationship_verification_plain(p_target_record_id, 128) THEN
        PERFORM hive.relationship_verification_raise('REQUEST_INVALID');
      END IF;
      SELECT * INTO v_target_row
        FROM hive.relationship_verification_chain
       WHERE hive_id = p_hive_id
         AND pin_id = p_pin_id
         AND record_id = p_target_record_id
         AND sequence > 0
         AND sequence < v_sequence;
      IF NOT FOUND THEN
        PERFORM hive.relationship_verification_raise('NOT_ELIGIBLE');
      END IF;
      v_target_body := v_target_row.canonical_json::jsonb;
      IF v_target_body->>'method' IS DISTINCT FROM 'AUTHORIZED_HUMAN'
         OR v_target_body->>'decision' IS DISTINCT FROM 'ACCEPT'
         OR v_target_body->>'effect' IS DISTINCT FROM 'SUPPORTS'
         OR v_target_body->>'candidateId' IS DISTINCT FROM p_candidate_id
         OR v_target_body->>'candidateContentDigest' IS DISTINCT FROM v_content THEN
        PERFORM hive.relationship_verification_raise('NOT_ELIGIBLE');
      END IF;
      IF EXISTS (
        SELECT 1
          FROM hive.relationship_verification_chain
         WHERE hive_id = p_hive_id
           AND pin_id = p_pin_id
           AND canonical_json::jsonb->>'effect' = 'REVOKES'
           AND canonical_json::jsonb->>'targetRecordId' = p_target_record_id
      ) THEN
        PERFORM hive.relationship_verification_raise('CAUSAL_CONFLICT');
      END IF;
      v_quotes := v_target_body->'quotations';
      v_endpoints := v_target_body->'endpoints';
      v_method := 'AUTHORIZED_HUMAN';
      v_effect := 'REVOKES';
      v_decision := 'REVOKE';
      v_target := p_target_record_id;
      v_structure_digest := NULL;
      v_polarity := NULL;
      v_request := p_request_id;
    ELSE
      IF p_target_record_id IS NOT NULL THEN
        PERFORM hive.relationship_verification_raise('REQUEST_INVALID');
      END IF;
      v_method := 'AUTHORIZED_HUMAN';
      v_effect := CASE WHEN p_decision = 'ACCEPT' THEN 'SUPPORTS' ELSE 'WITHHOLDS' END;
      v_decision := p_decision;
      v_target := NULL;
      v_structure_digest := NULL;
      v_polarity := NULL;
      v_request := p_request_id;
    END IF;
  END IF;

  IF NOT hive.relationship_verification_plain(v_request, 200) THEN
    PERFORM hive.relationship_verification_raise('REQUEST_INVALID');
  END IF;
  RETURN hive.relationship_verification_render(
    v_request, v_sequence, v_parent, p_candidate_id, v_content,
    coalesce(v_target_body->>'relationshipId', v_candidate->>'relationshipId'),
    v_endpoints, v_quotes, v_method, v_effect, v_actor, v_decision, v_target,
    v_structure_digest, v_polarity, v_decided, v_pin
  );
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_append_granted(
  p_row hive.relationship_verification_chain
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_nonce text := current_setting('hive.relationship_verification_append_nonce', true);
BEGIN
  IF v_nonce IS NULL OR v_nonce !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM hive.relationship_verification_append_grants grant_row
     WHERE grant_row.nonce = v_nonce
       AND grant_row.hive_id = p_row.hive_id
       AND grant_row.pin_id = p_row.pin_id
       AND grant_row.sequence = p_row.sequence
       AND grant_row.record_id = p_row.record_id
       AND grant_row.canonical_json = p_row.canonical_json
  );
END;
$$;

-- Rebinds an inserted decision to the pin. A grant or lifecycle flag is not enough.
CREATE OR REPLACE FUNCTION hive.relationship_verification_chain_row_allowed(
  p_row hive.relationship_verification_chain
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_pin hive.investigation_evidence_pins%ROWTYPE;
  v_body jsonb;
  v_candidate jsonb;
  v_block text;
  v_expected text;
  v_sequence integer;
  v_parent text;
  v_target jsonb;
BEGIN
  SELECT * INTO v_pin
    FROM hive.investigation_evidence_pins
   WHERE hive_id = p_row.hive_id
     AND pin_id = p_row.pin_id;
  IF NOT FOUND OR NOT hive.relationship_verification_pin_digests_ok(v_pin) THEN
    PERFORM hive.relationship_verification_raise('DIGEST_MISMATCH');
  END IF;
  IF hive.canonical_json(p_row.canonical_json::jsonb) IS DISTINCT FROM p_row.canonical_json
     OR hive.sha256_hex(p_row.canonical_json) IS DISTINCT FROM p_row.record_id
     OR p_row.sequence IS DISTINCT FROM hive.relationship_verification_next_sequence(p_row.hive_id, p_row.pin_id)
     OR p_row.causal_parent_id IS DISTINCT FROM hive.relationship_verification_parent_id(
          p_row.hive_id, p_row.pin_id, p_row.sequence
        ) THEN
    PERFORM hive.relationship_verification_raise('CHAIN_INVALID');
  END IF;
  IF p_row.pack_digest IS DISTINCT FROM v_pin.pack_digest
     OR p_row.plan_digest IS DISTINCT FROM v_pin.plan_digest
     OR p_row.extraction_digest IS DISTINCT FROM v_pin.extraction_digest
     OR p_row.binder_digest IS DISTINCT FROM v_pin.binder_digest
     OR p_row.evidence_digest IS DISTINCT FROM v_pin.evidence_digest THEN
    PERFORM hive.relationship_verification_raise('DIGEST_MISMATCH');
  END IF;
  v_body := p_row.canonical_json::jsonb;
  IF v_body->>'permission' IS DISTINCT FROM 'HIVE_OWNER'
     OR v_body->>'actorId' IS DISTINCT FROM lower(v_pin.owner_user_id::text) THEN
    PERFORM hive.relationship_verification_raise('PERMISSION_DENIED');
  END IF;
  IF v_body->'evidenceRevision'->>'extractionDigest' IS DISTINCT FROM v_pin.extraction_digest
     OR v_body->'evidenceRevision'->>'binderDigest' IS DISTINCT FROM v_pin.binder_digest
     OR v_body->'evidenceRevision'->>'evidenceDigest' IS DISTINCT FROM v_pin.evidence_digest
     OR v_body->>'packDigest' IS DISTINCT FROM v_pin.pack_digest
     OR v_body->>'planDigest' IS DISTINCT FROM v_pin.plan_digest THEN
    PERFORM hive.relationship_verification_raise('DIGEST_MISMATCH');
  END IF;
  v_candidate := hive.relationship_verification_find_candidate(v_pin, v_body->>'candidateId');
  IF v_candidate IS NULL THEN
    PERFORM hive.relationship_verification_raise('CANDIDATE_INVALID');
  END IF;
  IF v_body->>'decision' = 'REVOKE' THEN
    SELECT canonical_json::jsonb INTO v_target
      FROM hive.relationship_verification_chain
     WHERE hive_id = p_row.hive_id
       AND pin_id = p_row.pin_id
       AND record_id = v_body->>'targetRecordId'
       AND sequence > 0
       AND sequence < p_row.sequence;
    IF v_target IS NULL
       OR v_target->>'method' IS DISTINCT FROM 'AUTHORIZED_HUMAN'
       OR v_target->>'decision' IS DISTINCT FROM 'ACCEPT'
       OR v_target->>'effect' IS DISTINCT FROM 'SUPPORTS'
       OR v_body->>'method' IS DISTINCT FROM 'AUTHORIZED_HUMAN'
       OR v_body->>'effect' IS DISTINCT FROM 'REVOKES'
       OR v_body->'quotations' IS DISTINCT FROM v_target->'quotations'
       OR v_body->'endpoints' IS DISTINCT FROM v_target->'endpoints'
       OR v_body->>'relationshipId' IS DISTINCT FROM v_target->>'relationshipId'
       OR v_body->>'candidateId' IS DISTINCT FROM v_target->>'candidateId'
       OR v_body->>'candidateContentDigest' IS DISTINCT FROM v_target->>'candidateContentDigest' THEN
      PERFORM hive.relationship_verification_raise('NOT_ELIGIBLE');
    END IF;
  ELSE
    v_block := hive.relationship_verification_candidate_block(v_pin, v_candidate);
    IF v_block IS NOT NULL THEN
      PERFORM hive.relationship_verification_raise(v_block);
    END IF;
    IF v_body->'quotations' IS DISTINCT FROM hive.relationship_verification_quotations(v_candidate)
       OR v_body->>'relationshipId' IS DISTINCT FROM v_candidate->>'relationshipId'
       OR v_body->'endpoints'->0->>'entityId' IS DISTINCT FROM v_candidate->>'fromEntityId'
       OR v_body->'endpoints'->0->>'instanceId' IS DISTINCT FROM v_candidate->>'fromInstanceId'
       OR v_body->'endpoints'->1->>'entityId' IS DISTINCT FROM v_candidate->>'toEntityId'
       OR v_body->'endpoints'->1->>'instanceId' IS DISTINCT FROM v_candidate->>'toInstanceId' THEN
      PERFORM hive.relationship_verification_raise('CANDIDATE_INVALID');
    END IF;
    IF v_body->>'method' = 'AUTHORIZED_HUMAN' THEN
      IF (v_body->>'decision' = 'ACCEPT' AND v_body->>'effect' IS DISTINCT FROM 'SUPPORTS')
         OR (v_body->>'decision' = 'REJECT' AND v_body->>'effect' IS DISTINCT FROM 'WITHHOLDS')
         OR v_body ? 'targetRecordId'
         OR v_body ? 'structureDigest'
         OR v_body ? 'polarity' THEN
        PERFORM hive.relationship_verification_raise('CHAIN_INVALID');
      END IF;
    ELSIF v_body->>'method' = 'TYPED_SOURCE' THEN
      IF coalesce(v_body->>'structureDigest', '') !~ '^[0-9a-f]{64}$'
         OR v_body->>'polarity' NOT IN ('HOLDS', 'DOES_NOT_HOLD')
         OR v_body ? 'targetRecordId'
         OR (v_body->>'decision' = 'ACCEPT' AND (v_body->>'effect' IS DISTINCT FROM 'SUPPORTS' OR v_body->>'polarity' IS DISTINCT FROM 'HOLDS'))
         OR (v_body->>'decision' = 'REJECT' AND v_body->>'effect' NOT IN ('WITHHOLDS', 'OPPOSES')) THEN
        PERFORM hive.relationship_verification_raise('CHAIN_INVALID');
      END IF;
    ELSE
      PERFORM hive.relationship_verification_raise('CHAIN_INVALID');
    END IF;
  END IF;

  v_sequence := p_row.sequence;
  v_parent := p_row.causal_parent_id;
  v_expected := hive.relationship_verification_render(
    v_body->>'requestId',
    v_sequence,
    v_parent,
    v_body->>'candidateId',
    v_body->>'candidateContentDigest',
    v_body->>'relationshipId',
    v_body->'endpoints',
    v_body->'quotations',
    v_body->>'method',
    v_body->>'effect',
    v_body->>'actorId',
    v_body->>'decision',
    v_body->>'targetRecordId',
    v_body->>'structureDigest',
    v_body->>'polarity',
    v_body->>'decidedAt',
    v_pin
  );
  IF v_expected IS DISTINCT FROM p_row.canonical_json THEN
    PERFORM hive.relationship_verification_raise('CHAIN_INVALID');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_raise_mismatch(
  p_expected text,
  p_submitted text,
  p_pin hive.investigation_evidence_pins
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_expected jsonb;
  v_submitted jsonb;
  v_candidate jsonb;
BEGIN
  IF p_submitted IS NULL THEN
    PERFORM hive.relationship_verification_raise('invalid_request');
  END IF;
  BEGIN
    v_submitted := p_submitted::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    PERFORM hive.relationship_verification_raise('invalid_request');
  END;
  IF jsonb_typeof(v_submitted) IS DISTINCT FROM 'object'
     OR hive.canonical_json(v_submitted) IS DISTINCT FROM p_submitted THEN
    PERFORM hive.relationship_verification_raise('CHAIN_INVALID');
  END IF;
  v_expected := p_expected::jsonb;
  IF v_submitted->>'method' = 'TYPED_SOURCE' AND v_expected->>'method' IS DISTINCT FROM 'TYPED_SOURCE' THEN
    PERFORM hive.relationship_verification_raise('STRUCTURE_UNAPPROVED');
  END IF;
  IF v_expected->>'method' = 'TYPED_SOURCE' AND (
       v_submitted->>'method' IS DISTINCT FROM 'TYPED_SOURCE'
       OR v_submitted->>'decision' IS DISTINCT FROM v_expected->>'decision'
     ) THEN
    PERFORM hive.relationship_verification_raise('HUMAN_WITHHELD');
  END IF;
  IF v_submitted->>'actorId' IS DISTINCT FROM lower(p_pin.owner_user_id::text)
     OR v_submitted->>'permission' IS DISTINCT FROM 'HIVE_OWNER' THEN
    PERFORM hive.relationship_verification_raise('PERMISSION_DENIED');
  END IF;
  IF v_submitted->>'packDigest' IS DISTINCT FROM p_pin.pack_digest
     OR v_submitted->>'planDigest' IS DISTINCT FROM p_pin.plan_digest
     OR v_submitted->'evidenceRevision'->>'extractionDigest' IS DISTINCT FROM p_pin.extraction_digest
     OR v_submitted->'evidenceRevision'->>'binderDigest' IS DISTINCT FROM p_pin.binder_digest
     OR v_submitted->'evidenceRevision'->>'evidenceDigest' IS DISTINCT FROM p_pin.evidence_digest THEN
    PERFORM hive.relationship_verification_raise('DIGEST_MISMATCH');
  END IF;
  v_candidate := hive.relationship_verification_find_candidate(p_pin, coalesce(v_submitted->>'candidateId', ''));
  IF v_candidate IS NULL
     OR v_submitted->>'candidateId' IS DISTINCT FROM v_expected->>'candidateId'
     OR v_submitted->'quotations' IS DISTINCT FROM v_expected->'quotations'
     OR v_submitted->'endpoints' IS DISTINCT FROM v_expected->'endpoints'
     OR v_submitted->>'relationshipId' IS DISTINCT FROM v_expected->>'relationshipId'
     OR v_submitted->>'candidateContentDigest' IS DISTINCT FROM v_expected->>'candidateContentDigest' THEN
    PERFORM hive.relationship_verification_raise('CANDIDATE_INVALID');
  END IF;
  IF v_submitted->>'sequence' IS DISTINCT FROM v_expected->>'sequence'
     OR v_submitted->>'causalParentId' IS DISTINCT FROM v_expected->>'causalParentId'
     OR v_submitted->>'requestId' IS DISTINCT FROM v_expected->>'requestId' THEN
    PERFORM hive.relationship_verification_raise('CAUSAL_CONFLICT');
  END IF;
  PERFORM hive.relationship_verification_raise('CHAIN_INVALID');
END;
$$;

CREATE OR REPLACE FUNCTION hive.enforce_evidence_pin_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_mode text := current_setting('hive.evidence_pin_lifecycle', true);
  v_hive_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'evidence_pin_immutable' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'relationship_verification_chain' AND NEW.sequence IS DISTINCT FROM 0 THEN
      -- The lifecycle flag is intentionally ignored here.
      IF NOT hive.relationship_verification_append_granted(NEW) THEN
        RAISE EXCEPTION 'verification_append_unavailable' USING ERRCODE = 'P0001';
      END IF;
      PERFORM hive.relationship_verification_chain_row_allowed(NEW);
      RETURN NEW;
    END IF;
    IF v_mode IS DISTINCT FROM 'insert' THEN
      RAISE EXCEPTION 'evidence_pin_immutable' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'investigation_artifact_preimages' THEN
      IF v_mode = 'delete' AND NOT EXISTS (
        SELECT 1
          FROM hive.investigation_evidence_pins p
         WHERE p.pack_digest = OLD.digest OR p.plan_digest = OLD.digest
      ) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'evidence_pin_immutable' USING ERRCODE = 'P0001';
    END IF;

    v_hive_id := OLD.hive_id;
    IF v_mode = 'delete' AND NOT EXISTS (
      SELECT 1
        FROM hive.hives h
       WHERE h.id = v_hive_id
         AND h.deleting_at IS NULL
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'evidence_pin_immutable' USING ERRCODE = 'P0001';
  END IF;

  RAISE EXCEPTION 'evidence_pin_immutable' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_audit_metadata_ok(p_metadata jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_key text;
  v_value jsonb;
  v_allowed text[] := ARRAY[
    'outcome', 'pinId', 'requestId', 'hiveId', 'recordId', 'sequence',
    'decision', 'effect', 'method', 'candidateId', 'packDigest', 'planDigest',
    'extractionDigest', 'binderDigest', 'evidenceDigest'
  ];
  v_forbidden text[] := ARRAY[
    'quote', 'quotes', 'quotation', 'quotations', 'pageText', 'page_text',
    'text', 'canonicalJson', 'canonical_json', 'preimage'
  ];
BEGIN
  IF jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_metadata) LOOP
    IF v_key = ANY (v_forbidden) OR NOT (v_key = ANY (v_allowed)) THEN
      RETURN false;
    END IF;
    IF v_key = 'sequence' THEN
      IF jsonb_typeof(v_value) IS DISTINCT FROM 'number'
         OR (v_value #>> '{}') !~ '^[1-9][0-9]*$' THEN
        RETURN false;
      END IF;
    ELSIF jsonb_typeof(v_value) IS DISTINCT FROM 'string'
       OR char_length(v_value #>> '{}') < 1
       OR char_length(v_value #>> '{}') > 200 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN (p_metadata->>'outcome') IN ('appended', 'replayed')
    AND (p_metadata->>'decision') IN ('ACCEPT', 'REJECT', 'REVOKE')
    AND (p_metadata->>'effect') IN ('SUPPORTS', 'WITHHOLDS', 'OPPOSES', 'REVOKES')
    AND (p_metadata->>'method') IN ('AUTHORIZED_HUMAN', 'TYPED_SOURCE')
    AND (p_metadata->>'pinId') ~ '^[0-9a-f]{64}$'
    AND (p_metadata->>'recordId') ~ '^[0-9a-f]{64}$'
    AND (p_metadata->>'packDigest') ~ '^[0-9a-f]{64}$'
    AND (p_metadata->>'planDigest') ~ '^[0-9a-f]{64}$'
    AND (p_metadata->>'extractionDigest') ~ '^[0-9a-f]{64}$'
    AND (p_metadata->>'binderDigest') ~ '^[0-9a-f]{64}$'
    AND (p_metadata->>'evidenceDigest') ~ '^[0-9a-f]{64}$';
END;
$$;

CREATE OR REPLACE FUNCTION hive.enforce_evidence_pin_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF NEW.event_type LIKE 'investigation_evidence_pin_%'
     AND NOT hive.evidence_pin_audit_metadata_ok(NEW.safe_metadata) THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NEW.event_type LIKE 'relationship_verification_%'
     AND NOT hive.relationship_verification_audit_metadata_ok(NEW.safe_metadata) THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_receipt(
  p_outcome text,
  p_row hive.relationship_verification_chain
)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_body jsonb := p_row.canonical_json::jsonb;
  v_head text;
BEGIN
  v_head := hive.relationship_verification_chain_head(p_row.hive_id, p_row.pin_id);
  RETURN json_build_object(
    'schema', 'hive.relationship-verification-receipt/1',
    'outcome', p_outcome,
    'code', CASE WHEN p_outcome = 'replayed' THEN 'REPLAYED' ELSE 'APPENDED' END,
    'hiveId', p_row.hive_id,
    'pinId', p_row.pin_id,
    'requestId', p_row.request_id,
    'recordId', p_row.record_id,
    'sequence', p_row.sequence,
    'causalParentId', p_row.causal_parent_id,
    'decision', v_body->>'decision',
    'effect', v_body->>'effect',
    'method', v_body->>'method',
    'candidateId', v_body->>'candidateId',
    'headRecordId', v_head
  );
END;
$$;

CREATE OR REPLACE FUNCTION hive.relationship_verification_audit(
  p_hive hive.hives,
  p_outcome text,
  p_row hive.relationship_verification_chain
)
RETURNS void
LANGUAGE plpgsql
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_body jsonb := p_row.canonical_json::jsonb;
BEGIN
  INSERT INTO hive.audit_events (
    id, owner_user_id, case_id, source_document_id, intake_run_id, event_type,
    actor_user_id, actor_type, correlation_id, safe_metadata
  ) VALUES (
    gen_random_uuid(),
    p_hive.owner_user_id,
    p_hive.id,
    NULL,
    NULL,
    'relationship_verification_' || p_outcome,
    p_hive.owner_user_id,
    'SERVICE',
    NULL,
    jsonb_build_object(
      'outcome', p_outcome,
      'pinId', p_row.pin_id,
      'requestId', p_row.request_id,
      'hiveId', p_hive.id,
      'recordId', p_row.record_id,
      'sequence', p_row.sequence,
      'decision', v_body->>'decision',
      'effect', v_body->>'effect',
      'method', v_body->>'method',
      'candidateId', v_body->>'candidateId',
      'packDigest', p_row.pack_digest,
      'planDigest', p_row.plan_digest,
      'extractionDigest', p_row.extraction_digest,
      'binderDigest', p_row.binder_digest,
      'evidenceDigest', p_row.evidence_digest
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.append_relationship_verification(
  p_hive_id uuid,
  p_owner_user_id uuid,
  p_pin_id text,
  p_request_id text,
  p_expected_head text,
  p_candidate_id text,
  p_decision text,
  p_target_record_id text,
  p_decided_at timestamptz,
  p_record_canonical_json text,
  p_structure_json text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_hive hive.hives%ROWTYPE;
  v_pin hive.investigation_evidence_pins%ROWTYPE;
  v_existing hive.relationship_verification_chain%ROWTYPE;
  v_existing_body jsonb;
  v_built text;
  v_built_body jsonb;
  v_record_id text;
  v_nonce text;
  v_row hive.relationship_verification_chain%ROWTYPE;
BEGIN
  PERFORM hive.require_service_role();
  IF p_hive_id IS NULL OR p_owner_user_id IS NULL OR p_pin_id IS NULL
     OR p_request_id IS NULL OR p_candidate_id IS NULL OR p_decision IS NULL
     OR p_decided_at IS NULL
     OR p_pin_id !~ '^[0-9a-f]{64}$'
     OR NOT hive.relationship_verification_plain(p_request_id, 200)
     OR NOT hive.relationship_verification_plain(p_candidate_id, 200)
     OR p_decision NOT IN ('ACCEPT', 'REJECT', 'REVOKE')
     OR (p_expected_head IS NOT NULL AND p_expected_head !~ '^[0-9a-f]{64}$')
     OR (p_target_record_id IS NOT NULL AND NOT hive.relationship_verification_plain(p_target_record_id, 128))
     OR (p_record_canonical_json IS NOT NULL AND octet_length(p_record_canonical_json) > 8388608) THEN
    PERFORM hive.relationship_verification_raise('invalid_request');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_hive_id::text || ':' || p_pin_id || ':relationship-verification-append', 0));

  SELECT * INTO v_hive
    FROM hive.hives
   WHERE id = p_hive_id
     AND owner_user_id = p_owner_user_id
     AND archived_at IS NULL
     AND deleting_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM hive.relationship_verification_raise('hive_not_found');
  END IF;

  SELECT * INTO v_pin
    FROM hive.investigation_evidence_pins
   WHERE hive_id = v_hive.id
     AND owner_user_id = v_hive.owner_user_id
     AND pin_id = p_pin_id;
  IF NOT FOUND THEN
    PERFORM hive.relationship_verification_raise('pin_not_found');
  END IF;
  IF NOT hive.relationship_verification_pin_digests_ok(v_pin) THEN
    PERFORM hive.relationship_verification_raise('DIGEST_MISMATCH');
  END IF;

  -- Replay is by request id and does not require the current head. A different
  -- decision, candidate, or target for that request id conflicts and appends nothing.
  SELECT * INTO v_existing
    FROM hive.relationship_verification_chain
   WHERE hive_id = v_hive.id
     AND pin_id = v_pin.pin_id
     AND request_id = p_request_id;
  IF FOUND THEN
    v_existing_body := v_existing.canonical_json::jsonb;
    IF v_existing_body->>'candidateId' IS NOT DISTINCT FROM p_candidate_id
       AND v_existing_body->>'decision' IS NOT DISTINCT FROM p_decision
       AND v_existing_body->>'targetRecordId' IS NOT DISTINCT FROM p_target_record_id THEN
      PERFORM hive.relationship_verification_audit(v_hive, 'replayed', v_existing);
      RETURN hive.relationship_verification_receipt('replayed', v_existing);
    END IF;
    PERFORM hive.relationship_verification_raise('idempotency_conflict');
  END IF;

  v_built := hive.relationship_verification_canonical_record(
    v_hive.id,
    v_hive.owner_user_id,
    v_pin.pin_id,
    p_request_id,
    p_expected_head,
    p_candidate_id,
    p_decision,
    p_target_record_id,
    p_decided_at,
    p_structure_json,
    true
  );
  v_built_body := v_built::jsonb;

  SELECT * INTO v_existing
    FROM hive.relationship_verification_chain
   WHERE hive_id = v_hive.id
     AND pin_id = v_pin.pin_id
     AND request_id = v_built_body->>'requestId';
  IF FOUND THEN
    v_existing_body := v_existing.canonical_json::jsonb;
    IF p_request_id IS DISTINCT FROM v_existing.request_id
       OR v_existing_body->>'method' = 'TYPED_SOURCE' THEN
      PERFORM hive.relationship_verification_raise('HUMAN_WITHHELD');
    END IF;
    IF v_existing_body->>'candidateId' IS NOT DISTINCT FROM p_candidate_id
       AND v_existing_body->>'decision' IS NOT DISTINCT FROM p_decision
       AND v_existing_body->>'targetRecordId' IS NOT DISTINCT FROM p_target_record_id THEN
      PERFORM hive.relationship_verification_audit(v_hive, 'replayed', v_existing);
      RETURN hive.relationship_verification_receipt('replayed', v_existing);
    END IF;
    PERFORM hive.relationship_verification_raise('idempotency_conflict');
  END IF;

  IF p_request_id IS DISTINCT FROM v_built_body->>'requestId'
     AND v_built_body->>'method' = 'TYPED_SOURCE' THEN
    PERFORM hive.relationship_verification_raise('HUMAN_WITHHELD');
  END IF;
  IF p_request_id IS DISTINCT FROM v_built_body->>'requestId' THEN
    PERFORM hive.relationship_verification_raise('REQUEST_INVALID');
  END IF;
  IF p_record_canonical_json IS DISTINCT FROM v_built THEN
    PERFORM hive.relationship_verification_raise_mismatch(v_built, p_record_canonical_json, v_pin);
  END IF;

  v_record_id := hive.sha256_hex(v_built);
  v_nonce := encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text || v_record_id, 'UTF8')), 'hex');
  INSERT INTO hive.relationship_verification_append_grants (
    nonce, hive_id, pin_id, sequence, record_id, canonical_json
  ) VALUES (
    v_nonce,
    v_hive.id,
    v_pin.pin_id,
    (v_built_body->>'sequence')::integer,
    v_record_id,
    v_built
  );
  PERFORM set_config('hive.relationship_verification_append_nonce', v_nonce, true);
  INSERT INTO hive.relationship_verification_chain (
    hive_id, pin_id, sequence, record_id, causal_parent_id, canonical_json,
    pack_digest, plan_digest, extraction_digest, binder_digest, evidence_digest, request_id
  ) VALUES (
    v_hive.id,
    v_pin.pin_id,
    (v_built_body->>'sequence')::integer,
    v_record_id,
    v_built_body->>'causalParentId',
    v_built,
    v_pin.pack_digest,
    v_pin.plan_digest,
    v_pin.extraction_digest,
    v_pin.binder_digest,
    v_pin.evidence_digest,
    v_built_body->>'requestId'
  );
  DELETE FROM hive.relationship_verification_append_grants WHERE nonce = v_nonce;
  PERFORM set_config('hive.relationship_verification_append_nonce', '', true);

  SELECT * INTO v_row
    FROM hive.relationship_verification_chain
   WHERE hive_id = v_hive.id
     AND pin_id = v_pin.pin_id
     AND record_id = v_record_id;
  PERFORM hive.relationship_verification_audit(v_hive, 'appended', v_row);
  RETURN hive.relationship_verification_receipt('appended', v_row);
END;
$$;

COMMENT ON FUNCTION public.append_relationship_verification(uuid, uuid, text, text, text, text, text, text, timestamptz, text, text) IS
  'Service-role append of one relationship verification decision. Revalidates the Hive owner, pin, candidate, authorized quotations, canonical record, and pinned artifact digests. A lifecycle flag is not authorization.';

REVOKE ALL ON hive.relationship_verification_append_grants FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION hive.relationship_verification_raise(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_plain(text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_decided_at(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_contains_phrase(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_excerpt_id(text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_content_digest(text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_exact_keys(jsonb, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_identity_values(jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_quote_on_pin(hive.investigation_evidence_pins, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_candidate_block(hive.investigation_evidence_pins, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_quotations(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_excerpt_ids(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_find_candidate(hive.investigation_evidence_pins, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_pin_digests_ok(hive.investigation_evidence_pins) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_structure(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_typed_effect(hive.investigation_evidence_pins, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_typed_request_id(text, text, hive.investigation_evidence_pins, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_render(text, integer, text, text, text, text, jsonb, jsonb, text, text, text, text, text, text, text, text, hive.investigation_evidence_pins) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_chain_head(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_next_sequence(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_parent_id(uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_support_open(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_opposition(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_canonical_record(uuid, uuid, text, text, text, text, text, text, timestamptz, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_append_granted(hive.relationship_verification_chain) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_chain_row_allowed(hive.relationship_verification_chain) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_raise_mismatch(text, text, hive.investigation_evidence_pins) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_audit_metadata_ok(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_receipt(text, hive.relationship_verification_chain) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.relationship_verification_audit(hive.hives, text, hive.relationship_verification_chain) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.append_relationship_verification(uuid, uuid, text, text, text, text, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_relationship_verification(uuid, uuid, text, text, text, text, text, text, timestamptz, text, text) TO service_role;

COMMIT;
