-- V5-005 — pipeline throughput samples and median stats for size-driven extraction timeouts.

BEGIN;

CREATE TABLE hive.pipeline_model_call_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task text NOT NULL,
  processing_run_id uuid NULL REFERENCES hive.processing_runs (id) ON DELETE SET NULL,
  succeeded_at timestamptz NOT NULL DEFAULT now(),
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  latency_ms integer NOT NULL,
  concurrency_at_start integer NOT NULL,
  page_range text NULL,
  page_count integer NULL,
  CONSTRAINT ck_pipeline_model_call_samples__task CHECK (task IN ('extract', 'canonicalize', 'write')),
  CONSTRAINT ck_pipeline_model_call_samples__tokens CHECK (
    input_tokens >= 0 AND output_tokens >= 0 AND latency_ms > 0 AND concurrency_at_start >= 1
  ),
  CONSTRAINT ck_pipeline_model_call_samples__page_count CHECK (page_count IS NULL OR page_count >= 1)
);

CREATE INDEX idx_pipeline_model_call_samples__task_succeeded
  ON hive.pipeline_model_call_samples (task, succeeded_at DESC);

COMMENT ON TABLE hive.pipeline_model_call_samples IS
  'Succeeded pipeline planner calls for throughput medians; no document text.';

CREATE OR REPLACE FUNCTION public.record_pipeline_model_call(
  p_run_id uuid,
  p_task text,
  p_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_task text := lower(btrim(coalesce(p_task, '')));
  v_input integer;
  v_output integer;
  v_latency integer;
  v_concurrency integer;
  v_page_range text;
  v_page_count integer;
BEGIN
  IF v_task NOT IN ('extract', 'canonicalize', 'write') THEN
    RAISE EXCEPTION 'invalid_task';
  END IF;

  v_input := (p_payload ->> 'inputTokens')::integer;
  v_output := (p_payload ->> 'outputTokens')::integer;
  v_latency := (p_payload ->> 'latencyMs')::integer;
  v_concurrency := (p_payload ->> 'concurrencyAtStart')::integer;
  v_page_range := nullif(lower(btrim(coalesce(p_payload ->> 'pageRange', ''))), '');
  v_page_count := nullif((p_payload ->> 'pageCount')::integer, 0);

  IF v_input IS NULL OR v_output IS NULL OR v_latency IS NULL OR v_concurrency IS NULL THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;
  IF v_input < 0 OR v_output < 0 OR v_latency <= 0 OR v_concurrency < 1 THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;

  INSERT INTO hive.pipeline_model_call_samples (
    task,
    processing_run_id,
    input_tokens,
    output_tokens,
    latency_ms,
    concurrency_at_start,
    page_range,
    page_count
  )
  VALUES (
    v_task,
    p_run_id,
    v_input,
    v_output,
    v_latency,
    v_concurrency,
    v_page_range,
    v_page_count
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pipeline_throughput(p_task text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_task text := lower(btrim(coalesce(p_task, '')));
  v_count integer;
  v_median_tps numeric;
  v_median_ratio numeric;
  v_median_input_per_page numeric;
BEGIN
  IF v_task NOT IN ('extract', 'canonicalize', 'write') THEN
    RAISE EXCEPTION 'invalid_task';
  END IF;

  WITH recent AS (
    SELECT
      input_tokens,
      output_tokens,
      latency_ms,
      page_count,
      (output_tokens::numeric / (latency_ms::numeric / 1000.0)) AS tps,
      CASE
        WHEN input_tokens > 0 THEN output_tokens::numeric / input_tokens::numeric
        ELSE NULL
      END AS ratio,
      CASE
        WHEN page_count IS NOT NULL AND page_count > 0 THEN input_tokens::numeric / page_count::numeric
        ELSE NULL
      END AS input_per_page
    FROM hive.pipeline_model_call_samples
    WHERE task = v_task
      AND output_tokens > 0
      AND latency_ms > 0
    ORDER BY succeeded_at DESC
    LIMIT 50
  )
  SELECT
    count(*)::integer,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY tps),
    percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio),
    percentile_cont(0.5) WITHIN GROUP (ORDER BY input_per_page)
  INTO v_count, v_median_tps, v_median_ratio, v_median_input_per_page
  FROM recent;

  IF coalesce(v_count, 0) < 5 THEN
    RETURN json_build_object(
      'sampleCount', coalesce(v_count, 0),
      'outputTokensPerSecond', CASE v_task
        WHEN 'extract' THEN 110
        WHEN 'canonicalize' THEN 70
        ELSE 100
      END,
      'outputInputRatio', 1.0,
      'inputTokensPerPage', CASE WHEN v_task = 'extract' THEN 400 ELSE NULL END
    );
  END IF;

  RETURN json_build_object(
    'sampleCount', v_count,
    'outputTokensPerSecond', round(v_median_tps::numeric, 2),
    'outputInputRatio', round(coalesce(v_median_ratio, 1.0)::numeric, 4),
    'inputTokensPerPage', CASE
      WHEN v_task = 'extract' THEN round(coalesce(v_median_input_per_page, 400)::numeric, 2)
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_pipeline_model_call(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pipeline_model_call(uuid, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.get_pipeline_throughput(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_throughput(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hive.is_valid_stage_metric(p_metric jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT coalesce(jsonb_typeof(p_metric) = 'object', false)
     AND coalesce(p_metric ->> 'stage' IN (
           'UNDERSTANDING_REQUEST', 'IDENTIFYING_DOMAIN', 'DEVELOPING_QUESTIONS', 'PLANNING_INVESTIGATION',
           'EXTRACTING', 'CANONICALIZING', 'INVESTIGATING', 'WRITING', 'ACCEPTING_STUDY'
         ), false)
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(p_metric) kv
        WHERE kv.key NOT IN (
                'stage', 'outcome', 'promptId', 'promptDigest', 'modelAliasRequested', 'resolvedModel',
                'promptTokens', 'completionTokens', 'totalTokens', 'latencyMs', 'plannerLatencyMs',
                'finishReason', 'startedAt', 'completedAt', 'errorCode', 'retryable', 'attempt',
                'estimatedDurationMs', 'actualDurationMs'
              )
           OR (kv.key IN (
                 'promptTokens', 'completionTokens', 'totalTokens', 'latencyMs', 'plannerLatencyMs', 'attempt',
                 'estimatedDurationMs', 'actualDurationMs'
               )
               AND NOT (jsonb_typeof(kv.value) = 'null'
                        OR (jsonb_typeof(kv.value) = 'number'
                            AND (kv.value #>> '{}') ~ '^[0-9]{1,10}$')))
           OR (kv.key = 'retryable' AND jsonb_typeof(kv.value) NOT IN ('boolean', 'null'))
           OR (kv.key NOT IN (
                 'promptTokens', 'completionTokens', 'totalTokens', 'latencyMs', 'plannerLatencyMs', 'retryable',
                 'attempt', 'estimatedDurationMs', 'actualDurationMs'
               )
               AND NOT (jsonb_typeof(kv.value) = 'null'
                        OR (jsonb_typeof(kv.value) = 'string'
                            AND (kv.value #>> '{}') ~ '^[A-Za-z0-9_.:/@+-]{1,128}$')))
     );
$$;

COMMIT;
