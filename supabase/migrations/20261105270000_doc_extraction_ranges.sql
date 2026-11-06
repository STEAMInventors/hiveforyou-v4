-- V5-005 — persist verified extract output per page range; merge to doc_extractions when complete.
BEGIN;

CREATE TABLE IF NOT EXISTS hive.doc_extraction_ranges (
  id uuid DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  content_digest text NOT NULL,
  page_range text NOT NULL,
  prompt_id text NOT NULL,
  prompt_digest text NOT NULL,
  model_alias text NOT NULL,
  extraction jsonb NOT NULL,
  stats jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_doc_extraction_ranges PRIMARY KEY (id),
  CONSTRAINT fk_doc_extraction_ranges__hives
    FOREIGN KEY (hive_id) REFERENCES hive.hives (id) ON DELETE CASCADE,
  CONSTRAINT fk_doc_extraction_ranges__source_documents
    FOREIGN KEY (source_document_id) REFERENCES hive.source_documents (id) ON DELETE CASCADE,
  CONSTRAINT uq_doc_extraction_ranges__cache UNIQUE (
    source_document_id, content_digest, page_range, prompt_digest, model_alias
  ),
  CONSTRAINT ck_doc_extraction_ranges__content_digest CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_doc_extraction_ranges__page_range CHECK (
    page_range ~ '^(all|[1-9][0-9]*(-[1-9][0-9]*)?)$'
  ),
  CONSTRAINT ck_doc_extraction_ranges__prompt_digest CHECK (prompt_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_doc_extraction_ranges__prompt_id CHECK (prompt_id ~ '^[A-Za-z0-9_.:/@+-]{1,128}$'),
  CONSTRAINT ck_doc_extraction_ranges__model_alias CHECK (model_alias ~ '^[A-Za-z0-9_.:/@+-]{1,128}$'),
  CONSTRAINT ck_doc_extraction_ranges__extraction CHECK (
    jsonb_typeof(extraction) = 'object'
    AND extraction ->> 'schema' = 'hive.doc-extraction/1'
    AND octet_length(extraction::text) <= 2097152
  ),
  CONSTRAINT ck_doc_extraction_ranges__stats CHECK (
    jsonb_typeof(stats) = 'object' AND octet_length(stats::text) <= 262144
  )
);

COMMENT ON TABLE hive.doc_extraction_ranges IS
  'Verified hive.doc-extraction/1 per page range; insert-only until Hive or source document removal.';

CREATE INDEX IF NOT EXISTS idx_doc_extraction_ranges__hive_source
  ON hive.doc_extraction_ranges (hive_id, source_document_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_doc_extraction_ranges__bind_source ON hive.doc_extraction_ranges;
CREATE TRIGGER trg_doc_extraction_ranges__bind_source
  BEFORE INSERT ON hive.doc_extraction_ranges
  FOR EACH ROW
  EXECUTE FUNCTION hive.bind_doc_extraction_to_source();

DROP TRIGGER IF EXISTS trg_doc_extraction_ranges__immutable_update ON hive.doc_extraction_ranges;
CREATE TRIGGER trg_doc_extraction_ranges__immutable_update
  BEFORE UPDATE ON hive.doc_extraction_ranges
  FOR EACH ROW
  EXECUTE FUNCTION hive.prevent_doc_extraction_mutation();

CREATE OR REPLACE FUNCTION public.put_doc_extraction_range(
  p_hive_id uuid,
  p_source_document_id uuid,
  p_content_digest text,
  p_page_range text,
  p_prompt_id text,
  p_prompt_digest text,
  p_model_alias text,
  p_extraction jsonb,
  p_stats jsonb DEFAULT '{}'::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_doc hive.source_documents%ROWTYPE;
  v_content text := lower(btrim(coalesce(p_content_digest, '')));
  v_page_range text := lower(btrim(coalesce(p_page_range, '')));
  v_prompt_id text := btrim(coalesce(p_prompt_id, ''));
  v_prompt_digest text := lower(btrim(coalesce(p_prompt_digest, '')));
  v_model text := btrim(coalesce(p_model_alias, ''));
  v_existing hive.doc_extraction_ranges%ROWTYPE;
  v_row hive.doc_extraction_ranges%ROWTYPE;
  v_inserted boolean := false;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc FROM hive.source_documents WHERE id = p_source_document_id;
  IF NOT FOUND
     OR v_doc.deleted_at IS NOT NULL
     OR v_doc.lifecycle_status <> 'ACTIVE'
     OR v_doc.upload_status <> 'UPLOADED' THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_hive_id IS NULL OR v_doc.case_id <> p_hive_id THEN
    RAISE EXCEPTION 'doc_extraction_hive_mismatch' USING ERRCODE = '42501';
  END IF;

  IF v_content !~ '^sha256:[0-9a-f]{64}$'
     OR v_page_range !~ '^(all|[1-9][0-9]*(-[1-9][0-9]*)?)$'
     OR v_prompt_digest !~ '^sha256:[0-9a-f]{64}$'
     OR char_length(v_prompt_id) = 0 OR char_length(v_prompt_id) > 128
     OR char_length(v_model) = 0 OR char_length(v_model) > 128
     OR p_extraction IS NULL OR jsonb_typeof(p_extraction) <> 'object'
     OR p_extraction ->> 'schema' IS DISTINCT FROM 'hive.doc-extraction/1'
     OR p_stats IS NULL OR jsonb_typeof(p_stats) <> 'object' THEN
    RAISE EXCEPTION 'doc_extraction_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing
    FROM hive.doc_extraction_ranges
   WHERE source_document_id = p_source_document_id
     AND content_digest = v_content
     AND page_range = v_page_range
     AND prompt_digest = v_prompt_digest
     AND model_alias = v_model;

  IF FOUND THEN
    IF v_existing.hive_id = p_hive_id
       AND v_existing.extraction = p_extraction
       AND v_existing.stats = p_stats
       AND v_existing.prompt_id = v_prompt_id THEN
      RETURN json_build_object(
        'id', v_existing.id,
        'sourceDocumentId', v_existing.source_document_id,
        'contentDigest', v_existing.content_digest,
        'pageRange', v_existing.page_range,
        'inserted', false,
        'replayed', true
      );
    END IF;
    RAISE EXCEPTION 'doc_extraction_hash_conflict' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO hive.doc_extraction_ranges (
      hive_id,
      source_document_id,
      content_digest,
      page_range,
      prompt_id,
      prompt_digest,
      model_alias,
      extraction,
      stats
    ) VALUES (
      p_hive_id,
      p_source_document_id,
      v_content,
      v_page_range,
      v_prompt_id,
      v_prompt_digest,
      v_model,
      p_extraction,
      p_stats
    )
    RETURNING * INTO v_row;
    v_inserted := true;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_existing
        FROM hive.doc_extraction_ranges
       WHERE source_document_id = p_source_document_id
         AND content_digest = v_content
         AND page_range = v_page_range
         AND prompt_digest = v_prompt_digest
         AND model_alias = v_model;
      IF FOUND
         AND v_existing.hive_id = p_hive_id
         AND v_existing.extraction = p_extraction
         AND v_existing.stats = p_stats
         AND v_existing.prompt_id = v_prompt_id THEN
        RETURN json_build_object(
          'id', v_existing.id,
          'sourceDocumentId', v_existing.source_document_id,
          'contentDigest', v_existing.content_digest,
          'pageRange', v_existing.page_range,
          'inserted', false,
          'replayed', true
        );
      END IF;
      RAISE EXCEPTION 'doc_extraction_hash_conflict' USING ERRCODE = 'P0001';
  END;

  RETURN json_build_object(
    'id', v_row.id,
    'sourceDocumentId', v_row.source_document_id,
    'contentDigest', v_row.content_digest,
    'pageRange', v_row.page_range,
    'inserted', v_inserted,
    'replayed', false
  );
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'doc_extraction_invalid' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_doc_extraction_ranges_for_run(p_processing_run_id uuid)
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
             'id', r.id,
             'hiveId', r.hive_id,
             'sourceDocumentId', r.source_document_id,
             'contentDigest', r.content_digest,
             'pageRange', r.page_range,
             'promptId', r.prompt_id,
             'promptDigest', r.prompt_digest,
             'modelAlias', r.model_alias,
             'extraction', r.extraction,
             'stats', r.stats,
             'createdAt', r.created_at
           )
           ORDER BY r.source_document_id, r.page_range, r.created_at
         ), '[]'::json)
    INTO v_rows
    FROM hive.doc_extraction_ranges r
    JOIN LATERAL (
      SELECT (d ->> 'sourceDocumentId')::uuid AS doc_id,
             lower(btrim(d ->> 'pageSetDigest')) AS content_digest
        FROM jsonb_array_elements(v_run.source_snapshot -> 'documents') d
    ) snap
      ON snap.doc_id = r.source_document_id
     AND snap.content_digest = r.content_digest
   WHERE r.hive_id = v_run.hive_id;

  RETURN json_build_object('ranges', v_rows);
