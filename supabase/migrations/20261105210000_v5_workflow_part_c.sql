-- V5-005b part C — extractedDocumentCount on processing runs; export snapshot RPC for eval script.
BEGIN;

CREATE OR REPLACE FUNCTION hive.processing_run_json(r hive.processing_runs)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT json_build_object(
    'id', r.id,
    'hiveId', r.hive_id,
    'kind', r.kind,
    'requestId', r.request_id,
    'attemptNumber', r.attempt_number,
    'status', r.status,
    'preparationMode', r.preparation_mode,
    'authorizedSourceDocumentIds', coalesce(to_json(r.authorized_source_document_ids), '[]'::json),
    'intentRequestIds', to_json(r.intent_request_ids),
    'coverageComplete', coalesce(r.coverage_complete, false),
    'coverageAcknowledged', r.coverage_acknowledged,
    'coverageDigest', r.coverage_digest,
    'coverageStatus', r.coverage_status,
    'coverageGaps', coalesce(r.coverage_gaps, '[]'::jsonb),
    'coverageAcknowledgement', r.coverage_acknowledgement,
    'coverageAcknowledgedAt', r.coverage_acknowledged_at,
    'snapshotFrozen', r.source_snapshot IS NOT NULL,
    'stageAttempt', r.stage_attempt,
    'stageMetrics', r.stage_metrics,
    'extractedDocumentCount', CASE
      WHEN r.source_snapshot IS NULL THEN 0
      ELSE coalesce((
        SELECT count(DISTINCT e.source_document_id)::int
          FROM hive.doc_extractions e
          JOIN LATERAL (
            SELECT (d ->> 'sourceDocumentId')::uuid AS doc_id,
                   lower(btrim(d ->> 'pageSetDigest')) AS content_digest
              FROM jsonb_array_elements(r.source_snapshot -> 'documents') d
          ) snap
            ON snap.doc_id = e.source_document_id
           AND snap.content_digest = e.content_digest
         WHERE e.hive_id = r.hive_id
      ), 0)
    END,
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

CREATE OR REPLACE FUNCTION public.get_v5_run_export(p_processing_run_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_revision hive.study_revisions%ROWTYPE;
  v_extractions json;
  v_reports json;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_processing_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'processing_run_not_finished' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_revision FROM hive.study_revisions WHERE processing_run_id = p_processing_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'study_revision_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_extractions := (public.get_doc_extractions_for_run(p_processing_run_id) -> 'extractions');

  SELECT coalesce(json_agg(
           json_build_object(
             'audience', rr.audience,
             'reportRunId', rr.id,
             'view', rep.view,
             'writerOutput', rep.writer_output,
             'title', rep.title,
             'modelAlias', rep.model_alias,
             'resolvedModel', rep.resolved_model
           )
           ORDER BY rr.audience
         ), '[]'::json)
    INTO v_reports
    FROM hive.report_runs rr
    JOIN hive.reports rep ON rep.report_run_id = rr.id
   WHERE rr.study_revision_id = v_revision.id
     AND rr.trigger = 'STUDY_ACCEPTED'
     AND rr.status = 'SUCCEEDED';

  RETURN json_build_object(
    'processingRun', hive.processing_run_json(v_run),
    'sourceSnapshot', v_run.source_snapshot,
    'studyRevision', json_build_object(
      'id', v_revision.id,
      'format', v_revision.format,
      'investigation', v_revision.investigation
    ),
    'extractions', v_extractions,
    'reports', v_reports
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_v5_run_export(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_v5_run_export(uuid) TO service_role;

COMMIT;
