-- V4-004 — Analyze / Prompt Preview (D-039).
--
-- `hive.processing_runs` holds one durable preparation run per Analyze click
-- (kind STUDY_PREPARATION). The owner starts a run through `public.start_study_preparation`,
-- which freezes the authorized documents (sha256, read fingerprint, page-set digest), the
-- intent request IDs and the coverage the owner acknowledged. The web server (service role)
-- advances the run
--   QUEUED -> UNDERSTANDING_REQUEST -> IDENTIFYING_DOMAIN -> PLANNING_INVESTIGATION
--          -> BUILDING_PROMPT -> SAVING -> SUCCEEDED, or NEEDS_CLARIFICATION / FAILED
-- through `public.transition_processing_run`. A run whose frozen sources or intents no longer
-- match is failed atomically with SOURCE_CHANGED. `SUCCEEDED` requires the immutable
-- `hive.study_prompt_previews` row to exist with the matching prompt digest.
--
-- Authority: HiveForYou-DATA-MODEL.md, HiveForYou-DECISIONS.md (D-038, D-039),
-- HiveForYou-SECURITY-AND-PRIVACY.md, HiveForYou-NAMING-CONVENTIONS.md.
-- Requires 20261101190000_create_document_pages.sql and 20261101200000_create_document_reads.sql.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Table hive.processing_runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.processing_runs (
  id uuid DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  kind text NOT NULL,
  request_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  correlation_id uuid NOT NULL,
  lease_expires_at timestamptz,
  authorized_source_document_ids uuid[] NOT NULL,
  intent_request_ids uuid[] NOT NULL,
  source_snapshot jsonb NOT NULL,
  source_snapshot_digest text NOT NULL,
  intent_snapshot_digest text NOT NULL,
  coverage_digest text NOT NULL,
  coverage_complete boolean NOT NULL,
  coverage_acknowledged boolean NOT NULL DEFAULT false,
  stage_outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  stage_metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  error_message_safe text,
  retryable boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT pk_processing_runs PRIMARY KEY (id),
  CONSTRAINT fk_processing_runs__hives
    FOREIGN KEY (hive_id, owner_user_id) REFERENCES hive.hives (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT uq_processing_runs__owner_request UNIQUE (owner_user_id, request_id),
  CONSTRAINT uq_processing_runs__hive_kind_attempt UNIQUE (hive_id, kind, attempt_number),
  CONSTRAINT ck_processing_runs__kind CHECK (kind IN ('STUDY_PREPARATION')),
  CONSTRAINT ck_processing_runs__status CHECK (
    status IN (
      'QUEUED', 'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN', 'PLANNING_INVESTIGATION',
      'BUILDING_PROMPT', 'SAVING', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED'
    )
  ),
  CONSTRAINT ck_processing_runs__attempt_number CHECK (attempt_number >= 1),
  CONSTRAINT ck_processing_runs__digests CHECK (
    source_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
    AND intent_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
    AND coverage_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_processing_runs__source_snapshot CHECK (
    jsonb_typeof(source_snapshot) = 'object' AND octet_length(source_snapshot::text) <= 262144
  ),
  CONSTRAINT ck_processing_runs__stage_outputs CHECK (
    jsonb_typeof(stage_outputs) = 'object' AND octet_length(stage_outputs::text) <= 524288
  ),
  CONSTRAINT ck_processing_runs__stage_metrics CHECK (
    jsonb_typeof(stage_metrics) = 'array' AND jsonb_array_length(stage_metrics) <= 32
  ),
  CONSTRAINT ck_processing_runs__error_code_format CHECK (
    error_code IS NULL OR error_code ~ '^[A-Z_]{1,64}$'
  ),
  CONSTRAINT ck_processing_runs__error_message_safe_length CHECK (
    error_message_safe IS NULL OR char_length(error_message_safe) BETWEEN 1 AND 300
  ),
  CONSTRAINT ck_processing_runs__finished CHECK (
    (status IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')) = (finished_at IS NOT NULL)
  )
);

COMMENT ON TABLE hive.processing_runs IS
  'Durable processing run (first kind: STUDY_PREPARATION for Analyze / Prompt Preview) with frozen source and intent snapshots.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_runs__active_hive_kind
  ON hive.processing_runs (hive_id, kind)
  WHERE status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED');

CREATE INDEX IF NOT EXISTS idx_processing_runs__hive_kind_created
  ON hive.processing_runs (hive_id, kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Table hive.study_prompt_previews (write-once; one per successful run)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.study_prompt_previews (
  id uuid DEFAULT gen_random_uuid(),
  processing_run_id uuid NOT NULL,
  hive_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  intent_request_ids uuid[] NOT NULL,
  intent_decomposition jsonb NOT NULL,
  domain_proposal jsonb NOT NULL,
  investigation_plan jsonb NOT NULL,
  sample_coverage jsonb NOT NULL,
  source_snapshot jsonb NOT NULL,
  execution_manifest jsonb NOT NULL,
  stage_metadata jsonb NOT NULL,
  prompt_id text NOT NULL,
  prompt_version text NOT NULL,
  prompt_template_digest text NOT NULL,
  prompt_text text NOT NULL,
  prompt_digest text NOT NULL,
  source_snapshot_digest text NOT NULL,
  intent_snapshot_digest text NOT NULL,
  coverage_digest text NOT NULL,
  coverage_complete boolean NOT NULL,
  superseded_by_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_study_prompt_previews PRIMARY KEY (id),
  CONSTRAINT uq_study_prompt_previews__run UNIQUE (processing_run_id),
  CONSTRAINT fk_study_prompt_previews__processing_runs
    FOREIGN KEY (processing_run_id) REFERENCES hive.processing_runs (id) ON DELETE CASCADE,
  CONSTRAINT fk_study_prompt_previews__hives
    FOREIGN KEY (hive_id, owner_user_id) REFERENCES hive.hives (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT ck_study_prompt_previews__prompt_id CHECK (prompt_id ~ '^[a-z][a-z0-9-]{1,40}/[0-9]{1,4}$'),
  CONSTRAINT ck_study_prompt_previews__prompt_version CHECK (prompt_version ~ '^[0-9]{1,4}$'),
  CONSTRAINT ck_study_prompt_previews__digests CHECK (
    prompt_template_digest ~ '^sha256:[0-9a-f]{64}$'
    AND prompt_digest ~ '^sha256:[0-9a-f]{64}$'
    AND source_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
    AND intent_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
    AND coverage_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_study_prompt_previews__prompt_digest_matches CHECK (
    prompt_digest = 'sha256:' || encode(sha256(convert_to(prompt_text, 'UTF8')), 'hex')
  ),
  CONSTRAINT ck_study_prompt_previews__prompt_text_size CHECK (
    char_length(prompt_text) BETWEEN 1 AND 200000
  ),
  CONSTRAINT ck_study_prompt_previews__json_objects CHECK (
    jsonb_typeof(intent_decomposition) = 'object'
    AND jsonb_typeof(domain_proposal) = 'object'
    AND jsonb_typeof(investigation_plan) = 'object'
    AND jsonb_typeof(sample_coverage) = 'object'
    AND jsonb_typeof(source_snapshot) = 'object'
    AND jsonb_typeof(execution_manifest) = 'object'
    AND jsonb_typeof(stage_metadata) = 'array'
    AND octet_length(execution_manifest::text) <= 262144
  )
);

COMMENT ON TABLE hive.study_prompt_previews IS
  'Immutable prepared Canonical Study prompt (not an accepted Study revision); written once via service-role RPC.';

CREATE INDEX IF NOT EXISTS idx_study_prompt_previews__hive_created
  ON hive.study_prompt_previews (hive_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Transition, identity and immutability guards
-- ---------------------------------------------------------------------------
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
     OR NEW.authorized_source_document_ids IS DISTINCT FROM OLD.authorized_source_document_ids
     OR NEW.intent_request_ids IS DISTINCT FROM OLD.intent_request_ids
     OR NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot
     OR NEW.source_snapshot_digest IS DISTINCT FROM OLD.source_snapshot_digest
     OR NEW.intent_snapshot_digest IS DISTINCT FROM OLD.intent_snapshot_digest
     OR NEW.coverage_digest IS DISTINCT FROM OLD.coverage_digest
     OR NEW.coverage_complete IS DISTINCT FROM OLD.coverage_complete
     OR NEW.coverage_acknowledged IS DISTINCT FROM OLD.coverage_acknowledged
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;

  IF OLD.status IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED') THEN
    RAISE EXCEPTION 'processing_run_finished' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'QUEUED' AND NEW.status IN ('UNDERSTANDING_REQUEST', 'NEEDS_CLARIFICATION', 'FAILED'))
    OR (OLD.status = 'UNDERSTANDING_REQUEST' AND NEW.status IN ('IDENTIFYING_DOMAIN', 'FAILED'))
    OR (OLD.status = 'IDENTIFYING_DOMAIN' AND NEW.status IN ('PLANNING_INVESTIGATION', 'FAILED'))
    OR (OLD.status = 'PLANNING_INVESTIGATION' AND NEW.status IN ('BUILDING_PROMPT', 'FAILED'))
    OR (OLD.status = 'BUILDING_PROMPT' AND NEW.status IN ('SAVING', 'FAILED'))
    OR (OLD.status = 'SAVING' AND NEW.status IN ('SUCCEEDED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'processing_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_processing_runs__transition ON hive.processing_runs;
CREATE TRIGGER trg_processing_runs__transition
  BEFORE UPDATE ON hive.processing_runs
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_processing_run_transition();

-- Previews are write-once; only a NULL superseded_by_run_id may be set once.
CREATE OR REPLACE FUNCTION hive.enforce_study_prompt_preview_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF OLD.superseded_by_run_id IS NULL
     AND NEW.superseded_by_run_id IS NOT NULL
     AND (to_jsonb(NEW) - 'superseded_by_run_id') = (to_jsonb(OLD) - 'superseded_by_run_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'study_prompt_preview_immutable' USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_study_prompt_previews__immutable ON hive.study_prompt_previews;
CREATE TRIGGER trg_study_prompt_previews__immutable
  BEFORE UPDATE ON hive.study_prompt_previews
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_study_prompt_preview_immutable();

-- ---------------------------------------------------------------------------
-- 4. Snapshots (authoritative; computed only in the database)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.sha256_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = hive, public, pg_temp
AS $$
  SELECT 'sha256:' || encode(sha256(convert_to(coalesce(p_text, ''), 'UTF8')), 'hex');
$$;

-- Live documents in the Hive, split into eligible (latest read verified SUCCEEDED/PARTIAL) and
-- excluded, with the physical pages that have no verified row or empty verified text.
CREATE OR REPLACE FUNCTION hive.compute_study_source_snapshot(p_hive_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_documents jsonb;
  v_excluded jsonb;
  v_active integer;
  v_source_digest text;
  v_coverage_digest text;
  v_complete boolean;
BEGIN
  WITH live AS (
    SELECT d.id, d.original_filename, d.mime_type, lower(btrim(d.sha256)) AS sha256,
           d.read_status, d.page_count, d.created_at
      FROM hive.source_documents d
     WHERE d.case_id = p_hive_id
       AND d.lifecycle_status = 'ACTIVE'
       AND d.deleted_at IS NULL
       AND d.upload_status = 'UPLOADED'
  ), latest AS (
    SELECT DISTINCT ON (r.source_document_id) r.*
      FROM hive.document_reads r
      JOIN live l ON l.id = r.source_document_id
     ORDER BY r.source_document_id, r.attempt_number DESC
  ), eligible AS (
    SELECT l.*, lr.id AS read_id, lr.read_fingerprint, lr.page_set_digest,
           coalesce(lr.total_physical_pages, l.page_count, 0) AS total_pages
      FROM live l
      JOIN latest lr ON lr.source_document_id = l.id
     WHERE l.read_status IN ('SUCCEEDED', 'PARTIAL')
       AND lr.status IN ('SUCCEEDED', 'PARTIAL')
       AND lr.read_fingerprint IS NOT NULL
       AND lr.page_set_digest IS NOT NULL
  )
  SELECT
    coalesce((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'sourceDocumentId', e.id,
                 'fileName', e.original_filename,
                 'mimeType', e.mime_type,
                 'sha256', e.sha256,
                 'readId', e.read_id,
                 'readStatus', e.read_status,
                 'readFingerprint', e.read_fingerprint,
                 'pageSetDigest', e.page_set_digest,
                 'totalPhysicalPages', e.total_pages,
                 'verifiedPageCount', (
                   SELECT count(*) FROM hive.document_pages p
                    WHERE p.source_document_id = e.id AND p.page_set_digest = e.page_set_digest
                 ),
                 'missingPageNumbers', coalesce((
                   SELECT jsonb_agg(n ORDER BY n)
                     FROM generate_series(1, greatest(e.total_pages, 0)) AS n
                    WHERE NOT EXISTS (
                      SELECT 1 FROM hive.document_pages p
                       WHERE p.source_document_id = e.id
                         AND p.page_set_digest = e.page_set_digest
                         AND p.page_number = n
                    )
                 ), '[]'::jsonb),
                 'emptyPageNumbers', coalesce((
                   SELECT jsonb_agg(p.page_number ORDER BY p.page_number)
                     FROM hive.document_pages p
                    WHERE p.source_document_id = e.id
                      AND p.page_set_digest = e.page_set_digest
                      AND p.page_text ~ '^\s*$'
                 ), '[]'::jsonb),
                 'createdAt', e.created_at
               )
               ORDER BY e.created_at, e.id
             )
        FROM eligible e
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'sourceDocumentId', l.id,
                 'fileName', l.original_filename,
                 'reason', CASE
                   WHEN lr.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING') THEN 'READ_ACTIVE'
                   WHEN l.read_status = 'FAILED' THEN 'READ_FAILED'
                   WHEN l.read_status = 'UNREADABLE' THEN 'UNREADABLE'
                   ELSE 'NOT_READ'
                 END
               )
               ORDER BY l.created_at, l.id
             )
        FROM live l
        LEFT JOIN latest lr ON lr.source_document_id = l.id
       WHERE NOT EXISTS (SELECT 1 FROM eligible e WHERE e.id = l.id)
    ), '[]'::jsonb),
    (SELECT count(*)::integer FROM latest lr
      WHERE lr.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING'))
  INTO v_documents, v_excluded, v_active;

  SELECT hive.sha256_text(coalesce(string_agg(
           (d ->> 'sourceDocumentId') || ':' || (d ->> 'sha256') || ':' ||
           (d ->> 'readFingerprint') || ':' || (d ->> 'pageSetDigest'),
           E'\n' ORDER BY d ->> 'sourceDocumentId'), ''))
    INTO v_source_digest
    FROM jsonb_array_elements(v_documents) d;

  SELECT hive.sha256_text(jsonb_build_object(
           'sourceSnapshotDigest', v_source_digest,
           'excluded', coalesce((
             SELECT jsonb_agg(jsonb_build_object('id', x ->> 'sourceDocumentId', 'reason', x ->> 'reason')
                              ORDER BY x ->> 'sourceDocumentId')
               FROM jsonb_array_elements(v_excluded) x), '[]'::jsonb),
           'gaps', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', d ->> 'sourceDocumentId',
                      'readStatus', d ->> 'readStatus',
                      'missing', d -> 'missingPageNumbers',
                      'empty', d -> 'emptyPageNumbers')
                    ORDER BY d ->> 'sourceDocumentId')
               FROM jsonb_array_elements(v_documents) d), '[]'::jsonb)
         )::text)
    INTO v_coverage_digest;

  v_complete := jsonb_array_length(v_documents) > 0
    AND jsonb_array_length(v_excluded) = 0
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_documents) d
       WHERE d ->> 'readStatus' <> 'SUCCEEDED'
          OR jsonb_array_length(d -> 'missingPageNumbers') > 0
          OR jsonb_array_length(d -> 'emptyPageNumbers') > 0
    );

  RETURN jsonb_build_object(
    'documents', v_documents,
    'excluded', v_excluded,
    'activeReadCount', v_active,
    'sourceSnapshotDigest', v_source_digest,
    'coverageDigest', v_coverage_digest,
    'coverageComplete', v_complete
  );
END;
$$;

CREATE OR REPLACE FUNCTION hive.compute_study_intent_snapshot(p_hive_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = hive, public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'intentRequestIds', coalesce(jsonb_agg(i.id ORDER BY i.created_at, i.id), '[]'::jsonb),
    'intentSnapshotDigest', hive.sha256_text(coalesce(string_agg(
      i.id::text || ':' || hive.sha256_text(i.intent_text), E'\n' ORDER BY i.created_at, i.id), ''))
  )
    FROM hive.intent_requests i
    JOIN hive.hives h ON h.id = i.hive_id AND h.owner_user_id = i.owner_user_id
   WHERE i.hive_id = p_hive_id;
$$;

CREATE OR REPLACE FUNCTION hive.processing_run_snapshot_current(r hive.processing_runs)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = hive, public, pg_temp
AS $$
  SELECT (hive.compute_study_source_snapshot(r.hive_id) ->> 'sourceSnapshotDigest') = r.source_snapshot_digest
     AND (hive.compute_study_intent_snapshot(r.hive_id) ->> 'intentSnapshotDigest') = r.intent_snapshot_digest;
$$;

-- Why a saved preview no longer matches the Hive's current sources or intents.
CREATE OR REPLACE FUNCTION hive.study_prompt_preview_staleness(p hive.study_prompt_previews)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_current jsonb := hive.compute_study_source_snapshot(p.hive_id);
  v_intents jsonb := hive.compute_study_intent_snapshot(p.hive_id);
  v_reasons jsonb;
BEGIN
  WITH frozen AS (
    SELECT d ->> 'sourceDocumentId' AS id, d ->> 'readFingerprint' AS fp, d ->> 'pageSetDigest' AS digest
      FROM jsonb_array_elements(p.source_snapshot -> 'documents') d
  ), frozen_excluded AS (
    SELECT x ->> 'sourceDocumentId' AS id FROM jsonb_array_elements(p.source_snapshot -> 'excluded') x
  ), current_docs AS (
    SELECT d ->> 'sourceDocumentId' AS id, d ->> 'readFingerprint' AS fp, d ->> 'pageSetDigest' AS digest
      FROM jsonb_array_elements(v_current -> 'documents') d
  ), current_live AS (
    SELECT id FROM current_docs
    UNION
    SELECT x ->> 'sourceDocumentId' FROM jsonb_array_elements(v_current -> 'excluded') x
  ), reasons AS (
    SELECT 'DOCUMENT_REMOVED' AS kind, f.id
      FROM frozen f WHERE NOT EXISTS (SELECT 1 FROM current_live c WHERE c.id = f.id)
    UNION ALL
    SELECT 'DOCUMENT_READ_CHANGED', f.id
      FROM frozen f
     WHERE EXISTS (SELECT 1 FROM current_live c WHERE c.id = f.id)
       AND NOT EXISTS (
         SELECT 1 FROM current_docs c WHERE c.id = f.id AND c.fp = f.fp AND c.digest = f.digest
       )
    UNION ALL
    SELECT 'DOCUMENT_ADDED', c.id
      FROM current_docs c
     WHERE NOT EXISTS (SELECT 1 FROM frozen f WHERE f.id = c.id)
    UNION ALL
    SELECT 'DOCUMENT_ADDED', c.id
      FROM current_live c
     WHERE NOT EXISTS (SELECT 1 FROM frozen f WHERE f.id = c.id)
       AND NOT EXISTS (SELECT 1 FROM frozen_excluded x WHERE x.id = c.id)
       AND NOT EXISTS (SELECT 1 FROM current_docs d WHERE d.id = c.id)
    UNION ALL
    SELECT 'INTENT_ADDED', NULL
     WHERE (v_intents ->> 'intentSnapshotDigest') <> p.intent_snapshot_digest
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'sourceDocumentId', id)
                            ORDER BY kind, id), '[]'::jsonb)
    INTO v_reasons
    FROM reasons;

  RETURN jsonb_build_object('stale', jsonb_array_length(v_reasons) > 0, 'reasons', v_reasons);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Internal helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.expire_stale_processing_runs(p_hive_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_expired integer;
BEGIN
  UPDATE hive.processing_runs r
     SET status = 'FAILED',
         error_code = 'PREPARATION_INTERRUPTED',
         error_message_safe = 'Preparation stopped before it finished. You can try again.',
         retryable = true,
         lease_expires_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     AND r.lease_expires_at IS NOT NULL
     AND r.lease_expires_at < now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$$;

-- Stage metrics carry identifiers, counts and codes only (no free text).
CREATE OR REPLACE FUNCTION hive.is_valid_stage_metric(p_metric jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT coalesce(jsonb_typeof(p_metric) = 'object', false)
     AND coalesce(p_metric ->> 'stage' IN ('UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN', 'PLANNING_INVESTIGATION'), false)
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(p_metric) kv
        WHERE kv.key NOT IN (
                'stage', 'outcome', 'promptId', 'promptDigest', 'modelAliasRequested', 'resolvedModel',
                'promptTokens', 'completionTokens', 'totalTokens', 'latencyMs', 'plannerLatencyMs',
                'finishReason', 'startedAt', 'completedAt', 'errorCode', 'retryable'
              )
           OR (kv.key IN ('promptTokens', 'completionTokens', 'totalTokens', 'latencyMs', 'plannerLatencyMs')
               AND NOT (jsonb_typeof(kv.value) = 'null'
                        OR (jsonb_typeof(kv.value) = 'number'
                            AND (kv.value #>> '{}') ~ '^[0-9]{1,10}$')))
           OR (kv.key = 'retryable' AND jsonb_typeof(kv.value) NOT IN ('boolean', 'null'))
           OR (kv.key NOT IN ('promptTokens', 'completionTokens', 'totalTokens', 'latencyMs',
                              'plannerLatencyMs', 'retryable')
               AND NOT (jsonb_typeof(kv.value) = 'null'
                        OR (jsonb_typeof(kv.value) = 'string'
                            AND (kv.value #>> '{}') ~ '^[A-Za-z0-9_.:/@+-]{1,128}$')))
     );
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
    'authorizedSourceDocumentIds', to_json(r.authorized_source_document_ids),
    'intentRequestIds', to_json(r.intent_request_ids),
    'coverageComplete', r.coverage_complete,
    'coverageAcknowledged', r.coverage_acknowledged,
    'stageMetrics', r.stage_metrics,
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

CREATE OR REPLACE FUNCTION hive.study_prompt_preview_json(p hive.study_prompt_previews)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, public, pg_temp
AS $$
  SELECT json_build_object(
    'id', p.id,
    'processingRunId', p.processing_run_id,
    'hiveId', p.hive_id,
    'intentRequestIds', to_json(p.intent_request_ids),
    'intentDecomposition', p.intent_decomposition,
    'domainProposal', p.domain_proposal,
    'investigationPlan', p.investigation_plan,
    'sampleCoverage', p.sample_coverage,
    'sourceSnapshot', p.source_snapshot,
    'executionManifest', p.execution_manifest,
    'stageMetadata', p.stage_metadata,
    'promptId', p.prompt_id,
    'promptVersion', p.prompt_version,
    'promptTemplateDigest', p.prompt_template_digest,
    'promptText', p.prompt_text,
    'promptDigest', p.prompt_digest,
    'sourceSnapshotDigest', p.source_snapshot_digest,
    'intentSnapshotDigest', p.intent_snapshot_digest,
    'coverageComplete', p.coverage_complete,
    'supersededByRunId', p.superseded_by_run_id,
    'createdAt', p.created_at
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. Owner RPCs (authenticated)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_study_preparation(
  p_hive_id uuid,
  p_request_id uuid,
  p_correlation_id uuid,
  p_coverage_acknowledgement_digest text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run hive.processing_runs%ROWTYPE;
  v_sources jsonb;
  v_intents jsonb;
  v_ack text := lower(nullif(btrim(coalesce(p_coverage_acknowledgement_digest, '')), ''));
  v_attempt integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
      AND h.owner_user_id = v_uid
      AND h.archived_at IS NULL
      AND h.deleting_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM hive.expire_stale_document_reads(p_hive_id);
  PERFORM hive.expire_stale_processing_runs(p_hive_id);

  -- Replay of the same click returns the same run.
  SELECT * INTO v_run FROM hive.processing_runs
   WHERE owner_user_id = v_uid AND request_id = p_request_id;
  IF FOUND THEN
    IF v_run.hive_id <> p_hive_id THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'created', false);
  END IF;

  -- A different click while a run is active returns the active run.
  SELECT * INTO v_run FROM hive.processing_runs
   WHERE hive_id = p_hive_id
     AND kind = 'STUDY_PREPARATION'
     AND status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED');
  IF FOUND THEN
    RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'created', false);
  END IF;

  v_sources := hive.compute_study_source_snapshot(p_hive_id);
  IF (v_sources ->> 'activeReadCount')::integer > 0 THEN
    RAISE EXCEPTION 'document_read_active' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(v_sources -> 'documents') = 0 THEN
    RAISE EXCEPTION 'no_eligible_documents' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (v_sources ->> 'coverageComplete')::boolean
     AND v_ack IS DISTINCT FROM (v_sources ->> 'coverageDigest') THEN
    RAISE EXCEPTION 'coverage_unacknowledged' USING ERRCODE = 'P0001';
  END IF;

  v_intents := hive.compute_study_intent_snapshot(p_hive_id);

  SELECT coalesce(max(r.attempt_number), 0) + 1 INTO v_attempt
    FROM hive.processing_runs r
   WHERE r.hive_id = p_hive_id AND r.kind = 'STUDY_PREPARATION';

  INSERT INTO hive.processing_runs (
    hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
    lease_expires_at, authorized_source_document_ids, intent_request_ids, source_snapshot,
    source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
    coverage_acknowledged, error_code, error_message_safe, retryable, finished_at
  )
  VALUES (
    p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt,
    CASE WHEN jsonb_array_length(v_intents -> 'intentRequestIds') = 0 THEN 'NEEDS_CLARIFICATION' ELSE 'QUEUED' END,
    p_correlation_id,
    CASE WHEN jsonb_array_length(v_intents -> 'intentRequestIds') = 0 THEN NULL ELSE now() + interval '330 seconds' END,
    ARRAY(SELECT (d ->> 'sourceDocumentId')::uuid FROM jsonb_array_elements(v_sources -> 'documents') d),
    ARRAY(SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_intents -> 'intentRequestIds') x),
    jsonb_build_object(
      'documents', v_sources -> 'documents',
      'excluded', v_sources -> 'excluded',
      'coverageComplete', v_sources -> 'coverageComplete'
    ),
    v_sources ->> 'sourceSnapshotDigest',
    v_intents ->> 'intentSnapshotDigest',
    v_sources ->> 'coverageDigest',
    (v_sources ->> 'coverageComplete')::boolean,
    NOT (v_sources ->> 'coverageComplete')::boolean,
    CASE WHEN jsonb_array_length(v_intents -> 'intentRequestIds') = 0 THEN 'INTENT_MISSING' END,
    CASE WHEN jsonb_array_length(v_intents -> 'intentRequestIds') = 0
      THEN 'Tell us what you want to understand from these documents, then analyze again.' END,
    CASE WHEN jsonb_array_length(v_intents -> 'intentRequestIds') = 0 THEN true END,
    CASE WHEN jsonb_array_length(v_intents -> 'intentRequestIds') = 0 THEN now() END
  )
  RETURNING * INTO v_run;

  RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'created', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_study_preparation(
  p_hive_id uuid,
  p_include_preview boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run hive.processing_runs%ROWTYPE;
  v_preview hive.study_prompt_previews%ROWTYPE;
  v_sources jsonb;
  v_has_run boolean;
  v_has_preview boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hive.hives h
     WHERE h.id = p_hive_id
       AND h.owner_user_id = v_uid
       AND h.archived_at IS NULL
       AND h.deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM hive.expire_stale_document_reads(p_hive_id);
  PERFORM hive.expire_stale_processing_runs(p_hive_id);

  SELECT * INTO v_run FROM hive.processing_runs
   WHERE hive_id = p_hive_id AND kind = 'STUDY_PREPARATION'
   ORDER BY attempt_number DESC
   LIMIT 1;
  v_has_run := FOUND;

  SELECT * INTO v_preview FROM hive.study_prompt_previews p
   WHERE p.hive_id = p_hive_id
     AND EXISTS (SELECT 1 FROM hive.processing_runs r WHERE r.id = p.processing_run_id AND r.status = 'SUCCEEDED')
   ORDER BY p.created_at DESC, p.id DESC
   LIMIT 1;
  v_has_preview := FOUND;

  v_sources := hive.compute_study_source_snapshot(p_hive_id);

  RETURN json_build_object(
    'processingRun', CASE WHEN v_has_run THEN hive.processing_run_json(v_run) END,
    'preview', CASE WHEN v_has_preview AND p_include_preview THEN hive.study_prompt_preview_json(v_preview) END,
    'previewSummary', CASE WHEN v_has_preview THEN json_build_object(
      'id', v_preview.id,
      'processingRunId', v_preview.processing_run_id,
      'createdAt', v_preview.created_at
    ) END,
    'staleness', CASE WHEN v_has_preview THEN hive.study_prompt_preview_staleness(v_preview) END,
    'eligibility', json_build_object(
      'documents', v_sources -> 'documents',
      'excluded', v_sources -> 'excluded',
      'activeReadCount', v_sources -> 'activeReadCount',
      'coverageComplete', v_sources -> 'coverageComplete',
      'coverageDigest', v_sources -> 'coverageDigest'
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Server RPCs (service_role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_processing_run(
  p_run_id uuid,
  p_from_status text,
  p_to_status text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_to text := upper(btrim(coalesce(p_to_status, '')));
  v_from text := upper(btrim(coalesce(p_from_status, '')));
  v_terminal boolean;
  v_outputs jsonb;
  v_metrics jsonb;
  v_output_key text;
  v_message text;
  v_digest text;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_details) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_run.status <> v_from THEN
    RETURN json_build_object('applied', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  v_terminal := v_to IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED');

  IF v_to <> 'FAILED' AND EXISTS (
    SELECT 1 FROM hive.hives h
     WHERE h.id = v_run.hive_id AND (h.deleting_at IS NOT NULL OR h.archived_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Frozen sources or intents changed: fail the run atomically.
  IF v_to <> 'FAILED' AND NOT hive.processing_run_snapshot_current(v_run) THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'SOURCE_CHANGED',
           error_message_safe = 'Your documents or request changed while preparing. Analyze again to use the latest versions.',
           retryable = true,
           lease_expires_at = NULL,
           finished_at = now()
     WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('applied', false, 'sourceChanged', true,
                             'processingRun', hive.processing_run_json(v_run));
  END IF;

  v_outputs := v_run.stage_outputs;
  IF v_details ? 'stage_outputs' THEN
    IF jsonb_typeof(v_details -> 'stage_outputs') <> 'object' THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
    FOR v_output_key IN SELECT jsonb_object_keys(v_details -> 'stage_outputs') LOOP
      IF v_output_key NOT IN ('intentDecomposition', 'domainProposal', 'sampleCoverage', 'investigationPlan')
         OR jsonb_typeof(v_details -> 'stage_outputs' -> v_output_key) <> 'object' THEN
        RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
      END IF;
      IF v_outputs ? v_output_key THEN
        RAISE EXCEPTION 'stage_output_exists' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    v_outputs := v_outputs || (v_details -> 'stage_outputs');
  END IF;

  v_metrics := v_run.stage_metrics;
  IF v_details ? 'stage_metric' THEN
    IF NOT hive.is_valid_stage_metric(v_details -> 'stage_metric') THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
    v_metrics := v_metrics || jsonb_build_array(v_details -> 'stage_metric');
  END IF;

  -- Each stage may start only once the previous stage's validated output is saved.
  IF (v_to = 'IDENTIFYING_DOMAIN' AND NOT v_outputs ? 'intentDecomposition')
     OR (v_to = 'PLANNING_INVESTIGATION' AND NOT (v_outputs ? 'domainProposal' AND v_outputs ? 'sampleCoverage'))
     OR (v_to = 'BUILDING_PROMPT' AND NOT v_outputs ? 'investigationPlan') THEN
    RAISE EXCEPTION 'stage_output_missing' USING ERRCODE = 'P0001';
  END IF;

  IF v_to = 'SUCCEEDED' THEN
    v_digest := lower(btrim(coalesce(v_details ->> 'prompt_digest', '')));
    IF NOT EXISTS (
      SELECT 1 FROM hive.study_prompt_previews p
       WHERE p.processing_run_id = v_run.id AND p.prompt_digest = v_digest
    ) THEN
      RAISE EXCEPTION 'preview_not_saved' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_message := nullif(left(btrim(coalesce(v_details ->> 'error_message_safe', '')), 300), '');

  UPDATE hive.processing_runs
     SET status = v_to,
         started_at = CASE WHEN v_to = 'UNDERSTANDING_REQUEST' THEN now() ELSE started_at END,
         lease_expires_at = CASE WHEN v_terminal THEN NULL ELSE now() + interval '180 seconds' END,
         finished_at = CASE WHEN v_terminal THEN now() ELSE NULL END,
         stage_outputs = v_outputs,
         stage_metrics = v_metrics,
         error_code = CASE WHEN v_terminal THEN nullif(btrim(v_details ->> 'error_code'), '') ELSE error_code END,
         error_message_safe = CASE WHEN v_terminal THEN v_message ELSE error_message_safe END,
         retryable = CASE WHEN v_terminal THEN (v_details ->> 'retryable')::boolean ELSE retryable END
   WHERE id = p_run_id
  RETURNING * INTO v_run;

  IF v_to = 'SUCCEEDED' THEN
    UPDATE hive.study_prompt_previews
       SET superseded_by_run_id = v_run.id
     WHERE hive_id = v_run.hive_id
       AND processing_run_id <> v_run.id
       AND superseded_by_run_id IS NULL;
  END IF;

  RETURN json_build_object('applied', true, 'processingRun', hive.processing_run_json(v_run));
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

-- Frozen inputs for the worker: the run, the frozen intents in order, and whether the frozen
-- snapshot still matches the Hive.
CREATE OR REPLACE FUNCTION public.get_study_preparation_inputs(p_run_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN json_build_object(
    'processingRun', hive.processing_run_json(v_run),
    'ownerUserId', v_run.owner_user_id,
    'sourceSnapshot', v_run.source_snapshot,
    'sourceSnapshotDigest', v_run.source_snapshot_digest,
    'intentSnapshotDigest', v_run.intent_snapshot_digest,
    'coverageDigest', v_run.coverage_digest,
    'stageOutputs', v_run.stage_outputs,
    'snapshotCurrent', hive.processing_run_snapshot_current(v_run),
    'intents', coalesce((
      SELECT json_agg(json_build_object('id', i.id, 'intentText', i.intent_text, 'createdAt', i.created_at)
                      ORDER BY i.created_at, i.id)
        FROM hive.intent_requests i
       WHERE i.hive_id = v_run.hive_id
         AND i.owner_user_id = v_run.owner_user_id
         AND i.id = ANY (v_run.intent_request_ids)
    ), '[]'::json)
  );
END;
$$;

-- Write-once preview. Validated stage outputs, snapshots and metrics come from the run itself;
-- the caller supplies only the deterministic prompt artifacts.
CREATE OR REPLACE FUNCTION public.save_study_prompt_preview(p_run_id uuid, p_preview jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_preview hive.study_prompt_previews%ROWTYPE;
  v_digest text := lower(btrim(coalesce(p_preview ->> 'prompt_digest', '')));
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_preview, 'null'::jsonb)) <> 'object'
     OR jsonb_typeof(p_preview -> 'execution_manifest') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_preview -> 'prompt_text') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_preview FROM hive.study_prompt_previews WHERE processing_run_id = p_run_id;
  IF FOUND THEN
    IF v_preview.prompt_digest <> v_digest THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN json_build_object('created', false, 'preview', hive.study_prompt_preview_json(v_preview));
  END IF;

  IF v_run.status <> 'SAVING' THEN
    RAISE EXCEPTION 'processing_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (v_run.stage_outputs ?& ARRAY['intentDecomposition', 'domainProposal', 'sampleCoverage', 'investigationPlan']) THEN
    RAISE EXCEPTION 'stage_output_missing' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO hive.study_prompt_previews (
    processing_run_id, hive_id, owner_user_id, intent_request_ids,
    intent_decomposition, domain_proposal, investigation_plan, sample_coverage,
    source_snapshot, execution_manifest, stage_metadata,
    prompt_id, prompt_version, prompt_template_digest, prompt_text, prompt_digest,
    source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete
  )
  VALUES (
    v_run.id, v_run.hive_id, v_run.owner_user_id, v_run.intent_request_ids,
    v_run.stage_outputs -> 'intentDecomposition',
    v_run.stage_outputs -> 'domainProposal',
    v_run.stage_outputs -> 'investigationPlan',
    v_run.stage_outputs -> 'sampleCoverage',
    v_run.source_snapshot,
    p_preview -> 'execution_manifest',
    v_run.stage_metrics,
    p_preview ->> 'prompt_id',
    p_preview ->> 'prompt_version',
    lower(p_preview ->> 'prompt_template_digest'),
    p_preview ->> 'prompt_text',
    v_digest,
    v_run.source_snapshot_digest,
    v_run.intent_snapshot_digest,
    v_run.coverage_digest,
    v_run.coverage_complete
  )
  RETURNING * INTO v_preview;

  RETURN json_build_object('created', true, 'preview', hive.study_prompt_preview_json(v_preview));
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

-- Readback for verification before SUCCEEDED.
CREATE OR REPLACE FUNCTION public.read_study_prompt_preview(p_run_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_preview hive.study_prompt_previews%ROWTYPE;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_preview FROM hive.study_prompt_previews WHERE processing_run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN json_build_object('found', false);
  END IF;
  RETURN json_build_object('found', true, 'preview', hive.study_prompt_preview_json(v_preview));
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Row-Level Security & least-privilege grants
-- ---------------------------------------------------------------------------
ALTER TABLE hive.processing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.processing_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.study_prompt_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.study_prompt_previews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_processing_runs__select__owner ON hive.processing_runs;
CREATE POLICY pol_processing_runs__select__owner
  ON hive.processing_runs
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = processing_runs.hive_id
         AND h.owner_user_id = auth.uid()
         AND h.archived_at IS NULL
         AND h.deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS pol_study_prompt_previews__select__owner ON hive.study_prompt_previews;
CREATE POLICY pol_study_prompt_previews__select__owner
  ON hive.study_prompt_previews
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = study_prompt_previews.hive_id
         AND h.owner_user_id = auth.uid()
         AND h.archived_at IS NULL
         AND h.deleting_at IS NULL
    )
  );

REVOKE ALL ON hive.processing_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hive.processing_runs TO authenticated;
GRANT ALL ON hive.processing_runs TO service_role;

REVOKE ALL ON hive.study_prompt_previews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hive.study_prompt_previews TO authenticated;
GRANT ALL ON hive.study_prompt_previews TO service_role;

REVOKE ALL ON FUNCTION hive.enforce_processing_run_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.enforce_study_prompt_preview_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.sha256_text(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.compute_study_source_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.compute_study_intent_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.processing_run_snapshot_current(hive.processing_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.study_prompt_preview_staleness(hive.study_prompt_previews) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.expire_stale_processing_runs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.is_valid_stage_metric(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.processing_run_json(hive.processing_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.study_prompt_preview_json(hive.study_prompt_previews) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.start_study_preparation(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_study_preparation(uuid, uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_study_preparation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_preparation(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.transition_processing_run(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_processing_run(uuid, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.get_study_preparation_inputs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_study_preparation_inputs(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.save_study_prompt_preview(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_study_prompt_preview(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.read_study_prompt_preview(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_study_prompt_preview(uuid) TO service_role;

COMMIT;
