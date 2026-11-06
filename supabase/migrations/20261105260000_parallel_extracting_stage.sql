-- V5-005 — parallel EXTRACTING: per-document metrics without status churn; single guarded advance to CANONICALIZING.
BEGIN;

CREATE OR REPLACE FUNCTION hive.extracting_snapshot_document_count(p_run hive.processing_runs)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT coalesce(jsonb_array_length(p_run.source_snapshot -> 'documents'), 0)::int;
$$;

CREATE OR REPLACE FUNCTION hive.extracting_completed_document_count(p_run hive.processing_runs)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT coalesce((
    SELECT count(DISTINCT e.source_document_id)::int
      FROM hive.doc_extractions e
      JOIN LATERAL (
        SELECT (d ->> 'sourceDocumentId')::uuid AS doc_id,
               lower(btrim(d ->> 'pageSetDigest')) AS content_digest
          FROM jsonb_array_elements(p_run.source_snapshot -> 'documents') d
      ) snap
        ON snap.doc_id = e.source_document_id
       AND snap.content_digest = e.content_digest
     WHERE e.hive_id = p_run.hive_id
  ), 0);
$$;

CREATE OR REPLACE FUNCTION public.record_extracting_document_success(
  p_run_id uuid,
  p_stage_metric jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
BEGIN
  PERFORM hive.require_service_role();
  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> 'EXTRACTING' THEN
    RETURN json_build_object('saved', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;
  IF NOT hive.is_valid_stage_metric(p_stage_metric) THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  UPDATE hive.processing_runs
     SET stage_metrics = stage_metrics || jsonb_build_array(p_stage_metric),
         stage_attempt = 1
   WHERE id = p_run_id
     AND status = 'EXTRACTING'
  RETURNING * INTO v_run;

  IF NOT FOUND THEN
    SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id;
    RETURN json_build_object('saved', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  RETURN json_build_object('saved', true, 'processingRun', hive.processing_run_json(v_run));
END;
$$;

CREATE OR REPLACE FUNCTION public.try_advance_extracting_to_canonicalizing(p_run_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_required integer;
  v_extracted integer;
BEGIN
  PERFORM hive.require_service_role();
  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> 'EXTRACTING' OR v_run.source_snapshot IS NULL THEN
    RETURN json_build_object('applied', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  v_required := hive.extracting_snapshot_document_count(v_run);
  v_extracted := hive.extracting_completed_document_count(v_run);
  IF v_extracted < v_required THEN
    RETURN json_build_object('applied', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  UPDATE hive.processing_runs
     SET status = 'CANONICALIZING',
         stage_attempt = 1,
         lease_expires_at = now() + interval '300 seconds',
         next_dispatch_at = now() + interval '30 seconds'
   WHERE id = p_run_id
     AND status = 'EXTRACTING'
  RETURNING * INTO v_run;

  IF NOT FOUND THEN
    SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id;
    RETURN json_build_object('applied', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  RETURN json_build_object('applied', true, 'processingRun', hive.processing_run_json(v_run));
END;
$$;

REVOKE ALL ON FUNCTION public.record_extracting_document_success(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_extracting_document_success(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.try_advance_extracting_to_canonicalizing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_advance_extracting_to_canonicalizing(uuid) TO service_role;

REVOKE ALL ON FUNCTION hive.extracting_snapshot_document_count(hive.processing_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.extracting_completed_document_count(hive.processing_runs) FROM PUBLIC, anon, authenticated;

COMMIT;
