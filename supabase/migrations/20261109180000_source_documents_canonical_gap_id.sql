-- Missing-document slot uploads: optional canonical gap id on source documents (D-055; validate in RPC, no trigger).

BEGIN;

ALTER TABLE hive.source_documents
  ADD COLUMN IF NOT EXISTS canonical_gap_id text
  CONSTRAINT ck_source_documents__canonical_gap_id
    CHECK (canonical_gap_id IS NULL OR canonical_gap_id ~ '^X[0-9]+$');

COMMENT ON COLUMN hive.source_documents.canonical_gap_id IS
  'Canonical study gap id (Xn) when the owner uploaded through a missing-document slot on Documents.';

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
        'canonicalGapId', d.canonical_gap_id
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
        'canonicalGapId', NULL
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

-- Persist canonical_gap_id on vault registration (validated in app before RPC).
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
        INSERT INTO hive.source_documents (
          id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
          storage_bucket, storage_path, page_count, upload_status, lifecycle_status,
          canonical_gap_id, created_at, deleted_at
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

COMMIT;