END;
$$;

ALTER TABLE hive.doc_extraction_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.doc_extraction_ranges FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_doc_extraction_ranges__select__owner ON hive.doc_extraction_ranges;
CREATE POLICY pol_doc_extraction_ranges__select__owner
  ON hive.doc_extraction_ranges
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = doc_extraction_ranges.hive_id
         AND h.owner_user_id = auth.uid()
         AND h.archived_at IS NULL
         AND h.deleting_at IS NULL
    )
  );

REVOKE ALL ON hive.doc_extraction_ranges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hive.doc_extraction_ranges TO authenticated;
GRANT ALL ON hive.doc_extraction_ranges TO service_role;

REVOKE ALL ON FUNCTION public.put_doc_extraction_range(
  uuid, uuid, text, text, text, text, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.put_doc_extraction_range(
  uuid, uuid, text, text, text, text, text, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.get_doc_extraction_ranges_for_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_doc_extraction_ranges_for_run(uuid) TO service_role;

CREATE OR REPLACE FUNCTION hive.page_numbers_for_extraction_range(
  p_page_range text,
  p_verified_page_count integer
)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT CASE
    WHEN p_page_range = 'all' THEN
      ARRAY(SELECT generate_series(1, greatest(coalesce(p_verified_page_count, 0), 0)))
    WHEN p_page_range ~ '^[0-9]+$' THEN ARRAY[p_page_range::int]
    WHEN p_page_range ~ '^[0-9]+-[0-9]+$' THEN
      ARRAY(
        SELECT generate_series(
          split_part(p_page_range, '-', 1)::int,
          split_part(p_page_range, '-', 2)::int
        )
      )
    ELSE ARRAY[]::integer[]
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

COMMIT;
