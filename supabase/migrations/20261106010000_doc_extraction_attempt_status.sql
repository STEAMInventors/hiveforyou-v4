-- Extract attempts: status lifecycle (IN_FLIGHT → SUCCEEDED | FAILED) and stale cut-off repair.
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
    'errorCode', r.error_code,
    'errorMessageSafe', r.error_message_safe,
    'retryable', r.retryable,
    'correlationId', r.correlation_id,
    'createdAt', r.created_at,
    'startedAt', r.started_at,
    'updatedAt', r.updated_at,
    'finishedAt', r.finished_at,
    'leaseExpiresAt', r.lease_expires_at
  );
$$;

ALTER TABLE hive.doc_extraction_attempts
  ADD COLUMN IF NOT EXISTS attempt_status text NOT NULL DEFAULT 'FAILED';

ALTER TABLE hive.doc_extraction_attempts
  DROP CONSTRAINT IF EXISTS ck_doc_extraction_attempts__attempt_status;

ALTER TABLE hive.doc_extraction_attempts
  ADD CONSTRAINT ck_doc_extraction_attempts__attempt_status CHECK (
    attempt_status IN ('IN_FLIGHT', 'SUCCEEDED', 'FAILED')
  );

COMMENT ON COLUMN hive.doc_extraction_attempts.attempt_status IS
  'IN_FLIGHT while the planner HTTP request is active; SUCCEEDED or FAILED when the call completes.';

CREATE INDEX IF NOT EXISTS idx_doc_extraction_attempts__run_status_started
  ON hive.doc_extraction_attempts (processing_run_id, attempt_status, call_started_at);

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

CREATE OR REPLACE FUNCTION public.update_doc_extraction_attempt_outcome(
  p_attempt_id uuid,
  p_processing_run_id uuid,
  p_outcome text,
  p_error_code text,
  p_diagnostic_reason text,
  p_http_status integer,
  p_duration_ms integer,
  p_aborted_by_our_deadline boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_row hive.doc_extraction_attempts%ROWTYPE;
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF v_outcome NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'extract_attempt_invalid' USING ERRCODE = 'P0001';
  END IF;

  UPDATE hive.doc_extraction_attempts a
     SET attempt_status = CASE WHEN v_outcome = 'succeeded' THEN 'SUCCEEDED' ELSE 'FAILED' END,
         error_code = nullif(btrim(coalesce(p_error_code, '')), ''),
         diagnostic_reason = nullif(btrim(coalesce(p_diagnostic_reason, '')), ''),
         http_status = p_http_status,
         duration_ms = p_duration_ms,
         aborted_by_our_deadline = coalesce(p_aborted_by_our_deadline, false)
   WHERE a.id = p_attempt_id
     AND a.processing_run_id = p_processing_run_id
     AND a.attempt_status = 'IN_FLIGHT'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'extract_attempt_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN json_build_object('updated', true, 'id', v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_stale_in_flight_doc_extraction_attempts(
  p_processing_run_id uuid,
  p_this_invocation_started_at timestamptz,
  p_diagnostic_reason text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_n integer := 0;
  v_reason text := nullif(btrim(coalesce(p_diagnostic_reason, '')), '');
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF p_this_invocation_started_at IS NULL OR v_reason IS NULL THEN
    RAISE EXCEPTION 'extract_attempt_invalid' USING ERRCODE = 'P0001';
  END IF;

  -- Orphaned IN_FLIGHT rows from a prior worker invocation (lease or Vercel cut-off) started before this route began.
  UPDATE hive.doc_extraction_attempts a
     SET attempt_status = 'FAILED',
         error_code = 'MODEL_TIMEOUT',
         diagnostic_reason = v_reason,
         http_status = null,
         duration_ms = null,
         aborted_by_our_deadline = true
   WHERE a.processing_run_id = p_processing_run_id
     AND a.attempt_status = 'IN_FLIGHT'
     AND a.call_started_at < p_this_invocation_started_at;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN json_build_object('failedCount', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_doc_extraction_attempt(
  p_processing_run_id uuid,
  p_hive_id uuid,
  p_source_document_id uuid,
  p_content_digest text,
  p_page_range text,
  p_prompt_id text,
  p_prompt_digest text,
  p_error_code text,
  p_diagnostic_reason text,
  p_http_status integer,
  p_duration_ms integer,
  p_aborted_by_our_deadline boolean,
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
    'FAILED',
    nullif(btrim(coalesce(p_error_code, '')), ''),
    nullif(btrim(coalesce(p_diagnostic_reason, '')), ''),
    p_http_status,
    p_duration_ms,
    coalesce(p_aborted_by_our_deadline, false),
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

CREATE OR REPLACE FUNCTION public.get_doc_extraction_attempt_totals_for_run(p_processing_run_id uuid)
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

  SELECT coalesce(json_agg(
           json_build_object(
             'sourceDocumentId', t.source_document_id,
             'contentDigest', t.content_digest,
             'pageRange', t.page_range,
             'promptDigest', t.prompt_digest,
             'failedAttemptCount', t.failed_attempt_count,
             'cutoffOrTimeoutCount', t.cutoff_or_timeout_count
           )
           ORDER BY t.source_document_id, t.page_range
         ), '[]'::json)
    INTO v_rows
    FROM (
      SELECT
        a.source_document_id,
        a.content_digest,
        a.page_range,
        a.prompt_digest,
        count(*) FILTER (WHERE a.attempt_status = 'FAILED')::int AS failed_attempt_count,
        count(*) FILTER (
          WHERE a.attempt_status = 'FAILED'
            AND (
              a.aborted_by_our_deadline = true
              OR a.error_code = 'MODEL_TIMEOUT'
              OR coalesce(a.diagnostic_reason, '') IN (
                   'planner_timeout',
                   'invocation_deadline_abort',
                   'litellm_timeout',
                   'invocation_ended'
                 )
            )
        )::int AS cutoff_or_timeout_count
        FROM hive.doc_extraction_attempts a
       WHERE a.processing_run_id = p_processing_run_id
       GROUP BY a.source_document_id, a.content_digest, a.page_range, a.prompt_digest
    ) t;

  RETURN json_build_object('totals', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.begin_doc_extraction_attempt(
  uuid, uuid, uuid, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_doc_extraction_attempt(
  uuid, uuid, uuid, text, text, text, text, timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.update_doc_extraction_attempt_outcome(
  uuid, uuid, text, text, text, integer, integer, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_doc_extraction_attempt_outcome(
  uuid, uuid, text, text, text, integer, integer, boolean
) TO service_role;

REVOKE ALL ON FUNCTION public.fail_stale_in_flight_doc_extraction_attempts(
  uuid, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_stale_in_flight_doc_extraction_attempts(
  uuid, timestamptz, text
) TO service_role;

REVOKE ALL ON FUNCTION public.record_doc_extraction_attempt(
  uuid, uuid, uuid, text, text, text, text, text, text, integer, integer, boolean, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_doc_extraction_attempt(
  uuid, uuid, uuid, text, text, text, text, text, text, integer, integer, boolean, timestamptz
) TO service_role;

COMMIT;
