-- Persist pipeline progress ETA anchors on processing and report runs (multi-instance safe).

BEGIN;

ALTER TABLE hive.processing_runs
  ADD COLUMN IF NOT EXISTS estimated_completion_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimate_fingerprint text;

ALTER TABLE hive.report_runs
  ADD COLUMN IF NOT EXISTS estimated_completion_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimate_fingerprint text;

COMMENT ON COLUMN hive.processing_runs.estimated_completion_at IS
  'Absolute ETA anchor; updated by the worker when progress changes, read by owner polls.';
COMMENT ON COLUMN hive.processing_runs.estimate_fingerprint IS
  'Pipeline progress fingerprint paired with estimated_completion_at.';
COMMENT ON COLUMN hive.report_runs.estimated_completion_at IS
  'Absolute Writer ETA anchor; updated by the worker when progress changes.';
COMMENT ON COLUMN hive.report_runs.estimate_fingerprint IS
  'Report-run progress fingerprint paired with estimated_completion_at.';

CREATE OR REPLACE FUNCTION public.persist_processing_run_estimate(
  p_run_id uuid,
  p_estimated_completion_at timestamptz,
  p_estimate_fingerprint text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF p_estimated_completion_at IS NULL OR nullif(btrim(coalesce(p_estimate_fingerprint, '')), '') IS NULL THEN
    UPDATE hive.processing_runs
       SET estimated_completion_at = NULL,
           estimate_fingerprint = NULL
     WHERE id = p_run_id;
  ELSE
    UPDATE hive.processing_runs
       SET estimated_completion_at = p_estimated_completion_at,
           estimate_fingerprint = left(btrim(p_estimate_fingerprint), 2048)
     WHERE id = p_run_id;
  END IF;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_processing_run_estimate(
  p_run_id uuid,
  p_estimated_completion_at timestamptz,
  p_estimate_fingerprint text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_run_id IS NULL OR p_estimated_completion_at IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF nullif(btrim(coalesce(p_estimate_fingerprint, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  UPDATE hive.processing_runs r
     SET estimated_completion_at = p_estimated_completion_at,
         estimate_fingerprint = left(btrim(p_estimate_fingerprint), 2048)
   WHERE r.id = p_run_id
     AND r.owner_user_id = v_uid
     AND r.estimated_completion_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_report_run_estimate(
  p_report_run_id uuid,
  p_estimated_completion_at timestamptz,
  p_estimate_fingerprint text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF p_report_run_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF p_estimated_completion_at IS NULL OR nullif(btrim(coalesce(p_estimate_fingerprint, '')), '') IS NULL THEN
    UPDATE hive.report_runs
       SET estimated_completion_at = NULL,
           estimate_fingerprint = NULL
     WHERE id = p_report_run_id;
  ELSE
    UPDATE hive.report_runs
       SET estimated_completion_at = p_estimated_completion_at,
           estimate_fingerprint = left(btrim(p_estimate_fingerprint), 2048)
     WHERE id = p_report_run_id;
  END IF;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_report_run_estimate(
  p_report_run_id uuid,
  p_estimated_completion_at timestamptz,
  p_estimate_fingerprint text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_report_run_id IS NULL OR p_estimated_completion_at IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF nullif(btrim(coalesce(p_estimate_fingerprint, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  UPDATE hive.report_runs rr
     SET estimated_completion_at = p_estimated_completion_at,
         estimate_fingerprint = left(btrim(p_estimate_fingerprint), 2048)
    FROM hive.hives h
   WHERE rr.id = p_report_run_id
     AND h.id = rr.hive_id
     AND h.owner_user_id = v_uid
     AND rr.estimated_completion_at IS NULL;
  RETURN FOUND;
END;
$$;

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
    'extractingPageCompleted', CASE
      WHEN r.status <> 'EXTRACTING' OR r.source_snapshot IS NULL THEN NULL
      ELSE (
        WITH pending AS (
          SELECT (d ->> 'sourceDocumentId')::uuid AS doc_id,
                 lower(btrim(d ->> 'pageSetDigest')) AS content_digest,
                 (d ->> 'verifiedPageCount')::int AS page_total
            FROM jsonb_array_elements(r.source_snapshot -> 'documents') d
           WHERE NOT EXISTS (
             SELECT 1
               FROM hive.doc_extractions e
              WHERE e.hive_id = r.hive_id
                AND e.source_document_id = (d ->> 'sourceDocumentId')::uuid
                AND e.content_digest = lower(btrim(d ->> 'pageSetDigest'))
           )
           ORDER BY (d ->> 'sourceDocumentId')
           LIMIT 1
        ),
        covered AS (
          SELECT DISTINCT unnest(
                   hive.page_numbers_for_extraction_range(rng.page_range, pending.page_total)
                 ) AS page_number
            FROM pending
            JOIN hive.doc_extraction_ranges rng
              ON rng.hive_id = r.hive_id
             AND rng.source_document_id = pending.doc_id
             AND rng.content_digest = pending.content_digest
        )
        SELECT coalesce((SELECT count(*)::int FROM covered), 0)
      )
    END,
    'extractingPageTotal', CASE
      WHEN r.status <> 'EXTRACTING' OR r.source_snapshot IS NULL THEN NULL
      ELSE (
        SELECT (d ->> 'verifiedPageCount')::int
          FROM jsonb_array_elements(r.source_snapshot -> 'documents') d
         WHERE NOT EXISTS (
           SELECT 1 FROM hive.doc_extractions e
            WHERE e.hive_id = r.hive_id
              AND e.source_document_id = (d ->> 'sourceDocumentId')::uuid
              AND e.content_digest = lower(btrim(d ->> 'pageSetDigest'))
         )
         ORDER BY (d ->> 'sourceDocumentId')
         LIMIT 1
      )
    END,
    'estimatedCompletionAt', r.estimated_completion_at,
    'estimateFingerprint', r.estimate_fingerprint,
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

CREATE OR REPLACE FUNCTION hive.report_run_json(r hive.report_runs)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT json_build_object(
    'id', r.id,
    'hiveId', r.hive_id,
    'studyRevisionId', r.study_revision_id,
    'audience', r.audience,
    'trigger', r.trigger,
    'status', r.status,
    'attemptCount', r.attempt_count,
    'maxAttempts', r.max_attempts,
    'errorCode', r.error_code,
    'errorMessageSafe', r.error_message_safe,
    'retryable', r.retryable,
    'correlationId', r.correlation_id,
    'reportId', (SELECT p.id FROM hive.reports p WHERE p.report_run_id = r.id),
    'estimatedCompletionAt', r.estimated_completion_at,
    'estimateFingerprint', r.estimate_fingerprint,
    'createdAt', r.created_at,
    'startedAt', r.started_at,
    'updatedAt', r.updated_at,
    'finishedAt', r.finished_at
  );
$$;

REVOKE ALL ON FUNCTION public.persist_processing_run_estimate(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_processing_run_estimate(uuid, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.backfill_processing_run_estimate(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_processing_run_estimate(uuid, timestamptz, text) TO authenticated;

REVOKE ALL ON FUNCTION public.persist_report_run_estimate(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_report_run_estimate(uuid, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.backfill_report_run_estimate(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_report_run_estimate(uuid, timestamptz, text) TO authenticated;

COMMIT;
