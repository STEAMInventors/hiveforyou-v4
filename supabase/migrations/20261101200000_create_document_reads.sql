-- V4-003 — Durable document read attempts (`hive.document_reads`).
--
-- One row per attempt to read one source document. The owner starts reads through
-- `public.start_document_reads`; the web server (service role) advances each attempt
-- QUEUED -> READING -> SAVING -> VERIFYING -> SUCCEEDED | PARTIAL | UNREADABLE, or FAILED,
-- through `public.transition_document_read`. A document's read outcome
-- (`hive.source_documents.read_status`) changes only on a terminal transition, and a
-- successful outcome requires the verified page rows to exist in `hive.document_pages`.
--
-- Authority: HiveForYou-DATA-MODEL.md, HiveForYou-NAMING-CONVENTIONS.md,
-- HiveForYou-ERROR-HANDLING-OBSERVABILITY.md, HiveForYou-SECURITY-AND-PRIVACY.md.
-- Requires 20261101190000_create_document_pages.sql.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Table hive.document_reads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.document_reads (
  id uuid DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  request_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  correlation_id uuid NOT NULL,
  lease_expires_at timestamptz,
  read_fingerprint text,
  page_set_digest text,
  total_physical_pages integer,
  saved_page_count integer,
  verified_page_count integer,
  unreadable_page_count integer,
  error_code text,
  error_message_safe text,
  retryable boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT pk_document_reads PRIMARY KEY (id),
  CONSTRAINT fk_document_reads__hives
    FOREIGN KEY (hive_id, owner_user_id) REFERENCES hive.hives (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT fk_document_reads__source_documents
    FOREIGN KEY (source_document_id, hive_id) REFERENCES hive.source_documents (id, case_id) ON DELETE CASCADE,
  CONSTRAINT uq_document_reads__source_attempt UNIQUE (source_document_id, attempt_number),
  CONSTRAINT uq_document_reads__request_source UNIQUE (hive_id, request_id, source_document_id),
  CONSTRAINT ck_document_reads__status CHECK (
    status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING', 'SUCCEEDED', 'PARTIAL', 'UNREADABLE', 'FAILED')
  ),
  CONSTRAINT ck_document_reads__attempt_number CHECK (attempt_number >= 1),
  CONSTRAINT ck_document_reads__page_counts CHECK (
    (total_physical_pages IS NULL OR total_physical_pages >= 0)
    AND (saved_page_count IS NULL OR saved_page_count >= 0)
    AND (verified_page_count IS NULL OR verified_page_count >= 0)
    AND (unreadable_page_count IS NULL OR unreadable_page_count >= 0)
  ),
  CONSTRAINT ck_document_reads__read_fingerprint CHECK (
    read_fingerprint IS NULL OR char_length(read_fingerprint) BETWEEN 1 AND 128
  ),
  CONSTRAINT ck_document_reads__page_set_digest_format CHECK (
    page_set_digest IS NULL OR page_set_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_document_reads__error_code_format CHECK (
    error_code IS NULL OR error_code ~ '^[A-Z_]{1,64}$'
  ),
  CONSTRAINT ck_document_reads__error_message_safe_length CHECK (
    error_message_safe IS NULL OR char_length(error_message_safe) BETWEEN 1 AND 300
  ),
  CONSTRAINT ck_document_reads__finished CHECK (
    (status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING') AND finished_at IS NULL)
    OR (status IN ('SUCCEEDED', 'PARTIAL', 'UNREADABLE', 'FAILED') AND finished_at IS NOT NULL)
  )
);

COMMENT ON TABLE hive.document_reads IS
  'One attempt to read one source document into hive.document_pages; durable status for the Documents read modal.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_reads__active_source
  ON hive.document_reads (source_document_id)
  WHERE status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING');

CREATE INDEX IF NOT EXISTS idx_document_reads__hive_source_created
  ON hive.document_reads (hive_id, source_document_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Transition and identity guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.enforce_document_read_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.hive_id IS DISTINCT FROM OLD.hive_id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'hive.document_reads identity columns are immutable';
  END IF;

  IF OLD.status IN ('SUCCEEDED', 'PARTIAL', 'UNREADABLE', 'FAILED') THEN
    RAISE EXCEPTION 'document_read_finished' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'QUEUED' AND NEW.status IN ('READING', 'FAILED'))
    OR (OLD.status = 'READING' AND NEW.status IN ('SAVING', 'UNREADABLE', 'FAILED'))
    OR (OLD.status = 'SAVING' AND NEW.status IN ('VERIFYING', 'FAILED'))
    OR (OLD.status = 'VERIFYING' AND NEW.status IN ('SUCCEEDED', 'PARTIAL', 'UNREADABLE', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'document_read_transition_invalid' USING ERRCODE = 'P0001';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_reads__transition ON hive.document_reads;
CREATE TRIGGER trg_document_reads__transition
  BEFORE UPDATE ON hive.document_reads
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_document_read_transition();

-- ---------------------------------------------------------------------------
-- 3. Internal helpers
-- ---------------------------------------------------------------------------
-- Attempts whose lease lapsed (the server stopped before finishing) become retryable FAILED.
CREATE OR REPLACE FUNCTION hive.expire_stale_document_reads(p_hive_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_expired integer;
BEGIN
  WITH expired AS (
    UPDATE hive.document_reads r
       SET status = 'FAILED',
           error_code = 'PAGE_READ_FAILED',
           error_message_safe = 'Reading stopped before it finished. You can try again.',
           retryable = true,
           lease_expires_at = NULL,
           finished_at = now()
     WHERE r.hive_id = p_hive_id
       AND r.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')
       AND r.lease_expires_at IS NOT NULL
       AND r.lease_expires_at < now()
    RETURNING r.source_document_id
  ), sources AS (
    UPDATE hive.source_documents d
       SET read_status = 'FAILED'
      FROM expired e
     WHERE d.id = e.source_document_id
       AND d.read_status = 'PENDING'
    RETURNING d.id
  )
  SELECT count(*) INTO v_expired FROM expired;

  RETURN v_expired;
END;
$$;

CREATE OR REPLACE FUNCTION hive.document_read_json(r hive.document_reads)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT json_build_object(
    'id', r.id,
    'hiveId', r.hive_id,
    'sourceDocumentId', r.source_document_id,
    'requestId', r.request_id,
    'attemptNumber', r.attempt_number,
    'status', r.status,
    'totalPhysicalPages', r.total_physical_pages,
    'verifiedPageCount', r.verified_page_count,
    'unreadablePageCount', r.unreadable_page_count,
    'errorCode', r.error_code,
    'errorMessageSafe', r.error_message_safe,
    'retryable', r.retryable,
    'correlationId', r.correlation_id,
    'createdAt', r.created_at,
    'startedAt', r.started_at,
    'updatedAt', r.updated_at,
    'finishedAt', r.finished_at
  );
$$;

-- Latest attempt per live source document in the Hive.
CREATE OR REPLACE FUNCTION hive.latest_document_reads_json(p_hive_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT coalesce(
           json_agg(hive.document_read_json(latest.read_row) ORDER BY latest.created_at, latest.id),
           '[]'::json
         )
    FROM (
      SELECT DISTINCT ON (r.source_document_id) r AS read_row, r.created_at, r.id
        FROM hive.document_reads r
        JOIN hive.source_documents d ON d.id = r.source_document_id
       WHERE r.hive_id = p_hive_id
         AND d.lifecycle_status = 'ACTIVE'
         AND d.deleted_at IS NULL
       ORDER BY r.source_document_id, r.attempt_number DESC
    ) latest;
$$;

-- ---------------------------------------------------------------------------
-- 4. Owner RPCs (authenticated)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_document_reads(
  p_hive_id uuid,
  p_request_id uuid,
  p_correlation_id uuid,
  p_source_document_ids uuid[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted integer := 0;
  v_queued json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
      AND h.owner_user_id = v_uid
      AND h.archived_at IS NULL
      AND h.deleting_at IS NULL
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM hive.expire_stale_document_reads(p_hive_id);

  IF NOT EXISTS (
    SELECT 1 FROM hive.document_reads r
     WHERE r.hive_id = p_hive_id AND r.request_id = p_request_id
  ) THEN
    INSERT INTO hive.document_reads (
      hive_id, owner_user_id, source_document_id, request_id, attempt_number,
      status, correlation_id, lease_expires_at
    )
    SELECT p_hive_id,
           v_uid,
           d.id,
           p_request_id,
           coalesce((SELECT max(r.attempt_number) FROM hive.document_reads r
                      WHERE r.source_document_id = d.id), 0) + 1,
           'QUEUED',
           p_correlation_id,
           now() + interval '330 seconds'
      FROM hive.source_documents d
     WHERE d.case_id = p_hive_id
       AND d.owner_user_id = v_uid
       AND d.lifecycle_status = 'ACTIVE'
       AND d.deleted_at IS NULL
       AND d.upload_status = 'UPLOADED'
       AND d.read_status IN ('PENDING', 'FAILED')
       AND (p_source_document_ids IS NULL OR d.id = ANY (p_source_document_ids))
       AND NOT EXISTS (
         SELECT 1 FROM hive.document_reads a
          WHERE a.source_document_id = d.id
            AND a.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')
       )
     ORDER BY d.created_at, d.id
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  SELECT coalesce(json_agg(r.id ORDER BY r.created_at, r.id), '[]'::json)
    INTO v_queued
    FROM hive.document_reads r
   WHERE r.hive_id = p_hive_id
     AND r.request_id = p_request_id
     AND r.status = 'QUEUED';

  RETURN json_build_object(
    'documentReads', hive.latest_document_reads_json(p_hive_id),
    'queuedReadIds', v_queued,
    'created', v_inserted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_document_reads(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hive.hives h
     WHERE h.id = p_hive_id
       AND h.owner_user_id = v_uid
       AND h.archived_at IS NULL
       AND h.deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM hive.expire_stale_document_reads(p_hive_id);

  RETURN json_build_object('documentReads', hive.latest_document_reads_json(p_hive_id));
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Server RPC (service_role): compare-and-set status transition
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_document_read(
  p_read_id uuid,
  p_from_status text,
  p_to_status text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_read hive.document_reads%ROWTYPE;
  v_doc hive.source_documents%ROWTYPE;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_to text := upper(btrim(coalesce(p_to_status, '')));
  v_from text := upper(btrim(coalesce(p_from_status, '')));
  v_terminal boolean;
  v_digest text;
  v_verified integer;
  v_persisted integer;
  v_message text;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_details) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_read FROM hive.document_reads WHERE id = p_read_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_read_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_read.status <> v_from THEN
    RETURN json_build_object('applied', false, 'documentRead', hive.document_read_json(v_read));
  END IF;

  v_terminal := v_to IN ('SUCCEEDED', 'PARTIAL', 'UNREADABLE', 'FAILED');

  SELECT * INTO v_doc FROM hive.source_documents WHERE id = v_read.source_document_id;
  IF NOT v_terminal AND (
    NOT FOUND
    OR v_doc.lifecycle_status <> 'ACTIVE'
    OR v_doc.deleted_at IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = v_read.hive_id AND (h.deleting_at IS NOT NULL OR h.archived_at IS NOT NULL)
    )
  ) THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_to IN ('SUCCEEDED', 'PARTIAL') OR (v_to = 'UNREADABLE' AND v_from = 'VERIFYING') THEN
    v_digest := lower(btrim(coalesce(v_details ->> 'page_set_digest', v_read.page_set_digest, '')));
    v_verified := (v_details ->> 'verified_page_count')::integer;
    IF v_digest !~ '^sha256:[0-9a-f]{64}$' OR v_verified IS NULL OR v_verified < 1 THEN
      RAISE EXCEPTION 'page_generation_incomplete' USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO v_persisted
      FROM hive.document_pages p
     WHERE p.source_document_id = v_read.source_document_id
       AND p.hive_id = v_read.hive_id
       AND p.page_set_digest = v_digest;
    IF v_persisted <> v_verified THEN
      RAISE EXCEPTION 'page_generation_incomplete' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_message := nullif(left(btrim(coalesce(v_details ->> 'error_message_safe', '')), 300), '');

  UPDATE hive.document_reads
     SET status = v_to,
         started_at = CASE WHEN v_to = 'READING' THEN now() ELSE started_at END,
         lease_expires_at = CASE WHEN v_terminal THEN NULL ELSE now() + interval '180 seconds' END,
         finished_at = CASE WHEN v_terminal THEN now() ELSE NULL END,
         read_fingerprint = coalesce(nullif(btrim(v_details ->> 'read_fingerprint'), ''), read_fingerprint),
         page_set_digest = coalesce(lower(nullif(btrim(v_details ->> 'page_set_digest'), '')), page_set_digest),
         total_physical_pages = coalesce((v_details ->> 'total_physical_pages')::integer, total_physical_pages),
         saved_page_count = coalesce((v_details ->> 'saved_page_count')::integer, saved_page_count),
         verified_page_count = coalesce((v_details ->> 'verified_page_count')::integer, verified_page_count),
         unreadable_page_count = coalesce((v_details ->> 'unreadable_page_count')::integer, unreadable_page_count),
         error_code = CASE WHEN v_terminal THEN nullif(btrim(v_details ->> 'error_code'), '') ELSE error_code END,
         error_message_safe = CASE WHEN v_terminal THEN v_message ELSE error_message_safe END,
         retryable = CASE WHEN v_terminal THEN (v_details ->> 'retryable')::boolean ELSE retryable END
   WHERE id = p_read_id
  RETURNING * INTO v_read;

  IF v_terminal AND v_doc.id IS NOT NULL THEN
    UPDATE hive.source_documents
       SET read_status = v_to,
           page_count = CASE
             WHEN v_to IN ('SUCCEEDED', 'PARTIAL', 'UNREADABLE') AND v_read.total_physical_pages IS NOT NULL
               THEN v_read.total_physical_pages
             ELSE page_count
           END
     WHERE id = v_read.source_document_id
       AND lifecycle_status = 'ACTIVE'
       AND deleted_at IS NULL;
  END IF;

  IF v_to = 'READING' THEN
    RETURN json_build_object(
      'applied', true,
      'documentRead', hive.document_read_json(v_read),
      'source', json_build_object(
        'source_document_id', v_doc.id,
        'hive_id', v_doc.case_id,
        'owner_user_id', v_doc.owner_user_id,
        'file_name', v_doc.original_filename,
        'mime_type', v_doc.mime_type,
        'byte_size', v_doc.byte_size,
        'sha256', lower(btrim(v_doc.sha256)),
        'storage_bucket', v_doc.storage_bucket,
        'storage_path', v_doc.storage_path,
        'page_count', v_doc.page_count
      )
    );
  END IF;

  RETURN json_build_object('applied', true, 'documentRead', hive.document_read_json(v_read));
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Row-Level Security & least-privilege grants
-- ---------------------------------------------------------------------------
ALTER TABLE hive.document_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.document_reads FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_document_reads__select__owner ON hive.document_reads;
CREATE POLICY pol_document_reads__select__owner
  ON hive.document_reads
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = document_reads.hive_id
         AND h.owner_user_id = auth.uid()
         AND h.archived_at IS NULL
         AND h.deleting_at IS NULL
    )
  );

REVOKE ALL ON hive.document_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hive.document_reads TO authenticated;
GRANT ALL ON hive.document_reads TO service_role;

REVOKE ALL ON FUNCTION hive.enforce_document_read_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.expire_stale_document_reads(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.document_read_json(hive.document_reads) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.latest_document_reads_json(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.start_document_reads(uuid, uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_document_reads(uuid, uuid, uuid, uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.list_document_reads(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_document_reads(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.transition_document_read(uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_document_read(uuid, text, text, jsonb) TO service_role;

COMMIT;
