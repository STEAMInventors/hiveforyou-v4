-- V4 Document Reader Step 1 — Persisted source pages (`hive.document_pages`),
-- `read_status` on `hive.source_documents`, page-set digest verification, and
-- `service_role` RPCs (`public.put_document_pages`, `public.list_document_pages`).
-- `put_document_pages` stores pages only; the document's read outcome is set by
-- `public.transition_document_read` (20261101200000) after readback verification.
--
-- Authority: HiveForYou-DATA-MODEL.md, HiveForYou-NAMING-CONVENTIONS.md,
-- HiveForYou-ERROR-HANDLING-OBSERVABILITY.md, HiveForYou-SECURITY-AND-PRIVACY.md.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Add read_status to hive.source_documents (remains out of immutable identity guard)
-- ---------------------------------------------------------------------------
ALTER TABLE hive.source_documents
  ADD COLUMN IF NOT EXISTS read_status text NOT NULL DEFAULT 'PENDING';

ALTER TABLE hive.source_documents
  DROP CONSTRAINT IF EXISTS ck_source_documents__read_status;

ALTER TABLE hive.source_documents
  ADD CONSTRAINT ck_source_documents__read_status CHECK (
    read_status IN ('PENDING', 'SUCCEEDED', 'PARTIAL', 'UNREADABLE', 'FAILED')
  );

