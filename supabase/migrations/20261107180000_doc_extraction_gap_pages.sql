-- Record extraction coverage gaps; list gap page ranges per run.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_doc_extractions_for_run(p_processing_run_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_rows json;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_processing_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.source_snapshot IS NULL THEN
    RAISE EXCEPTION 'source_snapshot_missing' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(json_agg(
           json_build_object(
             'id', e.id,
             'hiveId', e.hive_id,
             'sourceDocumentId', e.source_document_id,
             'contentDigest', e.content_digest,
             'promptId', e.prompt_id,
             'promptDigest', e.prompt_digest,
             'modelAlias', e.model_alias,
             'extraction', e.extraction,
             'stats', e.stats,
             'createdAt', e.created_at
           )
           ORDER BY e.source_document_id, e.created_at
         ), '[]'::json)
    INTO v_rows
    FROM hive.doc_extractions e
    JOIN LATERAL (
      SELECT (d ->> 'sourceDocumentId')::uuid AS doc_id,
             lower(btrim(d ->> 'pageSetDigest')) AS content_digest
        FROM jsonb_array_elements(v_run.source_snapshot -> 'documents') d
    ) snap
      ON snap.doc_id = e.source_document_id
     AND snap.content_digest = e.content_digest
   WHERE e.hive_id = v_run.hive_id;

  RETURN json_build_object('extractions', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_doc_extractions_for_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_doc_extractions_for_run(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_doc_extraction_gap_pages_for_run(p_processing_run_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_rows json;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_processing_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(
           json_agg(
             json_build_object(
               'sourceDocumentId', lower(a.source_document_id::text),
               'pageRange', lower(btrim(a.page_range))
             )
             ORDER BY a.source_document_id, a.page_range
           ),
           '[]'::json
         )
    INTO v_rows
    FROM hive.doc_extraction_attempts a
   WHERE a.processing_run_id = p_processing_run_id
     AND a.attempt_status = 'FAILED'
     AND upper(btrim(coalesce(a.error_code, ''))) = 'PAGE_EXTRACTION_GAP';

  RETURN json_build_object('gaps', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_doc_extraction_gap_pages_for_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_doc_extraction_gap_pages_for_run(uuid) TO service_role;

COMMIT;
