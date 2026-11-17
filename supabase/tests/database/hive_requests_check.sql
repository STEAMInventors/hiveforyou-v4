-- FL-6a-1: checklist, upload gate, request RPCs. Paste into Supabase SQL editor.
-- Expect: ALL CHECKS PASSED, then ROLLBACK.
BEGIN;

DO $check$
DECLARE
  v_owner uuid := 'f06a0001-0000-4000-8000-000000000001';
  v_member uuid := 'f06a0001-0000-4000-8000-000000000002';
  v_client uuid := 'f06a0001-0000-4000-8000-000000000003';
  v_stranger uuid := 'f06a0001-0000-4000-8000-000000000004';
  v_firm uuid;
  v_hive uuid;
  v_own_hive uuid;
  v_client_req uuid := 'f06a0002-0000-4000-8000-000000000001';
  v_own_req uuid := 'f06a0002-0000-4000-8000-000000000002';
  v_firm_token text := repeat('c', 64);
  v_token_client text := repeat('a', 64);
  v_doc uuid := 'f06a0003-0000-4000-8000-000000000001';
  v_client_doc uuid := 'f06a0003-0000-4000-8000-000000000002';
  v_other_doc uuid := 'f06a0003-0000-4000-8000-000000000003';
  v_request_id uuid;
  v_request_id_b uuid;
  v_json json;
  v_count integer;
  v_items jsonb := '[{"key":"pay stubs","title":"Pay stubs","detail":"recent","position":1}]'::jsonb;
  v_items_b jsonb := '[{"key":"tax return","title":"Tax return","detail":"2024","position":1}]'::jsonb;
