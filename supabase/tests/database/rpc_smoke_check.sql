-- QF-1a / FL-11: one-call-per-RPC smoke for every app/edge participant role.
-- Requires migrations through 20261115210000_list_hives_union_all.sql.
-- Paste into Supabase SQL editor (one transaction). Expect: ALL CHECKS PASSED, then ROLLBACK.
-- APP_RPC_COVERAGE_BEGIN
-- - accept_firm_invitation
-- - accept_invitation
-- - accept_study_revision
-- - acknowledge_study_coverage
-- - add_team_note
-- - apply_vault_transaction
-- - assign_hive
-- - backfill_processing_run_estimate
-- - backfill_report_run_estimate
-- - begin_doc_extraction_attempt
-- - begin_hive_deletion
-- - claim_processing_run
-- - claim_report_run
-- - complete_hive_deletion
-- - create_firm
-- - create_hive
-- - create_intent_request
-- - create_invitation
-- - fail_stale_in_flight_doc_extraction_attempts
-- - generate_hive_report
-- - get_doc_extraction_attempt_totals_for_run
-- - get_doc_extraction_gap_pages_for_run
-- - get_doc_extraction_ranges_for_run
-- - get_doc_extractions_for_run
-- - get_failure_diagnostics
-- - get_hive
-- - get_hive_by_client_request_id
-- - get_hive_report
-- - get_hive_reports
-- - get_invitation_welcome_context
-- - get_my_profile
-- - get_pipeline_throughput
-- - get_processing_run_queued_reads
-- - get_report_generation_inputs
-- - get_source_upload_by_client_request
-- - get_study_preparation
-- - get_study_preparation_inputs
-- - get_study_source_pages
-- - get_study_tab_view
-- - get_study_tab_view_definer
-- - get_upload_quota
-- - invite_firm_member
-- - list_document_pages
-- - list_document_reads
-- - list_firm
-- - list_hive_people
-- - list_hive_source_documents
-- - list_hives
-- - list_team_notes
-- - lookup_firm_invitation
-- - lookup_invitation
-- - patch_processing_run_workflow_state
-- - persist_intake_result
-- - persist_processing_run_estimate
-- - persist_report_run_estimate
-- - put_doc_extraction
-- - put_doc_extraction_range
-- - put_document_pages
-- - read_study_prompt_preview
-- - rebuild_study
-- - record_doc_extraction_attempt
-- - record_extracting_document_success
-- - record_pipeline_model_call
-- - recover_expired_workflow_leases
-- - release_processing_run
-- - remove_member
-- - reserve_processing_run_handoff
-- - retry_processing_run_stage
-- - revoke_firm_invitation
-- - revoke_invitation
-- - save_report
-- - save_study_prompt_preview
-- - set_assistant_name
-- - set_display_name
-- - set_hive_kind
-- - set_hive_stage
-- - set_starting_view
-- - start_document_reads
-- - start_study_preparation
-- - sweep_workflow_recovery
-- - transition_document_read
-- - transition_processing_run
-- - transition_report_run
-- - try_advance_extracting_to_canonicalizing
-- - update_doc_extraction_attempt_outcome
-- APP_RPC_COVERAGE_END
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.smoke_set_role(p_user uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.smoke_expect_ok(p_user uuid, p_sql text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp.smoke_set_role(p_user);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE = '22023' OR SQLERRM LIKE 'invalid_request%'
         OR SQLERRM LIKE '%idempotency%'
         OR SQLERRM LIKE '%already%'
         OR SQLERRM LIKE '%firm_already%'
         OR SQLERRM LIKE 'invitation_%'
         OR SQLERRM LIKE 'hive_not_found'
         OR SQLERRM LIKE 'processing_run_not_found'
         OR SQLERRM LIKE 'report_run_not_found'
         OR SQLERRM LIKE 'document_read_not_found'
         OR SQLERRM = 'apply_vault_transaction payload must be an object' THEN
        NULL;
      ELSE
        RAISE;
      END IF;
  END;
  RESET ROLE;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.smoke_expect_refusal(p_user uuid, p_sql text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp.smoke_set_role(p_user);
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'smoke_expect_refusal: unexpected success for %', left(p_sql, 80);
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      IF SQLSTATE IN ('42501', '23505', 'P0002', '42883')
         OR SQLERRM LIKE 'auth_required%'
         OR SQLERRM LIKE 'access_denied%'
         OR SQLERRM LIKE 'firm_membership_exists%'
         OR SQLERRM LIKE 'hive_not_found%'
         OR SQLERRM LIKE 'invitation_%'
         OR SQLERRM LIKE 'permission denied%'
         OR SQLERRM LIKE '%payload must be an object%' THEN
        NULL;
      ELSE
        RAISE;
      END IF;
  END;
  RESET ROLE;
END;
$$;

DO $check$
DECLARE
  v_owner uuid := 'f1100010-0000-4000-8000-000000000001';
  v_member uuid := 'f1100010-0000-4000-8000-000000000002';
  v_client uuid := 'f1100010-0000-4000-8000-000000000003';
  v_pro uuid := 'f1100010-0000-4000-8000-000000000004';
  v_stranger uuid := 'f1100010-0000-4000-8000-000000000005';
  v_stranger_firm uuid := 'f1100010-0000-4000-8000-000000000006';
  v_firm_two_creator uuid := 'f1100010-0000-4000-8000-000000000007';
  v_hive uuid;
  v_firm uuid;
  v_client_req uuid := 'f1100020-0000-4000-8000-000000000001';
  v_firm_token text := repeat('c', 64);
  v_token_client text := repeat('a', 64);
  v_token_pro text := repeat('b', 64);
  v_doc uuid := 'f1100030-0000-4000-8000-000000000001';
  v_intent uuid := 'f1100030-0000-4000-8000-000000000002';
  v_run uuid := 'f1100030-0000-4000-8000-000000000003';
  v_canonical uuid := 'f1100030-0000-4000-8000-000000000004';
  v_revision uuid := 'f1100030-0000-4000-8000-000000000005';
  v_report_run uuid := 'f1100030-0000-4000-8000-000000000006';
  v_correlation uuid := 'f1100030-0000-4000-8000-000000000007';
  v_document_read uuid := 'f1100030-0000-4000-8000-000000000008';
  v_report_id uuid;
  v_study jsonb := jsonb_build_object(
    'schema', 'hive.canonical-study/1',
    'documents', jsonb_build_array(jsonb_build_object(
      'sourceDocumentId', 'f1100030-0000-4000-8000-000000000001',
      'role', 'ANCHOR', 'typeInPlainWords', 'statement', 'date', null, 'version', null, 'chainPosition', null
    )),
    'spineSource', 'ANCHOR',
    'spine', '[]'::jsonb,
    'outsideSpine', '[]'::jsonb,
    'conflicts', '[]'::jsonb,
    'timeline', '[]'::jsonb,
    'gaps', '[]'::jsonb,
    'domainLabel', 'unknown'
  );
  v_json json;
  v_count integer;
  v_row jsonb;
BEGIN
  RESET ROLE;

  INSERT INTO auth.users (id, email, aud, role)
  VALUES
    (v_owner, 'f11s-owner@example.test', 'authenticated', 'authenticated'),
    (v_member, 'f11s-member@example.test', 'authenticated', 'authenticated'),
    (v_client, 'f11s-client@example.test', 'authenticated', 'authenticated'),
    (v_pro, 'f11s-pro@example.test', 'authenticated', 'authenticated'),
    (v_stranger, 'f11s-stranger@example.test', 'authenticated', 'authenticated'),
    (v_stranger_firm, 'f11s-stranger-firm@example.test', 'authenticated', 'authenticated'),
    (v_firm_two_creator, 'f11s-firm-two@example.test', 'authenticated', 'authenticated');

  INSERT INTO hive.user_profiles (user_id, display_name, starting_view, created_at, updated_at)
  VALUES
    (v_owner, 'Smoke Owner', 'clients', now(), now()),
    (v_member, 'Smoke Paralegal', 'clients', now(), now())
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_json := public.create_firm('Smoke Law', 'Rivera');
  v_firm := (v_json->>'firmId')::uuid;
  IF v_firm IS NULL THEN
    RAISE EXCEPTION 'create_firm failed: %', v_json;
  END IF;

  v_json := public.invite_firm_member('f11s-member@example.test', 'Paralegal', 'member', v_firm_token);
  IF (v_json->>'firmMemberId') IS NULL THEN
    RAISE EXCEPTION 'invite_firm_member failed: %', v_json;
  END IF;

  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.accept_firm_invitation(v_firm_token);
  IF (v_json->>'firmId')::uuid IS DISTINCT FROM v_firm THEN
    RAISE EXCEPTION 'accept_firm_invitation failed: %', v_json;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_json := public.create_hive('Smoke client hive', 'M. Lopez', v_client_req, 'client');
  v_hive := (v_json->'hive'->>'id')::uuid;
  IF (v_json->'hive'->>'firmId')::uuid IS DISTINCT FROM v_firm THEN
    RAISE EXCEPTION 'create_hive firmId wrong: %', v_json;
  END IF;

  PERFORM public.assign_hive(v_hive, v_member, NULL);

  RESET ROLE;

  INSERT INTO hive.hive_invitations (hive_id, email, role, invited_by, token_hash, expires_at)
  VALUES
    (v_hive, 'f11s-client@example.test', 'client', v_owner, v_token_client, now() + interval '7 days'),
    (v_hive, 'f11s-pro@example.test', 'professional', v_owner, v_token_pro, now() + interval '7 days');

  -- Stranger: no visible hives.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.list_hives();
  IF jsonb_array_length(v_json::jsonb) <> 0 THEN
    RAISE EXCEPTION 'stranger list_hives should be empty: %', v_json;
  END IF;
  RESET ROLE;

  -- Hive owner: member branch, role owner.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.list_hives();
  IF jsonb_array_length(v_json::jsonb) <> 1 THEN
    RAISE EXCEPTION 'owner list_hives count wrong: %', v_json;
  END IF;
  v_row := v_json::jsonb -> 0;
  IF (v_row->>'id')::uuid IS DISTINCT FROM v_hive
     OR (v_row->>'membershipRole') <> 'owner'
     OR (v_row->>'memberState') <> 'active' THEN
    RAISE EXCEPTION 'owner list_hives row wrong: %', v_row;
  END IF;
  RESET ROLE;

  -- Firm staff (not a hive member): firm branch, role firm.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.list_hives();
  IF jsonb_array_length(v_json::jsonb) <> 1 THEN
    RAISE EXCEPTION 'firm member list_hives count wrong: %', v_json;
  END IF;
  v_row := v_json::jsonb -> 0;
  IF (v_row->>'id')::uuid IS DISTINCT FROM v_hive
     OR (v_row->>'membershipRole') <> 'firm'
     OR position('· you on it' IN coalesce(v_row->>'homeKicker', '')) = 0 THEN
    RAISE EXCEPTION 'firm member list_hives row wrong: %', v_row;
  END IF;
  RESET ROLE;

  -- Client: member branch, role client.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.accept_invitation(v_token_client);
  IF (v_json->>'role') <> 'client' OR (v_json->>'memberState') <> 'active' THEN
    RAISE EXCEPTION 'client accept wrong: %', v_json;
  END IF;
  v_json := public.list_hives();
  IF jsonb_array_length(v_json::jsonb) <> 1 THEN
    RAISE EXCEPTION 'client list_hives count wrong: %', v_json;
  END IF;
  v_row := v_json::jsonb -> 0;
  IF (v_row->>'membershipRole') <> 'client'
     OR coalesce(v_row->>'homeKicker', '') !~ '^Your hive with ' THEN
    RAISE EXCEPTION 'client list_hives row wrong: %', v_row;
  END IF;
  RESET ROLE;

  -- Professional (pending): member branch, invited kicker.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pro::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.accept_invitation(v_token_pro);
  IF (v_json->>'memberState') <> 'pending' THEN
    RAISE EXCEPTION 'pro should be pending: %', v_json;
  END IF;
  v_json := public.list_hives();
  IF jsonb_array_length(v_json::jsonb) <> 1 THEN
    RAISE EXCEPTION 'pending pro list_hives count wrong: %', v_json;
  END IF;
  v_row := v_json::jsonb -> 0;
  IF (v_row->>'membershipRole') <> 'professional'
     OR (v_row->>'memberState') <> 'pending'
     OR coalesce(v_row->>'homeKicker', '') NOT LIKE 'invited%' THEN
    RAISE EXCEPTION 'pending pro list_hives row wrong: %', v_row;
  END IF;
  RESET ROLE;

  UPDATE hive.hive_members
     SET state = 'active'
   WHERE hive_id = v_hive AND user_id = v_pro;

  -- Professional (active): member branch after activation.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pro::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.list_hives();
  IF jsonb_array_length(v_json::jsonb) <> 1 THEN
    RAISE EXCEPTION 'active pro list_hives count wrong: %', v_json;
  END IF;
  v_row := v_json::jsonb -> 0;
  IF (v_row->>'membershipRole') <> 'professional'
     OR (v_row->>'memberState') <> 'active' THEN
    RAISE EXCEPTION 'active pro list_hives row wrong: %', v_row;
  END IF;
  RESET ROLE;


  -- QF-1a fixture: source doc, intent, study workflow, report (service RPC args).
  INSERT INTO hive.source_documents (
    id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
    storage_bucket, storage_path, upload_status, lifecycle_status, read_status, created_at
  ) VALUES (
    v_doc, v_hive, v_owner, 'smoke.pdf', 'application/pdf', 1024, repeat('f', 64),
    'hive-source-documents', v_owner::text || '/' || v_hive::text || '/smoke.pdf',
    'UPLOADED', 'ACTIVE', 'SUCCEEDED', now()
  );

  INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
  VALUES (v_intent, v_hive, v_owner, 'Smoke hive intent.', v_client_req);

  INSERT INTO hive.document_reads (
    id, hive_id, owner_user_id, source_document_id, request_id, attempt_number,
    status, correlation_id, created_at, updated_at, finished_at
  ) VALUES (
    v_document_read, v_hive, v_owner, v_doc, gen_random_uuid(), 1,
    'SUCCEEDED', v_correlation, now(), now(), now()
  );

  INSERT INTO hive.processing_runs (
    id, hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
    authorized_source_document_ids, intent_request_ids, source_snapshot,
    source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
    coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement, coverage_acknowledged_at,
    snapshot_frozen_at, stage_attempt, stage_outputs
  ) VALUES (
    v_run, v_hive, v_owner, 'STUDY_PREPARATION', gen_random_uuid(), 1, 'ACCEPTING_STUDY', v_correlation,
    ARRAY[v_doc], ARRAY[v_intent],
    jsonb_build_object(
      'documents', '[]'::jsonb,
      'excluded', jsonb_build_array(jsonb_build_object(
        'sourceDocumentId', v_doc::text,
        'fileName', 'smoke.pdf',
        'reason', 'READ_FAILED'
      )),
      'coverageComplete', false
    ),
    'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64),
    false, true, 'MATERIAL_GAPS',
    jsonb_build_array(jsonb_build_object(
      'key', 'EXCLUDED:' || v_doc::text || ':READ_FAILED',
      'sourceDocumentId', v_doc::text,
      'fileName', 'smoke.pdf',
      'reason', 'READ_FAILED',
      'pageNumbers', '[]'::jsonb,
      'material', true
    )),
    'OWNER', now(),
    now(), 1, jsonb_build_object('canonicalStudy', v_study)
  );

  INSERT INTO hive.canonical_studies (id, hive_id, owner_user_id, current_revision_id)
  VALUES (v_canonical, v_hive, v_owner, NULL);

  INSERT INTO hive.study_revisions (
    id, canonical_study_id, hive_id, owner_user_id, revision_number, processing_run_id, format,
    investigation, verification, audience_configuration, investigation_digest, prompt_digest,
    source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete, coverage_status,
    coverage_gaps, coverage_acknowledgement
  ) VALUES (
    v_revision, v_canonical, v_hive, v_owner, 1, v_run, 'canonical-study-1',
    v_study,
    jsonb_build_object('schema', 'hive.study-verification/1', 'counts', jsonb_build_object('documentFindings', 0, 'claims', 0),
                       'findings', '[]'::jsonb, 'documentCoverage', '[]'::jsonb),
    jsonb_build_object('schema', 'hive.audience-configuration/1'),
    'sha256:' || repeat('c', 64), 'sha256:' || repeat('d', 64),
    'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64),
    true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED'
  );

  UPDATE hive.canonical_studies SET current_revision_id = v_revision WHERE id = v_canonical;

  INSERT INTO hive.report_runs (
    id, hive_id, owner_user_id, study_revision_id, audience, trigger, correlation_id, status, finished_at
  ) VALUES (
    v_report_run, v_hive, v_owner, v_revision, 'CUSTOMER', 'STUDY_ACCEPTED', v_correlation, 'SUCCEEDED', now()
  );

  INSERT INTO hive.reports (
    report_run_id, hive_id, owner_user_id, study_revision_id, audience, title,
    writer_output, scenario_analysis, view, writer_prompt_digest
  ) VALUES (
    v_report_run, v_hive, v_owner, v_revision, 'CUSTOMER', 'Overview',
    jsonb_build_object('schema', 'hive.writer-report/1', 'audience', 'CUSTOMER'),
    jsonb_build_object('schema', 'hive.scenario-analysis/1', 'scenarios', '[]'::jsonb),
    jsonb_build_object('schema', 'hive-application-view/1', 'audience', 'CUSTOMER', 'title', 'Overview', 'components', '[]'::jsonb),
    'sha256:' || repeat('8', 64)
  );

  SELECT id INTO v_report_id FROM hive.reports WHERE hive_id = v_hive LIMIT 1;

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('hive-source-documents', 'hive-source-documents', false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES (
    'hive-source-documents',
    v_owner::text || '/' || v_hive::text || '/smoke.pdf',
    v_owner,
    '{}'::jsonb
  )
  ON CONFLICT DO NOTHING;

  -- QF-1a: call every RPC once per role (list_hives covered above).

  -- rpc: accept_firm_invitation
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.accept_firm_invitation(%L)$fmt$, v_firm_token));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.accept_firm_invitation(%L)$fmt$, v_firm_token));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.accept_firm_invitation(%L)$fmt$, v_firm_token));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.accept_firm_invitation(%L)$fmt$, v_firm_token));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.accept_firm_invitation(%L)$fmt$, v_firm_token));

  -- rpc: accept_invitation
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.accept_invitation(%L)$fmt$, v_token_client));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.accept_invitation(%L)$fmt$, v_token_client));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.accept_invitation(%L)$fmt$, v_token_client));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.accept_invitation(%L)$fmt$, v_token_client));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.accept_invitation(%L)$fmt$, v_token_client));

  -- rpc: accept_study_revision
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.accept_study_revision(%L, %L::jsonb)$fmt$, v_run, v_study));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.accept_study_revision(%L, %L::jsonb)$fmt$, v_run, v_study));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.accept_study_revision(%L, %L::jsonb)$fmt$, v_run, v_study));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.accept_study_revision(%L, %L::jsonb)$fmt$, v_run, v_study));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.accept_study_revision(%L, %L::jsonb)$fmt$, v_run, v_study));

  -- rpc: acknowledge_study_coverage
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.acknowledge_study_coverage(%L, %L, 'sha256:' || repeat('3', 64))$fmt$, v_hive, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.acknowledge_study_coverage(%L, %L, 'sha256:' || repeat('3', 64))$fmt$, v_hive, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.acknowledge_study_coverage(%L, %L, 'sha256:' || repeat('3', 64))$fmt$, v_hive, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.acknowledge_study_coverage(%L, %L, 'sha256:' || repeat('3', 64))$fmt$, v_hive, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.acknowledge_study_coverage(%L, %L, 'sha256:' || repeat('3', 64))$fmt$, v_hive, v_run));

  -- rpc: add_team_note
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.add_team_note(%L, 'smoke note', gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.add_team_note(%L, 'smoke note', gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.add_team_note(%L, 'smoke note', gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.add_team_note(%L, 'smoke note', gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.add_team_note(%L, 'smoke note', gen_random_uuid())$fmt$, v_hive));

  -- rpc: apply_vault_transaction
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.apply_vault_transaction('{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.apply_vault_transaction('{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.apply_vault_transaction('{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.apply_vault_transaction('{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.apply_vault_transaction('{}'::jsonb)$fmt$));

  -- rpc: assign_hive
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.assign_hive(%L, %L, NULL)$fmt$, v_hive, v_member));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.assign_hive(%L, %L, NULL)$fmt$, v_hive, v_member));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.assign_hive(%L, %L, NULL)$fmt$, v_hive, v_member));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.assign_hive(%L, %L, NULL)$fmt$, v_hive, v_member));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.assign_hive(%L, %L, NULL)$fmt$, v_hive, v_member));

  -- rpc: backfill_processing_run_estimate
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.backfill_processing_run_estimate(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.backfill_processing_run_estimate(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.backfill_processing_run_estimate(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.backfill_processing_run_estimate(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.backfill_processing_run_estimate(%L)$fmt$, v_run));

  -- rpc: backfill_report_run_estimate
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.backfill_report_run_estimate(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.backfill_report_run_estimate(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.backfill_report_run_estimate(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.backfill_report_run_estimate(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.backfill_report_run_estimate(%L)$fmt$, v_report_run));

  -- rpc: begin_doc_extraction_attempt
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.begin_doc_extraction_attempt(%L, %L, 1)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.begin_doc_extraction_attempt(%L, %L, 1)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.begin_doc_extraction_attempt(%L, %L, 1)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.begin_doc_extraction_attempt(%L, %L, 1)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.begin_doc_extraction_attempt(%L, %L, 1)$fmt$, v_run, v_doc));

  -- rpc: begin_hive_deletion
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.begin_hive_deletion(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.begin_hive_deletion(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.begin_hive_deletion(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.begin_hive_deletion(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.begin_hive_deletion(%L)$fmt$, v_hive));

  -- rpc: claim_processing_run
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.claim_processing_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.claim_processing_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.claim_processing_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.claim_processing_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.claim_processing_run(%L)$fmt$, v_run));

  -- rpc: claim_report_run
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.claim_report_run(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.claim_report_run(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.claim_report_run(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.claim_report_run(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.claim_report_run(%L)$fmt$, v_report_run));

  -- rpc: complete_hive_deletion
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.complete_hive_deletion(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.complete_hive_deletion(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.complete_hive_deletion(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.complete_hive_deletion(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.complete_hive_deletion(%L)$fmt$, v_hive));

  -- rpc: create_firm
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.create_firm('Smoke Firm Two', 'Asst')$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.create_firm('Smoke Firm Two', 'Asst')$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.create_firm('Smoke Firm Two', 'Asst')$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.create_firm('Smoke Firm Two', 'Asst')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_firm_two_creator, format($fmt$SELECT public.create_firm('Smoke Firm Two', 'Asst')$fmt$));

  -- rpc: create_hive
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.create_hive('Extra hive', 'Extra', gen_random_uuid(), 'client')$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.create_hive('Extra hive', 'Extra', gen_random_uuid(), 'client')$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.create_hive('Extra hive', 'Extra', gen_random_uuid(), 'client')$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.create_hive('Extra hive', 'Extra', gen_random_uuid(), 'client')$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.create_hive('Extra hive', 'Extra', gen_random_uuid(), 'client')$fmt$));

  -- rpc: create_intent_request
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.create_intent_request(%L, 'more intent', gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.create_intent_request(%L, 'more intent', gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.create_intent_request(%L, 'more intent', gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.create_intent_request(%L, 'more intent', gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.create_intent_request(%L, 'more intent', gen_random_uuid())$fmt$, v_hive));

  -- rpc: create_invitation
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.create_invitation(%L, 'extra@example.test', 'client', repeat('e', 64))$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.create_invitation(%L, 'extra@example.test', 'client', repeat('e', 64))$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.create_invitation(%L, 'extra@example.test', 'client', repeat('e', 64))$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.create_invitation(%L, 'extra@example.test', 'client', repeat('e', 64))$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.create_invitation(%L, 'extra@example.test', 'client', repeat('e', 64))$fmt$, v_hive));

  -- rpc: fail_stale_in_flight_doc_extraction_attempts
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.fail_stale_in_flight_doc_extraction_attempts(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.fail_stale_in_flight_doc_extraction_attempts(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.fail_stale_in_flight_doc_extraction_attempts(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.fail_stale_in_flight_doc_extraction_attempts(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.fail_stale_in_flight_doc_extraction_attempts(%L)$fmt$, v_run));

  -- rpc: generate_hive_report
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.generate_hive_report(%L, %L, 'CUSTOMER', gen_random_uuid(), %L)$fmt$, v_hive, v_revision, v_correlation));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.generate_hive_report(%L, %L, 'CUSTOMER', gen_random_uuid(), %L)$fmt$, v_hive, v_revision, v_correlation));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.generate_hive_report(%L, %L, 'CUSTOMER', gen_random_uuid(), %L)$fmt$, v_hive, v_revision, v_correlation));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.generate_hive_report(%L, %L, 'CUSTOMER', gen_random_uuid(), %L)$fmt$, v_hive, v_revision, v_correlation));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.generate_hive_report(%L, %L, 'CUSTOMER', gen_random_uuid(), %L)$fmt$, v_hive, v_revision, v_correlation));

  -- rpc: get_doc_extraction_attempt_totals_for_run
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.get_doc_extraction_attempt_totals_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.get_doc_extraction_attempt_totals_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.get_doc_extraction_attempt_totals_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.get_doc_extraction_attempt_totals_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_doc_extraction_attempt_totals_for_run(%L)$fmt$, v_run));

  -- rpc: get_doc_extraction_gap_pages_for_run
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.get_doc_extraction_gap_pages_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.get_doc_extraction_gap_pages_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.get_doc_extraction_gap_pages_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.get_doc_extraction_gap_pages_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_doc_extraction_gap_pages_for_run(%L)$fmt$, v_run));

  -- rpc: get_doc_extraction_ranges_for_run
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.get_doc_extraction_ranges_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.get_doc_extraction_ranges_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.get_doc_extraction_ranges_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.get_doc_extraction_ranges_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_doc_extraction_ranges_for_run(%L)$fmt$, v_run));

  -- rpc: get_doc_extractions_for_run
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.get_doc_extractions_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.get_doc_extractions_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.get_doc_extractions_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.get_doc_extractions_for_run(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_doc_extractions_for_run(%L)$fmt$, v_run));

  -- rpc: get_failure_diagnostics
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_failure_diagnostics(%L, %L)$fmt$, v_hive, v_correlation));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.get_failure_diagnostics(%L, %L)$fmt$, v_hive, v_correlation));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.get_failure_diagnostics(%L, %L)$fmt$, v_hive, v_correlation));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.get_failure_diagnostics(%L, %L)$fmt$, v_hive, v_correlation));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_failure_diagnostics(%L, %L)$fmt$, v_hive, v_correlation));

  -- rpc: get_hive
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_hive(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.get_hive(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.get_hive(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.get_hive(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_hive(%L)$fmt$, v_hive));

  -- rpc: get_hive_by_client_request_id
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_hive_by_client_request_id(%L)$fmt$, v_client_req));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.get_hive_by_client_request_id(%L)$fmt$, v_client_req));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.get_hive_by_client_request_id(%L)$fmt$, v_client_req));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.get_hive_by_client_request_id(%L)$fmt$, v_client_req));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_hive_by_client_request_id(%L)$fmt$, v_client_req));

  -- rpc: get_hive_report
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_hive_report(%L, %L)$fmt$, v_hive, v_report_id));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.get_hive_report(%L, %L)$fmt$, v_hive, v_report_id));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.get_hive_report(%L, %L)$fmt$, v_hive, v_report_id));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.get_hive_report(%L, %L)$fmt$, v_hive, v_report_id));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_hive_report(%L, %L)$fmt$, v_hive, v_report_id));

  -- rpc: get_hive_reports
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_hive_reports(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.get_hive_reports(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.get_hive_reports(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.get_hive_reports(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_hive_reports(%L)$fmt$, v_hive));

  -- rpc: get_invitation_welcome_context
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_invitation_welcome_context(%L)$fmt$, v_token_pro));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.get_invitation_welcome_context(%L)$fmt$, v_token_pro));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.get_invitation_welcome_context(%L)$fmt$, v_token_pro));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.get_invitation_welcome_context(%L)$fmt$, v_token_pro));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_invitation_welcome_context(%L)$fmt$, v_token_pro));

  -- rpc: get_my_profile
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_my_profile()$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.get_my_profile()$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.get_my_profile()$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.get_my_profile()$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_stranger, format($fmt$SELECT public.get_my_profile()$fmt$));

  -- rpc: get_pipeline_throughput
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_pipeline_throughput('extract')$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.get_pipeline_throughput('extract')$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.get_pipeline_throughput('extract')$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.get_pipeline_throughput('extract')$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_pipeline_throughput('extract')$fmt$));

  -- rpc: get_processing_run_queued_reads
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.get_processing_run_queued_reads(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.get_processing_run_queued_reads(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.get_processing_run_queued_reads(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.get_processing_run_queued_reads(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_processing_run_queued_reads(%L)$fmt$, v_run));

  -- rpc: get_report_generation_inputs
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.get_report_generation_inputs(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.get_report_generation_inputs(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.get_report_generation_inputs(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.get_report_generation_inputs(%L)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_report_generation_inputs(%L)$fmt$, v_report_run));

  -- rpc: get_source_upload_by_client_request
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_source_upload_by_client_request(%L, %L, %L)$fmt$, v_hive, v_client_req, v_owner));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.get_source_upload_by_client_request(%L, %L, %L)$fmt$, v_hive, v_client_req, v_owner));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.get_source_upload_by_client_request(%L, %L, %L)$fmt$, v_hive, v_client_req, v_owner));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.get_source_upload_by_client_request(%L, %L, %L)$fmt$, v_hive, v_client_req, v_owner));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_source_upload_by_client_request(%L, %L, %L)$fmt$, v_hive, v_client_req, v_owner));

  -- rpc: get_study_preparation
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_study_preparation(%L, false)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.get_study_preparation(%L, false)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.get_study_preparation(%L, false)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.get_study_preparation(%L, false)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_study_preparation(%L, false)$fmt$, v_hive));

  -- rpc: get_study_preparation_inputs
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.get_study_preparation_inputs(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.get_study_preparation_inputs(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.get_study_preparation_inputs(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.get_study_preparation_inputs(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_study_preparation_inputs(%L)$fmt$, v_run));

  -- rpc: get_study_source_pages
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.get_study_source_pages(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.get_study_source_pages(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.get_study_source_pages(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.get_study_source_pages(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_study_source_pages(%L)$fmt$, v_run));

  -- rpc: get_study_tab_view
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_study_tab_view(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.get_study_tab_view(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.get_study_tab_view(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.get_study_tab_view(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_study_tab_view(%L)$fmt$, v_hive));

  -- rpc: get_study_tab_view_definer
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.get_study_tab_view_definer(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.get_study_tab_view_definer(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.get_study_tab_view_definer(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.get_study_tab_view_definer(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.get_study_tab_view_definer(%L)$fmt$, v_hive));

  -- rpc: get_upload_quota
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.get_upload_quota()$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.get_upload_quota()$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.get_upload_quota()$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.get_upload_quota()$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_stranger, format($fmt$SELECT public.get_upload_quota()$fmt$));

  -- rpc: invite_firm_member
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.invite_firm_member('extra@example.test', 'X', 'member', repeat('d', 64))$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.invite_firm_member('extra@example.test', 'X', 'member', repeat('d', 64))$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.invite_firm_member('extra@example.test', 'X', 'member', repeat('d', 64))$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.invite_firm_member('extra@example.test', 'X', 'member', repeat('d', 64))$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.invite_firm_member('extra@example.test', 'X', 'member', repeat('d', 64))$fmt$));

  -- rpc: list_document_pages
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.list_document_pages(%L)$fmt$, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.list_document_pages(%L)$fmt$, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.list_document_pages(%L)$fmt$, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.list_document_pages(%L)$fmt$, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.list_document_pages(%L)$fmt$, v_doc));

  -- rpc: list_document_reads
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.list_document_reads(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.list_document_reads(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.list_document_reads(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.list_document_reads(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.list_document_reads(%L)$fmt$, v_hive));

  -- rpc: list_firm
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.list_firm()$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.list_firm()$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.list_firm()$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.list_firm()$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.list_firm()$fmt$));

  -- rpc: list_hive_people
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.list_hive_people(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.list_hive_people(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.list_hive_people(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.list_hive_people(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.list_hive_people(%L)$fmt$, v_hive));

  -- rpc: list_hive_source_documents
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.list_hive_source_documents(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.list_hive_source_documents(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.list_hive_source_documents(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.list_hive_source_documents(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.list_hive_source_documents(%L)$fmt$, v_hive));

  -- rpc: list_team_notes
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.list_team_notes(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.list_team_notes(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.list_team_notes(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.list_team_notes(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.list_team_notes(%L)$fmt$, v_hive));

  -- rpc: lookup_firm_invitation
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.lookup_firm_invitation(%L)$fmt$, v_firm_token));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.lookup_firm_invitation(%L)$fmt$, v_firm_token));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.lookup_firm_invitation(%L)$fmt$, v_firm_token));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.lookup_firm_invitation(%L)$fmt$, v_firm_token));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.lookup_firm_invitation(%L)$fmt$, v_firm_token));

  -- rpc: lookup_invitation
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.lookup_invitation(%L)$fmt$, v_token_client));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.lookup_invitation(%L)$fmt$, v_token_client));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.lookup_invitation(%L)$fmt$, v_token_client));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.lookup_invitation(%L)$fmt$, v_token_client));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.lookup_invitation(%L)$fmt$, v_token_client));

  -- rpc: patch_processing_run_workflow_state
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.patch_processing_run_workflow_state(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.patch_processing_run_workflow_state(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.patch_processing_run_workflow_state(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.patch_processing_run_workflow_state(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.patch_processing_run_workflow_state(%L, '{}'::jsonb)$fmt$, v_run));

  -- rpc: persist_intake_result
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT hive.persist_intake_result('{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT hive.persist_intake_result('{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT hive.persist_intake_result('{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT hive.persist_intake_result('{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT hive.persist_intake_result('{}'::jsonb)$fmt$));

  -- rpc: persist_processing_run_estimate
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.persist_processing_run_estimate(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.persist_processing_run_estimate(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.persist_processing_run_estimate(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.persist_processing_run_estimate(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.persist_processing_run_estimate(%L, '{}'::jsonb)$fmt$, v_run));

  -- rpc: persist_report_run_estimate
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.persist_report_run_estimate(%L, '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.persist_report_run_estimate(%L, '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.persist_report_run_estimate(%L, '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.persist_report_run_estimate(%L, '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.persist_report_run_estimate(%L, '{}'::jsonb)$fmt$, v_report_run));

  -- rpc: put_doc_extraction
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.put_doc_extraction(%L, %L, '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.put_doc_extraction(%L, %L, '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.put_doc_extraction(%L, %L, '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.put_doc_extraction(%L, %L, '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.put_doc_extraction(%L, %L, '{}'::jsonb)$fmt$, v_run, v_doc));

  -- rpc: put_doc_extraction_range
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.put_doc_extraction_range(%L, %L, 1, 1, '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.put_doc_extraction_range(%L, %L, 1, 1, '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.put_doc_extraction_range(%L, %L, 1, 1, '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.put_doc_extraction_range(%L, %L, 1, 1, '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.put_doc_extraction_range(%L, %L, 1, 1, '{}'::jsonb)$fmt$, v_run, v_doc));

  -- rpc: put_document_pages
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.put_document_pages(%L, '[]'::jsonb)$fmt$, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.put_document_pages(%L, '[]'::jsonb)$fmt$, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.put_document_pages(%L, '[]'::jsonb)$fmt$, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.put_document_pages(%L, '[]'::jsonb)$fmt$, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.put_document_pages(%L, '[]'::jsonb)$fmt$, v_doc));

  -- rpc: read_study_prompt_preview
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.read_study_prompt_preview(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.read_study_prompt_preview(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.read_study_prompt_preview(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.read_study_prompt_preview(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.read_study_prompt_preview(%L)$fmt$, v_run));

  -- rpc: rebuild_study
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.rebuild_study(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.rebuild_study(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.rebuild_study(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.rebuild_study(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.rebuild_study(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));

  -- rpc: record_doc_extraction_attempt
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.record_doc_extraction_attempt(%L, %L, 1, 'GAP', '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.record_doc_extraction_attempt(%L, %L, 1, 'GAP', '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.record_doc_extraction_attempt(%L, %L, 1, 'GAP', '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.record_doc_extraction_attempt(%L, %L, 1, 'GAP', '{}'::jsonb)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.record_doc_extraction_attempt(%L, %L, 1, 'GAP', '{}'::jsonb)$fmt$, v_run, v_doc));

  -- rpc: record_extracting_document_success
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.record_extracting_document_success(%L, %L)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.record_extracting_document_success(%L, %L)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.record_extracting_document_success(%L, %L)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.record_extracting_document_success(%L, %L)$fmt$, v_run, v_doc));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.record_extracting_document_success(%L, %L)$fmt$, v_run, v_doc));

  -- rpc: record_pipeline_model_call
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.record_pipeline_model_call(%L, 'extract', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.record_pipeline_model_call(%L, 'extract', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.record_pipeline_model_call(%L, 'extract', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.record_pipeline_model_call(%L, 'extract', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.record_pipeline_model_call(%L, 'extract', '{}'::jsonb)$fmt$, v_run));

  -- rpc: recover_expired_workflow_leases
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.recover_expired_workflow_leases(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.recover_expired_workflow_leases(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.recover_expired_workflow_leases(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.recover_expired_workflow_leases(%L)$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.recover_expired_workflow_leases(%L)$fmt$, v_hive));

  -- rpc: release_processing_run
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.release_processing_run(%L, 'QUEUED', 0)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.release_processing_run(%L, 'QUEUED', 0)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.release_processing_run(%L, 'QUEUED', 0)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.release_processing_run(%L, 'QUEUED', 0)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.release_processing_run(%L, 'QUEUED', 0)$fmt$, v_run));

  -- rpc: remove_member
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.remove_member(%L, %L)$fmt$, v_hive, v_client));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.remove_member(%L, %L)$fmt$, v_hive, v_client));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.remove_member(%L, %L)$fmt$, v_hive, v_client));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.remove_member(%L, %L)$fmt$, v_hive, v_client));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.remove_member(%L, %L)$fmt$, v_hive, v_client));

  -- rpc: reserve_processing_run_handoff
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.reserve_processing_run_handoff(%L, gen_random_uuid())$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.reserve_processing_run_handoff(%L, gen_random_uuid())$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.reserve_processing_run_handoff(%L, gen_random_uuid())$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.reserve_processing_run_handoff(%L, gen_random_uuid())$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.reserve_processing_run_handoff(%L, gen_random_uuid())$fmt$, v_run));

  -- rpc: retry_processing_run_stage
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.retry_processing_run_stage(%L, 'FAILED', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.retry_processing_run_stage(%L, 'FAILED', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.retry_processing_run_stage(%L, 'FAILED', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.retry_processing_run_stage(%L, 'FAILED', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.retry_processing_run_stage(%L, 'FAILED', '{}'::jsonb)$fmt$, v_run));

  -- rpc: revoke_firm_invitation
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.revoke_firm_invitation(gen_random_uuid())$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.revoke_firm_invitation(gen_random_uuid())$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.revoke_firm_invitation(gen_random_uuid())$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.revoke_firm_invitation(gen_random_uuid())$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.revoke_firm_invitation(gen_random_uuid())$fmt$));

  -- rpc: revoke_invitation
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.revoke_invitation(gen_random_uuid())$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.revoke_invitation(gen_random_uuid())$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.revoke_invitation(gen_random_uuid())$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.revoke_invitation(gen_random_uuid())$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.revoke_invitation(gen_random_uuid())$fmt$));

  -- rpc: save_report
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.save_report(%L, '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.save_report(%L, '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.save_report(%L, '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.save_report(%L, '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.save_report(%L, '{}'::jsonb)$fmt$, v_report_run));

  -- rpc: save_study_prompt_preview
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.save_study_prompt_preview(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.save_study_prompt_preview(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.save_study_prompt_preview(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.save_study_prompt_preview(%L, '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.save_study_prompt_preview(%L, '{}'::jsonb)$fmt$, v_run));

  -- rpc: set_assistant_name
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.set_assistant_name('Asst Smoke')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.set_assistant_name('Asst Smoke')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.set_assistant_name('Asst Smoke')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.set_assistant_name('Asst Smoke')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_stranger, format($fmt$SELECT public.set_assistant_name('Asst Smoke')$fmt$));

  -- rpc: set_display_name
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.set_display_name('Renamed Smoke')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.set_display_name('Renamed Smoke')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.set_display_name('Renamed Smoke')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.set_display_name('Renamed Smoke')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_stranger, format($fmt$SELECT public.set_display_name('Renamed Smoke')$fmt$));

  -- rpc: set_hive_kind
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.set_hive_kind(%L, 'client')$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.set_hive_kind(%L, 'client')$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.set_hive_kind(%L, 'client')$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.set_hive_kind(%L, 'client')$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.set_hive_kind(%L, 'client')$fmt$, v_hive));

  -- rpc: set_hive_stage
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.set_hive_stage(%L, 'review')$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.set_hive_stage(%L, 'review')$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.set_hive_stage(%L, 'review')$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.set_hive_stage(%L, 'review')$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.set_hive_stage(%L, 'review')$fmt$, v_hive));

  -- rpc: set_starting_view
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.set_starting_view('clients')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_member, format($fmt$SELECT public.set_starting_view('clients')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_client, format($fmt$SELECT public.set_starting_view('clients')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_pro, format($fmt$SELECT public.set_starting_view('clients')$fmt$));
  PERFORM pg_temp.smoke_expect_ok(v_stranger, format($fmt$SELECT public.set_starting_view('clients')$fmt$));

  -- rpc: start_document_reads
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.start_document_reads(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.start_document_reads(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.start_document_reads(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.start_document_reads(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.start_document_reads(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));

  -- rpc: start_study_preparation
  PERFORM pg_temp.smoke_expect_ok(v_owner, format($fmt$SELECT public.start_study_preparation(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.start_study_preparation(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.start_study_preparation(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.start_study_preparation(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.start_study_preparation(%L, gen_random_uuid(), gen_random_uuid())$fmt$, v_hive));

  -- rpc: sweep_workflow_recovery
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.sweep_workflow_recovery(1)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.sweep_workflow_recovery(1)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.sweep_workflow_recovery(1)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.sweep_workflow_recovery(1)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.sweep_workflow_recovery(1)$fmt$));

  -- rpc: transition_document_read
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.transition_document_read(%L, 'QUEUED', 'SUCCEEDED', '{}'::jsonb)$fmt$, v_document_read));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.transition_document_read(%L, 'QUEUED', 'SUCCEEDED', '{}'::jsonb)$fmt$, v_document_read));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.transition_document_read(%L, 'QUEUED', 'SUCCEEDED', '{}'::jsonb)$fmt$, v_document_read));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.transition_document_read(%L, 'QUEUED', 'SUCCEEDED', '{}'::jsonb)$fmt$, v_document_read));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.transition_document_read(%L, 'QUEUED', 'SUCCEEDED', '{}'::jsonb)$fmt$, v_document_read));

  -- rpc: transition_processing_run
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.transition_processing_run(%L, 'QUEUED', 'QUEUED', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.transition_processing_run(%L, 'QUEUED', 'QUEUED', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.transition_processing_run(%L, 'QUEUED', 'QUEUED', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.transition_processing_run(%L, 'QUEUED', 'QUEUED', '{}'::jsonb)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.transition_processing_run(%L, 'QUEUED', 'QUEUED', '{}'::jsonb)$fmt$, v_run));

  -- rpc: transition_report_run
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.transition_report_run(%L, 'SUCCEEDED', 'SUCCEEDED', '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.transition_report_run(%L, 'SUCCEEDED', 'SUCCEEDED', '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.transition_report_run(%L, 'SUCCEEDED', 'SUCCEEDED', '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.transition_report_run(%L, 'SUCCEEDED', 'SUCCEEDED', '{}'::jsonb)$fmt$, v_report_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.transition_report_run(%L, 'SUCCEEDED', 'SUCCEEDED', '{}'::jsonb)$fmt$, v_report_run));

  -- rpc: try_advance_extracting_to_canonicalizing
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.try_advance_extracting_to_canonicalizing(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.try_advance_extracting_to_canonicalizing(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.try_advance_extracting_to_canonicalizing(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.try_advance_extracting_to_canonicalizing(%L)$fmt$, v_run));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.try_advance_extracting_to_canonicalizing(%L)$fmt$, v_run));

  -- rpc: update_doc_extraction_attempt_outcome
  PERFORM pg_temp.smoke_expect_refusal(v_owner, format($fmt$SELECT public.update_doc_extraction_attempt_outcome(gen_random_uuid(), 'SUCCEEDED', '{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_member, format($fmt$SELECT public.update_doc_extraction_attempt_outcome(gen_random_uuid(), 'SUCCEEDED', '{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_client, format($fmt$SELECT public.update_doc_extraction_attempt_outcome(gen_random_uuid(), 'SUCCEEDED', '{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_pro, format($fmt$SELECT public.update_doc_extraction_attempt_outcome(gen_random_uuid(), 'SUCCEEDED', '{}'::jsonb)$fmt$));
  PERFORM pg_temp.smoke_expect_refusal(v_stranger, format($fmt$SELECT public.update_doc_extraction_attempt_outcome(gen_random_uuid(), 'SUCCEEDED', '{}'::jsonb)$fmt$));


  RAISE NOTICE 'ALL CHECKS PASSED';
END;
$check$;

ROLLBACK;
