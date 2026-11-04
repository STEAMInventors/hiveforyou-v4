-- V4-004G: Restore persisted intent decomposition, specialist questions (whyItMatters, supportsOutcome),
-- investigation plan deliverables, and stated intent audience in get_report_generation_inputs so the
-- Writer receives the validated upstream task and professional-work context without rerunning the Study.

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
    ), '[]'::json)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_report_generation_inputs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_report_generation_inputs(uuid) TO service_role;
