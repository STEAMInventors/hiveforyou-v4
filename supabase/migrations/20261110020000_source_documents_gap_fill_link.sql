-- Missing-document slot uploads: stable (study_revision_id, gap_id, gap_title) link (D-055; validate in RPC).

BEGIN;

ALTER TABLE hive.source_documents
  ADD COLUMN IF NOT EXISTS canonical_gap_study_revision_id uuid,
  ADD COLUMN IF NOT EXISTS canonical_gap_title text
  CONSTRAINT ck_source_documents__canonical_gap_title
    CHECK (canonical_gap_title IS NULL OR btrim(canonical_gap_title) <> '');

COMMENT ON COLUMN hive.source_documents.canonical_gap_study_revision_id IS
  'Accepted study revision when the owner filled a missing-document slot.';
COMMENT ON COLUMN hive.source_documents.canonical_gap_title IS
  'Gap title on that revision; stable when gap ids Xn are renumbered.';

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
        'readStatus', 'PENDING',
        'registeredAt', d.created_at,
        'createdAt', d.created_at,
        'updatedAt', d.created_at,
        'canonicalGapId', d.canonical_gap_id,
        'canonicalGapStudyRevisionId', d.canonical_gap_study_revision_id,
        'canonicalGapTitle', d.canonical_gap_title
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
        'updatedAt', u.updated_at,
        'canonicalGapId', NULL,
        'canonicalGapStudyRevisionId', NULL,
        'canonicalGapTitle', NULL
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