BEGIN
  RESET ROLE;

  INSERT INTO auth.users (id, email, aud, role)
  VALUES
    (v_owner, 'f06a-owner@example.test', 'authenticated', 'authenticated'),
    (v_member, 'f06a-member@example.test', 'authenticated', 'authenticated'),
    (v_client, 'f06a-client@example.test', 'authenticated', 'authenticated'),
    (v_stranger, 'f06a-stranger@example.test', 'authenticated', 'authenticated');

  INSERT INTO hive.user_profiles (user_id, display_name, starting_view, created_at, updated_at)
  VALUES
    (v_owner, 'Case Owner', 'clients', now(), now()),
    (v_client, 'Case Client', 'own', now(), now())
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.create_firm('Checklist Law', 'Jamie');
  v_firm := (v_json->>'firmId')::uuid;
  v_json := public.invite_firm_member('f06a-member@example.test', 'Paralegal', 'member', v_firm_token);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.accept_firm_invitation(v_firm_token);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.create_hive('Firm client hive', 'R. Lee', v_client_req, 'client');
  v_hive := (v_json->'hive'->>'id')::uuid;
  v_json := public.create_invitation(v_hive, 'f06a-client@example.test', 'client', v_token_client);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.accept_invitation(v_token_client);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.create_hive('Own hive', NULL, v_own_req, 'own');
  v_own_hive := (v_json->'hive'->>'id')::uuid;
  RESET ROLE;

  RESET ROLE;
  INSERT INTO hive.source_documents (
    id, case_id, owner_user_id, uploaded_by_user_id, original_filename, mime_type, byte_size, sha256,
    storage_bucket, storage_path, upload_status, lifecycle_status, read_status, created_at
  ) VALUES
    (v_doc, v_hive, v_owner, NULL, 'owner.pdf', 'application/pdf', 1, repeat('a', 64),
     'hive-source-documents', v_owner::text || '/' || v_hive::text || '/owner.pdf', 'UPLOADED', 'ACTIVE', 'PENDING', now());

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.get_upload_quota_for_hive(v_hive);
  IF (v_json->>'limit')::integer <> 2000 OR (v_json->>'used')::integer <> 1 THEN
    RAISE EXCEPTION 'client hive quota from owner count: %', v_json;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.get_upload_quota_for_hive(v_hive);
    RAISE EXCEPTION 'stranger quota should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN
        RAISE;
      END IF;
  END;
  RESET ROLE;

  INSERT INTO hive.source_documents (
    id, case_id, owner_user_id, uploaded_by_user_id, original_filename, mime_type, byte_size, sha256,
    storage_bucket, storage_path, upload_status, lifecycle_status, read_status, created_at
  ) VALUES
    (v_client_doc, v_hive, v_owner, v_client, 'client.pdf', 'application/pdf', 1, repeat('b', 64),
     'hive-source-documents', v_owner::text || '/' || v_hive::text || '/client.pdf', 'UPLOADED', 'ACTIVE', 'PENDING', now()),
    (v_other_doc, v_hive, v_owner, v_member, 'staff.pdf', 'application/pdf', 1, repeat('c', 64),
     'hive-source-documents', v_owner::text || '/' || v_hive::text || '/staff.pdf', 'UPLOADED', 'ACTIVE', 'PENDING', now());

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.start_checklist(v_hive, 'sample-pack', 1, v_items);
  IF (v_json->>'created')::integer <> 1 THEN
    RAISE EXCEPTION 'start_checklist expected one row: %', v_json;
  END IF;

  BEGIN
    PERFORM public.start_checklist(v_hive, 'chapter13-confirmation', 1, v_items_b);
    RAISE EXCEPTION 'different pack should fail';
  EXCEPTION
    WHEN sqlstate '23505' THEN NULL;
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%pack_conflict%' THEN
        RAISE;
      END IF;
  END;

  v_json := public.list_requests(v_hive);
  v_request_id := (v_json->'requests'->0->>'id')::uuid;
  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'list_requests missing item: %', v_json;
  END IF;

  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.add_request(v_hive, 'Client extra', NULL);
    RAISE EXCEPTION 'client add_request should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.attach_document_to_request(v_request_id, v_client_doc);

  BEGIN
    PERFORM public.attach_document_to_request(v_request_id, v_client_doc);
    RAISE EXCEPTION 'duplicate attach same request should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%document_already_on_request%' AND SQLERRM NOT LIKE '%22023%' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.add_request(v_hive, 'Second line', NULL);
  v_request_id_b := (v_json->>'requestId')::uuid;
  PERFORM public.staff_resolve_request(v_request_id_b, 'NOT_NEEDED', NULL);
  BEGIN
    PERFORM public.attach_document_to_request(v_request_id_b, v_doc);
    RAISE EXCEPTION 'attach to NOT_NEEDED should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%request_not_needed%' AND SQLERRM NOT LIKE '%22023%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.attach_document_to_request(v_request_id_b, v_client_doc);
    RAISE EXCEPTION 'attach doc on other request should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%document_already_on_other_request%' AND SQLERRM NOT LIKE '%22023%' THEN
        RAISE;
      END IF;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.staff_resolve_request(v_request_id, 'ACCEPT', NULL);
    RAISE EXCEPTION 'client staff_resolve_request should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.set_request_state(v_request_id, 'READING', NULL);
    RAISE EXCEPTION 'client set_request_state should fail';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.staff_resolve_request(v_request_id, 'ASK_AGAIN', 'Please send a clearer scan.');
  IF v_json->>'stateNote' IS DISTINCT FROM 'Please send a clearer scan.' THEN
    RAISE EXCEPTION 'ASK_AGAIN note missing for staff resolve: %', v_json;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.list_requests(v_hive);
  IF v_json->'requests'->0->>'stateNote' IS DISTINCT FROM 'Please send a clearer scan.' THEN
    RAISE EXCEPTION 'ASK_AGAIN note not visible to member: %', v_json;
  END IF;

  SELECT count(*)::integer INTO v_count
    FROM hive.request_events e
    JOIN hive.requests r ON r.id = e.request_id
   WHERE r.hive_id = v_hive;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'client should not see request_events';
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.list_requests(v_hive);
    RAISE EXCEPTION 'stranger list_requests should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%hive_not_found%' AND SQLSTATE <> 'P0002' THEN
        RAISE;
      END IF;
  END;
  BEGIN
    PERFORM public.attach_document_to_request(v_request_id, v_doc);
    RAISE EXCEPTION 'stranger attach should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLERRM NOT LIKE '%hive_not_found%' THEN
        RAISE;
      END IF;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.get_upload_context(v_hive);
  IF (v_json->>'canUpload')::boolean IS NOT TRUE OR (v_json->>'ownerUserId')::uuid IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'owner upload context wrong: %', v_json;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.get_upload_context(v_hive);
  IF (v_json->>'canUpload')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'member upload context: %', v_json;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.get_upload_context(v_hive);
  IF (v_json->>'canUpload')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'client upload context: %', v_json;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.get_upload_context(v_hive);
  IF v_json::text <> '{"canUpload" : false, "ownerUserId" : null, "belongsToFirm" : false}'::text
     AND v_json::text <> '{"canUpload":false,"ownerUserId":null,"belongsToFirm":false}' THEN
    IF (v_json->>'canUpload')::boolean IS NOT FALSE OR v_json->>'ownerUserId' IS NOT NULL THEN
      RAISE EXCEPTION 'stranger upload context should hide hive: %', v_json;
    END IF;
  END IF;
  RESET ROLE;

  UPDATE hive.hives SET archived_at = now() WHERE id = v_own_hive;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.get_upload_context(v_own_hive);
  IF (v_json->>'canUpload')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'archived hive upload context: %', v_json;
  END IF;
  UPDATE hive.hives SET archived_at = NULL WHERE id = v_own_hive;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.start_document_reads(v_hive, gen_random_uuid(), gen_random_uuid(), ARRAY[v_client_doc]);
  IF (v_json->>'created')::integer < 1 THEN
    RAISE EXCEPTION 'client read on own upload should queue: %', v_json;
  END IF;
  BEGIN
    PERFORM public.start_document_reads(v_hive, gen_random_uuid(), gen_random_uuid(), ARRAY[v_other_doc]);
    RAISE EXCEPTION 'client read on others upload should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN
        RAISE;
      END IF;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.apply_vault_transaction('{}'::jsonb);
    RAISE EXCEPTION 'authenticated apply_vault_transaction should fail';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  SET ROLE service_role;
  BEGIN
    PERFORM public.record_request_check(
      v_request_id, ARRAY[v_client_doc], 'FITS', 'Looks right', '[]'::jsonb, 'fixture-model', 'fixture/1'
    );
    RAISE EXCEPTION 'FITS without page_refs should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%page_refs_required%' AND SQLERRM NOT LIKE '%22023%' THEN
        RAISE;
      END IF;
  END;

  PERFORM public.record_request_check(
    v_request_id,
    ARRAY[v_client_doc],
    'FITS',
    'First pass',
    '[{"sourceDocumentId":"' || v_client_doc::text || '","page":1}]'::jsonb,
    'fixture-model',
    'fixture/1'
  );
  PERFORM pg_sleep(0.01);
  PERFORM public.record_request_check(
    v_request_id,
    ARRAY[v_client_doc],
    'WRONG_PERIOD',
    'Second pass',
    '[{"sourceDocumentId":"' || v_client_doc::text || '","page":2}]'::jsonb,
    'fixture-model',
    'fixture/1'
  );
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.list_requests(v_hive);
  IF v_json->'requests'->0->'latestCheck'->>'verdict' IS DISTINCT FROM 'WRONG_PERIOD'
     OR v_json->'requests'->0->'latestCheck'->>'sentence' IS DISTINCT FROM 'Second pass' THEN
    RAISE EXCEPTION 'list_requests should surface latest check: %', v_json->'requests'->0->'latestCheck';
  END IF;
  RESET ROLE;

  RAISE NOTICE 'ALL CHECKS PASSED';
END;
$check$;

ROLLBACK;