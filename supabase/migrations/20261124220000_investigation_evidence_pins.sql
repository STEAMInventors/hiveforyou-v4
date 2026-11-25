-- Stage 5C.2c.1a — Immutable investigation evidence pins.
-- Content-addressed pack and plan preimages, one immutable pin per Hive,
-- the sequence-zero relationship-verification chain head, and retention of
-- every document-page generation the pin cites.
--
-- Pin creation is service_role only. The database revalidates the Hive owner
-- and accepts a verified fact only when that fact is a stored extraction fact
-- whose quote is on the authorized page generation. A self-consistent hash is
-- not admission.
--
-- Do not apply to a live Supabase project without explicit founder authorization.
-- This migration does not add a decision-append RPC or a public read of evidence.
-- Extraction bytes stay on hive.doc_extractions. Pack, plan, pin, binder,
-- evidence, source-generation, and extraction digests are recomputed.

BEGIN;

-- ---------------------------------------------------------------------------
-- Canonical JSON and digest helpers. Object keys sort in C collation.
-- Strings use to_json, matching JSON.stringify for the characters we store.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.sha256_hex(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = hive, public, pg_temp
AS $$
  SELECT encode(sha256(convert_to(COALESCE(p_text, ''), 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION hive.canonical_json(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_type text := jsonb_typeof(p_value);
  v_text text;
  v_key text;
  v_parts text[] := ARRAY[]::text[];
BEGIN
  IF p_value IS NULL OR v_type IS NULL OR v_type = 'null' THEN
    RETURN 'null';
  END IF;
  IF v_type = 'boolean' OR v_type = 'number' THEN
    RETURN p_value::text;
  END IF;
  IF v_type = 'string' THEN
    RETURN to_json(p_value #>> '{}')::text;
  END IF;
  IF v_type = 'array' THEN
    SELECT coalesce(string_agg(hive.canonical_json(elem), ',' ORDER BY ord), '')
      INTO v_text
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS t(elem, ord);
    RETURN '[' || coalesce(v_text, '') || ']';
  END IF;
  IF v_type = 'object' THEN
    FOR v_key IN
      SELECT item.key
        FROM jsonb_object_keys(p_value) AS item(key)
       ORDER BY item.key COLLATE "C"
    LOOP
      v_parts := array_append(v_parts, to_json(v_key)::text || ':' || hive.canonical_json(p_value -> v_key));
    END LOOP;
    RETURN '{' || array_to_string(v_parts, ',') || '}';
  END IF;
  RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION hive.jsonb_text_array_sorted(p_array jsonb, p_sort text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_sorted jsonb;
BEGIN
  IF p_array IS NULL OR jsonb_typeof(p_array) IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;
  IF p_sort = 'id' THEN
    SELECT coalesce(jsonb_agg(elem ORDER BY (elem->>'id') COLLATE "C"), '[]'::jsonb)
      INTO v_sorted
      FROM jsonb_array_elements(p_array) AS elem;
  ELSIF p_sort = 'conflict' THEN
    SELECT coalesce(jsonb_agg(elem ORDER BY (
      coalesce(elem->>'entityId', '') || coalesce(elem->>'instanceId', '') || coalesce(elem->>'fieldId', '')
    ) COLLATE "C"), '[]'::jsonb)
      INTO v_sorted
      FROM jsonb_array_elements(p_array) AS elem;
  ELSIF p_sort = 'candidate' THEN
    SELECT coalesce(jsonb_agg(elem ORDER BY (elem->>'candidateId') COLLATE "C", (elem->>'kind') COLLATE "C"), '[]'::jsonb)
      INTO v_sorted
      FROM jsonb_array_elements(p_array) AS elem;
  ELSE
    RETURN NULL;
  END IF;
  RETURN v_sorted;
END;
$$;

-- Evidence digest preimage: the same objects with fact, document, relationship,
-- conflict, and candidate arrays ordered. Binder digest keeps stored order.
CREATE OR REPLACE FUNCTION hive.investigation_evidence_canonical(p_verified jsonb, p_unresolved jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = hive, pg_catalog, pg_temp
AS $$
DECLARE
  v_verified jsonb := p_verified;
  v_unresolved jsonb := p_unresolved;
BEGIN
  IF jsonb_typeof(v_verified) IS DISTINCT FROM 'object' OR jsonb_typeof(v_unresolved) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  IF v_verified ? 'facts' THEN
    v_verified := jsonb_set(v_verified, '{facts}', hive.jsonb_text_array_sorted(v_verified->'facts', 'id'));
  END IF;
  IF v_verified ? 'documents' THEN
    v_verified := jsonb_set(v_verified, '{documents}', hive.jsonb_text_array_sorted(v_verified->'documents', 'id'));
  END IF;
  IF v_verified ? 'relationships' THEN
    v_verified := jsonb_set(v_verified, '{relationships}', hive.jsonb_text_array_sorted(v_verified->'relationships', 'id'));
  END IF;
  IF v_verified ? 'conflicts' THEN
    v_verified := jsonb_set(v_verified, '{conflicts}', hive.jsonb_text_array_sorted(v_verified->'conflicts', 'conflict'));
  END IF;
  IF v_unresolved ? 'candidates' THEN
    v_unresolved := jsonb_set(v_unresolved, '{candidates}', hive.jsonb_text_array_sorted(v_unresolved->'candidates', 'candidate'));
  END IF;
  RETURN hive.canonical_json(jsonb_build_object('verified', v_verified, 'unresolved', v_unresolved));
END;
$$;

-- ---------------------------------------------------------------------------
-- Tables. Private to hive. No authenticated read of quotations or page text.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.investigation_artifact_preimages (
  digest text NOT NULL,
  kind text NOT NULL,
  schema_id text NOT NULL,
  pack_id text,
  version text,
  canonical_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_investigation_artifact_preimages PRIMARY KEY (digest),
  CONSTRAINT ck_investigation_artifact_preimages__digest CHECK (
    digest ~ '^[0-9a-f]{64}$'
    AND digest = encode(sha256(convert_to(canonical_json, 'UTF8')), 'hex')
  ),
  CONSTRAINT ck_investigation_artifact_preimages__kind CHECK (
    (
      kind = 'PACK'
      AND schema_id = 'hive.domain-pack-runtime/1'
      AND pack_id IS NOT NULL
      AND char_length(pack_id) BETWEEN 1 AND 200
      AND version IS NOT NULL
      AND char_length(version) BETWEEN 1 AND 64
    )
    OR (
      kind = 'PLAN'
      AND schema_id = 'hive.domain-investigation-plan/1'
      AND pack_id IS NULL
      AND version IS NULL
    )
  )
);

COMMENT ON TABLE hive.investigation_artifact_preimages IS
  'Exact canonical preimages of compiled packs and investigation plans, addressed by SHA-256. No filesystem path.';

CREATE TABLE IF NOT EXISTS hive.investigation_evidence_pins (
  hive_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  pin_id text NOT NULL,
  schema_id text NOT NULL DEFAULT 'hive.investigation-evidence-pin/1',
  pack_digest text NOT NULL,
  plan_digest text NOT NULL,
  extraction_digest text NOT NULL,
  binder_digest text NOT NULL,
  evidence_digest text NOT NULL,
  source_generations_digest text NOT NULL,
  canonical_json text NOT NULL,
  verified jsonb NOT NULL,
  unresolved jsonb NOT NULL,
  source_generations jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_investigation_evidence_pins PRIMARY KEY (hive_id, pin_id),
  CONSTRAINT fk_investigation_evidence_pins__hive_owner
    FOREIGN KEY (hive_id, owner_user_id) REFERENCES hive.hives (id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_investigation_evidence_pins__pack
    FOREIGN KEY (pack_digest) REFERENCES hive.investigation_artifact_preimages (digest) ON DELETE RESTRICT,
  CONSTRAINT fk_investigation_evidence_pins__plan
    FOREIGN KEY (plan_digest) REFERENCES hive.investigation_artifact_preimages (digest) ON DELETE RESTRICT,
  CONSTRAINT ck_investigation_evidence_pins__digests CHECK (
    pin_id ~ '^[0-9a-f]{64}$'
    AND extraction_digest ~ '^[0-9a-f]{64}$'
    AND binder_digest ~ '^[0-9a-f]{64}$'
    AND evidence_digest ~ '^[0-9a-f]{64}$'
    AND source_generations_digest ~ '^[0-9a-f]{64}$'
    AND schema_id = 'hive.investigation-evidence-pin/1'
  ),
  CONSTRAINT ck_investigation_evidence_pins__preimage CHECK (
    pin_id = encode(sha256(convert_to(canonical_json, 'UTF8')), 'hex')
    AND (canonical_json::jsonb)->'verified' = verified
    AND (canonical_json::jsonb)->'unresolved' = unresolved
    AND (canonical_json::jsonb)->'sourceGenerations' = source_generations
    AND jsonb_typeof(verified->'relationships') = 'array'
    AND jsonb_array_length(verified->'relationships') = 0
  )
);

COMMENT ON TABLE hive.investigation_evidence_pins IS
  'Immutable hive.investigation-evidence-pin/1 rows. Quotations stay in canonical_json and are not exposed by a public RPC.';

CREATE INDEX IF NOT EXISTS idx_investigation_evidence_pins__pack
  ON hive.investigation_evidence_pins (pack_digest);
CREATE INDEX IF NOT EXISTS idx_investigation_evidence_pins__plan
  ON hive.investigation_evidence_pins (plan_digest);

CREATE TABLE IF NOT EXISTS hive.investigation_evidence_pin_requests (
  hive_id uuid NOT NULL,
  request_id uuid NOT NULL,
  pin_id text NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_investigation_evidence_pin_requests PRIMARY KEY (hive_id, request_id),
  CONSTRAINT fk_investigation_evidence_pin_requests__pin
    FOREIGN KEY (hive_id, pin_id) REFERENCES hive.investigation_evidence_pins (hive_id, pin_id) ON DELETE CASCADE,
  CONSTRAINT ck_investigation_evidence_pin_requests__outcome CHECK (outcome IN ('created', 'aliased'))
);

COMMENT ON TABLE hive.investigation_evidence_pin_requests IS
  'One request id pins one body. A later request for the same pin is an alias. Replay does not insert another row.';

CREATE TABLE IF NOT EXISTS hive.investigation_evidence_pin_pages (
  hive_id uuid NOT NULL,
  pin_id text NOT NULL,
  document_page_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  page_set_digest text NOT NULL,
  page_number integer NOT NULL,
  page_text_sha256 text NOT NULL,
  read_fingerprint text NOT NULL,
  source_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_investigation_evidence_pin_pages PRIMARY KEY (hive_id, pin_id, document_page_id),
  CONSTRAINT fk_investigation_evidence_pin_pages__pin
    FOREIGN KEY (hive_id, pin_id) REFERENCES hive.investigation_evidence_pins (hive_id, pin_id) ON DELETE CASCADE,
  CONSTRAINT fk_investigation_evidence_pin_pages__page
    FOREIGN KEY (document_page_id) REFERENCES hive.document_pages (id) ON DELETE RESTRICT,
  CONSTRAINT uq_investigation_evidence_pin_pages__page UNIQUE (pin_id, hive_id, document_page_id)
);

COMMENT ON TABLE hive.investigation_evidence_pin_pages IS
  'Retains each document-page generation cited by a pin. Page text stays on hive.document_pages.';

CREATE INDEX IF NOT EXISTS idx_investigation_evidence_pin_pages__page
  ON hive.investigation_evidence_pin_pages (document_page_id);

CREATE TABLE IF NOT EXISTS hive.relationship_verification_chain (
  hive_id uuid NOT NULL,
  pin_id text NOT NULL,
  sequence integer NOT NULL,
  record_id text NOT NULL,
  causal_parent_id text,
  canonical_json text NOT NULL,
  pack_digest text NOT NULL,
  plan_digest text NOT NULL,
  extraction_digest text NOT NULL,
  binder_digest text NOT NULL,
  evidence_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_relationship_verification_chain PRIMARY KEY (hive_id, pin_id, sequence),
  CONSTRAINT uq_relationship_verification_chain__record UNIQUE (hive_id, pin_id, record_id),
  CONSTRAINT fk_relationship_verification_chain__pin
    FOREIGN KEY (hive_id, pin_id) REFERENCES hive.investigation_evidence_pins (hive_id, pin_id) ON DELETE CASCADE,
  CONSTRAINT ck_relationship_verification_chain__head CHECK (
    sequence >= 0
    AND (sequence > 0 OR causal_parent_id IS NULL)
    AND record_id ~ '^[0-9a-f]{64}$'
    AND record_id = encode(sha256(convert_to(canonical_json, 'UTF8')), 'hex')
    AND pack_digest ~ '^[0-9a-f]{64}$'
    AND plan_digest ~ '^[0-9a-f]{64}$'
    AND extraction_digest ~ '^[0-9a-f]{64}$'
    AND binder_digest ~ '^[0-9a-f]{64}$'
    AND evidence_digest ~ '^[0-9a-f]{64}$'
  )
);

COMMENT ON TABLE hive.relationship_verification_chain IS
  'Append-only relationship verification chain. This gate inserts only the sequence-zero head. It is not a decision.';

-- ---------------------------------------------------------------------------
-- Immutability. Inserts succeed only while the pin RPC holds the insert
-- lifecycle flag. Deletes succeed only while authorized Hive deletion holds
-- the delete flag and the Hive is already marked deleting.
-- ---------------------------------------------------------------------------
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
    IF v_mode IS DISTINCT FROM 'insert' THEN
      RAISE EXCEPTION 'evidence_pin_immutable' USING ERRCODE = 'P0001';
    END IF;
    IF TG_TABLE_NAME = 'relationship_verification_chain' AND NEW.sequence IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'verification_append_unavailable' USING ERRCODE = 'P0001';
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

DROP TRIGGER IF EXISTS trg_investigation_artifact_preimages__lifecycle ON hive.investigation_artifact_preimages;
CREATE TRIGGER trg_investigation_artifact_preimages__lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON hive.investigation_artifact_preimages
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_evidence_pin_lifecycle();

DROP TRIGGER IF EXISTS trg_investigation_evidence_pins__lifecycle ON hive.investigation_evidence_pins;
CREATE TRIGGER trg_investigation_evidence_pins__lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON hive.investigation_evidence_pins
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_evidence_pin_lifecycle();

DROP TRIGGER IF EXISTS trg_investigation_evidence_pin_requests__lifecycle ON hive.investigation_evidence_pin_requests;
CREATE TRIGGER trg_investigation_evidence_pin_requests__lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON hive.investigation_evidence_pin_requests
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_evidence_pin_lifecycle();

DROP TRIGGER IF EXISTS trg_investigation_evidence_pin_pages__lifecycle ON hive.investigation_evidence_pin_pages;
CREATE TRIGGER trg_investigation_evidence_pin_pages__lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON hive.investigation_evidence_pin_pages
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_evidence_pin_lifecycle();

DROP TRIGGER IF EXISTS trg_relationship_verification_chain__lifecycle ON hive.relationship_verification_chain;
CREATE TRIGGER trg_relationship_verification_chain__lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON hive.relationship_verification_chain
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_evidence_pin_lifecycle();

CREATE OR REPLACE FUNCTION hive.bind_evidence_pin_page()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_page hive.document_pages%ROWTYPE;
BEGIN
  SELECT * INTO v_page FROM hive.document_pages WHERE id = NEW.document_page_id;
  IF NOT FOUND
     OR v_page.hive_id IS DISTINCT FROM NEW.hive_id
     OR v_page.source_document_id IS DISTINCT FROM NEW.source_document_id
     OR v_page.page_set_digest IS DISTINCT FROM NEW.page_set_digest
     OR v_page.page_number IS DISTINCT FROM NEW.page_number
     OR v_page.page_text_sha256 IS DISTINCT FROM NEW.page_text_sha256
     OR v_page.read_fingerprint IS DISTINCT FROM NEW.read_fingerprint
     OR v_page.source_sha256 IS DISTINCT FROM NEW.source_sha256 THEN
    RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_investigation_evidence_pin_pages__bind ON hive.investigation_evidence_pin_pages;
CREATE TRIGGER trg_investigation_evidence_pin_pages__bind
  BEFORE INSERT ON hive.investigation_evidence_pin_pages
  FOR EACH ROW
  EXECUTE FUNCTION hive.bind_evidence_pin_page();

CREATE OR REPLACE FUNCTION hive.prevent_pinned_page_generation_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM hive.investigation_evidence_pin_pages p
     WHERE p.document_page_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'pinned_page_generation_retained' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_pages__retain_pinned_generation ON hive.document_pages;
CREATE TRIGGER trg_document_pages__retain_pinned_generation
  BEFORE DELETE ON hive.document_pages
  FOR EACH ROW
  EXECUTE FUNCTION hive.prevent_pinned_page_generation_delete();

CREATE OR REPLACE FUNCTION hive.evidence_pin_audit_metadata_ok(p_metadata jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_key text;
  v_value jsonb;
  v_allowed text[] := ARRAY[
    'outcome', 'pinId', 'requestId', 'hiveId', 'packDigest', 'planDigest',
    'extractionDigest', 'binderDigest', 'evidenceDigest', 'sourceGenerationsDigest',
    'chainHeadId', 'sequence'
  ];
BEGIN
  IF jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  FOR v_key, v_value IN
    SELECT key, value FROM jsonb_each(p_metadata)
  LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RETURN false;
    END IF;
    IF v_key = 'sequence' THEN
      IF jsonb_typeof(v_value) IS DISTINCT FROM 'number' OR (v_value #>> '{}') IS DISTINCT FROM '0' THEN
        RETURN false;
      END IF;
    ELSIF jsonb_typeof(v_value) IS DISTINCT FROM 'string' OR char_length(v_value #>> '{}') > 80 OR char_length(v_value #>> '{}') < 1 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN (p_metadata->>'outcome') IN ('created', 'replayed', 'aliased')
    AND (p_metadata->>'pinId') ~ '^[0-9a-f]{64}$';
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_events__evidence_pin_metadata ON hive.audit_events;
CREATE TRIGGER trg_audit_events__evidence_pin_metadata
  BEFORE INSERT ON hive.audit_events
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_evidence_pin_audit();

-- ---------------------------------------------------------------------------
-- Source-generation binding. Raises on mismatch, incomplete evidence, or a
-- document the Hive does not own. Returns the page rows the pin must retain.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.evidence_pin_source_bindings(
  p_hive_id uuid,
  p_owner_user_id uuid,
  p_generations jsonb,
  p_verified jsonb,
  p_unresolved jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_gen jsonb;
  v_page jsonb;
  v_doc hive.source_documents%ROWTYPE;
  v_doc_id uuid;
  v_sha text;
  v_fingerprint text;
  v_set text;
  v_count integer;
  v_expected_set text;
  v_pages jsonb;
  v_seen_docs text[] := ARRAY[]::text[];
  v_seen_pages integer[] := ARRAY[]::integer[];
  v_page_number integer;
  v_page_hash text;
  v_stored_count integer;
  v_stored hive.document_pages%ROWTYPE;
  v_bindings jsonb := '[]'::jsonb;
  v_allowed jsonb := '{}'::jsonb;
  v_ref jsonb;
  v_item jsonb;
  v_ref_doc text;
  v_ref_page text;
  v_key text;
BEGIN
  IF jsonb_typeof(p_generations) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  FOR v_gen IN
    SELECT value FROM jsonb_array_elements(p_generations)
  LOOP
    IF jsonb_typeof(v_gen) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_doc_id := (v_gen->>'sourceDocumentId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END;
    IF v_doc_id::text = ANY (v_seen_docs) THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
    v_seen_docs := array_append(v_seen_docs, v_doc_id::text);
    v_sha := lower(btrim(coalesce(v_gen->>'sourceSha256', '')));
    v_fingerprint := btrim(coalesce(v_gen->>'readFingerprint', ''));
    v_set := lower(btrim(coalesce(v_gen->>'pageSetDigest', '')));
    IF v_sha !~ '^[0-9a-f]{64}$' OR char_length(v_fingerprint) < 1 OR char_length(v_fingerprint) > 128 THEN
      RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_set !~ '^sha256:[0-9a-f]{64}$' OR jsonb_typeof(v_gen->'pages') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      v_count := (v_gen->>'pageCount')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
    END;
    IF v_count IS NULL OR v_count < 1 OR jsonb_array_length(v_gen->'pages') IS DISTINCT FROM v_count THEN
      RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_doc FROM hive.source_documents WHERE id = v_doc_id;
    IF NOT FOUND OR v_doc.case_id IS DISTINCT FROM p_hive_id OR v_doc.owner_user_id IS DISTINCT FROM p_owner_user_id THEN
      RAISE EXCEPTION 'unauthorized_source' USING ERRCODE = 'P0001';
    END IF;
    IF v_doc.deleted_at IS NOT NULL OR v_doc.lifecycle_status IS DISTINCT FROM 'ACTIVE' OR v_doc.upload_status IS DISTINCT FROM 'UPLOADED' THEN
      RAISE EXCEPTION 'unauthorized_source' USING ERRCODE = 'P0001';
    END IF;
    IF lower(btrim(v_doc.sha256)) IS DISTINCT FROM v_sha THEN
      RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
    END IF;

    v_seen_pages := ARRAY[]::integer[];
    v_pages := '[]'::jsonb;
    FOR v_page IN
      SELECT value FROM jsonb_array_elements(v_gen->'pages')
    LOOP
      BEGIN
        v_page_number := (v_page->>'pageNumber')::integer;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
      END;
      v_page_hash := lower(btrim(coalesce(v_page->>'pageTextSha256', '')));
      IF v_page_number IS NULL OR v_page_number < 1 OR v_page_number = ANY (v_seen_pages) OR v_page_hash !~ '^sha256:[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
      END IF;
      v_seen_pages := array_append(v_seen_pages, v_page_number);
      v_pages := v_pages || jsonb_build_array(jsonb_build_object(
        'page_number', v_page_number,
        'page_text_sha256', v_page_hash
      ));
    END LOOP;
    v_expected_set := hive.compute_page_set_digest(v_sha, v_count, v_pages);
    IF v_expected_set IS NULL OR v_expected_set IS DISTINCT FROM v_set THEN
      RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*) INTO v_stored_count
      FROM hive.document_pages p
     WHERE p.hive_id = p_hive_id
       AND p.source_document_id = v_doc_id
       AND p.page_set_digest = v_set
       AND p.read_fingerprint = v_fingerprint
       AND p.source_sha256 = v_sha;
    IF v_stored_count = 0 THEN
      RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_stored_count IS DISTINCT FROM v_count THEN
      RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
    END IF;

    FOR v_page IN
      SELECT value FROM jsonb_array_elements(v_gen->'pages')
    LOOP
      v_page_number := (v_page->>'pageNumber')::integer;
      v_page_hash := lower(btrim(coalesce(v_page->>'pageTextSha256', '')));
      SELECT * INTO v_stored
        FROM hive.document_pages p
       WHERE p.hive_id = p_hive_id
         AND p.source_document_id = v_doc_id
         AND p.page_set_digest = v_set
         AND p.read_fingerprint = v_fingerprint
         AND p.page_number = v_page_number;
      IF NOT FOUND
         OR v_stored.page_text_sha256 IS DISTINCT FROM v_page_hash
         OR v_stored.source_sha256 IS DISTINCT FROM v_sha
         OR v_stored.page_count IS DISTINCT FROM v_count THEN
        RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
      END IF;
      v_key := v_doc_id::text || '#' || v_page_number::text;
      v_allowed := v_allowed || jsonb_build_object(v_key, '1');
      v_bindings := v_bindings || jsonb_build_array(jsonb_build_object(
        'documentPageId', v_stored.id,
        'sourceDocumentId', v_doc_id,
        'pageSetDigest', v_set,
        'pageNumber', v_page_number,
        'pageTextSha256', v_page_hash,
        'readFingerprint', v_fingerprint,
        'sourceSha256', v_sha
      ));
    END LOOP;

    IF EXISTS (
      SELECT 1
        FROM hive.document_pages p
       WHERE p.hive_id = p_hive_id
         AND p.source_document_id = v_doc_id
         AND p.page_set_digest = v_set
         AND p.read_fingerprint = v_fingerprint
         AND NOT (p.page_number = ANY (v_seen_pages))
    ) THEN
      RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF jsonb_typeof(p_verified) IS DISTINCT FROM 'object' OR jsonb_typeof(p_unresolved) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF p_verified->>'schema' IS DISTINCT FROM 'hive.verified-case-facts/1'
     OR p_unresolved->>'schema' IS DISTINCT FROM 'hive.investigation-unresolved-candidates/1' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_verified->'relationships') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_verified->'relationships') <> 0 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(coalesce(p_verified->'facts', '[]'::jsonb))
    UNION ALL
    SELECT value FROM jsonb_array_elements(coalesce(p_verified->'documents', '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_item->'sourceRefs') IS DISTINCT FROM 'array' OR jsonb_array_length(v_item->'sourceRefs') < 1 THEN
      RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
    END IF;
    FOR v_ref IN SELECT value FROM jsonb_array_elements(v_item->'sourceRefs') LOOP
      v_ref_doc := coalesce(v_ref->>'documentId', '');
      v_ref_page := coalesce(v_ref->>'page', '');
      IF v_ref_page !~ '^[1-9][0-9]*$' OR coalesce(v_ref->>'excerptId', '') = '' THEN
        RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
      END IF;
      IF coalesce(v_allowed->>(v_ref_doc || '#' || v_ref_page), '') IS DISTINCT FROM '1' THEN
        IF v_ref_doc = ANY (v_seen_docs) THEN
          RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
        END IF;
        RAISE EXCEPTION 'unauthorized_source' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(coalesce(p_unresolved->'candidates', '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_item->'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(v_item->'evidence') < 1 THEN
      RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
    END IF;
    FOR v_ref IN SELECT value FROM jsonb_array_elements(v_item->'evidence') LOOP
      v_ref_doc := coalesce(v_ref->>'sourceDocumentId', '');
      v_ref_page := coalesce(v_ref->>'page', '');
      IF v_ref_page !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
      END IF;
      IF coalesce(v_allowed->>(v_ref_doc || '#' || v_ref_page), '') IS DISTINCT FROM '1' THEN
        IF v_ref_doc = ANY (v_seen_docs) THEN
          RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
        END IF;
        RAISE EXCEPTION 'unauthorized_source' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    IF jsonb_typeof(v_item->'sourceRefs') = 'array' THEN
      FOR v_ref IN SELECT value FROM jsonb_array_elements(v_item->'sourceRefs') LOOP
        v_ref_doc := coalesce(v_ref->>'documentId', '');
        v_ref_page := coalesce(v_ref->>'page', '');
        IF v_ref_doc = '' AND v_ref_page = '' THEN
          CONTINUE;
        END IF;
        IF v_ref_page !~ '^[1-9][0-9]*$' THEN
          RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
        END IF;
        IF coalesce(v_allowed->>(v_ref_doc || '#' || v_ref_page), '') IS DISTINCT FROM '1' THEN
          IF v_ref_doc = ANY (v_seen_docs) THEN
            RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
          END IF;
          RAISE EXCEPTION 'unauthorized_source' USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_bindings;
END;
$$;

CREATE OR REPLACE FUNCTION hive.evidence_pin_put_artifact(p_kind text, p_canonical_json text)
RETURNS text
LANGUAGE plpgsql
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_parsed jsonb;
  v_digest text;
  v_existing hive.investigation_artifact_preimages%ROWTYPE;
  v_pack_id text;
  v_version text;
  v_schema text;
BEGIN
  IF p_kind NOT IN ('PACK', 'PLAN') OR p_canonical_json IS NULL OR octet_length(p_canonical_json) > 8388608 OR octet_length(p_canonical_json) < 2 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_parsed := p_canonical_json::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'artifact_preimage_invalid' USING ERRCODE = 'P0001';
  END;
  IF jsonb_typeof(v_parsed) IS DISTINCT FROM 'object' OR hive.canonical_json(v_parsed) IS DISTINCT FROM p_canonical_json THEN
    RAISE EXCEPTION 'artifact_preimage_invalid' USING ERRCODE = 'P0001';
  END IF;
  v_schema := v_parsed->>'schema';
  IF p_kind = 'PACK' THEN
    IF v_schema IS DISTINCT FROM 'hive.domain-pack-runtime/1'
       OR jsonb_typeof(v_parsed->'identity') IS DISTINCT FROM 'object'
       OR (v_parsed->'identity') ? 'digest'
       OR coalesce(v_parsed->'identity'->>'packId', '') = ''
       OR coalesce(v_parsed->'identity'->>'version', '') = '' THEN
      RAISE EXCEPTION 'artifact_preimage_invalid' USING ERRCODE = 'P0001';
    END IF;
    v_pack_id := v_parsed->'identity'->>'packId';
    v_version := v_parsed->'identity'->>'version';
  ELSE
    IF v_schema IS DISTINCT FROM 'hive.domain-investigation-plan/1' OR (v_parsed ? 'digest') THEN
      RAISE EXCEPTION 'artifact_preimage_invalid' USING ERRCODE = 'P0001';
    END IF;
    v_pack_id := NULL;
    v_version := NULL;
  END IF;
  v_digest := hive.sha256_hex(p_canonical_json);
  SELECT * INTO v_existing
    FROM hive.investigation_artifact_preimages
   WHERE digest = v_digest
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.canonical_json IS DISTINCT FROM p_canonical_json OR v_existing.kind IS DISTINCT FROM p_kind THEN
      RAISE EXCEPTION 'artifact_preimage_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_digest;
  END IF;
  BEGIN
    INSERT INTO hive.investigation_artifact_preimages (digest, kind, schema_id, pack_id, version, canonical_json)
    VALUES (v_digest, p_kind, v_schema, v_pack_id, v_version, p_canonical_json);
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM hive.investigation_artifact_preimages WHERE digest = v_digest;
    IF NOT FOUND OR v_existing.canonical_json IS DISTINCT FROM p_canonical_json OR v_existing.kind IS DISTINCT FROM p_kind THEN
      RAISE EXCEPTION 'artifact_preimage_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END;
  RETURN v_digest;
END;
$$;

CREATE OR REPLACE FUNCTION hive.evidence_pin_receipt(
  p_outcome text,
  p_hive_id uuid,
  p_request_id uuid,
  p_pin hive.investigation_evidence_pins,
  p_record_id text
)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT json_build_object(
    'schema', 'hive.investigation-evidence-pin-receipt/1',
    'outcome', p_outcome,
    'hiveId', p_hive_id,
    'requestId', p_request_id,
    'pinId', p_pin.pin_id,
    'packDigest', p_pin.pack_digest,
    'planDigest', p_pin.plan_digest,
    'extractionDigest', p_pin.extraction_digest,
    'binderDigest', p_pin.binder_digest,
    'evidenceDigest', p_pin.evidence_digest,
    'sourceGenerationsDigest', p_pin.source_generations_digest,
    'chainHead', json_build_object(
      'sequence', 0,
      'recordId', p_record_id,
      'causalParentId', NULL
    )
  );
$$;

CREATE OR REPLACE FUNCTION hive.evidence_pin_audit(
  p_hive hive.hives,
  p_outcome text,
  p_request_id uuid,
  p_pin hive.investigation_evidence_pins,
  p_record_id text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = hive, public, pg_temp
AS $$
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
    'investigation_evidence_pin_' || p_outcome,
    p_hive.owner_user_id,
    'SERVICE',
    NULL,
    jsonb_build_object(
      'outcome', p_outcome,
      'pinId', p_pin.pin_id,
      'requestId', p_request_id,
      'hiveId', p_hive.id,
      'packDigest', p_pin.pack_digest,
      'planDigest', p_pin.plan_digest,
      'extractionDigest', p_pin.extraction_digest,
      'binderDigest', p_pin.binder_digest,
      'evidenceDigest', p_pin.evidence_digest,
      'sourceGenerationsDigest', p_pin.source_generations_digest,
      'chainHeadId', p_record_id,
      'sequence', 0
    )
  );
END;
$$;

-- Typographic folding and whitespace collapse used by the quote checker.
CREATE OR REPLACE FUNCTION hive.normalize_quote_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT btrim(regexp_replace(
    translate(
      replace(replace(coalesce(p_text, ''), E'\r\n', E'\n'), E'\r', E'\n'),
      chr(8216) || chr(8217) || chr(8218) || chr(8242) || chr(8220) || chr(8221) || chr(8222) || chr(8243) || chr(160),
      '''''"""" '
    ),
    '\s+',
    ' ',
    'g'
  ));
$$;

-- A quote is on a page when the normalized quote is contained in the normalized
-- page, or every non-empty table cell is.
CREATE OR REPLACE FUNCTION hive.quote_on_page(p_quote text, p_page text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = hive, pg_catalog, pg_temp
AS $$
DECLARE
  v_quote text := hive.normalize_quote_text(p_quote);
  v_page text := hive.normalize_quote_text(p_page);
  v_cell text;
  v_cells integer := 0;
BEGIN
  IF v_quote = '' OR v_page = '' THEN
    RETURN false;
  END IF;
  IF position(v_quote IN v_page) > 0 THEN
    RETURN true;
  END IF;
  IF position('|' IN v_quote) = 0 THEN
    RETURN false;
  END IF;
  FOREACH v_cell IN ARRAY regexp_split_to_array(v_quote, '\|') LOOP
    v_cell := btrim(v_cell);
    IF v_cell = '' THEN
      CONTINUE;
    END IF;
    v_cells := v_cells + 1;
    IF position(v_cell IN v_page) = 0 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN v_cells > 0;
END;
$$;

-- Canonical preimage of the extraction facts a pin is allowed to cite.
-- Same projection as authorizedExtractionDigest: documents by id, facts by id,
-- evidence in stored order, page and quote only.
CREATE OR REPLACE FUNCTION hive.authorized_extraction_canonical(p_ids uuid[])
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = hive, pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_row hive.doc_extractions%ROWTYPE;
  v_docs jsonb := '[]'::jsonb;
  v_facts jsonb;
  v_fact jsonb;
  v_evidence jsonb;
  v_item jsonb;
  v_sorted jsonb;
BEGIN
  IF p_ids IS NULL THEN
    RETURN NULL;
  END IF;
  IF coalesce(array_length(p_ids, 1), 0) = 0 THEN
    RETURN '[]';
  END IF;
  FOR v_id IN
    SELECT id FROM unnest(p_ids) AS id ORDER BY id::text COLLATE "C"
  LOOP
    SELECT * INTO v_row FROM hive.doc_extractions WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    v_facts := '[]'::jsonb;
    FOR v_fact IN
      SELECT value
        FROM jsonb_array_elements(coalesce(v_row.extraction->'facts', '[]'::jsonb))
       ORDER BY value->>'id' COLLATE "C"
    LOOP
      v_evidence := '[]'::jsonb;
      FOR v_item IN
        SELECT value FROM jsonb_array_elements(coalesce(v_fact->'evidence', '[]'::jsonb))
      LOOP
        v_evidence := v_evidence || jsonb_build_array(jsonb_build_object(
          'page', CASE WHEN jsonb_typeof(v_item->'page') = 'number' THEN v_item->'page' ELSE to_jsonb((v_item->>'page')::integer) END,
          'quote', coalesce(v_item->>'quote', '')
        ));
      END LOOP;
      v_facts := v_facts || jsonb_build_array(jsonb_build_object(
        'evidence', v_evidence,
        'id', coalesce(v_fact->>'id', ''),
        'valueAsWritten', coalesce(v_fact->>'valueAsWritten', '')
      ));
    END LOOP;
    v_docs := v_docs || jsonb_build_array(jsonb_build_object(
      'documentId', v_row.source_document_id::text,
      'facts', v_facts
    ));
  END LOOP;
  SELECT coalesce(jsonb_agg(elem ORDER BY (elem->>'documentId') COLLATE "C"), '[]'::jsonb)
    INTO v_sorted
    FROM jsonb_array_elements(v_docs) AS elem;
  RETURN hive.canonical_json(v_sorted);
END;
$$;

-- Rejects a verified fact that is not a stored extraction fact on the
-- authorized page. Hash agreement is checked by the caller and is not enough.
CREATE OR REPLACE FUNCTION hive.evidence_pin_require_trusted_facts(
  p_hive_id uuid,
  p_owner_user_id uuid,
  p_extraction_ids uuid[],
  p_generations jsonb,
  p_verified jsonb,
  p_unresolved jsonb,
  p_extraction_digest text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = hive, pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_row hive.doc_extractions%ROWTYPE;
  v_seen int := 0;
  v_gen jsonb;
  v_doc_id uuid;
  v_sha text;
  v_fingerprint text;
  v_set text;
  v_canonical text;
  v_item jsonb;
  v_ref jsonb;
  v_fact jsonb;
  v_excerpt text;
  v_ref_pages text[] := ARRAY[]::text[];
  v_evidence_pages text[] := ARRAY[]::text[];
  v_page text;
  v_page_text text;
  v_quote text;
  v_matched boolean;
BEGIN
  IF p_extraction_ids IS NULL OR p_extraction_digest IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM unnest(p_extraction_ids) AS id)
     IS DISTINCT FROM (SELECT count(DISTINCT id) FROM unnest(p_extraction_ids) AS id) THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  IF coalesce(array_length(p_extraction_ids, 1), 0) = 0 THEN
    IF jsonb_array_length(coalesce(p_verified->'facts', '[]'::jsonb)) <> 0
       OR jsonb_array_length(coalesce(p_verified->'documents', '[]'::jsonb)) <> 0
       OR p_extraction_digest IS DISTINCT FROM hive.sha256_hex('[]') THEN
      RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    FOREACH v_id IN ARRAY p_extraction_ids LOOP
      SELECT * INTO v_row FROM hive.doc_extractions WHERE id = v_id;
      IF NOT FOUND OR v_row.hive_id IS DISTINCT FROM p_hive_id THEN
        RAISE EXCEPTION 'unauthorized_source' USING ERRCODE = 'P0001';
      END IF;
      v_matched := false;
      FOR v_gen IN SELECT value FROM jsonb_array_elements(p_generations) LOOP
        BEGIN
          v_doc_id := (v_gen->>'sourceDocumentId')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
        END;
        IF v_doc_id IS DISTINCT FROM v_row.source_document_id THEN
          CONTINUE;
        END IF;
        v_sha := lower(btrim(coalesce(v_gen->>'sourceSha256', '')));
        v_fingerprint := btrim(coalesce(v_gen->>'readFingerprint', ''));
        v_set := lower(btrim(coalesce(v_gen->>'pageSetDigest', '')));
        IF v_row.content_digest IS DISTINCT FROM 'sha256:' || v_sha THEN
          RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
        END IF;
        IF coalesce(v_row.extraction->>'documentId', '') IS DISTINCT FROM v_row.source_document_id::text
           OR coalesce(v_row.extraction->>'schema', '') IS DISTINCT FROM 'hive.doc-extraction/1' THEN
          RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM hive.source_documents d
           WHERE d.id = v_row.source_document_id
             AND d.case_id = p_hive_id
             AND d.owner_user_id = p_owner_user_id
        ) THEN
          RAISE EXCEPTION 'unauthorized_source' USING ERRCODE = 'P0001';
        END IF;
        v_matched := true;
        EXIT;
      END LOOP;
      IF NOT v_matched THEN
        RAISE EXCEPTION 'unauthorized_source' USING ERRCODE = 'P0001';
      END IF;
      v_seen := v_seen + 1;
    END LOOP;
    v_canonical := hive.authorized_extraction_canonical(p_extraction_ids);
    IF v_canonical IS NULL OR hive.sha256_hex(v_canonical) IS DISTINCT FROM p_extraction_digest THEN
      RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(coalesce(p_verified->'facts', '[]'::jsonb))
  LOOP
    IF coalesce(v_item->>'status', '') IS DISTINCT FROM 'VERIFIED'
       OR jsonb_typeof(v_item->'value') IS DISTINCT FROM 'object'
       OR coalesce(v_item->'value'->>'value', '') = '' THEN
      RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_typeof(v_item->'sourceRefs') IS DISTINCT FROM 'array' OR jsonb_array_length(v_item->'sourceRefs') < 1 THEN
      RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
    END IF;
    v_excerpt := NULL;
    v_ref_pages := ARRAY[]::text[];
    v_doc_id := NULL;
    FOR v_ref IN SELECT value FROM jsonb_array_elements(v_item->'sourceRefs') LOOP
      IF v_excerpt IS NULL THEN
        v_excerpt := coalesce(v_ref->>'excerptId', '');
      ELSIF v_excerpt IS DISTINCT FROM coalesce(v_ref->>'excerptId', '') THEN
        RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        IF v_doc_id IS NULL THEN
          v_doc_id := (v_ref->>'documentId')::uuid;
        ELSIF v_doc_id IS DISTINCT FROM (v_ref->>'documentId')::uuid THEN
          RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
        END IF;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
      END;
      v_page := coalesce(v_ref->>'page', '');
      IF v_page = '' OR v_page = ANY (v_ref_pages) THEN
        RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
      END IF;
      v_ref_pages := array_append(v_ref_pages, v_page);
    END LOOP;
    v_fact := NULL;
    FOR v_id IN SELECT unnest(p_extraction_ids) LOOP
      SELECT * INTO v_row FROM hive.doc_extractions WHERE id = v_id;
      IF v_row.source_document_id IS DISTINCT FROM v_doc_id THEN
        CONTINUE;
      END IF;
      SELECT elem INTO v_fact
        FROM jsonb_array_elements(coalesce(v_row.extraction->'facts', '[]'::jsonb)) AS elem
       WHERE elem->>'id' = v_excerpt
       LIMIT 1;
      EXIT WHEN v_fact IS NOT NULL;
    END LOOP;
    IF v_fact IS NULL
       OR hive.normalize_quote_text(v_fact->>'valueAsWritten') IS DISTINCT FROM hive.normalize_quote_text(v_item->'value'->>'value') THEN
      RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
    END IF;
    v_evidence_pages := ARRAY[]::text[];
    FOR v_ref IN SELECT value FROM jsonb_array_elements(coalesce(v_fact->'evidence', '[]'::jsonb)) LOOP
      v_page := coalesce(v_ref->>'page', '');
      v_quote := coalesce(v_ref->>'quote', '');
      IF v_page = '' OR v_page = ANY (v_evidence_pages) OR v_quote = '' THEN
        RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
      END IF;
      v_evidence_pages := array_append(v_evidence_pages, v_page);
      SELECT p.page_text INTO v_page_text
        FROM hive.document_pages p
        JOIN jsonb_array_elements(p_generations) gen ON (gen->>'sourceDocumentId')::uuid = p.source_document_id
       WHERE p.hive_id = p_hive_id
         AND p.source_document_id = v_doc_id
         AND p.page_number::text = v_page
         AND p.source_sha256 = lower(btrim(gen->>'sourceSha256'))
         AND p.read_fingerprint = btrim(gen->>'readFingerprint')
         AND p.page_set_digest = lower(btrim(gen->>'pageSetDigest'));
      IF NOT FOUND OR NOT hive.quote_on_page(v_quote, v_page_text) THEN
        RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    IF (SELECT array_agg(x ORDER BY x) FROM unnest(v_evidence_pages) AS x)
       IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(v_ref_pages) AS x) THEN
      RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(coalesce(p_verified->'documents', '[]'::jsonb))
  LOOP
    IF coalesce(v_item->>'status', '') IS DISTINCT FROM 'VERIFIED'
       OR jsonb_typeof(v_item->'sourceRefs') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_item->'sourceRefs') < 1 THEN
      RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
    END IF;
    v_excerpt := NULL;
    v_doc_id := NULL;
    v_ref_pages := ARRAY[]::text[];
    FOR v_ref IN SELECT value FROM jsonb_array_elements(v_item->'sourceRefs') LOOP
      IF v_excerpt IS NULL THEN
        v_excerpt := coalesce(v_ref->>'excerptId', '');
      ELSIF v_excerpt IS DISTINCT FROM coalesce(v_ref->>'excerptId', '') THEN
        RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        IF v_doc_id IS NULL THEN
          v_doc_id := (v_ref->>'documentId')::uuid;
        ELSIF v_doc_id IS DISTINCT FROM (v_ref->>'documentId')::uuid THEN
          RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
        END IF;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
      END;
      v_page := coalesce(v_ref->>'page', '');
      IF v_page = '' OR v_page = ANY (v_ref_pages) THEN
        RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
      END IF;
      v_ref_pages := array_append(v_ref_pages, v_page);
    END LOOP;
    v_fact := NULL;
    FOR v_id IN SELECT unnest(p_extraction_ids) LOOP
      SELECT * INTO v_row FROM hive.doc_extractions WHERE id = v_id;
      IF v_row.source_document_id IS DISTINCT FROM v_doc_id THEN
        CONTINUE;
      END IF;
      SELECT elem INTO v_fact
        FROM jsonb_array_elements(coalesce(v_row.extraction->'facts', '[]'::jsonb)) AS elem
       WHERE elem->>'id' = v_excerpt
       LIMIT 1;
      EXIT WHEN v_fact IS NOT NULL;
    END LOOP;
    IF v_fact IS NULL THEN
      RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
    END IF;
    v_evidence_pages := ARRAY[]::text[];
    FOR v_ref IN SELECT value FROM jsonb_array_elements(coalesce(v_fact->'evidence', '[]'::jsonb)) LOOP
      v_page := coalesce(v_ref->>'page', '');
      v_quote := coalesce(v_ref->>'quote', '');
      IF v_page = '' OR v_quote = '' THEN
        RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
      END IF;
      v_evidence_pages := array_append(v_evidence_pages, v_page);
      SELECT p.page_text INTO v_page_text
        FROM hive.document_pages p
        JOIN jsonb_array_elements(p_generations) gen ON (gen->>'sourceDocumentId')::uuid = p.source_document_id
       WHERE p.hive_id = p_hive_id
         AND p.source_document_id = v_doc_id
         AND p.page_number::text = v_page
         AND p.source_sha256 = lower(btrim(gen->>'sourceSha256'))
         AND p.read_fingerprint = btrim(gen->>'readFingerprint')
         AND p.page_set_digest = lower(btrim(gen->>'pageSetDigest'));
      IF NOT FOUND OR NOT hive.quote_on_page(v_quote, v_page_text) THEN
        RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    IF (SELECT array_agg(x ORDER BY x) FROM unnest(v_evidence_pages) AS x)
       IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(v_ref_pages) AS x) THEN
      RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(coalesce(p_unresolved->'candidates', '[]'::jsonb))
  LOOP
    FOR v_ref IN SELECT value FROM jsonb_array_elements(coalesce(v_item->'evidence', '[]'::jsonb)) LOOP
      v_quote := coalesce(v_ref->>'quote', '');
      v_page := coalesce(v_ref->>'page', '');
      IF v_quote = '' OR v_page = '' THEN
        RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        v_doc_id := (v_ref->>'sourceDocumentId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'incomplete_evidence' USING ERRCODE = 'P0001';
      END;
      SELECT p.page_text INTO v_page_text
        FROM hive.document_pages p
        JOIN jsonb_array_elements(p_generations) gen ON (gen->>'sourceDocumentId')::uuid = p.source_document_id
       WHERE p.hive_id = p_hive_id
         AND p.source_document_id = v_doc_id
         AND p.page_number::text = v_page
         AND p.source_sha256 = lower(btrim(gen->>'sourceSha256'))
         AND p.read_fingerprint = btrim(gen->>'readFingerprint')
         AND p.page_set_digest = lower(btrim(gen->>'pageSetDigest'));
      IF NOT FOUND OR NOT hive.quote_on_page(v_quote, v_page_text) THEN
        RAISE EXCEPTION 'untrusted_verified_fact' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Server pin creation. service_role only. The Hive owner is revalidated
-- against hive.hives. Same request and same preimage replays. Same request
-- and a different preimage conflicts. A new request for an existing pin aliases
-- it. The Hive row lock serializes creators of one Hive.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_investigation_evidence_pin(
  p_hive_id uuid,
  p_owner_user_id uuid,
  p_request_id uuid,
  p_pin_canonical_json text,
  p_pack_canonical_json text,
  p_plan_canonical_json text,
  p_extraction_ids uuid[]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_hive hive.hives%ROWTYPE;
  v_pin_body jsonb;
  v_pack_digest text;
  v_plan_digest text;
  v_pin_id text;
  v_pack_id text;
  v_version text;
  v_bindings jsonb;
  v_binding jsonb;
  v_existing_pin hive.investigation_evidence_pins%ROWTYPE;
  v_existing_request hive.investigation_evidence_pin_requests%ROWTYPE;
  v_head_json text;
  v_record_id text;
  v_stored_pack text;
  v_stored_plan text;
BEGIN
  PERFORM hive.require_service_role();
  IF p_hive_id IS NULL OR p_owner_user_id IS NULL OR p_request_id IS NULL
     OR p_pin_canonical_json IS NULL OR p_pack_canonical_json IS NULL OR p_plan_canonical_json IS NULL
     OR p_extraction_ids IS NULL
     OR octet_length(p_pin_canonical_json) > 8388608
     OR octet_length(p_pin_canonical_json) < 2 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_hive
    FROM hive.hives h
   WHERE h.id = p_hive_id
     AND h.owner_user_id = p_owner_user_id
     AND h.archived_at IS NULL
     AND h.deleting_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_hive_id::text || ':investigation-evidence-pin', 0));

  BEGIN
    v_pin_body := p_pin_canonical_json::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END;
  IF jsonb_typeof(v_pin_body) IS DISTINCT FROM 'object'
     OR hive.canonical_json(v_pin_body) IS DISTINCT FROM p_pin_canonical_json THEN
    RAISE EXCEPTION 'pin_digest_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF (
    SELECT coalesce(array_agg(item.key ORDER BY item.key COLLATE "C"), ARRAY[]::text[])
      FROM jsonb_object_keys(v_pin_body) AS item(key)
  ) IS DISTINCT FROM ARRAY[
    'artifacts', 'binderDigest', 'evidenceDigest', 'extractionDigest', 'schema',
    'sourceGenerations', 'sourceGenerationsDigest', 'unresolved', 'verified'
  ]::text[] THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF v_pin_body->>'schema' IS DISTINCT FROM 'hive.investigation-evidence-pin/1' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_pin_body->>'extractionDigest', '') !~ '^[0-9a-f]{64}$'
     OR coalesce(v_pin_body->>'binderDigest', '') !~ '^[0-9a-f]{64}$'
     OR coalesce(v_pin_body->>'evidenceDigest', '') !~ '^[0-9a-f]{64}$'
     OR coalesce(v_pin_body->>'sourceGenerationsDigest', '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'pin_digest_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF hive.sha256_hex(hive.canonical_json(jsonb_build_object(
       'verified', v_pin_body->'verified',
       'unresolved', v_pin_body->'unresolved'
     ))) IS DISTINCT FROM v_pin_body->>'binderDigest'
     OR hive.sha256_hex(hive.investigation_evidence_canonical(v_pin_body->'verified', v_pin_body->'unresolved'))
        IS DISTINCT FROM v_pin_body->>'evidenceDigest' THEN
    RAISE EXCEPTION 'pin_digest_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF hive.sha256_hex(hive.canonical_json(v_pin_body->'sourceGenerations')) IS DISTINCT FROM v_pin_body->>'sourceGenerationsDigest' THEN
    RAISE EXCEPTION 'source_generation_mismatch' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('hive.evidence_pin_lifecycle', 'insert', true);
  v_pack_digest := hive.evidence_pin_put_artifact('PACK', p_pack_canonical_json);
  v_plan_digest := hive.evidence_pin_put_artifact('PLAN', p_plan_canonical_json);

  v_pack_id := v_pin_body->'artifacts'->'pack'->>'packId';
  v_version := v_pin_body->'artifacts'->'pack'->>'version';
  IF v_pin_body->'artifacts'->'pack'->>'retrieval' IS DISTINCT FROM 'CONTENT_DIGEST'
     OR v_pin_body->'artifacts'->'plan'->>'retrieval' IS DISTINCT FROM 'CONTENT_DIGEST'
     OR v_pin_body->'artifacts'->'pack'->>'schema' IS DISTINCT FROM 'hive.domain-pack-runtime/1'
     OR v_pin_body->'artifacts'->'plan'->>'schema' IS DISTINCT FROM 'hive.domain-investigation-plan/1'
     OR v_pin_body->'artifacts'->'pack'->>'digest' IS DISTINCT FROM v_pack_digest
     OR v_pin_body->'artifacts'->'plan'->>'digest' IS DISTINCT FROM v_plan_digest
     OR v_pack_id IS NULL OR v_version IS NULL THEN
    RAISE EXCEPTION 'artifact_preimage_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM hive.investigation_artifact_preimages a
     WHERE a.digest = v_pack_digest
       AND (a.pack_id IS DISTINCT FROM v_pack_id OR a.version IS DISTINCT FROM v_version)
  ) THEN
    RAISE EXCEPTION 'artifact_preimage_mismatch' USING ERRCODE = 'P0001';
  END IF;

  v_bindings := hive.evidence_pin_source_bindings(
    v_hive.id,
    v_hive.owner_user_id,
    v_pin_body->'sourceGenerations',
    v_pin_body->'verified',
    v_pin_body->'unresolved'
  );
  PERFORM hive.evidence_pin_require_trusted_facts(
    v_hive.id,
    v_hive.owner_user_id,
    p_extraction_ids,
    v_pin_body->'sourceGenerations',
    v_pin_body->'verified',
    v_pin_body->'unresolved',
    v_pin_body->>'extractionDigest'
  );
  v_pin_id := hive.sha256_hex(p_pin_canonical_json);

  SELECT * INTO v_existing_request
    FROM hive.investigation_evidence_pin_requests r
   WHERE r.hive_id = v_hive.id
     AND r.request_id = p_request_id;
  IF FOUND THEN
    SELECT * INTO v_existing_pin
      FROM hive.investigation_evidence_pins p
     WHERE p.hive_id = v_hive.id
       AND p.pin_id = v_existing_request.pin_id;
    SELECT canonical_json INTO v_stored_pack
      FROM hive.investigation_artifact_preimages WHERE digest = v_existing_pin.pack_digest;
    SELECT canonical_json INTO v_stored_plan
      FROM hive.investigation_artifact_preimages WHERE digest = v_existing_pin.plan_digest;
    IF v_existing_pin.canonical_json IS NOT DISTINCT FROM p_pin_canonical_json
       AND v_stored_pack IS NOT DISTINCT FROM p_pack_canonical_json
       AND v_stored_plan IS NOT DISTINCT FROM p_plan_canonical_json
       AND v_existing_request.pin_id = v_pin_id THEN
      SELECT record_id INTO v_record_id
        FROM hive.relationship_verification_chain
       WHERE hive_id = v_hive.id AND pin_id = v_existing_pin.pin_id AND sequence = 0;
      PERFORM set_config('hive.evidence_pin_lifecycle', '', true);
      PERFORM hive.evidence_pin_audit(v_hive, 'replayed', p_request_id, v_existing_pin, v_record_id);
      RETURN hive.evidence_pin_receipt('replayed', v_hive.id, p_request_id, v_existing_pin, v_record_id);
    END IF;
    IF v_existing_pin.canonical_json IS DISTINCT FROM p_pin_canonical_json OR v_existing_request.pin_id IS DISTINCT FROM v_pin_id THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'artifact_preimage_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_pin
    FROM hive.investigation_evidence_pins p
   WHERE p.hive_id = v_hive.id
     AND p.pin_id = v_pin_id;
  IF FOUND THEN
    IF v_existing_pin.canonical_json IS DISTINCT FROM p_pin_canonical_json THEN
      RAISE EXCEPTION 'pin_digest_mismatch' USING ERRCODE = 'P0001';
    END IF;
    PERFORM set_config('hive.evidence_pin_lifecycle', 'insert', true);
    INSERT INTO hive.investigation_evidence_pin_requests (hive_id, request_id, pin_id, outcome)
    VALUES (v_hive.id, p_request_id, v_pin_id, 'aliased');
    PERFORM set_config('hive.evidence_pin_lifecycle', '', true);
    SELECT record_id INTO v_record_id
      FROM hive.relationship_verification_chain
     WHERE hive_id = v_hive.id AND pin_id = v_pin_id AND sequence = 0;
    PERFORM hive.evidence_pin_audit(v_hive, 'aliased', p_request_id, v_existing_pin, v_record_id);
    RETURN hive.evidence_pin_receipt('aliased', v_hive.id, p_request_id, v_existing_pin, v_record_id);
  END IF;

  v_head_json := hive.canonical_json(jsonb_build_object(
    'schema', 'hive.relationship-verification-head/1',
    'sequence', 0,
    'causalParentId', NULL,
    'hiveId', v_hive.id,
    'pinId', v_pin_id,
    'packDigest', v_pack_digest,
    'planDigest', v_plan_digest,
    'evidenceRevision', jsonb_build_object(
      'extractionDigest', v_pin_body->>'extractionDigest',
      'binderDigest', v_pin_body->>'binderDigest',
      'evidenceDigest', v_pin_body->>'evidenceDigest'
    )
  ));
  v_record_id := hive.sha256_hex(v_head_json);

  PERFORM set_config('hive.evidence_pin_lifecycle', 'insert', true);
  INSERT INTO hive.investigation_evidence_pins (
    hive_id, owner_user_id, pin_id, pack_digest, plan_digest,
    extraction_digest, binder_digest, evidence_digest, source_generations_digest,
    canonical_json, verified, unresolved, source_generations
  ) VALUES (
    v_hive.id,
    v_hive.owner_user_id,
    v_pin_id,
    v_pack_digest,
    v_plan_digest,
    v_pin_body->>'extractionDigest',
    v_pin_body->>'binderDigest',
    v_pin_body->>'evidenceDigest',
    v_pin_body->>'sourceGenerationsDigest',
    p_pin_canonical_json,
    v_pin_body->'verified',
    v_pin_body->'unresolved',
    v_pin_body->'sourceGenerations'
  );
  FOR v_binding IN SELECT value FROM jsonb_array_elements(v_bindings) LOOP
    INSERT INTO hive.investigation_evidence_pin_pages (
      hive_id, pin_id, document_page_id, source_document_id, page_set_digest,
      page_number, page_text_sha256, read_fingerprint, source_sha256
    ) VALUES (
      v_hive.id,
      v_pin_id,
      (v_binding->>'documentPageId')::uuid,
      (v_binding->>'sourceDocumentId')::uuid,
      v_binding->>'pageSetDigest',
      (v_binding->>'pageNumber')::integer,
      v_binding->>'pageTextSha256',
      v_binding->>'readFingerprint',
      v_binding->>'sourceSha256'
    );
  END LOOP;
  INSERT INTO hive.relationship_verification_chain (
    hive_id, pin_id, sequence, record_id, causal_parent_id, canonical_json,
    pack_digest, plan_digest, extraction_digest, binder_digest, evidence_digest
  ) VALUES (
    v_hive.id, v_pin_id, 0, v_record_id, NULL, v_head_json,
    v_pack_digest, v_plan_digest,
    v_pin_body->>'extractionDigest', v_pin_body->>'binderDigest', v_pin_body->>'evidenceDigest'
  );
  INSERT INTO hive.investigation_evidence_pin_requests (hive_id, request_id, pin_id, outcome)
  VALUES (v_hive.id, p_request_id, v_pin_id, 'created');
  PERFORM set_config('hive.evidence_pin_lifecycle', '', true);

  SELECT * INTO v_existing_pin
    FROM hive.investigation_evidence_pins
   WHERE hive_id = v_hive.id AND pin_id = v_pin_id;
  PERFORM hive.evidence_pin_audit(v_hive, 'created', p_request_id, v_existing_pin, v_record_id);
  RETURN hive.evidence_pin_receipt('created', v_hive.id, p_request_id, v_existing_pin, v_record_id);
END;
$$;

COMMENT ON FUNCTION public.create_investigation_evidence_pin(uuid, uuid, uuid, text, text, text, uuid[]) IS
  'Service-role pin creation. Revalidates the Hive owner and stores a verified fact only when it is a stored extraction fact on the authorized page. Returns digests and the sequence-zero chain head only.';

-- Authorized Hive deletion removes pins and unreferenced preimages before the
-- Hive row cascade reaches retained document pages.
CREATE OR REPLACE FUNCTION public.complete_hive_deletion(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM hive.hives h WHERE h.id = p_hive_id AND h.deleting_at IS NOT NULL
  ) THEN
    PERFORM set_config('hive.evidence_pin_lifecycle', 'delete', true);
    DELETE FROM hive.investigation_evidence_pins WHERE hive_id = p_hive_id;
    DELETE FROM hive.investigation_artifact_preimages a
     WHERE NOT EXISTS (
       SELECT 1
         FROM hive.investigation_evidence_pins p
        WHERE p.pack_digest = a.digest OR p.plan_digest = a.digest
     );
    PERFORM set_config('hive.evidence_pin_lifecycle', '', true);
  END IF;

  DELETE FROM hive.hives h
   WHERE h.id = p_hive_id
     AND h.deleting_at IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 1 THEN
    RETURN json_build_object('deleted', true, 'replayed', false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM hive.hives h WHERE h.id = p_hive_id) THEN
    RETURN json_build_object('deleted', true, 'replayed', true);
  END IF;

  IF EXISTS (
    SELECT 1
      FROM hive.hives h
     WHERE h.id = p_hive_id
       AND h.deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hive_not_deleting' USING ERRCODE = '22023';
  END IF;

  RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
END;
$$;

ALTER TABLE hive.investigation_artifact_preimages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.investigation_artifact_preimages FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.investigation_evidence_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.investigation_evidence_pins FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.investigation_evidence_pin_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.investigation_evidence_pin_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.investigation_evidence_pin_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.investigation_evidence_pin_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.relationship_verification_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.relationship_verification_chain FORCE ROW LEVEL SECURITY;

REVOKE ALL ON hive.investigation_artifact_preimages FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON hive.investigation_evidence_pins FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON hive.investigation_evidence_pin_requests FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON hive.investigation_evidence_pin_pages FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON hive.relationship_verification_chain FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION hive.sha256_hex(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.canonical_json(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.jsonb_text_array_sorted(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.investigation_evidence_canonical(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.enforce_evidence_pin_lifecycle() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.bind_evidence_pin_page() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.prevent_pinned_page_generation_delete() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.evidence_pin_audit_metadata_ok(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.enforce_evidence_pin_audit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.evidence_pin_source_bindings(uuid, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.evidence_pin_put_artifact(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.evidence_pin_receipt(text, uuid, uuid, hive.investigation_evidence_pins, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.evidence_pin_audit(hive.hives, text, uuid, hive.investigation_evidence_pins, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.normalize_quote_text(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.quote_on_page(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.authorized_extraction_canonical(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION hive.evidence_pin_require_trusted_facts(uuid, uuid, uuid[], jsonb, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_investigation_evidence_pin(uuid, uuid, uuid, text, text, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_investigation_evidence_pin(uuid, uuid, uuid, text, text, text, uuid[]) TO service_role;

COMMIT;
