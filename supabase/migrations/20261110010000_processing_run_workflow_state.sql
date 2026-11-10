-- Mutable workflow bookkeeping on a processing run (async planner job ids, extract hand-off counters).
-- These keys live in stage_outputs, but transition_processing_run only accepts the immutable stage-output
-- keys (canonicalStudy, ...) and rejects anything else with 'invalid_request'. Every write of these keys
-- therefore failed: canonicalize failed right after submitting its planner job, and the extract
-- zero-progress counter was never saved (its write is fire-and-forget). This RPC is the only writer of
-- these keys: allowlisted keys, overwrite allowed, null removes a key, no status/lease/dispatch side effects.
BEGIN;

CREATE OR REPLACE FUNCTION public.patch_processing_run_workflow_state(
  p_run_id uuid,
  p_expected_status text,
  p_patch jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_key text;
  v_status text := upper(btrim(coalesce(p_expected_status, '')));
  v_updated integer;
BEGIN
  PERFORM hive.require_service_role();

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request:workflow_state_patch_not_object' USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('plannerJobs', 'extractZeroProgressHandoffs', 'extractGapRetryCompleted') THEN
      RAISE EXCEPTION 'invalid_request:workflow_state_key_not_allowed:%', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_patch -> v_key) NOT IN ('object', 'null') THEN
      RAISE EXCEPTION 'invalid_request:workflow_state_value_not_object:%', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE hive.processing_runs r
     SET stage_outputs = (
           SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
             FROM jsonb_each(coalesce(r.stage_outputs, '{}'::jsonb) || p_patch) AS e(key, value)
            WHERE jsonb_typeof(e.value) <> 'null'
         )
   WHERE r.id = p_run_id
     AND r.status = v_status;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN json_build_object('applied', v_updated > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.patch_processing_run_workflow_state(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_processing_run_workflow_state(uuid, text, jsonb) TO service_role;

COMMIT;
