-- QF-1a: shared pgTAP fixture helpers (prepended to each *.test.sql in CI and scripts/run-pgtap-database.mjs).
-- FL-5: direct hive.hives inserts must also create the owner hive_members row like public.create_hive.

CREATE OR REPLACE FUNCTION pg_temp.qf1a_seed_user(p_user_id uuid, p_email text)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (p_user_id, p_email, 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.qf1a_ensure_owner_memberships()
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by)
  SELECT h.id, h.owner_user_id, 'owner', 'active', h.owner_user_id
    FROM hive.hives h
   WHERE NOT EXISTS (
     SELECT 1
       FROM hive.hive_members m
      WHERE m.hive_id = h.id
        AND m.user_id = h.owner_user_id
        AND m.role = 'owner'
        AND m.state = 'active'
   );
$$;

-- Insert a processing run with digests and frozen snapshot computed like public.start_study_preparation.
CREATE OR REPLACE FUNCTION pg_temp.qf1a_insert_frozen_study_preparation_run(
  p_id uuid,
  p_hive_id uuid,
  p_owner_user_id uuid,
  p_request_id uuid,
  p_correlation_id uuid,
  p_status text,
  p_attempt_number integer DEFAULT 1,
  p_stage_attempt integer DEFAULT 1,
  p_stage_outputs jsonb DEFAULT '{}'::jsonb,
  p_lease_expires_at timestamptz DEFAULT NULL,
  p_next_dispatch_at timestamptz DEFAULT NULL,
  p_workflow_last_handoff_at timestamptz DEFAULT NULL,
  p_updated_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_intents jsonb;
  v_sources jsonb;
  v_gaps jsonb;
  v_coverage_status text;
  v_acknowledgement text;
BEGIN
  v_intents := hive.compute_study_intent_snapshot(p_hive_id);
  v_sources := hive.compute_study_source_snapshot(p_hive_id);
  v_gaps := hive.classify_coverage_gaps(v_sources);
  v_coverage_status := hive.coverage_status_for(v_gaps);
  v_acknowledgement := CASE WHEN v_coverage_status = 'MATERIAL_GAPS' THEN 'PENDING' ELSE 'NOT_REQUIRED' END;

  INSERT INTO hive.processing_runs (
    id, hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
    authorized_source_document_ids, intent_request_ids, source_snapshot,
    source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
    coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement,
    snapshot_frozen_at, stage_attempt, stage_outputs,
    lease_expires_at, next_dispatch_at, workflow_last_handoff_at, updated_at
  )
  VALUES (
    p_id,
    p_hive_id,
    p_owner_user_id,
    'STUDY_PREPARATION',
    p_request_id,
    p_attempt_number,
    p_status,
    p_correlation_id,
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
    now(),
    p_stage_attempt,
    p_stage_outputs,
    p_lease_expires_at,
    p_next_dispatch_at,
    p_workflow_last_handoff_at,
    coalesce(p_updated_at, now())
  );

  RETURN p_id;
END;
$$;

-- pg_cron is optional locally; avoid parsing cron.job when the extension is absent.
CREATE OR REPLACE FUNCTION pg_temp.qf1a_no_hive_dispatch_cron_job()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    RETURN true;
  END IF;
  RETURN NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hive-dispatch-due-work');
END;
$$;