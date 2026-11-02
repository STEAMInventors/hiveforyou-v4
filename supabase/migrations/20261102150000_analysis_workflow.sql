-- V4-004 — End-to-end Analyze workflow: Reader → preparation → Canonical Study → two Writer reports (D-041).
--
-- Additive to 20261102090000 and 20261102120000:
--   * hive.processing_runs gains READING_DOCUMENTS (reads queued by Analyze, snapshot frozen only
--     after they finish), INVESTIGATING / VERIFYING_EVIDENCE / ACCEPTING_STUDY, a per-stage attempt
--     counter (max 3) and next_dispatch_at. Each stage is claimed with a lease; a lapsed lease is a
--     new attempt, not a failure. SUCCEEDED is reached only through accept_study_revision.
--   * hive.canonical_studies (one per Hive, pointer to the current revision) and immutable
--     hive.study_revisions (validated investigation JSONB + trusted verification).
--   * hive.report_runs: independent CUSTOMER and PRO Writer runs (max 3 attempts each) queued in the
--     same transaction that accepts a revision; immutable hive.reports with scenario results and the
--     bound A2UI view. Writer failures never touch the revision.
--   * public.dispatch_due_work(): pg_cron (every minute) + pg_net recovery sweeper posting due work
--     to the web server's internal worker route, with the URL and bearer token read from Vault.
--
-- Prerequisites on the Supabase project (founder approval): pg_cron, pg_net and supabase_vault
-- enabled; Vault secrets `hive_internal_worker_url` and `hive_internal_worker_token`.
-- Authority: HiveForYou-DATA-MODEL.md, HiveForYou-DECISIONS.md (D-039, D-040, D-041).
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ---------------------------------------------------------------------------
-- 1. processing_runs: deferred snapshot, new stages, stage attempts
-- ---------------------------------------------------------------------------
ALTER TABLE hive.processing_runs ALTER COLUMN authorized_source_document_ids DROP NOT NULL;
ALTER TABLE hive.processing_runs ALTER COLUMN source_snapshot DROP NOT NULL;
ALTER TABLE hive.processing_runs ALTER COLUMN source_snapshot_digest DROP NOT NULL;
ALTER TABLE hive.processing_runs ALTER COLUMN coverage_digest DROP NOT NULL;
ALTER TABLE hive.processing_runs ALTER COLUMN coverage_complete DROP NOT NULL;

ALTER TABLE hive.processing_runs ADD COLUMN IF NOT EXISTS stage_attempt integer NOT NULL DEFAULT 1;
ALTER TABLE hive.processing_runs ADD COLUMN IF NOT EXISTS next_dispatch_at timestamptz;
ALTER TABLE hive.processing_runs ADD COLUMN IF NOT EXISTS snapshot_frozen_at timestamptz;
-- Coverage of the frozen snapshot (B5): COMPLETE, NONMATERIAL_GAPS (proceeds with visible limitations)
-- or MATERIAL_GAPS (needs an acknowledgement: PRIOR = every gap was acknowledged before in this Hive,
-- OWNER = acknowledged for this run, PENDING = the run waits in AWAITING_ACKNOWLEDGEMENT).
ALTER TABLE hive.processing_runs ADD COLUMN IF NOT EXISTS coverage_status text;
ALTER TABLE hive.processing_runs ADD COLUMN IF NOT EXISTS coverage_gaps jsonb;
ALTER TABLE hive.processing_runs ADD COLUMN IF NOT EXISTS coverage_acknowledgement text;
ALTER TABLE hive.processing_runs ADD COLUMN IF NOT EXISTS coverage_acknowledged_at timestamptz;

-- Backfills touch finished runs, which the transition trigger (rightly) refuses to update.
ALTER TABLE hive.processing_runs DISABLE TRIGGER trg_processing_runs__transition;
UPDATE hive.processing_runs SET snapshot_frozen_at = created_at
 WHERE snapshot_frozen_at IS NULL AND source_snapshot IS NOT NULL;
ALTER TABLE hive.processing_runs ENABLE TRIGGER trg_processing_runs__transition;

ALTER TABLE hive.processing_runs DROP CONSTRAINT IF EXISTS ck_processing_runs__status;
ALTER TABLE hive.processing_runs ADD CONSTRAINT ck_processing_runs__status CHECK (
  status IN (
    'QUEUED', 'READING_DOCUMENTS', 'AWAITING_ACKNOWLEDGEMENT', 'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN',
    'DEVELOPING_QUESTIONS', 'PLANNING_INVESTIGATION', 'BUILDING_PROMPT', 'SAVING', 'INVESTIGATING',
    'VERIFYING_EVIDENCE', 'ACCEPTING_STUDY', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED'
  )
);

ALTER TABLE hive.processing_runs DROP CONSTRAINT IF EXISTS ck_processing_runs__stage_outputs;
ALTER TABLE hive.processing_runs ADD CONSTRAINT ck_processing_runs__stage_outputs CHECK (
  jsonb_typeof(stage_outputs) = 'object' AND octet_length(stage_outputs::text) <= 2097152
);

ALTER TABLE hive.processing_runs DROP CONSTRAINT IF EXISTS ck_processing_runs__stage_metrics;
ALTER TABLE hive.processing_runs ADD CONSTRAINT ck_processing_runs__stage_metrics CHECK (
  jsonb_typeof(stage_metrics) = 'array' AND jsonb_array_length(stage_metrics) <= 48
);

ALTER TABLE hive.processing_runs DROP CONSTRAINT IF EXISTS ck_processing_runs__stage_attempt;
ALTER TABLE hive.processing_runs ADD CONSTRAINT ck_processing_runs__stage_attempt CHECK (stage_attempt BETWEEN 1 AND 3);

