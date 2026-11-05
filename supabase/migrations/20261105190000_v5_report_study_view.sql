-- V5-005b part B — reports store hive.study-view/1 for canonical-study-1 revisions.
-- Widens hive.reports JSON check with a second accepted shape (legacy shape unchanged), lets save_report
-- take an explicit title, exposes the study-view citation index on report_json, and adds the revision
-- format and the run's verified doc extractions to get_report_generation_inputs.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

-- ---------------------------------------------------------------------------
-- hive.reports — legacy hive-application-view/1 OR hive.study-view/1 with hive.write-run/1 metrics
-- ---------------------------------------------------------------------------
ALTER TABLE hive.reports DROP CONSTRAINT IF EXISTS ck_reports__json;
ALTER TABLE hive.reports ADD CONSTRAINT ck_reports__json CHECK (
  (
    jsonb_typeof(writer_output) = 'object' AND writer_output ->> 'schema' = 'hive.writer-report/1'
    AND writer_output ->> 'audience' = audience
    AND jsonb_typeof(scenario_analysis) = 'object' AND scenario_analysis ->> 'schema' = 'hive.scenario-analysis/1'
    AND jsonb_typeof(view) = 'object' AND view ->> 'schema' = 'hive-application-view/1'
    AND view ->> 'audience' = audience
    AND octet_length(writer_output::text) <= 524288
    AND octet_length(view::text) <= 1048576
  )
  OR (
    jsonb_typeof(writer_output) = 'object' AND writer_output ->> 'schema' = 'hive.write-run/1'
    AND writer_output ->> 'audience' = audience
    AND jsonb_typeof(writer_output -> 'calls') = 'array'
    AND jsonb_typeof(writer_output -> 'drops') = 'object'
    AND jsonb_typeof(writer_output -> 'sources') = 'object'
    AND scenario_analysis = '{}'::jsonb
    AND jsonb_typeof(view) = 'object' AND view ->> 'schema' = 'hive.study-view/1'
    AND jsonb_typeof(view -> 'sections') = 'array'
    AND jsonb_typeof(view -> 'blocks') = 'array'
    AND octet_length(writer_output::text) <= 524288
    AND octet_length(view::text) <= 1048576
  )
);

-- ---------------------------------------------------------------------------
-- save_report — title from the view, else the explicit p_report.title (study views carry none)
-- ---------------------------------------------------------------------------
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
    left(coalesce(nullif(btrim(p_report -> 'view' ->> 'title'), ''), nullif(btrim(p_report ->> 'title'), '')), 160),
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

-- ---------------------------------------------------------------------------
-- report_json — study views also return their citation index (fact id -> document page and quote)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.report_json(p hive.reports)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT (hive.report_summary_json(p)::jsonb || jsonb_build_object(
    'view', p.view,
    'scenarioAnalysis', CASE WHEN p.view ->> 'schema' = 'hive.study-view/1' THEN NULL ELSE p.scenario_analysis END,
    'studyViewSources', CASE WHEN p.view ->> 'schema' = 'hive.study-view/1' THEN p.writer_output -> 'sources' END,
    'modelAlias', p.model_alias
  ))::json;
$$;

REVOKE ALL ON FUNCTION hive.report_json(hive.reports) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_report_generation_inputs — adds studyRevision.format and, for canonical-study-1, the verified
-- doc extractions bound to the revision's frozen snapshot (same rows the canonicalize stage read)
-- ---------------------------------------------------------------------------
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
      'format', v_revision.format,
      'investigation', v_revision.investigation,
      'verification', v_revision.verification,
      'audienceConfiguration', v_revision.audience_configuration,
      'coverageComplete', v_revision.coverage_complete,
      'coverageStatus', v_revision.coverage_status,
      'coverageGaps', v_revision.coverage_gaps
    ),
    'intentDecomposition', v_preview.intent_decomposition,
    'domainProposal', v_preview.domain_proposal,
    'intentIntelligence', v_preview.intent_intelligence,
    'investigationPlan', v_preview.investigation_plan,
    'sourceSnapshot', v_source.source_snapshot,
    'intents', coalesce((
      SELECT json_agg(
               json_build_object(
                 'id', i.id,
                 'intentText', i.intent_text,
                 'audience', i.audience
               )
               ORDER BY i.created_at, i.id
             )
        FROM hive.intent_requests i
       WHERE i.hive_id = v_run.hive_id
         AND i.owner_user_id = v_run.owner_user_id
         AND i.id = ANY (v_source.intent_request_ids)
    ), '[]'::json),
    'extractions', coalesce((
      SELECT json_agg(e.extraction ORDER BY e.source_document_id, e.created_at)
        FROM hive.doc_extractions e
        JOIN LATERAL (
          SELECT (d ->> 'sourceDocumentId')::uuid AS doc_id,
                 lower(btrim(d ->> 'pageSetDigest')) AS content_digest
            FROM jsonb_array_elements(coalesce(v_source.source_snapshot -> 'documents', '[]'::jsonb)) d
        ) snap
          ON snap.doc_id = e.source_document_id
         AND snap.content_digest = e.content_digest
       WHERE e.hive_id = v_run.hive_id
         AND v_revision.format = 'canonical-study-1'
    ), '[]'::json)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_report_generation_inputs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_report_generation_inputs(uuid) TO service_role;

COMMIT;
