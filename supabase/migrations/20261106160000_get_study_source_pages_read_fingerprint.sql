-- Align frozen-run page loading with list_document_pages (read_fingerprint + normalized digest).
BEGIN;

CREATE OR REPLACE FUNCTION public.get_study_source_pages(p_run_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
BEGIN
  PERFORM hive.require_service_role();
  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id;
  IF NOT FOUND OR v_run.source_snapshot IS NULL THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN json_build_object(
    'snapshotCurrent', hive.processing_run_snapshot_current(v_run),
    'pages', coalesce((
      SELECT json_agg(json_build_object(
               'sourceDocumentId', p.source_document_id,
               'pageNumber', p.page_number,
               'pageSetDigest', p.page_set_digest,
               'pageText', p.page_text,
               'pageTextSha256', p.page_text_sha256)
             ORDER BY doc.ordinality, p.page_number)
        FROM jsonb_array_elements(v_run.source_snapshot -> 'documents') WITH ORDINALITY AS doc (d, ordinality)
        JOIN hive.document_pages p
          ON p.source_document_id = (doc.d ->> 'sourceDocumentId')::uuid
         AND p.hive_id = v_run.hive_id
         AND p.read_fingerprint = btrim(doc.d ->> 'readFingerprint')
         AND lower(p.page_set_digest) = lower(btrim(doc.d ->> 'pageSetDigest'))
    ), '[]'::json)
  );
END;
$$;

COMMIT;
