-- V4-004 refinement — Intent intelligence stage and intent audience (D-040).
--
-- Additive to 20261102090000_create_study_preparation.sql:
--   * hive.intent_requests.audience (optional, write-once with the intent) and a 4-argument
--     public.create_intent_request that accepts it;
--   * a DEVELOPING_QUESTIONS run status between IDENTIFYING_DOMAIN and PLANNING_INVESTIGATION,
--     whose validated output `intentIntelligence` gates planning;
--   * hive.study_prompt_previews.intent_intelligence (NULL for previews saved before this stage).
-- The intent snapshot digest is unchanged (audience is fixed when the intent is saved).
--
-- Authority: HiveForYou-DATA-MODEL.md, HiveForYou-DECISIONS.md (D-039, D-040).
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Intent audience
-- ---------------------------------------------------------------------------
ALTER TABLE hive.intent_requests ADD COLUMN IF NOT EXISTS audience text;

ALTER TABLE hive.intent_requests DROP CONSTRAINT IF EXISTS ck_intent_requests__audience_length;
ALTER TABLE hive.intent_requests ADD CONSTRAINT ck_intent_requests__audience_length CHECK (
  audience IS NULL OR (audience = btrim(audience) AND char_length(audience) BETWEEN 1 AND 200)
);

DROP FUNCTION IF EXISTS public.create_intent_request(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.create_intent_request(
  p_hive_id uuid,
  p_intent_text text,
  p_client_request_id uuid,
  p_audience text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_text text := btrim(coalesce(p_intent_text, ''));
  v_audience text := nullif(btrim(regexp_replace(coalesce(p_audience, ''), '\s+', ' ', 'g')), '');
  v_row hive.intent_requests%ROWTYPE;
  v_created boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:id_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_text) < 1 OR char_length(v_text) > 2000 THEN
    RAISE EXCEPTION 'invalid_request:intent_length' USING ERRCODE = '22023';
  END IF;
  IF v_audience IS NOT NULL AND char_length(v_audience) > 200 THEN
    RAISE EXCEPTION 'invalid_request:audience_length' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hive.hives h
     WHERE h.id = p_hive_id AND h.owner_user_id = v_uid AND h.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO hive.intent_requests (hive_id, owner_user_id, intent_text, client_request_id, audience)
  VALUES (p_hive_id, v_uid, v_text, p_client_request_id, v_audience)
  ON CONFLICT ON CONSTRAINT uq_intent_requests__owner_client_request DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_created := true;
  ELSE
    SELECT * INTO v_row
      FROM hive.intent_requests r
     WHERE r.owner_user_id = v_uid AND r.client_request_id = p_client_request_id;
    IF v_row.hive_id IS DISTINCT FROM p_hive_id
       OR v_row.intent_text IS DISTINCT FROM v_text
       OR v_row.audience IS DISTINCT FROM v_audience THEN
      RAISE EXCEPTION 'idempotency_conflict'
        USING ERRCODE = '23505', CONSTRAINT = 'uq_intent_requests__owner_client_request';
    END IF;
  END IF;

  RETURN json_build_object(
    'intentRequest', json_build_object(
      'id', v_row.id,
      'intentRequestId', v_row.id,
      'hiveId', v_row.hive_id,
      'clientRequestId', v_row.client_request_id,
      'createdAt', v_row.created_at
    ),
    'created', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_intent_request(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_intent_request(uuid, text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. DEVELOPING_QUESTIONS status and transitions
-- ---------------------------------------------------------------------------
ALTER TABLE hive.processing_runs DROP CONSTRAINT IF EXISTS ck_processing_runs__status;
ALTER TABLE hive.processing_runs ADD CONSTRAINT ck_processing_runs__status CHECK (
  status IN (
    'QUEUED', 'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN', 'DEVELOPING_QUESTIONS',
    'PLANNING_INVESTIGATION', 'BUILDING_PROMPT', 'SAVING', 'SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED'
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
    OR (OLD.status = 'IDENTIFYING_DOMAIN' AND NEW.status IN ('DEVELOPING_QUESTIONS', 'FAILED'))
    OR (OLD.status = 'DEVELOPING_QUESTIONS' AND NEW.status IN ('PLANNING_INVESTIGATION', 'FAILED'))
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

CREATE OR REPLACE FUNCTION hive.is_valid_stage_metric(p_metric jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT coalesce(jsonb_typeof(p_metric) = 'object', false)
     AND coalesce(p_metric ->> 'stage' IN (
           'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN', 'DEVELOPING_QUESTIONS', 'PLANNING_INVESTIGATION'
         ), false)
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
      IF v_output_key NOT IN (
           'intentDecomposition', 'domainProposal', 'sampleCoverage', 'intentIntelligence', 'investigationPlan'
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

  -- Each stage may start only once the previous stage's validated output is saved.
  IF (v_to = 'IDENTIFYING_DOMAIN' AND NOT v_outputs ? 'intentDecomposition')
     OR (v_to = 'DEVELOPING_QUESTIONS' AND NOT (v_outputs ? 'domainProposal' AND v_outputs ? 'sampleCoverage'))
     OR (v_to = 'PLANNING_INVESTIGATION' AND NOT v_outputs ? 'intentIntelligence')
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

-- ---------------------------------------------------------------------------
-- 3. Preview column and readback
-- ---------------------------------------------------------------------------
ALTER TABLE hive.study_prompt_previews ADD COLUMN IF NOT EXISTS intent_intelligence jsonb;

ALTER TABLE hive.study_prompt_previews DROP CONSTRAINT IF EXISTS ck_study_prompt_previews__intent_intelligence;
ALTER TABLE hive.study_prompt_previews ADD CONSTRAINT ck_study_prompt_previews__intent_intelligence CHECK (
  intent_intelligence IS NULL OR jsonb_typeof(intent_intelligence) = 'object'
);

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
    'intentIntelligence', p.intent_intelligence,
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
  IF NOT (v_run.stage_outputs ?& ARRAY[
    'intentDecomposition', 'domainProposal', 'sampleCoverage', 'intentIntelligence', 'investigationPlan'
  ]) THEN
    RAISE EXCEPTION 'stage_output_missing' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO hive.study_prompt_previews (
    processing_run_id, hive_id, owner_user_id, intent_request_ids,
    intent_decomposition, domain_proposal, intent_intelligence, investigation_plan, sample_coverage,
    source_snapshot, execution_manifest, stage_metadata,
    prompt_id, prompt_version, prompt_template_digest, prompt_text, prompt_digest,
    source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete
  )
  VALUES (
    v_run.id, v_run.hive_id, v_run.owner_user_id, v_run.intent_request_ids,
    v_run.stage_outputs -> 'intentDecomposition',
    v_run.stage_outputs -> 'domainProposal',
    v_run.stage_outputs -> 'intentIntelligence',
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

-- ---------------------------------------------------------------------------
-- 4. Worker inputs carry the audience
-- ---------------------------------------------------------------------------
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
      SELECT json_agg(json_build_object('id', i.id, 'intentText', i.intent_text, 'audience', i.audience,
                                        'createdAt', i.created_at)
                      ORDER BY i.created_at, i.id)
        FROM hive.intent_requests i
       WHERE i.hive_id = v_run.hive_id
         AND i.owner_user_id = v_run.owner_user_id
         AND i.id = ANY (v_run.intent_request_ids)
    ), '[]'::json)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants (CREATE OR REPLACE keeps grants; restated for least privilege)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION hive.enforce_processing_run_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.is_valid_stage_metric(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hive.study_prompt_preview_json(hive.study_prompt_previews) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.transition_processing_run(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_processing_run(uuid, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.get_study_preparation_inputs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_study_preparation_inputs(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.save_study_prompt_preview(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_study_prompt_preview(uuid, jsonb) TO service_role;

COMMIT;