-- Update list_hive_source_documents so registered documents reflect persisted read_status.
CREATE OR REPLACE FUNCTION public.list_hive_source_documents(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_docs json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hive.hives h
     WHERE h.id = p_hive_id AND h.owner_user_id = v_uid AND h.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(json_agg(row ORDER BY row->>'createdAt' DESC), '[]'::json)
    INTO v_docs
    FROM (
      SELECT json_build_object(
        'id', d.id,
        'hiveId', d.case_id,
        'clientRequestId', COALESCE(u.client_request_id, d.id),
        'fileName', d.original_filename,
        'mimeType', d.mime_type,
        'byteSize', d.byte_size,
        'status', 'REGISTERED',
        'failureReason', NULL,
        'scanStatus', 'UNKNOWN_TO_SCANNER',
        'readStatus', COALESCE(d.read_status, 'PENDING'),
        'registeredAt', d.created_at,
        'createdAt', d.created_at,
        'updatedAt', d.created_at
      ) AS row
        FROM hive.source_documents d
        LEFT JOIN hive.upload_operations u
          ON u.source_document_id = d.id AND u.status = 'REGISTERED'
       WHERE d.case_id = p_hive_id
         AND d.owner_user_id = v_uid
         AND d.lifecycle_status = 'ACTIVE'
         AND d.deleted_at IS NULL
      UNION ALL
      SELECT json_build_object(
        'id', u.source_document_id,
        'hiveId', u.case_id,
        'clientRequestId', u.client_request_id,
        'fileName', u.original_filename,
        'mimeType', u.mime_type,
        'byteSize', u.byte_size,
        'status', CASE WHEN u.status = 'FAILED' THEN 'REJECTED' ELSE 'PENDING' END,
        'failureReason', CASE WHEN u.status = 'FAILED' THEN 'TYPE_MISMATCH' ELSE NULL END,
        'scanStatus', 'UNKNOWN_TO_SCANNER',
        'readStatus', 'PENDING',
        'registeredAt', NULL,
        'createdAt', u.created_at,
        'updatedAt', u.updated_at
      ) AS row
        FROM hive.upload_operations u
       WHERE u.case_id = p_hive_id
         AND u.owner_user_id = v_uid
         AND u.status IN ('PENDING', 'STORED')
         AND NOT EXISTS (
           SELECT 1 FROM hive.source_documents d WHERE d.id = u.source_document_id
         )
    ) combined;

  RETURN json_build_object('sourceDocuments', v_docs);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Table hive.document_pages (1-based physical pages, <= 64 KiB per page)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.document_pages (
  id uuid DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_sha256 text NOT NULL,
  read_fingerprint text NOT NULL,
  page_set_digest text NOT NULL,
  page_count integer NOT NULL,
  page_number integer NOT NULL,
  page_text text NOT NULL,
  page_text_sha256 text NOT NULL,
  page_byte_length integer NOT NULL,
  extraction_method text NOT NULL,
  extraction_status text NOT NULL DEFAULT 'SUCCEEDED',
  provenance_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_document_pages PRIMARY KEY (id),
  CONSTRAINT fk_document_pages__hives
    FOREIGN KEY (hive_id) REFERENCES hive.hives (id) ON DELETE CASCADE,
  CONSTRAINT fk_document_pages__source_documents
    FOREIGN KEY (source_document_id) REFERENCES hive.source_documents (id) ON DELETE CASCADE,
  CONSTRAINT uq_document_pages__source_generation_page UNIQUE (
    source_document_id, page_set_digest, page_number
  ),
  CONSTRAINT ck_document_pages__page_bounds CHECK (
    page_count >= 1 AND page_number >= 1 AND page_number <= page_count
  ),
  CONSTRAINT ck_document_pages__source_sha256_format CHECK (
    source_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_document_pages__read_fingerprint_not_blank CHECK (
    char_length(btrim(read_fingerprint)) > 0 AND char_length(read_fingerprint) <= 128
  ),
  CONSTRAINT ck_document_pages__page_set_digest_format CHECK (
    page_set_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_document_pages__page_text_sha256_format CHECK (
    page_text_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_document_pages__page_text_sha256_matches CHECK (
    page_text_sha256 = 'sha256:' || encode(sha256(convert_to(page_text, 'UTF8')), 'hex')
  ),
  CONSTRAINT ck_document_pages__page_byte_length_matches CHECK (
    page_byte_length = octet_length(convert_to(page_text, 'UTF8'))
  ),
  CONSTRAINT ck_document_pages__page_text_size CHECK (
    octet_length(convert_to(page_text, 'UTF8')) <= 65536
  ),
  CONSTRAINT ck_document_pages__extraction_method CHECK (
    extraction_method IN ('pdf_native', 'image_ocr_local', 'docx_render_v1')
  ),
  CONSTRAINT ck_document_pages__extraction_status CHECK (
    extraction_status IN ('SUCCEEDED')
  ),
  CONSTRAINT ck_document_pages__provenance_size CHECK (
    jsonb_typeof(provenance_json) = 'object' AND octet_length(provenance_json::text) <= 65536
  )
);

COMMENT ON TABLE hive.document_pages IS
  'Persisted Reader-prepared physical pages and provenance (<= 64 KiB/page). Insert-only; written via service_role RPC.';

CREATE INDEX IF NOT EXISTS idx_document_pages__hive_source_page
  ON hive.document_pages (hive_id, source_document_id, page_number);

CREATE INDEX IF NOT EXISTS idx_document_pages__hive_source_generation
  ON hive.document_pages (
    hive_id, source_document_id, read_fingerprint, page_set_digest, page_number
  );

-- ---------------------------------------------------------------------------
-- 3. Deterministic page-set digest (must match @hiveforyou/contracts computePageSetDigest)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.compute_page_set_digest(
  p_source_sha256 text,
  p_page_count integer,
  p_pages jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_source text := lower(btrim(p_source_sha256));
  v_hashes text;
BEGIN
  IF v_source !~ '^[0-9a-f]{64}$' OR p_page_count IS NULL OR p_page_count < 1 THEN
    RETURN NULL;
  END IF;
  IF p_pages IS NULL OR jsonb_typeof(p_pages) <> 'array' OR jsonb_array_length(p_pages) <> p_page_count THEN
    RETURN NULL;
  END IF;

  SELECT string_agg(lower(btrim(elem ->> 'page_text_sha256')), E'\n' ORDER BY (elem ->> 'page_number')::integer)
    INTO v_hashes
    FROM jsonb_array_elements(p_pages) AS elem;

  IF v_hashes IS NULL OR v_hashes = '' THEN
    RETURN NULL;
  END IF;

  RETURN 'sha256:' || encode(
    sha256(
      convert_to(
        'document-page-set@1' || E'\n'
          || v_source || E'\n'
          || p_page_count::text || E'\n'
          || v_hashes || E'\n',
        'UTF8'
      )
    ),
    'hex'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Triggers: Hive/source binding and immutability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.bind_document_page_to_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_doc hive.source_documents%ROWTYPE;
BEGIN
  SELECT * INTO v_doc FROM hive.source_documents WHERE id = NEW.source_document_id;
  IF NOT FOUND
     OR v_doc.deleted_at IS NOT NULL
     OR v_doc.lifecycle_status <> 'ACTIVE'
     OR v_doc.upload_status <> 'UPLOADED' THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NEW.hive_id IS NOT NULL AND NEW.hive_id <> v_doc.case_id THEN
    RAISE EXCEPTION 'page_hive_mismatch' USING ERRCODE = '42501';
  END IF;

  IF v_doc.sha256 IS NULL OR lower(btrim(v_doc.sha256)) <> lower(btrim(NEW.source_sha256)) THEN
    RAISE EXCEPTION 'page_source_sha256_mismatch' USING ERRCODE = 'P0001';
  END IF;

  NEW.hive_id := v_doc.case_id;
  NEW.source_sha256 := lower(btrim(NEW.source_sha256));
  NEW.read_fingerprint := btrim(NEW.read_fingerprint);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_pages__bind_source ON hive.document_pages;
CREATE TRIGGER trg_document_pages__bind_source
  BEFORE INSERT ON hive.document_pages
  FOR EACH ROW
  EXECUTE FUNCTION hive.bind_document_page_to_source();

CREATE OR REPLACE FUNCTION hive.prevent_document_page_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'hive.document_pages rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_document_pages__immutable_update ON hive.document_pages;
CREATE TRIGGER trg_document_pages__immutable_update
  BEFORE UPDATE ON hive.document_pages
  FOR EACH ROW
  EXECUTE FUNCTION hive.prevent_document_page_mutation();

-- ---------------------------------------------------------------------------
-- 5. Service-role RPCs for persisting and reading back document_pages
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.put_document_pages(
  p_hive_id uuid,
  p_source_document_id uuid,
  p_source_sha256 text,
  p_read_fingerprint text,
  p_page_set_digest text,
  p_read_status text,
  p_total_physical_pages integer,
  p_page_count integer,
  p_pages jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_doc hive.source_documents%ROWTYPE;
  v_sha text := lower(btrim(coalesce(p_source_sha256, '')));
  v_fp text := btrim(coalesce(p_read_fingerprint, ''));
  v_set_digest text := lower(btrim(coalesce(p_page_set_digest, '')));
  v_status text := upper(btrim(coalesce(p_read_status, 'SUCCEEDED')));
  v_expected_digest text;
  v_elem jsonb;
  v_idx integer := 0;
  v_page_num integer;
  v_page_text text;
  v_page_sha text;
  v_byte_len integer;
  v_method text;
  v_prov jsonb;
  v_existing hive.document_pages%ROWTYPE;
  v_inserted integer := 0;
  v_replayed integer := 0;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc FROM hive.source_documents WHERE id = p_source_document_id;
  IF NOT FOUND
     OR v_doc.deleted_at IS NOT NULL
     OR v_doc.lifecycle_status <> 'ACTIVE'
     OR v_doc.upload_status <> 'UPLOADED' THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_hive_id IS NULL OR v_doc.case_id <> p_hive_id THEN
    RAISE EXCEPTION 'page_hive_mismatch' USING ERRCODE = '42501';
  END IF;

  IF v_doc.sha256 IS NULL OR lower(btrim(v_doc.sha256)) <> v_sha OR v_sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'page_source_sha256_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF char_length(v_fp) = 0 OR char_length(v_fp) > 128 THEN
    RAISE EXCEPTION 'page_read_fingerprint_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_set_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'page_set_digest_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_status NOT IN ('SUCCEEDED', 'PARTIAL', 'UNREADABLE') THEN
    RAISE EXCEPTION 'page_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF p_page_count IS NULL OR p_page_count < 1
     OR p_total_physical_pages IS NULL OR p_total_physical_pages < p_page_count
     OR p_pages IS NULL OR jsonb_typeof(p_pages) <> 'array'
     OR jsonb_array_length(p_pages) <> p_page_count THEN
    RAISE EXCEPTION 'page_numbering_invalid' USING ERRCODE = 'P0001';
  END IF;

  FOR v_elem IN
    SELECT value
      FROM jsonb_array_elements(p_pages)
     ORDER BY CASE
       WHEN jsonb_typeof(value -> 'page_number') = 'number'
         AND (value ->> 'page_number') ~ '^[0-9]+$'
       THEN (value ->> 'page_number')::integer
       ELSE -1
     END
  LOOP
    v_idx := v_idx + 1;
    IF jsonb_typeof(v_elem) <> 'object'
       OR jsonb_typeof(v_elem -> 'page_number') <> 'number'
       OR (v_elem ->> 'page_number') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'page_numbering_invalid' USING ERRCODE = 'P0001';
    END IF;
    v_page_num := (v_elem ->> 'page_number')::integer;
    IF v_page_num <> v_idx THEN
      RAISE EXCEPTION 'page_numbering_invalid' USING ERRCODE = 'P0001';
    END IF;

    IF jsonb_typeof(v_elem -> 'page_text') <> 'string' THEN
      RAISE EXCEPTION 'page_invalid' USING ERRCODE = 'P0001';
    END IF;
    v_page_text := v_elem ->> 'page_text';
    v_byte_len := octet_length(convert_to(v_page_text, 'UTF8'));
    IF v_byte_len > 65536 THEN
      RAISE EXCEPTION 'page_payload_too_large' USING ERRCODE = 'P0001';
    END IF;

    v_page_sha := 'sha256:' || encode(sha256(convert_to(v_page_text, 'UTF8')), 'hex');
    IF (v_elem ->> 'page_text_sha256') IS DISTINCT FROM v_page_sha
       OR COALESCE((v_elem ->> 'page_byte_length')::integer, -1) <> v_byte_len THEN
      RAISE EXCEPTION 'page_invalid' USING ERRCODE = 'P0001';
    END IF;

    v_method := v_elem ->> 'extraction_method';
    IF v_method IS NULL OR v_method NOT IN ('pdf_native', 'image_ocr_local', 'docx_render_v1') THEN
      RAISE EXCEPTION 'page_invalid' USING ERRCODE = 'P0001';
    END IF;

    v_prov := v_elem -> 'provenance_json';
    IF v_prov IS NULL OR jsonb_typeof(v_prov) <> 'object' THEN
      RAISE EXCEPTION 'page_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF octet_length(v_prov::text) > 65536 THEN
      RAISE EXCEPTION 'page_payload_too_large' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  v_expected_digest := hive.compute_page_set_digest(v_sha, p_page_count, p_pages);
  IF v_expected_digest IS NULL OR v_expected_digest <> v_set_digest THEN
    RAISE EXCEPTION 'page_set_digest_mismatch' USING ERRCODE = 'P0001';
  END IF;

  FOR v_elem IN
    SELECT value
      FROM jsonb_array_elements(p_pages)
     ORDER BY ((value ->> 'page_number')::integer)
  LOOP
    v_page_num := (v_elem ->> 'page_number')::integer;
    v_page_text := v_elem ->> 'page_text';
    v_page_sha := v_elem ->> 'page_text_sha256';
    v_byte_len := (v_elem ->> 'page_byte_length')::integer;
    v_method := v_elem ->> 'extraction_method';
    v_prov := v_elem -> 'provenance_json';

    SELECT * INTO v_existing
      FROM hive.document_pages
     WHERE source_document_id = p_source_document_id
       AND page_set_digest = v_set_digest
       AND page_number = v_page_num;

    IF FOUND THEN
      IF v_existing.hive_id = v_doc.case_id
         AND v_existing.source_sha256 = v_sha
         AND v_existing.read_fingerprint = v_fp
         AND v_existing.page_set_digest = v_set_digest
         AND v_existing.page_count = p_page_count
         AND v_existing.page_text_sha256 = v_page_sha
         AND v_existing.page_byte_length = v_byte_len
         AND v_existing.page_text = v_page_text
         AND v_existing.extraction_method = v_method THEN
        v_replayed := v_replayed + 1;
      ELSE
        RAISE EXCEPTION 'page_hash_conflict' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      BEGIN
        INSERT INTO hive.document_pages (
          hive_id,
          source_document_id,
          source_sha256,
          read_fingerprint,
          page_set_digest,
          page_count,
          page_number,
          page_text,
          page_text_sha256,
          page_byte_length,
          extraction_method,
          extraction_status,
          provenance_json
        ) VALUES (
          v_doc.case_id,
          p_source_document_id,
          v_sha,
          v_fp,
          v_set_digest,
          p_page_count,
          v_page_num,
          v_page_text,
          v_page_sha,
          v_byte_len,
          v_method,
          'SUCCEEDED',
          v_prov
        );
        v_inserted := v_inserted + 1;
      EXCEPTION
        WHEN unique_violation THEN
          SELECT * INTO v_existing
            FROM hive.document_pages
           WHERE source_document_id = p_source_document_id
             AND page_set_digest = v_set_digest
             AND page_number = v_page_num;
          IF FOUND
             AND v_existing.hive_id = v_doc.case_id
             AND v_existing.source_sha256 = v_sha
             AND v_existing.read_fingerprint = v_fp
             AND v_existing.page_set_digest = v_set_digest
             AND v_existing.page_count = p_page_count
             AND v_existing.page_text_sha256 = v_page_sha
             AND v_existing.page_byte_length = v_byte_len
             AND v_existing.page_text = v_page_text
             AND v_existing.extraction_method = v_method THEN
            v_replayed := v_replayed + 1;
          ELSE
            RAISE EXCEPTION 'page_hash_conflict' USING ERRCODE = 'P0001';
          END IF;
      END;
    END IF;
  END LOOP;

  -- read_status and page_count change only in public.transition_document_read,
  -- after the saved pages have been read back and verified.
  RETURN json_build_object(
    'source_document_id', p_source_document_id,
    'hive_id', v_doc.case_id,
    'source_sha256', v_sha,
    'read_fingerprint', v_fp,
    'page_set_digest', v_set_digest,
    'read_status', v_status,
    'total_physical_pages', p_total_physical_pages,
    'page_count', p_page_count,
    'inserted_count', v_inserted,
    'replayed_count', v_replayed
  );
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'page_invalid' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.list_document_pages(
  p_hive_id uuid,
  p_source_document_id uuid,
  p_read_fingerprint text,
  p_page_set_digest text
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_doc hive.source_documents%ROWTYPE;
  v_fp text := btrim(coalesce(p_read_fingerprint, ''));
  v_set_digest text := lower(btrim(coalesce(p_page_set_digest, '')));
  v_pages json;
  v_page_count integer;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc FROM hive.source_documents WHERE id = p_source_document_id;
  IF NOT FOUND
     OR v_doc.deleted_at IS NOT NULL
     OR v_doc.lifecycle_status <> 'ACTIVE'
     OR v_doc.upload_status <> 'UPLOADED' THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_hive_id IS NULL OR v_doc.case_id <> p_hive_id THEN
    RAISE EXCEPTION 'page_hive_mismatch' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_fp) = 0 OR char_length(v_fp) > 128 THEN
    RAISE EXCEPTION 'page_read_fingerprint_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_set_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'page_set_digest_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(
    json_agg(
      json_build_object(
        'id', p.id,
        'hive_id', p.hive_id,
        'source_document_id', p.source_document_id,
        'source_sha256', p.source_sha256,
        'read_fingerprint', p.read_fingerprint,
        'page_set_digest', p.page_set_digest,
        'page_count', p.page_count,
        'page_number', p.page_number,
        'page_text', p.page_text,
        'page_text_sha256', p.page_text_sha256,
        'page_byte_length', p.page_byte_length,
        'extraction_method', p.extraction_method,
        'extraction_status', p.extraction_status,
        'provenance_json', p.provenance_json,
        'created_at', p.created_at
      )
      ORDER BY p.page_number ASC
    ),
    '[]'::json
  )
    INTO v_pages
    FROM hive.document_pages p
   WHERE p.source_document_id = p_source_document_id
     AND p.hive_id = v_doc.case_id
     AND p.read_fingerprint = v_fp
     AND p.page_set_digest = v_set_digest;

  IF json_array_length(v_pages) > 0 THEN
    v_page_count := (v_pages -> 0 ->> 'page_count')::integer;
    IF v_page_count IS NULL
       OR v_page_count < 1
       OR json_array_length(v_pages) <> v_page_count THEN
      RAISE EXCEPTION 'page_generation_incomplete' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN json_build_object(
    'found', json_array_length(v_pages) > 0,
    'source_document_id', v_doc.id,
    'hive_id', v_doc.case_id,
    'source_sha256', lower(btrim(v_doc.sha256)),
    'read_fingerprint', v_fp,
    'page_set_digest', v_set_digest,
    'read_status', v_doc.read_status,
    'total_physical_pages', COALESCE(v_doc.page_count, json_array_length(v_pages)),
    'pages', v_pages
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Row-Level Security & least-privilege grants
-- ---------------------------------------------------------------------------
ALTER TABLE hive.document_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.document_pages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_document_pages__select__owner ON hive.document_pages;
CREATE POLICY pol_document_pages__select__owner
  ON hive.document_pages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = document_pages.hive_id
         AND h.owner_user_id = auth.uid()
         AND h.archived_at IS NULL
         AND h.deleting_at IS NULL
    )
  );

REVOKE ALL ON hive.document_pages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hive.document_pages TO authenticated;
GRANT ALL ON hive.document_pages TO service_role;

REVOKE ALL ON FUNCTION hive.compute_page_set_digest(text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hive.compute_page_set_digest(text, integer, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.put_document_pages(
  uuid, uuid, text, text, text, text, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.put_document_pages(
  uuid, uuid, text, text, text, text, integer, integer, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.list_document_pages(
  uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_document_pages(
  uuid, uuid, text, text
) TO service_role;

COMMIT;