-- The source snapshot is all-or-nothing and must exist before any model stage.
ALTER TABLE hive.processing_runs DROP CONSTRAINT IF EXISTS ck_processing_runs__snapshot_frozen;
ALTER TABLE hive.processing_runs ADD CONSTRAINT ck_processing_runs__snapshot_frozen CHECK (
  ((source_snapshot IS NULL) = (source_snapshot_digest IS NULL))
  AND ((source_snapshot IS NULL) = (coverage_digest IS NULL))
  AND ((source_snapshot IS NULL) = (coverage_complete IS NULL))
  AND ((source_snapshot IS NULL) = (authorized_source_document_ids IS NULL))
  AND ((source_snapshot IS NULL) = (snapshot_frozen_at IS NULL))
  AND (source_snapshot IS NOT NULL OR status IN ('QUEUED', 'READING_DOCUMENTS', 'NEEDS_CLARIFICATION', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_processing_runs__due
  ON hive.processing_runs (next_dispatch_at)
  WHERE status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED');

-- Coverage gaps of a source snapshot ({documents, excluded}), classified deterministically.
-- Material: a document Hive could not use at all, a partial read, pages without a verified row, empty
-- pages in a partial read, or a document whose every verified page is empty. Nonmaterial: some empty
-- pages in an otherwise complete read (for example blank separator pages). Each key is bound to the
-- read it describes (page-set digest), so a re-read that changes the gap needs a new acknowledgement.
CREATE OR REPLACE FUNCTION hive.classify_coverage_gaps(p_sources jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(g ORDER BY g ->> 'key'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
               'key', 'EXCLUDED:' || (x ->> 'sourceDocumentId') || ':' || (x ->> 'reason'),
               'sourceDocumentId', x ->> 'sourceDocumentId',
               'fileName', x ->> 'fileName',
               'reason', x ->> 'reason',
               'pageNumbers', '[]'::jsonb,
               'material', true
             ) AS g
        FROM jsonb_array_elements(coalesce(p_sources -> 'excluded', '[]'::jsonb)) x
      UNION ALL
      SELECT jsonb_build_object(
               'key', r.reason || ':' || (d ->> 'sourceDocumentId') || ':' || (d ->> 'pageSetDigest'),
               'sourceDocumentId', d ->> 'sourceDocumentId',
               'fileName', d ->> 'fileName',
               'reason', r.reason,
               'pageNumbers', coalesce(d -> 'missingPageNumbers', '[]'::jsonb),
               'material', true
             )
        FROM jsonb_array_elements(coalesce(p_sources -> 'documents', '[]'::jsonb)) d
        CROSS JOIN LATERAL (
          SELECT CASE WHEN jsonb_array_length(coalesce(d -> 'missingPageNumbers', '[]'::jsonb)) > 0
                      THEN 'PAGES_NOT_READ' ELSE 'PARTIAL_READ' END AS reason
        ) r
       WHERE d ->> 'readStatus' <> 'SUCCEEDED'
          OR jsonb_array_length(coalesce(d -> 'missingPageNumbers', '[]'::jsonb)) > 0
      UNION ALL
      SELECT jsonb_build_object(
               'key', e.reason || ':' || (d ->> 'sourceDocumentId') || ':' || (d ->> 'pageSetDigest'),
               'sourceDocumentId', d ->> 'sourceDocumentId',
               'fileName', d ->> 'fileName',
               'reason', e.reason,
               'pageNumbers', d -> 'emptyPageNumbers',
               'material', e.reason = 'NO_TEXT' OR d ->> 'readStatus' <> 'SUCCEEDED'
             )
        FROM jsonb_array_elements(coalesce(p_sources -> 'documents', '[]'::jsonb)) d
        CROSS JOIN LATERAL (
          SELECT CASE WHEN coalesce((d ->> 'verifiedPageCount')::integer, 0) > 0
                       AND jsonb_array_length(d -> 'emptyPageNumbers') >= (d ->> 'verifiedPageCount')::integer
                      THEN 'NO_TEXT' ELSE 'PAGES_WITHOUT_TEXT' END AS reason
        ) e
       WHERE jsonb_array_length(coalesce(d -> 'emptyPageNumbers', '[]'::jsonb)) > 0
    ) gaps;
$$;

CREATE OR REPLACE FUNCTION hive.coverage_status_for(p_gaps jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT CASE
    WHEN jsonb_array_length(coalesce(p_gaps, '[]'::jsonb)) = 0 THEN 'COMPLETE'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(p_gaps) g WHERE (g ->> 'material')::boolean) THEN 'MATERIAL_GAPS'
    ELSE 'NONMATERIAL_GAPS'
  END;
$$;

-- What the owner has acknowledged in this Hive, one row per material gap. Reused by later runs:
-- a gap acknowledged once is not asked about again while the same read still describes it.
CREATE TABLE IF NOT EXISTS hive.coverage_acknowledgements (
  id uuid DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  gap_key text NOT NULL,
  reason text NOT NULL,
  processing_run_id uuid NOT NULL,
  coverage_digest text NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_coverage_acknowledgements PRIMARY KEY (id),
  CONSTRAINT uq_coverage_acknowledgements__hive_gap UNIQUE (hive_id, gap_key),
  CONSTRAINT fk_coverage_acknowledgements__hives
    FOREIGN KEY (hive_id, owner_user_id) REFERENCES hive.hives (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT fk_coverage_acknowledgements__processing_runs
    FOREIGN KEY (processing_run_id) REFERENCES hive.processing_runs (id) ON DELETE CASCADE,
  CONSTRAINT ck_coverage_acknowledgements__gap_key CHECK (
    char_length(gap_key) <= 200 AND gap_key ~ '^[A-Z_]{1,32}:[0-9a-f-]{36}:[A-Za-z0-9_:]{1,80}$'
  ),
  CONSTRAINT ck_coverage_acknowledgements__reason CHECK (reason ~ '^[A-Z_]{1,32}$'),
  CONSTRAINT ck_coverage_acknowledgements__digest CHECK (coverage_digest ~ '^sha256:[0-9a-f]{64}$')
);

COMMENT ON TABLE hive.coverage_acknowledgements IS
  'Material coverage gaps the owner acknowledged (B5); reused by later runs in the same Hive.';

CREATE OR REPLACE FUNCTION hive.unacknowledged_material_gaps(p_hive_id uuid, p_gaps jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(g ORDER BY g ->> 'key'), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(p_gaps, '[]'::jsonb)) g
   WHERE (g ->> 'material')::boolean
     AND NOT EXISTS (
       SELECT 1 FROM hive.coverage_acknowledgements a
        WHERE a.hive_id = p_hive_id AND a.gap_key = g ->> 'key'
     );
$$;

CREATE OR REPLACE FUNCTION hive.record_coverage_acknowledgements(
  p_run hive.processing_runs,
  p_gaps jsonb,
  p_coverage_digest text
)
RETURNS void
LANGUAGE sql
SET search_path = hive, pg_temp
AS $$
  INSERT INTO hive.coverage_acknowledgements (hive_id, owner_user_id, gap_key, reason, processing_run_id, coverage_digest)
  SELECT p_run.hive_id, p_run.owner_user_id, g ->> 'key', g ->> 'reason', p_run.id, p_coverage_digest
    FROM jsonb_array_elements(coalesce(p_gaps, '[]'::jsonb)) g
   WHERE (g ->> 'material')::boolean
  ON CONFLICT ON CONSTRAINT uq_coverage_acknowledgements__hive_gap DO NOTHING;
$$;

-- Runs frozen before B5 (all gaps were acknowledged at start then).
ALTER TABLE hive.processing_runs DISABLE TRIGGER trg_processing_runs__transition;
UPDATE hive.processing_runs
   SET coverage_gaps = hive.classify_coverage_gaps(source_snapshot),
       coverage_status = hive.coverage_status_for(hive.classify_coverage_gaps(source_snapshot)),
       coverage_acknowledgement = CASE
         WHEN hive.coverage_status_for(hive.classify_coverage_gaps(source_snapshot)) = 'MATERIAL_GAPS' THEN 'OWNER'
         ELSE 'NOT_REQUIRED' END,
       coverage_acknowledged_at = CASE
         WHEN hive.coverage_status_for(hive.classify_coverage_gaps(source_snapshot)) = 'MATERIAL_GAPS' THEN created_at
         END
 WHERE source_snapshot IS NOT NULL AND coverage_status IS NULL;
ALTER TABLE hive.processing_runs ENABLE TRIGGER trg_processing_runs__transition;

ALTER TABLE hive.processing_runs DROP CONSTRAINT IF EXISTS ck_processing_runs__coverage;
ALTER TABLE hive.processing_runs ADD CONSTRAINT ck_processing_runs__coverage CHECK (
  (source_snapshot IS NULL) = (coverage_status IS NULL)
  AND (source_snapshot IS NULL) = (coverage_gaps IS NULL)
  AND (source_snapshot IS NULL) = (coverage_acknowledgement IS NULL)
  AND coalesce(coverage_status IN ('COMPLETE', 'NONMATERIAL_GAPS', 'MATERIAL_GAPS'), true)
  AND coalesce(jsonb_typeof(coverage_gaps) = 'array' AND octet_length(coverage_gaps::text) <= 262144, true)
  AND coalesce(coverage_acknowledgement IN ('NOT_REQUIRED', 'PENDING', 'PRIOR', 'OWNER'), true)
  AND coalesce((coverage_status = 'MATERIAL_GAPS') = (coverage_acknowledgement <> 'NOT_REQUIRED'), true)
  AND coalesce(coverage_acknowledgement IN ('PRIOR', 'OWNER'), false) = (coverage_acknowledged_at IS NOT NULL)
  AND (coverage_acknowledgement IS DISTINCT FROM 'PENDING'
       OR status IN ('AWAITING_ACKNOWLEDGEMENT', 'NEEDS_CLARIFICATION', 'FAILED'))
  AND (status <> 'AWAITING_ACKNOWLEDGEMENT' OR coverage_acknowledgement = 'PENDING')
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
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;

  -- The source snapshot and its coverage are written exactly once (at start, or when reading
  -- finishes). The only later change: a waiting run records the owner's acknowledgement once.
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
    OR (OLD.status = 'READING_DOCUMENTS' AND NEW.status IN ('AWAITING_ACKNOWLEDGEMENT', 'UNDERSTANDING_REQUEST', 'FAILED'))
    OR (OLD.status = 'AWAITING_ACKNOWLEDGEMENT' AND NEW.status IN ('UNDERSTANDING_REQUEST', 'FAILED'))
    OR (OLD.status = 'UNDERSTANDING_REQUEST' AND NEW.status IN ('IDENTIFYING_DOMAIN', 'FAILED'))
    OR (OLD.status = 'IDENTIFYING_DOMAIN' AND NEW.status IN ('DEVELOPING_QUESTIONS', 'FAILED'))
    OR (OLD.status = 'DEVELOPING_QUESTIONS' AND NEW.status IN ('PLANNING_INVESTIGATION', 'FAILED'))
    OR (OLD.status = 'PLANNING_INVESTIGATION' AND NEW.status IN ('BUILDING_PROMPT', 'FAILED'))
    OR (OLD.status = 'BUILDING_PROMPT' AND NEW.status IN ('SAVING', 'FAILED'))
    OR (OLD.status = 'SAVING' AND NEW.status IN ('INVESTIGATING', 'FAILED'))
    OR (OLD.status = 'INVESTIGATING' AND NEW.status IN ('VERIFYING_EVIDENCE', 'FAILED'))
    OR (OLD.status = 'VERIFYING_EVIDENCE' AND NEW.status IN ('ACCEPTING_STUDY', 'FAILED'))
    OR (OLD.status = 'ACCEPTING_STUDY' AND NEW.status IN ('SUCCEEDED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'processing_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Before the sources are frozen only the intents can go stale.
CREATE OR REPLACE FUNCTION hive.processing_run_snapshot_current(r hive.processing_runs)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = hive, public, pg_temp
AS $$
  SELECT (r.source_snapshot_digest IS NULL
          OR (hive.compute_study_source_snapshot(r.hive_id) ->> 'sourceSnapshotDigest') = r.source_snapshot_digest)
     AND (hive.compute_study_intent_snapshot(r.hive_id) ->> 'intentSnapshotDigest') = r.intent_snapshot_digest;
$$;

-- With the sweeper, a lapsed lease is retried by claim_processing_run. Only a run that made no
-- progress for 15 minutes (no worker, no sweeper), or is older than two hours, is interrupted.
CREATE OR REPLACE FUNCTION hive.expire_stale_processing_runs(p_hive_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_expired integer;
  v_waited integer;
BEGIN
  UPDATE hive.processing_runs r
     SET status = 'FAILED',
         error_code = 'PREPARATION_INTERRUPTED',
         error_message_safe = 'Analysis stopped before it finished. You can try again.',
         retryable = true,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     AND (coalesce(r.lease_expires_at, r.next_dispatch_at, r.updated_at) < now() - interval '15 minutes'
          OR r.created_at < now() - interval '2 hours');
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- A run waiting for the owner's review keeps its finished reads; after a day it stops so the Hive
  -- is not blocked, and Analyze starts again from the same verified reads.
  UPDATE hive.processing_runs r
     SET status = 'FAILED',
         error_code = 'COVERAGE_INCOMPLETE',
         error_message_safe = 'This analysis waited for your review and stopped. Analyze again when you''re ready.',
         retryable = true,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.status = 'AWAITING_ACKNOWLEDGEMENT'
     AND r.updated_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_waited = ROW_COUNT;
  RETURN v_expired + v_waited;
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
           'INVESTIGATING', 'WRITING'
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

-- ---------------------------------------------------------------------------
-- 2. Canonical Study and immutable revisions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.canonical_studies (
  id uuid DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  current_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_canonical_studies PRIMARY KEY (id),
  CONSTRAINT uq_canonical_studies__hive UNIQUE (hive_id),
  CONSTRAINT uq_canonical_studies__id_hive UNIQUE (id, hive_id),
  CONSTRAINT fk_canonical_studies__hives
    FOREIGN KEY (hive_id, owner_user_id) REFERENCES hive.hives (id, owner_user_id) ON DELETE CASCADE
);

COMMENT ON TABLE hive.canonical_studies IS
  'One evolving Canonical Study per Hive; current_revision_id points at the accepted immutable revision.';

CREATE TABLE IF NOT EXISTS hive.study_revisions (
  id uuid DEFAULT gen_random_uuid(),
  canonical_study_id uuid NOT NULL,
  hive_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  revision_number integer NOT NULL,
  predecessor_revision_id uuid,
  processing_run_id uuid NOT NULL,
  study_prompt_preview_id uuid NOT NULL,
  investigation jsonb NOT NULL,
  verification jsonb NOT NULL,
  audience_configuration jsonb NOT NULL,
  investigation_digest text NOT NULL,
  prompt_digest text NOT NULL,
  source_snapshot_digest text NOT NULL,
  intent_snapshot_digest text NOT NULL,
  coverage_digest text NOT NULL,
  coverage_complete boolean NOT NULL,
  coverage_status text NOT NULL,
  coverage_gaps jsonb NOT NULL,
  coverage_acknowledgement text NOT NULL,
  model_alias text,
  resolved_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_study_revisions PRIMARY KEY (id),
  CONSTRAINT ck_study_revisions__coverage CHECK (
    coverage_status IN ('COMPLETE', 'NONMATERIAL_GAPS', 'MATERIAL_GAPS')
    AND jsonb_typeof(coverage_gaps) = 'array'
    AND coverage_acknowledgement IN ('NOT_REQUIRED', 'PRIOR', 'OWNER')
    AND (coverage_status = 'MATERIAL_GAPS') = (coverage_acknowledgement <> 'NOT_REQUIRED')
  ),
  CONSTRAINT uq_study_revisions__study_number UNIQUE (canonical_study_id, revision_number),
  CONSTRAINT uq_study_revisions__run UNIQUE (processing_run_id),
  CONSTRAINT fk_study_revisions__canonical_studies
    FOREIGN KEY (canonical_study_id, hive_id) REFERENCES hive.canonical_studies (id, hive_id) ON DELETE CASCADE,
  CONSTRAINT fk_study_revisions__hives
    FOREIGN KEY (hive_id, owner_user_id) REFERENCES hive.hives (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT fk_study_revisions__processing_runs
    FOREIGN KEY (processing_run_id) REFERENCES hive.processing_runs (id) ON DELETE CASCADE,
  CONSTRAINT fk_study_revisions__study_prompt_previews
    FOREIGN KEY (study_prompt_preview_id) REFERENCES hive.study_prompt_previews (id) ON DELETE CASCADE,
  CONSTRAINT fk_study_revisions__predecessor
    FOREIGN KEY (predecessor_revision_id) REFERENCES hive.study_revisions (id) ON DELETE SET NULL,
  CONSTRAINT ck_study_revisions__revision_number CHECK (revision_number >= 1),
  CONSTRAINT ck_study_revisions__json CHECK (
    jsonb_typeof(investigation) = 'object'
    AND investigation ->> 'schema' = 'hive.study-investigation/1'
    AND jsonb_typeof(verification) = 'object'
    AND verification ->> 'schema' = 'hive.study-verification/1'
    AND jsonb_typeof(audience_configuration) = 'object'
    AND audience_configuration ->> 'schema' = 'hive.audience-configuration/1'
    AND octet_length(investigation::text) <= 2097152
    AND octet_length(verification::text) <= 262144
  ),
  CONSTRAINT ck_study_revisions__digests CHECK (
    investigation_digest ~ '^sha256:[0-9a-f]{64}$'
    AND prompt_digest ~ '^sha256:[0-9a-f]{64}$'
    AND source_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
    AND intent_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
    AND coverage_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_study_revisions__model CHECK (
    (model_alias IS NULL OR model_alias ~ '^[A-Za-z0-9_.:/@+-]{1,128}$')
    AND (resolved_model IS NULL OR resolved_model ~ '^[A-Za-z0-9_.:/@+-]{1,128}$')
  )
);

COMMENT ON TABLE hive.study_revisions IS
  'Immutable accepted Canonical Study revision: validated investigation JSONB plus trusted verification. Serves both audiences.';

CREATE INDEX IF NOT EXISTS idx_study_revisions__hive_created ON hive.study_revisions (hive_id, created_at DESC);

ALTER TABLE hive.canonical_studies DROP CONSTRAINT IF EXISTS fk_canonical_studies__current_revision;
ALTER TABLE hive.canonical_studies ADD CONSTRAINT fk_canonical_studies__current_revision
  FOREIGN KEY (current_revision_id) REFERENCES hive.study_revisions (id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION hive.enforce_immutable_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%_immutable', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_study_revisions__immutable ON hive.study_revisions;
CREATE TRIGGER trg_study_revisions__immutable
  BEFORE UPDATE ON hive.study_revisions
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_immutable_row();

DROP TRIGGER IF EXISTS trg_coverage_acknowledgements__immutable ON hive.coverage_acknowledgements;
CREATE TRIGGER trg_coverage_acknowledgements__immutable
  BEFORE UPDATE ON hive.coverage_acknowledgements
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_immutable_row();

-- ---------------------------------------------------------------------------
-- 3. Writer runs and immutable reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.report_runs (
  id uuid DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  study_revision_id uuid NOT NULL,
  audience text NOT NULL,
  trigger text NOT NULL,
  request_id uuid,
  status text NOT NULL DEFAULT 'QUEUED',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  correlation_id uuid NOT NULL,
  lease_expires_at timestamptz,
  next_dispatch_at timestamptz,
  stage_metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  error_message_safe text,
  retryable boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT pk_report_runs PRIMARY KEY (id),
  CONSTRAINT fk_report_runs__hives
    FOREIGN KEY (hive_id, owner_user_id) REFERENCES hive.hives (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT fk_report_runs__study_revisions
    FOREIGN KEY (study_revision_id) REFERENCES hive.study_revisions (id) ON DELETE CASCADE,
  CONSTRAINT ck_report_runs__audience CHECK (audience IN ('CUSTOMER', 'PRO')),
  CONSTRAINT ck_report_runs__trigger CHECK (trigger IN ('STUDY_ACCEPTED', 'OWNER_GENERATE')),
  CONSTRAINT ck_report_runs__status CHECK (status IN ('QUEUED', 'WRITING', 'VALIDATING', 'SAVING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT ck_report_runs__attempts CHECK (max_attempts = 3 AND attempt_count BETWEEN 0 AND max_attempts),
  CONSTRAINT ck_report_runs__request CHECK ((trigger = 'OWNER_GENERATE') = (request_id IS NOT NULL)),
  CONSTRAINT ck_report_runs__stage_metrics CHECK (jsonb_typeof(stage_metrics) = 'array' AND jsonb_array_length(stage_metrics) <= 12),
  CONSTRAINT ck_report_runs__error_code_format CHECK (error_code IS NULL OR error_code ~ '^[A-Z_]{1,64}$'),
  CONSTRAINT ck_report_runs__error_message_safe_length CHECK (
    error_message_safe IS NULL OR char_length(error_message_safe) BETWEEN 1 AND 300
  ),
  CONSTRAINT ck_report_runs__finished CHECK ((status IN ('SUCCEEDED', 'FAILED')) = (finished_at IS NOT NULL))
);

COMMENT ON TABLE hive.report_runs IS
  'One Writer run for one audience over one accepted study revision; retried independently (max 3 attempts).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_runs__accepted_revision_audience
  ON hive.report_runs (study_revision_id, audience) WHERE trigger = 'STUDY_ACCEPTED';
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_runs__active_revision_audience
  ON hive.report_runs (study_revision_id, audience) WHERE status NOT IN ('SUCCEEDED', 'FAILED');
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_runs__owner_request
  ON hive.report_runs (owner_user_id, request_id, audience) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_report_runs__due
  ON hive.report_runs (next_dispatch_at) WHERE status NOT IN ('SUCCEEDED', 'FAILED');
CREATE INDEX IF NOT EXISTS idx_report_runs__hive_created ON hive.report_runs (hive_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hive.reports (
  id uuid DEFAULT gen_random_uuid(),
  report_run_id uuid NOT NULL,
  hive_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  study_revision_id uuid NOT NULL,
  audience text NOT NULL,
  title text NOT NULL,
  writer_output jsonb NOT NULL,
  scenario_analysis jsonb NOT NULL,
  view jsonb NOT NULL,
  writer_prompt_digest text NOT NULL,
  model_alias text,
  resolved_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_reports PRIMARY KEY (id),
  CONSTRAINT uq_reports__run UNIQUE (report_run_id),
  CONSTRAINT fk_reports__report_runs FOREIGN KEY (report_run_id) REFERENCES hive.report_runs (id) ON DELETE CASCADE,
  CONSTRAINT fk_reports__hives
    FOREIGN KEY (hive_id, owner_user_id) REFERENCES hive.hives (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT fk_reports__study_revisions FOREIGN KEY (study_revision_id) REFERENCES hive.study_revisions (id) ON DELETE CASCADE,
  CONSTRAINT ck_reports__audience CHECK (audience IN ('CUSTOMER', 'PRO')),
  CONSTRAINT ck_reports__title CHECK (char_length(title) BETWEEN 1 AND 160),
  CONSTRAINT ck_reports__json CHECK (
    jsonb_typeof(writer_output) = 'object' AND writer_output ->> 'schema' = 'hive.writer-report/1'
    AND writer_output ->> 'audience' = audience
    AND jsonb_typeof(scenario_analysis) = 'object' AND scenario_analysis ->> 'schema' = 'hive.scenario-analysis/1'
    AND jsonb_typeof(view) = 'object' AND view ->> 'schema' = 'hive-application-view/1'
    AND view ->> 'audience' = audience
    AND octet_length(writer_output::text) <= 524288
    AND octet_length(view::text) <= 1048576
  ),
  CONSTRAINT ck_reports__digest CHECK (writer_prompt_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_reports__model CHECK (
    (model_alias IS NULL OR model_alias ~ '^[A-Za-z0-9_.:/@+-]{1,128}$')
    AND (resolved_model IS NULL OR resolved_model ~ '^[A-Za-z0-9_.:/@+-]{1,128}$')
  )
);

COMMENT ON TABLE hive.reports IS
  'Immutable audience report pinned to one study revision: validated Writer output, code-computed scenarios and the bound A2UI view.';

CREATE INDEX IF NOT EXISTS idx_reports__hive_created ON hive.reports (hive_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_reports__immutable ON hive.reports;
CREATE TRIGGER trg_reports__immutable
  BEFORE UPDATE ON hive.reports
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_immutable_row();

CREATE OR REPLACE FUNCTION hive.enforce_report_run_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.hive_id IS DISTINCT FROM OLD.hive_id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.study_revision_id IS DISTINCT FROM OLD.study_revision_id
     OR NEW.audience IS DISTINCT FROM OLD.audience
     OR NEW.trigger IS DISTINCT FROM OLD.trigger
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'hive.report_runs identity columns are immutable';
  END IF;
  IF OLD.status IN ('SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION 'report_run_finished' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'QUEUED' AND NEW.status IN ('WRITING', 'FAILED'))
    OR (OLD.status = 'WRITING' AND NEW.status IN ('VALIDATING', 'QUEUED', 'FAILED'))
    OR (OLD.status = 'VALIDATING' AND NEW.status IN ('SAVING', 'QUEUED', 'FAILED'))
    OR (OLD.status = 'SAVING' AND NEW.status IN ('SUCCEEDED', 'QUEUED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'report_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_runs__transition ON hive.report_runs;
CREATE TRIGGER trg_report_runs__transition
  BEFORE UPDATE ON hive.report_runs
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_report_run_transition();

-- ---------------------------------------------------------------------------
-- 4. JSON helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.study_revision_summary_json(s hive.study_revisions)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT json_build_object(
    'id', s.id,
    'canonicalStudyId', s.canonical_study_id,
    'revisionNumber', s.revision_number,
    'predecessorRevisionId', s.predecessor_revision_id,
    'processingRunId', s.processing_run_id,
    'coverageComplete', s.coverage_complete,
    'coverageStatus', s.coverage_status,
    'coverageGaps', s.coverage_gaps,
    'coverageAcknowledgement', s.coverage_acknowledgement,
    'audienceConfiguration', s.audience_configuration,
    'counts', s.verification -> 'counts',
    'createdAt', s.created_at
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
    'createdAt', r.created_at,
    'startedAt', r.started_at,
    'updatedAt', r.updated_at,
    'finishedAt', r.finished_at
  );
$$;

CREATE OR REPLACE FUNCTION hive.report_summary_json(p hive.reports)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT json_build_object(
    'id', p.id,
    'reportRunId', p.report_run_id,
    'studyRevisionId', p.study_revision_id,
    'revisionNumber', (SELECT s.revision_number FROM hive.study_revisions s WHERE s.id = p.study_revision_id),
    'audience', p.audience,
    'title', p.title,
    'createdAt', p.created_at
  );
$$;

CREATE OR REPLACE FUNCTION hive.report_json(p hive.reports)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT (hive.report_summary_json(p)::jsonb || jsonb_build_object(
    'view', p.view,
    'scenarioAnalysis', p.scenario_analysis,
    'modelAlias', p.model_alias
  ))::json;
$$;

-- Latest Writer run per audience for one revision.
CREATE OR REPLACE FUNCTION hive.latest_report_runs_json(p_revision_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT coalesce(json_agg(hive.report_run_json(x.r) ORDER BY x.audience), '[]'::json)
    FROM (
      SELECT DISTINCT ON (r.audience) r, r.audience
        FROM hive.report_runs r
       WHERE r.study_revision_id = p_revision_id
       ORDER BY r.audience, r.created_at DESC, r.id DESC
    ) x;
$$;

-- ---------------------------------------------------------------------------
-- 5. Owner RPCs: Analyze (single entry point)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.start_study_preparation(uuid, uuid, uuid, text);

-- Starts the whole workflow. Documents not yet verified are queued for reading with the run
-- (verified reads are reused, never restarted); the source snapshot is frozen when reading finishes.
-- Starting is not consent to gaps (B5): material gaps that are already known and were not
-- acknowledged before in this Hive need `p_coverage_acknowledgement_digest`; gaps discovered by the
-- reads pause the run in AWAITING_ACKNOWLEDGEMENT (see acknowledge_study_coverage).
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
  v_live integer;
  v_needs_read integer;
  v_no_intent boolean;
  v_queued json := '[]'::json;
  v_gaps jsonb;
  v_known jsonb;
  v_unacked jsonb;
  v_acked_now boolean := false;
  v_coverage_status text;
  v_acknowledgement text;
  v_acknowledged_at timestamptz;
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

  SELECT * INTO v_run FROM hive.processing_runs
   WHERE owner_user_id = v_uid AND request_id = p_request_id;
  IF FOUND THEN
    IF v_run.hive_id <> p_hive_id THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'created', false,
                             'queuedReadIds', '[]'::json);
  END IF;

  -- A run waiting for review whose documents or request have since changed no longer applies.
  UPDATE hive.processing_runs r
     SET status = 'FAILED',
         error_code = 'SOURCE_CHANGED',
         error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
         retryable = true,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.kind = 'STUDY_PREPARATION'
     AND r.status = 'AWAITING_ACKNOWLEDGEMENT'
     AND NOT hive.processing_run_snapshot_current(r);

  SELECT * INTO v_run FROM hive.processing_runs
   WHERE hive_id = p_hive_id
     AND kind = 'STUDY_PREPARATION'
     AND status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED');
  IF FOUND THEN
    RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'created', false,
                             'queuedReadIds', '[]'::json);
  END IF;

  SELECT count(*) INTO v_live
    FROM hive.source_documents d
   WHERE d.case_id = p_hive_id AND d.lifecycle_status = 'ACTIVE' AND d.deleted_at IS NULL
     AND d.upload_status = 'UPLOADED';
  IF v_live = 0 THEN
    RAISE EXCEPTION 'no_eligible_documents' USING ERRCODE = 'P0001';
  END IF;

  v_intents := hive.compute_study_intent_snapshot(p_hive_id);
  v_no_intent := jsonb_array_length(v_intents -> 'intentRequestIds') = 0;
  v_sources := hive.compute_study_source_snapshot(p_hive_id);

  SELECT count(*) INTO v_needs_read
    FROM hive.source_documents d
   WHERE d.case_id = p_hive_id AND d.owner_user_id = v_uid
     AND d.lifecycle_status = 'ACTIVE' AND d.deleted_at IS NULL AND d.upload_status = 'UPLOADED'
     AND d.read_status IN ('PENDING', 'FAILED')
     AND NOT EXISTS (
       SELECT 1 FROM hive.document_reads a
        WHERE a.source_document_id = d.id AND a.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')
     );

  IF NOT v_no_intent AND v_needs_read = 0 AND (v_sources ->> 'activeReadCount')::integer = 0
     AND jsonb_array_length(v_sources -> 'documents') = 0 THEN
    RAISE EXCEPTION 'no_eligible_documents' USING ERRCODE = 'P0001';
  END IF;

  -- Gaps already known: every gap except those of documents about to be read (or being read).
  v_gaps := hive.classify_coverage_gaps(v_sources);
  SELECT coalesce(jsonb_agg(g ORDER BY g ->> 'key'), '[]'::jsonb) INTO v_known
    FROM jsonb_array_elements(v_gaps) g
   WHERE NOT EXISTS (
     SELECT 1 FROM hive.source_documents d
      WHERE d.id = (g ->> 'sourceDocumentId')::uuid
        AND (d.read_status IN ('PENDING', 'FAILED')
             OR EXISTS (SELECT 1 FROM hive.document_reads a
                         WHERE a.source_document_id = d.id
                           AND a.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')))
   );
  v_unacked := hive.unacknowledged_material_gaps(p_hive_id, v_known);
  IF NOT v_no_intent AND jsonb_array_length(v_unacked) > 0 THEN
    IF v_ack IS DISTINCT FROM (v_sources ->> 'coverageDigest') THEN
      RAISE EXCEPTION 'coverage_unacknowledged' USING ERRCODE = 'P0001';
    END IF;
    v_acked_now := true;
  END IF;

  SELECT coalesce(max(r.attempt_number), 0) + 1 INTO v_attempt
    FROM hive.processing_runs r
   WHERE r.hive_id = p_hive_id AND r.kind = 'STUDY_PREPARATION';

  IF v_no_intent THEN
    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      intent_request_ids, intent_snapshot_digest,
      error_code, error_message_safe, retryable, finished_at
    )
    VALUES (
      p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt, 'NEEDS_CLARIFICATION', p_correlation_id,
      ARRAY[]::uuid[], v_intents ->> 'intentSnapshotDigest',
      'INTENT_MISSING', 'Tell us what you want to understand from these documents, then analyze again.', true, now()
    )
    RETURNING * INTO v_run;
  ELSIF v_needs_read > 0 OR (v_sources ->> 'activeReadCount')::integer > 0 THEN
    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      intent_request_ids, intent_snapshot_digest, next_dispatch_at
    )
    VALUES (
      p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt, 'READING_DOCUMENTS', p_correlation_id,
      ARRAY(SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_intents -> 'intentRequestIds') x),
      v_intents ->> 'intentSnapshotDigest',
      now() + interval '30 seconds'
    )
    RETURNING * INTO v_run;

    INSERT INTO hive.document_reads (
      hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
      lease_expires_at
    )
    SELECT p_hive_id, v_uid, d.id, p_request_id,
           coalesce((SELECT max(r.attempt_number) FROM hive.document_reads r WHERE r.source_document_id = d.id), 0) + 1,
           'QUEUED', p_correlation_id, now() + interval '330 seconds'
      FROM hive.source_documents d
     WHERE d.case_id = p_hive_id AND d.owner_user_id = v_uid
       AND d.lifecycle_status = 'ACTIVE' AND d.deleted_at IS NULL AND d.upload_status = 'UPLOADED'
       AND d.read_status IN ('PENDING', 'FAILED')
       AND NOT EXISTS (
         SELECT 1 FROM hive.document_reads a
          WHERE a.source_document_id = d.id AND a.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')
       )
     ORDER BY d.created_at, d.id
    ON CONFLICT DO NOTHING;

    SELECT coalesce(json_agg(r.id ORDER BY r.created_at, r.id), '[]'::json) INTO v_queued
      FROM hive.document_reads r
     WHERE r.hive_id = p_hive_id AND r.request_id = p_request_id AND r.status = 'QUEUED';
  ELSE
    v_coverage_status := hive.coverage_status_for(v_gaps);
    IF v_coverage_status <> 'MATERIAL_GAPS' THEN
      v_acknowledgement := 'NOT_REQUIRED';
    ELSIF v_acked_now THEN
      v_acknowledgement := 'OWNER';
      v_acknowledged_at := now();
    ELSE
      v_acknowledgement := 'PRIOR';
      SELECT max(a.acknowledged_at) INTO v_acknowledged_at
        FROM hive.coverage_acknowledgements a
        JOIN jsonb_array_elements(v_gaps) g ON g ->> 'key' = a.gap_key
       WHERE a.hive_id = p_hive_id;
    END IF;

    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      authorized_source_document_ids, intent_request_ids, source_snapshot,
      source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
      coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement, coverage_acknowledged_at,
      snapshot_frozen_at, next_dispatch_at
    )
    VALUES (
      p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt, 'QUEUED', p_correlation_id,
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
      v_acknowledgement IN ('PRIOR', 'OWNER'),
      v_coverage_status,
      v_gaps,
      v_acknowledgement,
      v_acknowledged_at,
      now(),
      now() + interval '30 seconds'
    )
    RETURNING * INTO v_run;
  END IF;

  IF v_acked_now THEN
    PERFORM hive.record_coverage_acknowledgements(v_run, v_unacked, v_sources ->> 'coverageDigest');
  END IF;

  RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'created', true,
                           'queuedReadIds', v_queued);
END;
$$;

-- The owner reviewed the material gaps a waiting run found after reading, and continues with them.
-- The same run resumes from its frozen snapshot; no document is read again.
CREATE OR REPLACE FUNCTION public.acknowledge_study_coverage(
  p_hive_id uuid,
  p_processing_run_id uuid,
  p_coverage_digest text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run hive.processing_runs%ROWTYPE;
  v_digest text := lower(nullif(btrim(coalesce(p_coverage_digest, '')), ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_processing_run_id IS NULL THEN
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

  PERFORM hive.expire_stale_processing_runs(p_hive_id);

  SELECT * INTO v_run FROM hive.processing_runs
   WHERE id = p_processing_run_id AND hive_id = p_hive_id AND owner_user_id = v_uid
     AND kind = 'STUDY_PREPARATION'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_run.status <> 'AWAITING_ACKNOWLEDGEMENT' THEN
    -- A replay after the run already continued is not an error.
    IF v_run.coverage_acknowledgement = 'OWNER' AND v_run.coverage_digest = v_digest THEN
      RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'resumed', false);
    END IF;
    RAISE EXCEPTION 'processing_run_not_awaiting' USING ERRCODE = 'P0001';
  END IF;
  IF v_digest IS DISTINCT FROM v_run.coverage_digest THEN
    RAISE EXCEPTION 'coverage_unacknowledged' USING ERRCODE = 'P0001';
  END IF;

  IF NOT hive.processing_run_snapshot_current(v_run) THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'SOURCE_CHANGED',
           error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = v_run.id
    RETURNING * INTO v_run;
    RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'resumed', false, 'sourceChanged', true);
  END IF;

  PERFORM hive.record_coverage_acknowledgements(v_run, v_run.coverage_gaps, v_run.coverage_digest);

  UPDATE hive.processing_runs
     SET status = 'UNDERSTANDING_REQUEST',
         coverage_acknowledgement = 'OWNER',
         coverage_acknowledged = true,
         coverage_acknowledged_at = now(),
         started_at = coalesce(started_at, now()),
         stage_attempt = 1,
         lease_expires_at = NULL,
         next_dispatch_at = now() + interval '30 seconds'
   WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'resumed', true);
END;
$$;

-- The latest run, its saved preview (shown as soon as it exists), the accepted revision it produced
-- and both Writer runs, so one poll drives the whole Analyze modal.
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
  v_revision hive.study_revisions%ROWTYPE;
  v_sources jsonb;
  v_has_run boolean;
  v_has_preview boolean;
  v_has_revision boolean;
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
     AND (p.processing_run_id = v_run.id
          OR EXISTS (SELECT 1 FROM hive.processing_runs r WHERE r.id = p.processing_run_id AND r.status = 'SUCCEEDED'))
   ORDER BY (p.processing_run_id = v_run.id) DESC, p.created_at DESC, p.id DESC
   LIMIT 1;
  v_has_preview := FOUND;

  SELECT s.* INTO v_revision FROM hive.study_revisions s
    JOIN hive.canonical_studies c ON c.id = s.canonical_study_id
   WHERE c.hive_id = p_hive_id AND s.id = c.current_revision_id;
  v_has_revision := FOUND;

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
    'studyRevision', CASE WHEN v_has_revision THEN hive.study_revision_summary_json(v_revision) END,
    'reportRuns', CASE WHEN v_has_revision THEN hive.latest_report_runs_json(v_revision.id) ELSE '[]'::json END,
    'documentReads', hive.latest_document_reads_json(p_hive_id),
    'eligibility', json_build_object(
      'documents', v_sources -> 'documents',
      'excluded', v_sources -> 'excluded',
      'activeReadCount', v_sources -> 'activeReadCount',
      'coverageComplete', v_sources -> 'coverageComplete',
      'coverageDigest', v_sources -> 'coverageDigest',
      'gaps', (
        SELECT coalesce(jsonb_agg(g || jsonb_build_object('acknowledged', EXISTS (
                 SELECT 1 FROM hive.coverage_acknowledgements a
                  WHERE a.hive_id = p_hive_id AND a.gap_key = g ->> 'key')) ORDER BY g ->> 'key'), '[]'::jsonb)
          FROM jsonb_array_elements(hive.classify_coverage_gaps(v_sources)) g
      )
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Server RPCs: claim, transition, retry, release (service_role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.require_service_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = hive, public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Claims the run's current stage for one invocation. A lapsed lease means the previous invocation
-- died: that is a new attempt; after three the run fails as a retryable interruption.
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
  -- A waiting run belongs to the owner; a retry backs off until its next_dispatch_at.
  IF v_run.status IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     OR (v_run.lease_expires_at IS NOT NULL AND v_run.lease_expires_at > now())
     OR (v_run.lease_expires_at IS NULL AND v_run.stage_attempt > 1 AND v_run.next_dispatch_at > now()) THEN
    RETURN json_build_object('claimed', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  v_attempt := v_run.stage_attempt + CASE
    WHEN v_run.lease_expires_at IS NOT NULL AND v_run.status <> 'READING_DOCUMENTS' THEN 1 ELSE 0 END;
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

-- Gives up the lease so the next stage can be claimed by a fresh invocation now (or after a delay).
CREATE OR REPLACE FUNCTION public.release_processing_run(p_run_id uuid, p_status text, p_delay_seconds integer DEFAULT 0)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
BEGIN
  PERFORM hive.require_service_role();
  UPDATE hive.processing_runs
     SET lease_expires_at = NULL,
         next_dispatch_at = now() + make_interval(secs => greatest(0, least(coalesce(p_delay_seconds, 0), 600)))
   WHERE id = p_run_id AND status = upper(btrim(coalesce(p_status, '')))
     AND status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
  RETURNING * INTO v_run;
  RETURN json_build_object('released', FOUND);
END;
$$;

-- A retryable model failure (timeout, unavailable): retry the same stage later, up to three attempts.
CREATE OR REPLACE FUNCTION public.retry_processing_run_stage(p_run_id uuid, p_status text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_metrics jsonb;
BEGIN
  PERFORM hive.require_service_role();
  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> upper(btrim(coalesce(p_status, ''))) THEN
    RETURN json_build_object('retried', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;
  v_metrics := v_run.stage_metrics;
  IF v_details ? 'stage_metric' THEN
    IF NOT hive.is_valid_stage_metric(v_details -> 'stage_metric') THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
    v_metrics := v_metrics || jsonb_build_array(v_details -> 'stage_metric');
  END IF;
  IF v_run.stage_attempt >= 3 THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           stage_metrics = v_metrics,
           error_code = nullif(btrim(v_details ->> 'error_code'), ''),
           error_message_safe = nullif(left(btrim(coalesce(v_details ->> 'error_message_safe', '')), 300), ''),
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('retried', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;
  UPDATE hive.processing_runs
     SET stage_attempt = stage_attempt + 1,
         stage_metrics = v_metrics,
         lease_expires_at = NULL,
         next_dispatch_at = now() + make_interval(secs => 20 * v_run.stage_attempt)
   WHERE id = p_run_id
  RETURNING * INTO v_run;
  RETURN json_build_object('retried', true, 'processingRun', hive.processing_run_json(v_run));
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

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
  v_sources jsonb;
  v_freeze boolean := false;
  v_gaps jsonb;
  v_coverage_status text;
  v_acknowledgement text;
  v_acknowledged_at timestamptz;
BEGIN
  PERFORM hive.require_service_role();
  IF jsonb_typeof(v_details) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF v_to = 'SUCCEEDED' THEN
    RAISE EXCEPTION 'processing_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_run.status <> v_from THEN
    RETURN json_build_object('applied', false, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  v_terminal := v_to IN ('NEEDS_CLARIFICATION', 'FAILED');

  IF v_to <> 'FAILED' AND EXISTS (
    SELECT 1 FROM hive.hives h
     WHERE h.id = v_run.hive_id AND (h.deleting_at IS NOT NULL OR h.archived_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Reading has finished: freeze the sources now, or stop if coverage needs the person.
  IF v_to = 'UNDERSTANDING_REQUEST' AND v_run.source_snapshot IS NULL THEN
    PERFORM hive.expire_stale_document_reads(v_run.hive_id);
    v_sources := hive.compute_study_source_snapshot(v_run.hive_id);
    IF (v_sources ->> 'activeReadCount')::integer > 0 THEN
      RETURN json_build_object('applied', false, 'waiting', true, 'processingRun', hive.processing_run_json(v_run));
    END IF;
    IF jsonb_array_length(v_sources -> 'documents') = 0 THEN
      UPDATE hive.processing_runs
         SET status = 'FAILED',
             error_code = 'COVERAGE_INCOMPLETE',
             error_message_safe = 'We couldn''t read any of your documents. Check the files, then analyze again.',
             retryable = false,
             lease_expires_at = NULL,
             next_dispatch_at = NULL,
             finished_at = now()
       WHERE id = p_run_id
      RETURNING * INTO v_run;
      RETURN json_build_object('applied', false, 'processingRun', hive.processing_run_json(v_run));
    END IF;
    v_gaps := hive.classify_coverage_gaps(v_sources);
    v_coverage_status := hive.coverage_status_for(v_gaps);
    IF v_coverage_status = 'MATERIAL_GAPS'
       AND jsonb_array_length(hive.unacknowledged_material_gaps(v_run.hive_id, v_gaps)) > 0 THEN
      -- Freeze what was read and wait for the owner; the reads are finished and stay finished.
      IF (hive.compute_study_intent_snapshot(v_run.hive_id) ->> 'intentSnapshotDigest') = v_run.intent_snapshot_digest THEN
        UPDATE hive.processing_runs
           SET status = 'AWAITING_ACKNOWLEDGEMENT',
               authorized_source_document_ids =
                 ARRAY(SELECT (d ->> 'sourceDocumentId')::uuid FROM jsonb_array_elements(v_sources -> 'documents') d),
               source_snapshot = jsonb_build_object(
                 'documents', v_sources -> 'documents',
                 'excluded', v_sources -> 'excluded',
                 'coverageComplete', v_sources -> 'coverageComplete'),
               source_snapshot_digest = v_sources ->> 'sourceSnapshotDigest',
               coverage_digest = v_sources ->> 'coverageDigest',
               coverage_complete = false,
               coverage_status = v_coverage_status,
               coverage_gaps = v_gaps,
               coverage_acknowledgement = 'PENDING',
               coverage_acknowledged = false,
               snapshot_frozen_at = now(),
               lease_expires_at = NULL,
               next_dispatch_at = NULL
         WHERE id = p_run_id
        RETURNING * INTO v_run;
        RETURN json_build_object('applied', false, 'awaitingAcknowledgement', true,
                                 'processingRun', hive.processing_run_json(v_run));
      END IF;
    END IF;
    IF v_coverage_status = 'MATERIAL_GAPS' THEN
      -- Every material gap was acknowledged before: at this run's start (OWNER) or earlier (PRIOR).
      SELECT CASE WHEN bool_or(a.processing_run_id = v_run.id) THEN 'OWNER' ELSE 'PRIOR' END, max(a.acknowledged_at)
        INTO v_acknowledgement, v_acknowledged_at
        FROM hive.coverage_acknowledgements a
        JOIN jsonb_array_elements(v_gaps) g ON g ->> 'key' = a.gap_key
       WHERE a.hive_id = v_run.hive_id;
    ELSE
      v_acknowledgement := 'NOT_REQUIRED';
      v_acknowledged_at := NULL;
    END IF;
    v_freeze := true;
  END IF;

  IF v_to <> 'FAILED' AND NOT v_freeze AND NOT hive.processing_run_snapshot_current(v_run) THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'SOURCE_CHANGED',
           error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('applied', false, 'sourceChanged', true,
                             'processingRun', hive.processing_run_json(v_run));
  END IF;
  IF v_freeze AND (hive.compute_study_intent_snapshot(v_run.hive_id) ->> 'intentSnapshotDigest') <> v_run.intent_snapshot_digest THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'SOURCE_CHANGED',
           error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
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
      IF v_output_key NOT IN (
           'intentDecomposition', 'domainProposal', 'sampleCoverage', 'intentIntelligence', 'investigationPlan',
           'studyInvestigation'
         )
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

  IF (v_to = 'IDENTIFYING_DOMAIN' AND NOT v_outputs ? 'intentDecomposition')
     OR (v_to = 'DEVELOPING_QUESTIONS' AND NOT (v_outputs ? 'domainProposal' AND v_outputs ? 'sampleCoverage'))
     OR (v_to = 'PLANNING_INVESTIGATION' AND NOT v_outputs ? 'intentIntelligence')
     OR (v_to = 'BUILDING_PROMPT' AND NOT v_outputs ? 'investigationPlan')
     OR (v_to = 'VERIFYING_EVIDENCE' AND NOT v_outputs ? 'studyInvestigation') THEN
    RAISE EXCEPTION 'stage_output_missing' USING ERRCODE = 'P0001';
  END IF;

  IF v_to = 'INVESTIGATING' THEN
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
         started_at = CASE WHEN v_to = 'UNDERSTANDING_REQUEST' THEN coalesce(started_at, now()) ELSE started_at END,
         -- The invocation that advanced the run keeps the next stage until it releases it.
         lease_expires_at = CASE WHEN v_terminal THEN NULL ELSE now() + interval '300 seconds' END,
         next_dispatch_at = CASE WHEN v_terminal THEN NULL ELSE now() + interval '30 seconds' END,
         stage_attempt = CASE WHEN v_to <> status THEN 1 ELSE stage_attempt END,
         finished_at = CASE WHEN v_terminal THEN now() ELSE NULL END,
         stage_outputs = v_outputs,
         stage_metrics = v_metrics,
         authorized_source_document_ids = CASE WHEN v_freeze
           THEN ARRAY(SELECT (d ->> 'sourceDocumentId')::uuid FROM jsonb_array_elements(v_sources -> 'documents') d)
           ELSE authorized_source_document_ids END,
         source_snapshot = CASE WHEN v_freeze THEN jsonb_build_object(
             'documents', v_sources -> 'documents',
             'excluded', v_sources -> 'excluded',
             'coverageComplete', v_sources -> 'coverageComplete')
           ELSE source_snapshot END,
         source_snapshot_digest = CASE WHEN v_freeze THEN v_sources ->> 'sourceSnapshotDigest' ELSE source_snapshot_digest END,
         coverage_digest = CASE WHEN v_freeze THEN v_sources ->> 'coverageDigest' ELSE coverage_digest END,
         coverage_complete = CASE WHEN v_freeze THEN (v_sources ->> 'coverageComplete')::boolean ELSE coverage_complete END,
         coverage_acknowledged = CASE WHEN v_freeze THEN v_acknowledgement IN ('PRIOR', 'OWNER')
                                      ELSE coverage_acknowledged END,
         coverage_status = CASE WHEN v_freeze THEN v_coverage_status ELSE coverage_status END,
         coverage_gaps = CASE WHEN v_freeze THEN v_gaps ELSE coverage_gaps END,
         coverage_acknowledgement = CASE WHEN v_freeze THEN v_acknowledgement ELSE coverage_acknowledgement END,
         coverage_acknowledged_at = CASE WHEN v_freeze THEN v_acknowledged_at ELSE coverage_acknowledged_at END,
         snapshot_frozen_at = CASE WHEN v_freeze THEN now() ELSE snapshot_frozen_at END,
         error_code = CASE WHEN v_terminal THEN nullif(btrim(v_details ->> 'error_code'), '') ELSE error_code END,
         error_message_safe = CASE WHEN v_terminal THEN v_message ELSE error_message_safe END,
         retryable = CASE WHEN v_terminal THEN (v_details ->> 'retryable')::boolean ELSE retryable END
   WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN json_build_object('applied', true, 'processingRun', hive.processing_run_json(v_run));
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

-- Accepts a verified Canonical Study in one transaction: immutable revision, current pointer,
-- both Writer runs queued, run SUCCEEDED. Replays return the same revision.
CREATE OR REPLACE FUNCTION public.accept_study_revision(p_run_id uuid, p_revision jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.processing_runs%ROWTYPE;
  v_preview hive.study_prompt_previews%ROWTYPE;
  v_study hive.canonical_studies%ROWTYPE;
  v_revision hive.study_revisions%ROWTYPE;
  v_number integer;
  v_metrics jsonb;
BEGIN
  PERFORM hive.require_service_role();
  IF jsonb_typeof(coalesce(p_revision, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM hive.processing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_revision FROM hive.study_revisions WHERE processing_run_id = p_run_id;
  IF FOUND THEN
    IF v_revision.investigation_digest <> lower(coalesce(p_revision ->> 'investigation_digest', '')) THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN json_build_object('created', false, 'studyRevision', hive.study_revision_summary_json(v_revision),
                             'reportRuns', hive.latest_report_runs_json(v_revision.id),
                             'processingRun', hive.processing_run_json(v_run));
  END IF;

  IF v_run.status <> 'ACCEPTING_STUDY' THEN
    RAISE EXCEPTION 'processing_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF NOT hive.processing_run_snapshot_current(v_run) THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'SOURCE_CHANGED',
           error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = p_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('created', false, 'sourceChanged', true, 'processingRun', hive.processing_run_json(v_run));
  END IF;

  SELECT * INTO v_preview FROM hive.study_prompt_previews WHERE processing_run_id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preview_not_saved' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO hive.canonical_studies (hive_id, owner_user_id)
  VALUES (v_run.hive_id, v_run.owner_user_id)
  ON CONFLICT ON CONSTRAINT uq_canonical_studies__hive DO NOTHING;
  SELECT * INTO v_study FROM hive.canonical_studies WHERE hive_id = v_run.hive_id FOR UPDATE;

  SELECT coalesce(max(s.revision_number), 0) + 1 INTO v_number
    FROM hive.study_revisions s WHERE s.canonical_study_id = v_study.id;

  INSERT INTO hive.study_revisions (
    canonical_study_id, hive_id, owner_user_id, revision_number, predecessor_revision_id,
    processing_run_id, study_prompt_preview_id, investigation, verification, audience_configuration,
    investigation_digest, prompt_digest, source_snapshot_digest, intent_snapshot_digest, coverage_digest,
    coverage_complete, coverage_status, coverage_gaps, coverage_acknowledgement, model_alias, resolved_model
  )
  VALUES (
    v_study.id, v_run.hive_id, v_run.owner_user_id, v_number, v_study.current_revision_id,
    v_run.id, v_preview.id, p_revision -> 'investigation', p_revision -> 'verification',
    p_revision -> 'audience_configuration',
    lower(p_revision ->> 'investigation_digest'), v_preview.prompt_digest, v_run.source_snapshot_digest,
    v_run.intent_snapshot_digest, v_run.coverage_digest, v_run.coverage_complete,
    v_run.coverage_status, v_run.coverage_gaps, v_run.coverage_acknowledgement,
    nullif(p_revision ->> 'model_alias', ''), nullif(p_revision ->> 'resolved_model', '')
  )
  RETURNING * INTO v_revision;

  UPDATE hive.canonical_studies SET current_revision_id = v_revision.id, updated_at = now() WHERE id = v_study.id;

  INSERT INTO hive.report_runs (hive_id, owner_user_id, study_revision_id, audience, trigger, correlation_id, next_dispatch_at)
  SELECT v_run.hive_id, v_run.owner_user_id, v_revision.id, a.audience, 'STUDY_ACCEPTED', gen_random_uuid(),
         now() + interval '30 seconds'
    FROM (VALUES ('CUSTOMER'), ('PRO')) AS a (audience);

  v_metrics := v_run.stage_metrics;
  IF p_revision ? 'stage_metric' AND hive.is_valid_stage_metric(p_revision -> 'stage_metric') THEN
    v_metrics := v_metrics || jsonb_build_array(p_revision -> 'stage_metric');
  END IF;

  UPDATE hive.processing_runs
     SET status = 'SUCCEEDED',
         stage_metrics = v_metrics,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE id = p_run_id
  RETURNING * INTO v_run;

  UPDATE hive.study_prompt_previews
     SET superseded_by_run_id = v_run.id
   WHERE hive_id = v_run.hive_id
     AND processing_run_id <> v_run.id
     AND superseded_by_run_id IS NULL;

  RETURN json_build_object('created', true, 'studyRevision', hive.study_revision_summary_json(v_revision),
                           'reportRuns', hive.latest_report_runs_json(v_revision.id),
                           'processingRun', hive.processing_run_json(v_run));
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

-- Reads the run is waiting for that no invocation has started yet.
CREATE OR REPLACE FUNCTION public.get_processing_run_queued_reads(p_run_id uuid)
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN json_build_object('readIds', coalesce((
    SELECT json_agg(r.id ORDER BY r.created_at, r.id)
      FROM hive.document_reads r
     WHERE r.hive_id = v_run.hive_id AND r.status = 'QUEUED' AND r.lease_expires_at > now()
  ), '[]'::json));
END;
$$;

-- Page text for the frozen, authorized pages of a run (the Study binds these into the prompt).
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
         AND p.page_set_digest = doc.d ->> 'pageSetDigest'
    ), '[]'::json)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Writer runs (service_role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_report_run(p_report_run_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.report_runs%ROWTYPE;
BEGIN
  PERFORM hive.require_service_role();
  SELECT * INTO v_run FROM hive.report_runs WHERE id = p_report_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status IN ('SUCCEEDED', 'FAILED')
     OR (v_run.status <> 'QUEUED' AND v_run.lease_expires_at > now())
     OR (v_run.status = 'QUEUED' AND v_run.next_dispatch_at IS NOT NULL AND v_run.next_dispatch_at > now()
         AND v_run.attempt_count > 0) THEN
    RETURN json_build_object('claimed', false, 'reportRun', hive.report_run_json(v_run));
  END IF;
  IF v_run.attempt_count >= v_run.max_attempts THEN
    UPDATE hive.report_runs
       SET status = 'FAILED',
           error_code = coalesce(error_code, 'REPORT_INTERRUPTED'),
           error_message_safe = coalesce(error_message_safe, 'The report stopped before it finished. You can generate it again.'),
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = p_report_run_id
    RETURNING * INTO v_run;
    RETURN json_build_object('claimed', false, 'reportRun', hive.report_run_json(v_run));
  END IF;
  -- A lapsed WRITING/VALIDATING/SAVING lease restarts the run as a new attempt.
  IF v_run.status <> 'QUEUED' THEN
    UPDATE hive.report_runs SET status = 'QUEUED' WHERE id = p_report_run_id;
  END IF;
  UPDATE hive.report_runs
     SET status = 'WRITING',
         attempt_count = attempt_count + 1,
         started_at = coalesce(started_at, now()),
         lease_expires_at = now() + interval '300 seconds',
         next_dispatch_at = NULL
   WHERE id = p_report_run_id
  RETURNING * INTO v_run;
  RETURN json_build_object('claimed', true, 'reportRun', hive.report_run_json(v_run));
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_report_run(
  p_report_run_id uuid,
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
  v_run hive.report_runs%ROWTYPE;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_to text := upper(btrim(coalesce(p_to_status, '')));
  v_metrics jsonb;
  v_retry boolean;
BEGIN
  PERFORM hive.require_service_role();
  IF v_to NOT IN ('VALIDATING', 'SAVING', 'FAILED') OR jsonb_typeof(v_details) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM hive.report_runs WHERE id = p_report_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> upper(btrim(coalesce(p_from_status, ''))) THEN
    RETURN json_build_object('applied', false, 'reportRun', hive.report_run_json(v_run));
  END IF;
  v_metrics := v_run.stage_metrics;
  IF v_details ? 'stage_metric' THEN
    IF NOT hive.is_valid_stage_metric(v_details -> 'stage_metric') THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
    v_metrics := v_metrics || jsonb_build_array(v_details -> 'stage_metric');
  END IF;

  -- A retryable failure with attempts left goes back to QUEUED (the Study is never rerun).
  v_retry := v_to = 'FAILED' AND coalesce((v_details ->> 'retryable')::boolean, false)
             AND v_run.attempt_count < v_run.max_attempts;

  UPDATE hive.report_runs
     SET status = CASE WHEN v_retry THEN 'QUEUED' ELSE v_to END,
         stage_metrics = v_metrics,
         lease_expires_at = CASE WHEN v_to = 'FAILED' THEN NULL ELSE now() + interval '300 seconds' END,
         next_dispatch_at = CASE WHEN v_retry THEN now() + make_interval(secs => 30 * v_run.attempt_count) ELSE NULL END,
         error_code = CASE WHEN v_to = 'FAILED' THEN nullif(btrim(v_details ->> 'error_code'), '') ELSE error_code END,
         error_message_safe = CASE WHEN v_to = 'FAILED'
           THEN nullif(left(btrim(coalesce(v_details ->> 'error_message_safe', '')), 300), '') ELSE error_message_safe END,
         retryable = CASE WHEN v_to = 'FAILED' THEN (v_details ->> 'retryable')::boolean ELSE retryable END,
         finished_at = CASE WHEN v_to = 'FAILED' AND NOT v_retry THEN now() ELSE NULL END
   WHERE id = p_report_run_id
  RETURNING * INTO v_run;
  RETURN json_build_object('applied', true, 'retrying', v_retry, 'reportRun', hive.report_run_json(v_run));
EXCEPTION
  WHEN invalid_text_representation OR check_violation THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

-- Write-once report; the run succeeds in the same transaction.
CREATE OR REPLACE FUNCTION public.save_report(p_report_run_id uuid, p_report jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.report_runs%ROWTYPE;
  v_report hive.reports%ROWTYPE;
BEGIN
  PERFORM hive.require_service_role();
  IF jsonb_typeof(coalesce(p_report, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM hive.report_runs WHERE id = p_report_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_report FROM hive.reports WHERE report_run_id = p_report_run_id;
  IF FOUND THEN
    RETURN json_build_object('created', false, 'report', hive.report_summary_json(v_report),
                             'reportRun', hive.report_run_json(v_run));
  END IF;
  IF v_run.status <> 'SAVING' THEN
    RAISE EXCEPTION 'report_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO hive.reports (
    report_run_id, hive_id, owner_user_id, study_revision_id, audience, title,
    writer_output, scenario_analysis, view, writer_prompt_digest, model_alias, resolved_model
  )
  VALUES (
    v_run.id, v_run.hive_id, v_run.owner_user_id, v_run.study_revision_id, v_run.audience,
    left(p_report -> 'view' ->> 'title', 160),
    p_report -> 'writer_output', p_report -> 'scenario_analysis', p_report -> 'view',
    lower(p_report ->> 'writer_prompt_digest'),
    nullif(p_report ->> 'model_alias', ''), nullif(p_report ->> 'resolved_model', '')
  )
  RETURNING * INTO v_report;

  UPDATE hive.report_runs
     SET status = 'SUCCEEDED', lease_expires_at = NULL, next_dispatch_at = NULL, finished_at = now(),
         error_code = NULL, error_message_safe = NULL, retryable = NULL
   WHERE id = p_report_run_id
  RETURNING * INTO v_run;

  RETURN json_build_object('created', true, 'report', hive.report_summary_json(v_report),
                           'reportRun', hive.report_run_json(v_run));
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
END;
$$;

-- Everything one Writer call needs, from the accepted revision only.
CREATE OR REPLACE FUNCTION public.get_report_generation_inputs(p_report_run_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_run hive.report_runs%ROWTYPE;
  v_revision hive.study_revisions%ROWTYPE;
  v_preview hive.study_prompt_previews%ROWTYPE;
  v_source hive.processing_runs%ROWTYPE;
BEGIN
  PERFORM hive.require_service_role();
  SELECT * INTO v_run FROM hive.report_runs WHERE id = p_report_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_revision FROM hive.study_revisions WHERE id = v_run.study_revision_id;
  SELECT * INTO v_preview FROM hive.study_prompt_previews WHERE id = v_revision.study_prompt_preview_id;
  SELECT * INTO v_source FROM hive.processing_runs WHERE id = v_revision.processing_run_id;
  RETURN json_build_object(
    'reportRun', hive.report_run_json(v_run),
    'studyRevision', json_build_object(
      'id', v_revision.id,
      'revisionNumber', v_revision.revision_number,
      'processingRunId', v_revision.processing_run_id,
      'investigation', v_revision.investigation,
      'verification', v_revision.verification,
      'audienceConfiguration', v_revision.audience_configuration,
      'coverageComplete', v_revision.coverage_complete,
      'coverageStatus', v_revision.coverage_status,
      'coverageGaps', v_revision.coverage_gaps
    ),
    'domainProposal', v_preview.domain_proposal,
    'sourceSnapshot', v_source.source_snapshot,
    'intents', coalesce((
      SELECT json_agg(json_build_object('id', i.id, 'intentText', i.intent_text) ORDER BY i.created_at, i.id)
        FROM hive.intent_requests i
       WHERE i.hive_id = v_run.hive_id AND i.id = ANY (v_source.intent_request_ids)
    ), '[]'::json)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Owner RPCs: reports (freely accessible; no billing or entitlement checks)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.require_owned_hive(p_hive_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hive.hives h
     WHERE h.id = p_hive_id AND h.owner_user_id = v_uid AND h.archived_at IS NULL AND h.deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hive_reports(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_revision hive.study_revisions%ROWTYPE;
  v_has_revision boolean;
BEGIN
  PERFORM hive.require_owned_hive(p_hive_id);
  SELECT s.* INTO v_revision FROM hive.study_revisions s
    JOIN hive.canonical_studies c ON c.id = s.canonical_study_id
   WHERE c.hive_id = p_hive_id AND s.id = c.current_revision_id;
  v_has_revision := FOUND;
  RETURN json_build_object(
    'studyRevision', CASE WHEN v_has_revision THEN hive.study_revision_summary_json(v_revision) END,
    'reportRuns', CASE WHEN v_has_revision THEN hive.latest_report_runs_json(v_revision.id) ELSE '[]'::json END,
    'latest', coalesce((
      SELECT json_agg(hive.report_json(x.p) ORDER BY x.audience)
        FROM (
          SELECT DISTINCT ON (p.audience) p, p.audience
            FROM hive.reports p
           WHERE p.hive_id = p_hive_id AND v_has_revision AND p.study_revision_id = v_revision.id
           ORDER BY p.audience, p.created_at DESC, p.id DESC
        ) x
    ), '[]'::json),
    'history', coalesce((
      SELECT json_agg(hive.report_summary_json(p) ORDER BY p.created_at DESC, p.id DESC)
        FROM hive.reports p WHERE p.hive_id = p_hive_id
    ), '[]'::json)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hive_report(p_hive_id uuid, p_report_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_report hive.reports%ROWTYPE;
BEGIN
  PERFORM hive.require_owned_hive(p_hive_id);
  SELECT * INTO v_report FROM hive.reports WHERE id = p_report_id AND hive_id = p_hive_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN json_build_object('report', hive.report_json(v_report));
END;
$$;

-- "Generate again": a new Writer run over the same accepted revision. The Study is not rerun.
CREATE OR REPLACE FUNCTION public.generate_hive_report(
  p_hive_id uuid,
  p_study_revision_id uuid,
  p_audience text,
  p_request_id uuid,
  p_correlation_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_audience text := upper(btrim(coalesce(p_audience, '')));
  v_run hive.report_runs%ROWTYPE;
BEGIN
  v_uid := hive.require_owned_hive(p_hive_id);
  IF v_audience NOT IN ('CUSTOMER', 'PRO') OR p_request_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hive.study_revisions s WHERE s.id = p_study_revision_id AND s.hive_id = p_hive_id) THEN
    RAISE EXCEPTION 'study_revision_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_run FROM hive.report_runs
   WHERE owner_user_id = v_uid AND request_id = p_request_id AND audience = v_audience;
  IF FOUND THEN
    IF v_run.study_revision_id <> p_study_revision_id THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN json_build_object('reportRun', hive.report_run_json(v_run), 'created', false);
  END IF;

  SELECT * INTO v_run FROM hive.report_runs
   WHERE study_revision_id = p_study_revision_id AND audience = v_audience AND status NOT IN ('SUCCEEDED', 'FAILED');
  IF FOUND THEN
    RETURN json_build_object('reportRun', hive.report_run_json(v_run), 'created', false);
  END IF;

  INSERT INTO hive.report_runs (
    hive_id, owner_user_id, study_revision_id, audience, trigger, request_id, correlation_id, next_dispatch_at
  )
  VALUES (p_hive_id, v_uid, p_study_revision_id, v_audience, 'OWNER_GENERATE', p_request_id, p_correlation_id,
          now() + interval '30 seconds')
  RETURNING * INTO v_run;
  RETURN json_build_object('reportRun', hive.report_run_json(v_run), 'created', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Recovery sweeper: pg_cron every minute → pg_net → internal worker route
-- ---------------------------------------------------------------------------
-- Due work: queued reads nobody picked up, runs whose stage is unclaimed (or whose lease lapsed),
-- and Writer runs that are queued or whose lease lapsed. Claims in the worker are compare-and-set,
-- so a duplicate dispatch is harmless. Without both Vault secrets the sweeper does nothing.
CREATE OR REPLACE FUNCTION public.dispatch_due_work(p_limit integer DEFAULT 25)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, extensions, pg_temp
AS $$
DECLARE
  v_url text;
  v_token text;
  v_item record;
  v_count integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'hive_internal_worker_url';
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'hive_internal_worker_token';
  IF coalesce(v_url, '') !~ '^https://' OR coalesce(v_token, '') = '' THEN
    RETURN 0;
  END IF;

  FOR v_item IN
    (SELECT 'document_read' AS kind, r.id
       FROM hive.document_reads r
      WHERE r.status = 'QUEUED' AND r.started_at IS NULL AND r.created_at < now() - interval '30 seconds'
        AND r.lease_expires_at > now()
      ORDER BY r.created_at
      LIMIT v_limit)
    UNION ALL
    (SELECT 'analysis', p.id
       FROM hive.processing_runs p
      WHERE p.status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
        AND (p.lease_expires_at IS NULL OR p.lease_expires_at < now())
        AND (p.next_dispatch_at IS NULL OR p.next_dispatch_at <= now())
      ORDER BY p.updated_at
      LIMIT v_limit)
    UNION ALL
    (SELECT 'report', r.id
       FROM hive.report_runs r
      WHERE (r.status = 'QUEUED' AND (r.next_dispatch_at IS NULL OR r.next_dispatch_at <= now()))
         OR (r.status IN ('WRITING', 'VALIDATING', 'SAVING') AND r.lease_expires_at < now())
      ORDER BY r.updated_at
      LIMIT v_limit)
  LOOP
    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/api/internal/workflow',
      body := jsonb_build_object('kind', v_item.kind, 'id', v_item.id),
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json'),
      timeout_milliseconds := 5000
    );
    v_count := v_count + 1;
  END LOOP;

  -- Stop re-dispatching the same unclaimed item every minute while an invocation is starting.
  UPDATE hive.processing_runs
     SET next_dispatch_at = now() + interval '50 seconds'
   WHERE status NOT IN ('AWAITING_ACKNOWLEDGEMENT', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     AND (lease_expires_at IS NULL OR lease_expires_at < now())
     AND (next_dispatch_at IS NULL OR next_dispatch_at <= now());

  RETURN v_count;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hive-dispatch-due-work') THEN
    PERFORM cron.unschedule('hive-dispatch-due-work');
  END IF;
  PERFORM cron.schedule('hive-dispatch-due-work', '* * * * *', 'SELECT public.dispatch_due_work()');
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Row-Level Security & least-privilege grants
-- ---------------------------------------------------------------------------
ALTER TABLE hive.canonical_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.canonical_studies FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.study_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.study_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.report_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.reports FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.coverage_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.coverage_acknowledgements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_coverage_acknowledgements__select__owner ON hive.coverage_acknowledgements;
CREATE POLICY pol_coverage_acknowledgements__select__owner ON hive.coverage_acknowledgements FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM hive.hives h WHERE h.id = coverage_acknowledgements.hive_id AND h.owner_user_id = auth.uid()
       AND h.archived_at IS NULL AND h.deleting_at IS NULL));

REVOKE ALL ON hive.coverage_acknowledgements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hive.coverage_acknowledgements TO authenticated;
GRANT ALL ON hive.coverage_acknowledgements TO service_role;

DROP POLICY IF EXISTS pol_canonical_studies__select__owner ON hive.canonical_studies;
CREATE POLICY pol_canonical_studies__select__owner ON hive.canonical_studies FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM hive.hives h WHERE h.id = canonical_studies.hive_id AND h.owner_user_id = auth.uid()
       AND h.archived_at IS NULL AND h.deleting_at IS NULL));

DROP POLICY IF EXISTS pol_study_revisions__select__owner ON hive.study_revisions;
CREATE POLICY pol_study_revisions__select__owner ON hive.study_revisions FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM hive.hives h WHERE h.id = study_revisions.hive_id AND h.owner_user_id = auth.uid()
       AND h.archived_at IS NULL AND h.deleting_at IS NULL));

DROP POLICY IF EXISTS pol_report_runs__select__owner ON hive.report_runs;
CREATE POLICY pol_report_runs__select__owner ON hive.report_runs FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM hive.hives h WHERE h.id = report_runs.hive_id AND h.owner_user_id = auth.uid()
       AND h.archived_at IS NULL AND h.deleting_at IS NULL));

DROP POLICY IF EXISTS pol_reports__select__owner ON hive.reports;
CREATE POLICY pol_reports__select__owner ON hive.reports FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM hive.hives h WHERE h.id = reports.hive_id AND h.owner_user_id = auth.uid()
       AND h.archived_at IS NULL AND h.deleting_at IS NULL));

REVOKE ALL ON hive.canonical_studies, hive.study_revisions, hive.report_runs, hive.reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hive.canonical_studies, hive.study_revisions, hive.report_runs, hive.reports TO authenticated;
GRANT ALL ON hive.canonical_studies, hive.study_revisions, hive.report_runs, hive.reports TO service_role;

REVOKE ALL ON FUNCTION hive.enforce_processing_run_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.enforce_immutable_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.enforce_report_run_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.processing_run_snapshot_current(hive.processing_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.expire_stale_processing_runs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.is_valid_stage_metric(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.processing_run_json(hive.processing_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.study_revision_summary_json(hive.study_revisions) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.report_run_json(hive.report_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.report_summary_json(hive.reports) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.report_json(hive.reports) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.latest_report_runs_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.require_service_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.require_owned_hive(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION hive.classify_coverage_gaps(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.coverage_status_for(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.unacknowledged_material_gaps(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.record_coverage_acknowledgements(hive.processing_runs, jsonb, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.start_study_preparation(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_study_preparation(uuid, uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.acknowledge_study_coverage(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_study_coverage(uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_study_preparation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_preparation(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.get_hive_reports(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hive_reports(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_hive_report(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hive_report(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.generate_hive_report(uuid, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_hive_report(uuid, uuid, text, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_processing_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_processing_run(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.release_processing_run(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_processing_run(uuid, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.retry_processing_run_stage(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_processing_run_stage(uuid, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.transition_processing_run(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_processing_run(uuid, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.accept_study_revision(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_study_revision(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.get_processing_run_queued_reads(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_processing_run_queued_reads(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_study_source_pages(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_study_source_pages(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_report_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_report_run(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.transition_report_run(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_report_run(uuid, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_report(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_report(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.get_report_generation_inputs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_report_generation_inputs(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.dispatch_due_work(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_due_work(integer) TO service_role;

COMMIT;
