-- FL-5: paste into Supabase SQL editor (one transaction). Expect: ALL CHECKS PASSED, then ROLLBACK.
BEGIN;

DO $check$
DECLARE
  v_owner uuid := 'f0280001-0000-4000-8000-000000000001';
  v_client uuid := 'f0280001-0000-4000-8000-000000000002';
  v_pro uuid := 'f0280001-0000-4000-8000-000000000003';
  v_stranger uuid := 'f0280001-0000-4000-8000-000000000004';
  v_hive uuid := 'f0280002-0000-4000-8000-000000000001';
  v_doc uuid := 'f0280003-0000-4000-8000-000000000001';
  v_intent uuid := 'f0280003-0000-4000-8000-000000000002';
  v_run uuid := 'f0280003-0000-4000-8000-000000000003';
  v_canonical uuid := 'f0280003-0000-4000-8000-000000000004';
  v_revision uuid := 'f0280003-0000-4000-8000-000000000005';
  v_report_run uuid := 'f0280003-0000-4000-8000-000000000006';
  v_client_req uuid := 'f0280003-0000-4000-8000-000000000001';
  v_token_hex text := repeat('a', 64);
  v_token_pro text := repeat('b', 64);
  v_json json;
  v_count integer;
  v_study jsonb := jsonb_build_object(
    'schema', 'hive.canonical-study/1',
    'documents', jsonb_build_array(jsonb_build_object(
      'sourceDocumentId', v_doc::text,
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
BEGIN
  RESET ROLE;

  INSERT INTO auth.users (id, email, aud, role)
  VALUES
    (v_owner, 'f028-owner@example.test', 'authenticated', 'authenticated'),
    (v_client, 'f028-client@example.test', 'authenticated', 'authenticated'),
    (v_pro, 'f028-pro@example.test', 'authenticated', 'authenticated'),
    (v_stranger, 'f028-stranger@example.test', 'authenticated', 'authenticated');

  INSERT INTO hive.user_profiles (user_id, display_name, starting_view, created_at, updated_at)
  VALUES (v_owner, 'Alex Owner', 'own', now(), now())
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.create_hive('Membership check hive', NULL, v_client_req, 'client');
  v_hive := (v_json->'hive'->>'id')::uuid;
  RESET ROLE;

  INSERT INTO hive.source_documents (
    id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
    storage_bucket, storage_path, upload_status, lifecycle_status, read_status, created_at
  ) VALUES (
    v_doc, v_hive, v_owner, 'fixture.pdf', 'application/pdf', 1024, repeat('f', 64),
    'hive-source-documents', v_owner::text || '/' || v_hive::text || '/fixture.pdf',
    'UPLOADED', 'ACTIVE', 'SUCCEEDED', now()
  );

  INSERT INTO hive.intent_requests (id, hive_id, owner_user_id, intent_text, client_request_id)
  VALUES (v_intent, v_hive, v_owner, 'Synthetic intent.', v_client_req);

  INSERT INTO hive.processing_runs (
    id, hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
    authorized_source_document_ids, intent_request_ids, source_snapshot,
    source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
    coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement,
    snapshot_frozen_at, stage_attempt, stage_outputs
  ) VALUES (
    v_run, v_hive, v_owner, 'STUDY_PREPARATION', gen_random_uuid(), 1, 'ACCEPTING_STUDY', gen_random_uuid(),
    ARRAY[v_doc], ARRAY[v_intent],
    jsonb_build_object('documents', '[]'::jsonb, 'excluded', '[]'::jsonb, 'coverageComplete', true),
    'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64),
    true, true, 'COMPLETE', '[]'::jsonb, 'NOT_REQUIRED',
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
    v_report_run, v_hive, v_owner, v_revision, 'CUSTOMER', 'STUDY_ACCEPTED', gen_random_uuid(), 'SUCCEEDED', now()
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

  INSERT INTO hive.audit_events (
    id, owner_user_id, case_id, event_type, actor_user_id, actor_type, safe_metadata
  ) VALUES (
    gen_random_uuid(), v_owner, v_hive, 'membership_fixture', v_owner, 'USER', '{}'::jsonb
  );

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('hive-source-documents', 'hive-source-documents', false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES (
    'hive-source-documents',
    v_owner::text || '/' || v_hive::text || '/fixture.pdf',
    v_owner,
    '{}'::jsonb
  );

  INSERT INTO hive.hive_invitations (hive_id, email, role, invited_by, token_hash, expires_at)
  VALUES (v_hive, 'f028-client@example.test', 'client', v_owner, v_token_hex, now() + interval '7 days');

  INSERT INTO hive.hive_invitations (hive_id, email, role, invited_by, token_hash, expires_at)
  VALUES (v_hive, 'f028-pro@example.test', 'professional', v_owner, v_token_pro, now() + interval '7 days');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.list_hives();
  IF jsonb_array_length(v_json::jsonb) <> 0 THEN
    RAISE EXCEPTION 'non-member list_hives should be empty';
  END IF;
  BEGIN
    PERFORM public.get_hive(v_hive);
    RAISE EXCEPTION 'non-member get_hive should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_invitation(v_hive, 'f028-owner@example.test', 'client', repeat('d', 64));
    RAISE EXCEPTION 'owner own email invite should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.create_invitation(v_hive, 'f028-client@example.test', 'client', repeat('e', 64));
    RAISE EXCEPTION 'owner member email invite should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  v_json := public.list_hive_people(v_hive);
  IF jsonb_array_length(v_json::jsonb -> 'pendingInvitations') <> 2 THEN
    RAISE EXCEPTION 'owner pendingInvitations count wrong: %', v_json;
  END IF;

  BEGIN
    PERFORM 1 FROM hive.hive_invitations WHERE hive_id = v_hive LIMIT 1;
    RAISE EXCEPTION 'owner direct hive_invitations select should fail';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      RAISE;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.accept_invitation(v_token_hex);
  IF (v_json->>'role') <> 'client' OR (v_json->>'memberState') <> 'active' THEN
    RAISE EXCEPTION 'client accept state wrong: %', v_json;
  END IF;

  SELECT count(*)::integer INTO v_count FROM hive.source_documents WHERE case_id = v_hive;
  IF v_count < 1 THEN RAISE EXCEPTION 'client source_documents read failed'; END IF;
  SELECT count(*)::integer INTO v_count FROM hive.study_revisions WHERE hive_id = v_hive;
  IF v_count < 1 THEN RAISE EXCEPTION 'client study_revisions read failed'; END IF;
  SELECT count(*)::integer INTO v_count FROM hive.reports WHERE hive_id = v_hive;
  IF v_count < 1 THEN RAISE EXCEPTION 'client reports read failed'; END IF;
  SELECT count(*)::integer INTO v_count FROM hive.audit_events WHERE case_id = v_hive;
  IF v_count < 1 THEN RAISE EXCEPTION 'client audit_events read failed'; END IF;
  SELECT count(*)::integer INTO v_count FROM hive.hive_members WHERE hive_id = v_hive;
  IF v_count < 2 THEN RAISE EXCEPTION 'client hive_members read failed'; END IF;

  BEGIN
    PERFORM 1 FROM hive.hive_invitations WHERE hive_id = v_hive LIMIT 1;
    RAISE EXCEPTION 'client direct hive_invitations select should fail';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      RAISE;
  END;

  v_json := public.list_hive_people(v_hive);
  IF jsonb_array_length(v_json::jsonb -> 'people') < 2 THEN
    RAISE EXCEPTION 'client list_hive_people people wrong: %', v_json;
  END IF;
  IF position('token_hash' in lower(v_json::text)) > 0
     OR position('tokenhash' in lower(v_json::text)) > 0 THEN
    RAISE EXCEPTION 'client list_hive_people must not expose token_hash';
  END IF;

  SELECT count(*)::integer INTO v_count
    FROM storage.objects
   WHERE bucket_id = 'hive-source-documents' AND hive.storage_path_hive_id(name) = v_hive;
  IF v_count < 1 THEN RAISE EXCEPTION 'client storage.objects read failed'; END IF;

  PERFORM public.get_hive(v_hive);
  PERFORM public.list_hive_source_documents(v_hive);
  PERFORM public.get_study_preparation(v_hive, false);
  PERFORM public.get_hive_reports(v_hive);

  BEGIN
    PERFORM public.start_study_preparation(v_hive, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'client start_study_preparation should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.rebuild_study(v_hive, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'client rebuild_study should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.create_intent_request(v_hive, 'x', gen_random_uuid());
    RAISE EXCEPTION 'client create_intent_request should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.start_document_reads(v_hive, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'client start_document_reads should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.set_hive_kind(v_hive, 'own');
    RAISE EXCEPTION 'client set_hive_kind should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.create_invitation(v_hive, 'x@example.test', 'client', repeat('d', 64));
    RAISE EXCEPTION 'client create_invitation should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.begin_hive_deletion(v_hive);
    RAISE EXCEPTION 'client begin_hive_deletion should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pro::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.get_invitation_welcome_context(v_token_pro);
  IF (v_json->>'hiveId')::uuid IS DISTINCT FROM v_hive THEN
    RAISE EXCEPTION 'welcome context hive mismatch';
  END IF;
  IF v_json::jsonb ? 'requestedItemCount' THEN
    RAISE EXCEPTION 'welcome context must not include requestedItemCount';
  END IF;

  v_json := public.accept_invitation(v_token_pro);
  IF (v_json->>'memberState') <> 'pending' THEN
    RAISE EXCEPTION 'pro should be pending: %', v_json;
  END IF;

  BEGIN
    PERFORM public.list_hive_source_documents(v_hive);
    RAISE EXCEPTION 'pending pro must not list documents';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.get_study_preparation(v_hive, false);
    RAISE EXCEPTION 'pending pro must not read study';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.get_hive_reports(v_hive);
    RAISE EXCEPTION 'pending pro must not read reports';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  SELECT count(*)::integer INTO v_count FROM hive.source_documents WHERE case_id = v_hive;
  IF v_count <> 0 THEN RAISE EXCEPTION 'pending pro source_documents should be 0'; END IF;
  SELECT count(*)::integer INTO v_count FROM hive.study_revisions WHERE hive_id = v_hive;
  IF v_count <> 0 THEN RAISE EXCEPTION 'pending pro study_revisions should be 0'; END IF;
  SELECT count(*)::integer INTO v_count FROM hive.reports WHERE hive_id = v_hive;
  IF v_count <> 0 THEN RAISE EXCEPTION 'pending pro reports should be 0'; END IF;
  SELECT count(*)::integer INTO v_count
    FROM storage.objects
   WHERE bucket_id = 'hive-source-documents' AND hive.storage_path_hive_id(name) = v_hive;
  IF v_count <> 0 THEN RAISE EXCEPTION 'pending pro storage.objects should be 0'; END IF;

  BEGIN
    PERFORM 1 FROM hive.hive_invitations WHERE hive_id = v_hive LIMIT 1;
    RAISE EXCEPTION 'pending pro direct hive_invitations select should fail';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      RAISE;
  END;

  BEGIN
    PERFORM public.start_study_preparation(v_hive, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'pending pro start_study_preparation should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.create_intent_request(v_hive, 'x', gen_random_uuid());
    RAISE EXCEPTION 'pending pro create_intent_request should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.start_document_reads(v_hive, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'pending pro start_document_reads should fail';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;

  UPDATE hive.hive_members
     SET state = 'active'
   WHERE hive_id = v_hive AND user_id = v_pro;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pro::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM 1 FROM hive.hive_invitations WHERE hive_id = v_hive LIMIT 1;
    RAISE EXCEPTION 'active pro direct hive_invitations select should fail';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      RAISE;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.list_hives();
  IF jsonb_array_length(v_json::jsonb) <> 1 THEN
    RAISE EXCEPTION 'owner list_hives count wrong: %', v_json;
  END IF;
  IF (v_json::jsonb -> 0 ->> 'ownerDisplayName') IS DISTINCT FROM 'Alex Owner' THEN
    RAISE EXCEPTION 'owner display name missing from list_hives';
  END IF;
  PERFORM public.create_intent_request(v_hive, 'Owner intent', gen_random_uuid());
  RESET ROLE;

  RAISE NOTICE 'ALL CHECKS PASSED';
END;
$check$;

ROLLBACK;