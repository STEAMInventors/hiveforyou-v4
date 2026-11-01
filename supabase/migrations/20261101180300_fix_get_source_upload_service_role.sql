-- V4-003: service-role upload lookup must not depend on auth.uid() or exposed hive schema.
BEGIN;

DROP FUNCTION IF EXISTS public.get_source_upload_by_client_request(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_source_upload_by_client_request(
  p_hive_id uuid,
  p_client_request_id uuid,
  p_owner_user_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_row hive.upload_operations%ROWTYPE;
BEGIN
  IF p_hive_id IS NULL OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:id_required' USING ERRCODE = '22023';
  END IF;

  IF v_role = 'service_role' THEN
    IF p_owner_user_id IS NULL THEN
      RAISE EXCEPTION 'invalid_request:owner_user_id_required' USING ERRCODE = '22023';
    END IF;
    v_owner := p_owner_user_id;
  ELSE
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
    END IF;
    IF p_owner_user_id IS NOT NULL AND p_owner_user_id <> v_uid THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
    v_owner := v_uid;
  END IF;

  SELECT u.* INTO v_row
    FROM hive.upload_operations u
   WHERE u.owner_user_id = v_owner
     AND u.client_request_id = p_client_request_id
     AND u.case_id = p_hive_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'id', v_row.id,
    'caseId', v_row.case_id,
    'ownerUserId', v_row.owner_user_id,
    'sourceDocumentId', v_row.source_document_id,
    'originalFilename', v_row.original_filename,
    'mimeType', v_row.mime_type,
    'byteSize', v_row.byte_size,
    'sha256', v_row.sha256,
    'storageBucket', v_row.storage_bucket,
    'storagePath', v_row.storage_path,
    'status', v_row.status,
    'errorCode', v_row.error_code,
    'errorCategory', v_row.error_category,
    'clientRequestId', v_row.client_request_id,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_source_upload_by_client_request(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_source_upload_by_client_request(uuid, uuid, uuid) TO authenticated, service_role;

COMMIT;
