-- FL-5: storage.objects on hive-source-documents — active members read; owner write/delete.
BEGIN;

CREATE OR REPLACE FUNCTION hive.storage_path_hive_id(p_object_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = hive, public, pg_temp
AS $$
  SELECT NULLIF(split_part(p_object_name, '/', 2), '')::uuid
$$;

REVOKE ALL ON FUNCTION hive.storage_path_hive_id(text) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS hive_source_documents_select_member ON storage.objects;
CREATE POLICY hive_source_documents_select_member ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'hive-source-documents'
    AND hive.is_hive_member(hive.storage_path_hive_id(name))
  );

DROP POLICY IF EXISTS hive_source_documents_insert_owner ON storage.objects;
CREATE POLICY hive_source_documents_insert_owner ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hive-source-documents'
    AND hive.is_hive_owner(hive.storage_path_hive_id(name))
    AND split_part(name, '/', 1) = (SELECT h.owner_user_id::text FROM hive.hives h WHERE h.id = hive.storage_path_hive_id(name))
  );

DROP POLICY IF EXISTS hive_source_documents_update_owner ON storage.objects;
CREATE POLICY hive_source_documents_update_owner ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'hive-source-documents'
    AND hive.is_hive_owner(hive.storage_path_hive_id(name))
  )
  WITH CHECK (
    bucket_id = 'hive-source-documents'
    AND hive.is_hive_owner(hive.storage_path_hive_id(name))
  );

DROP POLICY IF EXISTS hive_source_documents_delete_owner ON storage.objects;
CREATE POLICY hive_source_documents_delete_owner ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'hive-source-documents'
    AND hive.is_hive_owner(hive.storage_path_hive_id(name))
  );

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
  v_uid uuid;
  v_inserted integer := 0;
  v_queued json;
BEGIN
  IF p_request_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  v_uid := hive.require_owned_hive(p_hive_id);

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

COMMIT;