CREATE OR REPLACE FUNCTION hive.apply_vault_transaction(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, pg_temp
AS $$
DECLARE
  op jsonb;
  op_type text;
  row_data jsonb;
  v_gap_id text;
  v_gap_revision uuid;
  v_gap_title text;
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'apply_vault_transaction payload must be an object';
  END IF;

  FOR op IN SELECT jsonb_array_elements(COALESCE(payload->'operations', '[]'::jsonb))
  LOOP
    op_type := op->>'op';
    row_data := COALESCE(op->'row', '{}'::jsonb);
    CASE op_type
      WHEN 'insert_case' THEN
        INSERT INTO hive.cases (
          id, owner_user_id, tenant_id, title, domain, status, created_at, updated_at, deleted_at
        ) VALUES (
          (row_data->>'id')::uuid,
          (row_data->>'owner_user_id')::uuid,
          hive.jsonb_text_or_null(row_data->'tenant_id')::uuid,
          row_data->>'title',
          hive.jsonb_text_or_null(row_data->'domain'),
          row_data->>'status',
          (row_data->>'created_at')::timestamptz,
          (row_data->>'updated_at')::timestamptz,
          hive.jsonb_text_or_null(row_data->'deleted_at')::timestamptz
        )
        ON CONFLICT (id) DO NOTHING;
      WHEN 'insert_upload_pending' THEN
        INSERT INTO hive.upload_operations (
          id, case_id, owner_user_id, source_document_id, original_filename, mime_type, byte_size,
          sha256, storage_bucket, storage_path, status, error_code, error_category,
          client_request_id, created_at, updated_at
        ) VALUES (
          (row_data->>'id')::uuid,
          (row_data->>'case_id')::uuid,
          (row_data->>'owner_user_id')::uuid,
          (row_data->>'source_document_id')::uuid,
          row_data->>'original_filename',
          row_data->>'mime_type',
          (row_data->>'byte_size')::integer,
          row_data->>'sha256',
          row_data->>'storage_bucket',
          row_data->>'storage_path',
          'PENDING',
          NULL,
          NULL,
          hive.jsonb_text_or_null(row_data->'client_request_id')::uuid,
          (row_data->>'created_at')::timestamptz,
          (row_data->>'updated_at')::timestamptz
        );
      WHEN 'insert_source_document' THEN
        v_gap_id := hive.jsonb_text_or_null(row_data->'canonical_gap_id');
        IF v_gap_id IS NOT NULL AND v_gap_id !~ '^X[0-9]+$' THEN
          RAISE EXCEPTION 'invalid canonical_gap_id';
        END IF;
        v_gap_revision := NULL;
        v_gap_title := hive.jsonb_text_or_null(row_data->'canonical_gap_title');
        IF row_data ? 'canonical_gap_study_revision_id' AND row_data->'canonical_gap_study_revision_id' IS NOT NULL THEN
          v_gap_revision := (row_data->>'canonical_gap_study_revision_id')::uuid;
        END IF;
        IF v_gap_id IS NOT NULL AND (v_gap_revision IS NULL OR v_gap_title IS NULL OR btrim(v_gap_title) = '') THEN
          RAISE EXCEPTION 'invalid canonical_gap_link';
        END IF;
        INSERT INTO hive.source_documents (
          id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
          storage_bucket, storage_path, page_count, upload_status, lifecycle_status,
          canonical_gap_id, canonical_gap_study_revision_id, canonical_gap_title,
          created_at, deleted_at
        ) VALUES (
          (row_data->>'id')::uuid,
          (row_data->>'case_id')::uuid,
          (row_data->>'owner_user_id')::uuid,
          row_data->>'original_filename',
          row_data->>'mime_type',
          (row_data->>'byte_size')::integer,
          row_data->>'sha256',
          row_data->>'storage_bucket',
          row_data->>'storage_path',
          hive.jsonb_text_or_null(row_data->'page_count')::integer,
          row_data->>'upload_status',
          row_data->>'lifecycle_status',
          v_gap_id,
          v_gap_revision,
          v_gap_title,
          (row_data->>'created_at')::timestamptz,
          hive.jsonb_text_or_null(row_data->'deleted_at')::timestamptz
        );
      WHEN 'append_audit' THEN
        INSERT INTO hive.audit_events (
          id, owner_user_id, case_id, source_document_id, intake_run_id, event_type,
          actor_user_id, actor_type, correlation_id, safe_metadata, created_at
        ) VALUES (
          (row_data->>'id')::uuid,
          (row_data->>'owner_user_id')::uuid,
          hive.jsonb_text_or_null(row_data->'case_id')::uuid,
          hive.jsonb_text_or_null(row_data->'source_document_id')::uuid,
          hive.jsonb_text_or_null(row_data->'intake_run_id')::uuid,
          row_data->>'event_type',
          hive.jsonb_text_or_null(row_data->'actor_user_id')::uuid,
          row_data->>'actor_type',
          hive.jsonb_text_or_null(row_data->'correlation_id')::uuid,
          COALESCE(row_data->'safe_metadata', '{}'::jsonb),
          (row_data->>'created_at')::timestamptz
        );
      WHEN 'mark_upload_stored' THEN
        UPDATE hive.upload_operations
        SET status = 'STORED', updated_at = (row_data->>'updated_at')::timestamptz
        WHERE id = (row_data->>'id')::uuid;
      WHEN 'mark_upload_failed' THEN
        UPDATE hive.upload_operations
        SET
          status = 'FAILED',
          updated_at = (row_data->>'updated_at')::timestamptz,
          error_code = row_data->>'error_code',
          error_category = row_data->>'error_category'
        WHERE id = (row_data->>'id')::uuid;
      WHEN 'mark_upload_registered' THEN
        UPDATE hive.upload_operations
        SET
          status = 'REGISTERED',
          updated_at = (row_data->>'updated_at')::timestamptz
        WHERE id = (row_data->>'id')::uuid;
      ELSE
        RAISE EXCEPTION 'unsupported vault operation: %', op_type;
    END CASE;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION hive.compute_study_source_snapshot(p_hive_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_documents jsonb;
  v_excluded jsonb;
  v_active integer;
  v_source_digest text;
  v_coverage_digest text;
  v_complete boolean;
BEGIN
  WITH live AS (
    SELECT d.id, d.original_filename, d.mime_type, lower(btrim(d.sha256)) AS sha256,
           d.read_status, d.page_count, d.created_at,
           d.canonical_gap_id, d.canonical_gap_study_revision_id, d.canonical_gap_title
      FROM hive.source_documents d
     WHERE d.case_id = p_hive_id
       AND d.lifecycle_status = 'ACTIVE'
       AND d.deleted_at IS NULL
       AND d.upload_status = 'UPLOADED'
  ), latest AS (
    SELECT DISTINCT ON (r.source_document_id) r.*
      FROM hive.document_reads r
      JOIN live l ON l.id = r.source_document_id
     ORDER BY r.source_document_id, r.attempt_number DESC
  ), eligible AS (
    SELECT l.*, lr.id AS read_id, lr.read_fingerprint, lr.page_set_digest,
           coalesce(lr.total_physical_pages, l.page_count, 0) AS total_pages
      FROM live l
      JOIN latest lr ON lr.source_document_id = l.id
     WHERE l.read_status IN ('SUCCEEDED', 'PARTIAL')
       AND lr.status IN ('SUCCEEDED', 'PARTIAL')
       AND lr.read_fingerprint IS NOT NULL
       AND lr.page_set_digest IS NOT NULL
  )
  SELECT
    coalesce((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'sourceDocumentId', e.id,
                 'fileName', e.original_filename,
                 'mimeType', e.mime_type,
                 'sha256', e.sha256,
                 'readId', e.read_id,
                 'readStatus', e.read_status,
                 'readFingerprint', e.read_fingerprint,
                 'pageSetDigest', e.page_set_digest,
                 'totalPhysicalPages', e.total_pages,
                 'verifiedPageCount', (
                   SELECT count(*) FROM hive.document_pages p
                    WHERE p.source_document_id = e.id AND p.page_set_digest = e.page_set_digest
                 ),
                 'missingPageNumbers', coalesce((
                   SELECT jsonb_agg(n ORDER BY n)
                     FROM generate_series(1, greatest(e.total_pages, 0)) AS n
                    WHERE NOT EXISTS (
                      SELECT 1 FROM hive.document_pages p
                       WHERE p.source_document_id = e.id
                         AND p.page_set_digest = e.page_set_digest
                         AND p.page_number = n
                    )
                 ), '[]'::jsonb),
                 'emptyPageNumbers', coalesce((
                   SELECT jsonb_agg(p.page_number ORDER BY p.page_number)
                     FROM hive.document_pages p
                    WHERE p.source_document_id = e.id
                      AND p.page_set_digest = e.page_set_digest
                      AND p.page_text ~ '^\s*$'
                 ), '[]'::jsonb),
                 'createdAt', e.created_at,
                 'canonicalGapId', e.canonical_gap_id,
                 'canonicalGapStudyRevisionId', e.canonical_gap_study_revision_id,
                 'canonicalGapTitle', e.canonical_gap_title
               )
               ORDER BY e.created_at, e.id
             )
        FROM eligible e
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'sourceDocumentId', l.id,
                 'fileName', l.original_filename,
                 'reason', CASE
                   WHEN lr.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING') THEN 'READ_ACTIVE'
                   WHEN l.read_status = 'FAILED' THEN 'READ_FAILED'
                   WHEN l.read_status = 'UNREADABLE' THEN 'UNREADABLE'
                   ELSE 'NOT_READ'
                 END
               )
               ORDER BY l.created_at, l.id
             )
        FROM live l
        LEFT JOIN latest lr ON lr.source_document_id = l.id
       WHERE NOT EXISTS (SELECT 1 FROM eligible e WHERE e.id = l.id)
    ), '[]'::jsonb),
    (SELECT count(*)::integer FROM latest lr
      WHERE lr.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING'))
  INTO v_documents, v_excluded, v_active;

  SELECT hive.sha256_text(coalesce(string_agg(
           (d ->> 'sourceDocumentId') || ':' || (d ->> 'sha256') || ':' ||
           (d ->> 'readFingerprint') || ':' || (d ->> 'pageSetDigest'),
           E'\n' ORDER BY d ->> 'sourceDocumentId'), ''))
    INTO v_source_digest
    FROM jsonb_array_elements(v_documents) d;

  SELECT hive.sha256_text(jsonb_build_object(
           'sourceSnapshotDigest', v_source_digest,
           'excluded', coalesce((
             SELECT jsonb_agg(jsonb_build_object('id', x ->> 'sourceDocumentId', 'reason', x ->> 'reason')
                              ORDER BY x ->> 'sourceDocumentId')
               FROM jsonb_array_elements(v_excluded) x), '[]'::jsonb),
           'gaps', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', d ->> 'sourceDocumentId',
                      'readStatus', d ->> 'readStatus',
                      'missing', d -> 'missingPageNumbers',
                      'empty', d -> 'emptyPageNumbers')
                    ORDER BY d ->> 'sourceDocumentId')
               FROM jsonb_array_elements(v_documents) d), '[]'::jsonb)
         )::text)
    INTO v_coverage_digest;

  v_complete := jsonb_array_length(v_documents) > 0
    AND jsonb_array_length(v_excluded) = 0
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_documents) d
       WHERE d ->> 'readStatus' <> 'SUCCEEDED'
          OR jsonb_array_length(d -> 'missingPageNumbers') > 0
          OR jsonb_array_length(d -> 'emptyPageNumbers') > 0
    );

  RETURN jsonb_build_object(
    'documents', v_documents,
    'excluded', v_excluded,
    'activeReadCount', v_active,
    'sourceSnapshotDigest', v_source_digest,
    'coverageDigest', v_coverage_digest,
    'coverageComplete', v_complete
  );
END;
$$;

COMMIT;
