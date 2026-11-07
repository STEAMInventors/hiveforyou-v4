-- D-055: drop bind trigger on doc_extraction_attempts; validate source + frozen snapshot in begin RPC.
-- Root cause: hive.bind_doc_extraction_to_source() references NEW.model_alias, which attempts rows lack.
BEGIN;

DROP TRIGGER IF EXISTS trg_doc_extraction_attempts__bind_source ON hive.doc_extraction_attempts;

CREATE OR REPLACE FUNCTION public.begin_doc_extraction_attempt(
  p_processing_run_id uuid,
  p_hive_id uuid,
  p_source_document_id uuid,
  p_content_digest text,
  p_page_range text,
  p_prompt_id text,
  p_prompt_digest text,
  p_call_started_at timestamptz
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_doc hive.source_documents%ROWTYPE;
  v_content text := lower(btrim(coalesce(p_content_digest, '')));
  v_page_range text := lower(btrim(coalesce(p_page_range, '')));
  v_prompt_id text := btrim(coalesce(p_prompt_id, ''));
  v_prompt_digest text := lower(btrim(coalesce(p_prompt_digest, '')));
  v_next integer;
  v_row hive.doc_extraction_attempts%ROWTYPE;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_processing_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_run.hive_id IS DISTINCT FROM p_hive_id THEN
    RAISE EXCEPTION 'extract_attempt_hive_mismatch' USING ERRCODE = '42501';
  END IF;

  IF v_run.source_snapshot IS NULL THEN
    RAISE EXCEPTION 'source_snapshot_missing' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_doc FROM hive.source_documents WHERE id = p_source_document_id;
  IF NOT FOUND
     OR v_doc.deleted_at IS NOT NULL
     OR v_doc.lifecycle_status <> 'ACTIVE'
     OR v_doc.upload_status <> 'UPLOADED' THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_doc.case_id <> p_hive_id THEN
    RAISE EXCEPTION 'extract_attempt_hive_mismatch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_run.source_snapshot -> 'documents') d
     WHERE (d ->> 'sourceDocumentId')::uuid = p_source_document_id
       AND lower(btrim(d ->> 'pageSetDigest')) = v_content
  ) THEN
    RAISE EXCEPTION 'extract_attempt_content_digest_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF v_content !~ '^sha256:[0-9a-f]{64}$'
     OR v_page_range !~ '^(all|[1-9][0-9]*(-[1-9][0-9]*)?)$'
     OR v_prompt_digest !~ '^sha256:[0-9a-f]{64}$'
     OR char_length(v_prompt_id) = 0 OR char_length(v_prompt_id) > 128
     OR p_call_started_at IS NULL THEN
    RAISE EXCEPTION 'extract_attempt_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(max(attempt_number), 0) + 1
    INTO v_next
    FROM hive.doc_extraction_attempts
   WHERE processing_run_id = p_processing_run_id
     AND source_document_id = p_source_document_id
     AND content_digest = v_content
     AND page_range = v_page_range
     AND prompt_digest = v_prompt_digest;

  INSERT INTO hive.doc_extraction_attempts (
    processing_run_id,
    hive_id,
    source_document_id,
    content_digest,
    page_range,
    prompt_id,
    prompt_digest,
    attempt_number,
    attempt_status,
    error_code,
    diagnostic_reason,
    http_status,
    duration_ms,
    aborted_by_our_deadline,
    call_started_at
  ) VALUES (
    p_processing_run_id,
    p_hive_id,
    p_source_document_id,
    v_content,
    v_page_range,
    v_prompt_id,
    v_prompt_digest,
    v_next,
    'IN_FLIGHT',
    null,
    null,
    null,
    null,
    false,
    p_call_started_at
  )
  RETURNING * INTO v_row;

  RETURN json_build_object(
    'id', v_row.id,
    'attemptNumber', v_row.attempt_number,
    'processingRunId', v_row.processing_run_id,
    'sourceDocumentId', v_row.source_document_id,
    'pageRange', v_row.page_range
  );
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'extract_attempt_invalid' USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.begin_doc_extraction_attempt(
  uuid, uuid, uuid, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_doc_extraction_attempt(
  uuid, uuid, uuid, text, text, text, text, timestamptz
) TO service_role;

COMMIT;
