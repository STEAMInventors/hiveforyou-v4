-- V5-005 (partial) — Cached verified document extractions and simplified pipeline run stages (D-052).
-- Additive only: `hive.doc_extractions`, `study_revisions.format`, statuses EXTRACTING and CANONICALIZING.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. hive.doc_extractions — verified hive.doc-extraction/1 per document generation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.doc_extractions (
  id uuid DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  content_digest text NOT NULL,
  prompt_id text NOT NULL,
  prompt_digest text NOT NULL,
  model_alias text NOT NULL,
  extraction jsonb NOT NULL,
  stats jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_doc_extractions PRIMARY KEY (id),
  CONSTRAINT fk_doc_extractions__hives
    FOREIGN KEY (hive_id) REFERENCES hive.hives (id) ON DELETE CASCADE,
  CONSTRAINT fk_doc_extractions__source_documents
    FOREIGN KEY (source_document_id) REFERENCES hive.source_documents (id) ON DELETE CASCADE,
  CONSTRAINT uq_doc_extractions__cache UNIQUE (
    source_document_id, content_digest, prompt_digest, model_alias
  ),
  CONSTRAINT ck_doc_extractions__content_digest CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_doc_extractions__prompt_digest CHECK (prompt_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_doc_extractions__prompt_id CHECK (prompt_id ~ '^[A-Za-z0-9_.:/@+-]{1,128}$'),
  CONSTRAINT ck_doc_extractions__model_alias CHECK (model_alias ~ '^[A-Za-z0-9_.:/@+-]{1,128}$'),
  CONSTRAINT ck_doc_extractions__extraction CHECK (
    jsonb_typeof(extraction) = 'object'
    AND extraction ->> 'schema' = 'hive.doc-extraction/1'
    AND octet_length(extraction::text) <= 2097152
  ),
  CONSTRAINT ck_doc_extractions__stats CHECK (
    jsonb_typeof(stats) = 'object' AND octet_length(stats::text) <= 262144
  )
);

COMMENT ON TABLE hive.doc_extractions IS
  'Verified hive.doc-extraction/1 payloads with final ids; insert-only cache keyed by document content, prompt and model.';

CREATE INDEX IF NOT EXISTS idx_doc_extractions__hive_source
  ON hive.doc_extractions (hive_id, source_document_id, created_at DESC);

CREATE OR REPLACE FUNCTION hive.bind_doc_extraction_to_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_doc hive.source_documents%ROWTYPE;
BEGIN
  SELECT * INTO v_doc FROM hive.source_documents WHERE id = NEW.source_document_id;
  IF NOT FOUND
     OR v_doc.deleted_at IS NOT NULL
     OR v_doc.lifecycle_status <> 'ACTIVE'
     OR v_doc.upload_status <> 'UPLOADED' THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NEW.hive_id IS NOT NULL AND NEW.hive_id <> v_doc.case_id THEN
    RAISE EXCEPTION 'doc_extraction_hive_mismatch' USING ERRCODE = '42501';
  END IF;

  NEW.hive_id := v_doc.case_id;
  NEW.content_digest := lower(btrim(NEW.content_digest));
  NEW.prompt_digest := lower(btrim(NEW.prompt_digest));
  NEW.prompt_id := btrim(NEW.prompt_id);
  NEW.model_alias := btrim(NEW.model_alias);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_doc_extractions__bind_source ON hive.doc_extractions;
CREATE TRIGGER trg_doc_extractions__bind_source
  BEFORE INSERT ON hive.doc_extractions
  FOR EACH ROW
  EXECUTE FUNCTION hive.bind_doc_extraction_to_source();

CREATE OR REPLACE FUNCTION hive.prevent_doc_extraction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'hive.doc_extractions rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_doc_extractions__immutable_update ON hive.doc_extractions;
CREATE TRIGGER trg_doc_extractions__immutable_update
  BEFORE UPDATE ON hive.doc_extractions
  FOR EACH ROW
  EXECUTE FUNCTION hive.prevent_doc_extraction_mutation();

DROP TRIGGER IF EXISTS trg_doc_extractions__immutable_delete ON hive.doc_extractions;
CREATE TRIGGER trg_doc_extractions__immutable_delete
  BEFORE DELETE ON hive.doc_extractions
  FOR EACH ROW
  EXECUTE FUNCTION hive.prevent_doc_extraction_mutation();

CREATE OR REPLACE FUNCTION public.put_doc_extraction(
  p_hive_id uuid,
  p_source_document_id uuid,
  p_content_digest text,
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
  v_prompt_id text := btrim(coalesce(p_prompt_id, ''));
  v_prompt_digest text := lower(btrim(coalesce(p_prompt_digest, '')));
  v_model text := btrim(coalesce(p_model_alias, ''));
  v_existing hive.doc_extractions%ROWTYPE;
  v_row hive.doc_extractions%ROWTYPE;
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
     OR v_prompt_digest !~ '^sha256:[0-9a-f]{64}$'
     OR char_length(v_prompt_id) = 0 OR char_length(v_prompt_id) > 128
     OR char_length(v_model) = 0 OR char_length(v_model) > 128
     OR p_extraction IS NULL OR jsonb_typeof(p_extraction) <> 'object'
     OR p_extraction ->> 'schema' IS DISTINCT FROM 'hive.doc-extraction/1'
     OR p_stats IS NULL OR jsonb_typeof(p_stats) <> 'object' THEN
    RAISE EXCEPTION 'doc_extraction_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing
    FROM hive.doc_extractions
   WHERE source_document_id = p_source_document_id
     AND content_digest = v_content
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
        'inserted', false,
        'replayed', true
      );
    END IF;
    RAISE EXCEPTION 'doc_extraction_hash_conflict' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO hive.doc_extractions (
      hive_id,
      source_document_id,
      content_digest,
      prompt_id,
      prompt_digest,
      model_alias,
      extraction,
      stats
    ) VALUES (
      p_hive_id,
      p_source_document_id,
      v_content,
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
        FROM hive.doc_extractions
       WHERE source_document_id = p_source_document_id
         AND content_digest = v_content
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
    'inserted', v_inserted,
    'replayed', false
  );
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'doc_extraction_invalid' USING ERRCODE = 'P0001';
END;
$$;

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

ALTER TABLE hive.doc_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.doc_extractions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_doc_extractions__select__owner ON hive.doc_extractions;
CREATE POLICY pol_doc_extractions__select__owner
  ON hive.doc_extractions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = doc_extractions.hive_id
         AND h.owner_user_id = auth.uid()
         AND h.archived_at IS NULL
         AND h.deleting_at IS NULL
    )
  );

