-- Persist planner extract attempts per (run, document, page range) for bounded retries and observability.
BEGIN;

CREATE TABLE IF NOT EXISTS hive.doc_extraction_attempts (
  id uuid DEFAULT gen_random_uuid(),
  processing_run_id uuid NOT NULL,
  hive_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  content_digest text NOT NULL,
  page_range text NOT NULL,
  prompt_id text NOT NULL,
  prompt_digest text NOT NULL,
  attempt_number integer NOT NULL,
  error_code text,
  diagnostic_reason text,
  http_status integer,
  duration_ms integer,
  aborted_by_our_deadline boolean NOT NULL DEFAULT false,
  call_started_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_doc_extraction_attempts PRIMARY KEY (id),
  CONSTRAINT fk_doc_extraction_attempts__run
    FOREIGN KEY (processing_run_id) REFERENCES hive.processing_runs (id) ON DELETE CASCADE,
  CONSTRAINT fk_doc_extraction_attempts__hives
    FOREIGN KEY (hive_id) REFERENCES hive.hives (id) ON DELETE CASCADE,
  CONSTRAINT fk_doc_extraction_attempts__source_documents
    FOREIGN KEY (source_document_id) REFERENCES hive.source_documents (id) ON DELETE CASCADE,
  CONSTRAINT uq_doc_extraction_attempts__attempt UNIQUE (
    processing_run_id,
    source_document_id,
    content_digest,
    page_range,
    prompt_digest,
    attempt_number
  ),
  CONSTRAINT ck_doc_extraction_attempts__content_digest CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_doc_extraction_attempts__page_range CHECK (
    page_range ~ '^(all|[1-9][0-9]*(-[1-9][0-9]*)?)$'
  ),
  CONSTRAINT ck_doc_extraction_attempts__prompt_digest CHECK (prompt_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_doc_extraction_attempts__prompt_id CHECK (prompt_id ~ '^[A-Za-z0-9_.:/@+-]{1,128}$'),
  CONSTRAINT ck_doc_extraction_attempts__attempt_number CHECK (attempt_number >= 1 AND attempt_number <= 1000),
  CONSTRAINT ck_doc_extraction_attempts__duration_ms CHECK (duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 86400000)),
  CONSTRAINT ck_doc_extraction_attempts__http_status CHECK (
    http_status IS NULL OR (http_status >= 100 AND http_status <= 599)
  )
);

COMMENT ON TABLE hive.doc_extraction_attempts IS
  'Failed hive-extract planner calls per run and page range; used for bounded retries and diagnostics.';

CREATE INDEX IF NOT EXISTS idx_doc_extraction_attempts__run_document
  ON hive.doc_extraction_attempts (processing_run_id, source_document_id, page_range);

DROP TRIGGER IF EXISTS trg_doc_extraction_attempts__bind_source ON hive.doc_extraction_attempts;
CREATE TRIGGER trg_doc_extraction_attempts__bind_source
  BEFORE INSERT ON hive.doc_extraction_attempts
  FOR EACH ROW
  EXECUTE FUNCTION hive.bind_doc_extraction_to_source();

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
        count(*)::int AS failed_attempt_count,
        count(*) FILTER (
          WHERE a.aborted_by_our_deadline = true
             OR a.error_code = 'MODEL_TIMEOUT'
             OR coalesce(a.diagnostic_reason, '') IN (
                  'planner_timeout',
                  'invocation_deadline_abort',
                  'litellm_timeout'
                )
        )::int AS cutoff_or_timeout_count
        FROM hive.doc_extraction_attempts a
       WHERE a.processing_run_id = p_processing_run_id
       GROUP BY a.source_document_id, a.content_digest, a.page_range, a.prompt_digest
    ) t;

  RETURN json_build_object('totals', v_rows);
END;
$$;

ALTER TABLE hive.doc_extraction_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.doc_extraction_attempts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_doc_extraction_attempts__select__owner ON hive.doc_extraction_attempts;
CREATE POLICY pol_doc_extraction_attempts__select__owner
  ON hive.doc_extraction_attempts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = doc_extraction_attempts.hive_id
         AND h.owner_user_id = auth.uid()
         AND h.archived_at IS NULL
         AND h.deleting_at IS NULL
    )
  );

REVOKE ALL ON hive.doc_extraction_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hive.doc_extraction_attempts TO authenticated;
GRANT ALL ON hive.doc_extraction_attempts TO service_role;

REVOKE ALL ON FUNCTION public.record_doc_extraction_attempt(
  uuid, uuid, uuid, text, text, text, text, text, text, integer, integer, boolean, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_doc_extraction_attempt(
  uuid, uuid, uuid, text, text, text, text, text, text, integer, integer, boolean, timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.get_doc_extraction_attempt_totals_for_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_doc_extraction_attempt_totals_for_run(uuid) TO service_role;

COMMIT;