REVOKE ALL ON hive.doc_extractions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hive.doc_extractions TO authenticated;
GRANT ALL ON hive.doc_extractions TO service_role;

REVOKE ALL ON FUNCTION public.put_doc_extraction(
  uuid, uuid, text, text, text, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.put_doc_extraction(
  uuid, uuid, text, text, text, text, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.get_doc_extractions_for_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_doc_extractions_for_run(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. hive.study_revisions.format — agentic vs simplified canonical study payload
-- ---------------------------------------------------------------------------
ALTER TABLE hive.study_revisions
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'investigation-1';

ALTER TABLE hive.study_revisions DROP CONSTRAINT IF EXISTS ck_study_revisions__format;
ALTER TABLE hive.study_revisions
  ADD CONSTRAINT ck_study_revisions__format
  CHECK (format IN ('investigation-1', 'canonical-study-1'));

COMMENT ON COLUMN hive.study_revisions.format IS
  'investigation-1: hive.study-investigation/1 in investigation. canonical-study-1: hive.canonical-study/1 (V5 pipeline).';

-- ---------------------------------------------------------------------------
-- 3. hive.processing_runs — EXTRACTING and CANONICALIZING (V5 pipeline stages)
-- ---------------------------------------------------------------------------
ALTER TABLE hive.processing_runs DROP CONSTRAINT IF EXISTS ck_processing_runs__status;
ALTER TABLE hive.processing_runs ADD CONSTRAINT ck_processing_runs__status CHECK (
  status IN (
    'QUEUED', 'READING_DOCUMENTS', 'AWAITING_ACKNOWLEDGEMENT', 'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN',
    'DEVELOPING_QUESTIONS', 'PLANNING_INVESTIGATION', 'BUILDING_PROMPT', 'SAVING', 'INVESTIGATING',
    'EXTRACTING', 'CANONICALIZING',
    'VERIFYING_EVIDENCE', 'ACCEPTING_STUDY', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED'
  )
);

CREATE OR REPLACE FUNCTION hive.enforce_processing_run_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.hive_id IS DISTINCT FROM OLD.hive_id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.intent_request_ids IS DISTINCT FROM OLD.intent_request_ids
     OR NEW.intent_snapshot_digest IS DISTINCT FROM OLD.intent_snapshot_digest
     OR NEW.preparation_mode IS DISTINCT FROM OLD.preparation_mode
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;

  IF OLD.source_snapshot IS NOT NULL AND (
       NEW.authorized_source_document_ids IS DISTINCT FROM OLD.authorized_source_document_ids
       OR NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot
       OR NEW.source_snapshot_digest IS DISTINCT FROM OLD.source_snapshot_digest
       OR NEW.coverage_digest IS DISTINCT FROM OLD.coverage_digest
       OR NEW.coverage_complete IS DISTINCT FROM OLD.coverage_complete
       OR NEW.coverage_status IS DISTINCT FROM OLD.coverage_status
       OR NEW.coverage_gaps IS DISTINCT FROM OLD.coverage_gaps
       OR NEW.snapshot_frozen_at IS DISTINCT FROM OLD.snapshot_frozen_at) THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;
  IF OLD.source_snapshot IS NOT NULL AND (
       NEW.coverage_acknowledgement IS DISTINCT FROM OLD.coverage_acknowledgement
       OR NEW.coverage_acknowledged_at IS DISTINCT FROM OLD.coverage_acknowledged_at
       OR NEW.coverage_acknowledged IS DISTINCT FROM OLD.coverage_acknowledged)
     AND NOT (OLD.status = 'AWAITING_ACKNOWLEDGEMENT' AND OLD.coverage_acknowledgement = 'PENDING'
              AND NEW.status = 'UNDERSTANDING_REQUEST' AND NEW.coverage_acknowledgement = 'OWNER'
              AND NEW.coverage_acknowledged AND NEW.coverage_acknowledged_at IS NOT NULL) THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;

  IF OLD.status IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED') THEN
    RAISE EXCEPTION 'processing_run_finished' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'QUEUED' AND NEW.status IN ('READING_DOCUMENTS', 'UNDERSTANDING_REQUEST', 'NEEDS_CLARIFICATION', 'FAILED'))
    OR (OLD.status = 'READING_DOCUMENTS' AND NEW.status IN ('AWAITING_ACKNOWLEDGEMENT', 'UNDERSTANDING_REQUEST', 'EXTRACTING', 'FAILED'))
    OR (OLD.status = 'AWAITING_ACKNOWLEDGEMENT' AND NEW.status IN ('UNDERSTANDING_REQUEST', 'FAILED'))
    OR (OLD.status = 'UNDERSTANDING_REQUEST' AND NEW.status IN ('IDENTIFYING_DOMAIN', 'FAILED'))
    OR (OLD.status = 'IDENTIFYING_DOMAIN' AND NEW.status IN ('DEVELOPING_QUESTIONS', 'FAILED'))
    OR (OLD.status = 'DEVELOPING_QUESTIONS' AND NEW.status IN ('PLANNING_INVESTIGATION', 'BUILDING_PROMPT', 'FAILED'))
    OR (OLD.status = 'PLANNING_INVESTIGATION' AND NEW.status IN ('BUILDING_PROMPT', 'FAILED'))
    OR (OLD.status = 'BUILDING_PROMPT' AND NEW.status IN ('SAVING', 'FAILED'))
    OR (OLD.status = 'SAVING' AND NEW.status IN ('INVESTIGATING', 'FAILED'))
    OR (OLD.status = 'INVESTIGATING' AND NEW.status IN ('VERIFYING_EVIDENCE', 'FAILED'))
    OR (OLD.status = 'EXTRACTING' AND NEW.status IN ('EXTRACTING', 'CANONICALIZING', 'FAILED'))
    OR (OLD.status = 'CANONICALIZING' AND NEW.status IN ('ACCEPTING_STUDY', 'FAILED'))
    OR (OLD.status = 'VERIFYING_EVIDENCE' AND NEW.status IN ('ACCEPTING_STUDY', 'FAILED'))
    OR (OLD.status = 'ACCEPTING_STUDY' AND NEW.status IN ('SUCCEEDED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'processing_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hive.is_valid_stage_metric(p_metric jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT coalesce(jsonb_typeof(p_metric) = 'object', false)
     AND coalesce(p_metric ->> 'stage' IN (
           'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN', 'DEVELOPING_QUESTIONS', 'PLANNING_INVESTIGATION',
           'EXTRACTING', 'CANONICALIZING', 'INVESTIGATING', 'WRITING'
         ), false)
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(p_metric) kv
        WHERE kv.key NOT IN (
                'stage', 'outcome', 'promptId', 'promptDigest', 'modelAliasRequested', 'resolvedModel',
                'promptTokens', 'completionTokens', 'totalTokens', 'latencyMs', 'plannerLatencyMs',
                'finishReason', 'startedAt', 'completedAt', 'errorCode', 'retryable', 'attempt'
              )
           OR (kv.key IN ('promptTokens', 'completionTokens', 'totalTokens', 'latencyMs', 'plannerLatencyMs', 'attempt')
               AND NOT (jsonb_typeof(kv.value) = 'null'
                        OR (jsonb_typeof(kv.value) = 'number'
                            AND (kv.value #>> '{}') ~ '^[0-9]{1,10}$')))
           OR (kv.key = 'retryable' AND jsonb_typeof(kv.value) NOT IN ('boolean', 'null'))
           OR (kv.key NOT IN ('promptTokens', 'completionTokens', 'totalTokens', 'latencyMs',
                              'plannerLatencyMs', 'retryable', 'attempt')
               AND NOT (jsonb_typeof(kv.value) = 'null'
                        OR (jsonb_typeof(kv.value) = 'string'
                            AND (kv.value #>> '{}') ~ '^[A-Za-z0-9_.:/@+-]{1,128}$')))
     );
$$;

CREATE OR REPLACE FUNCTION public.claim_processing_run(p_run_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_attempt integer;
BEGIN
  PERFORM hive.require_service_role();
  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     OR (v_run.lease_expires_at IS NOT NULL AND v_run.lease_expires_at > now())
     OR (v_run.lease_expires_at IS NULL AND v_run.stage_attempt > 1 AND v_run.next_dispatch_at > now()) THEN
    RETURN json_build_object('claimed', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  v_attempt := v_run.stage_attempt + CASE
    WHEN v_run.lease_expires_at IS NOT NULL AND v_run.status NOT IN ('READING_DOCUMENTS', 'EXTRACTING') THEN 1 ELSE 0 END;
  IF v_attempt > 3 THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'PREPARATION_INTERRUPTED',
           error_message_safe = 'Analysis stopped before it finished. You can try again.',
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('claimed', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  UPDATE hive.processing_runs
     SET stage_attempt = v_attempt,
         lease_expires_at = now() + interval '300 seconds',
         next_dispatch_at = NULL
   WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN json_build_object('claimed', true, 'processingRun', hive.processing_run_json(v_run));
END;
$$;

COMMIT;
