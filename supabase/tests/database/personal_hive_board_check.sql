-- HB-2 (D-060): personal Hive without a Pro, with an invited Pro, and with an accepted Pro.
-- Cross-hive access is refused. Run after 20261123120000_personal_hive_pro_requests.sql.
-- Expect: ALL CHECKS PASSED, then ROLLBACK.
BEGIN;

DO $check$
DECLARE
  v_owner uuid := 'c2b00001-0000-4000-8000-000000000001';
  v_pro uuid := 'c2b00001-0000-4000-8000-000000000002';
  v_other uuid := 'c2b00001-0000-4000-8000-000000000003';
  v_stranger uuid := 'c2b00001-0000-4000-8000-000000000004';
  v_hive uuid;
  v_other_hive uuid;
  v_firm_hive uuid;
  v_firm uuid;
  v_create uuid := 'c2b00002-0000-4000-8000-000000000001';
  v_create_other uuid := 'c2b00002-0000-4000-8000-000000000002';
  v_create_firm uuid := 'c2b00002-0000-4000-8000-000000000003';
  v_token text := repeat('a', 64);
  v_msg uuid := 'c2b00003-0000-4000-8000-000000000001';
  v_reply uuid := 'c2b00003-0000-4000-8000-000000000002';
  v_request uuid;
  v_pack uuid;
  v_json json;
  v_study integer;
BEGIN
  RESET ROLE;
  INSERT INTO auth.users (id, email, aud, role)
  VALUES
    (v_owner, 'hb2-owner@example.test', 'authenticated', 'authenticated'),
    (v_pro, 'hb2-pro@example.test', 'authenticated', 'authenticated'),
    (v_other, 'hb2-other@example.test', 'authenticated', 'authenticated'),
    (v_stranger, 'hb2-stranger@example.test', 'authenticated', 'authenticated');
  INSERT INTO hive.user_profiles (user_id, display_name, starting_view, created_at, updated_at)
  VALUES
    (v_owner, 'Maya Owner', 'own', now(), now()),
    (v_pro, 'Pat Pro', 'clients', now(), now())
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.create_hive('Maya personal', 'Own documents', v_create, 'own');
  v_hive := (v_json->'hive'->>'id')::uuid;
  IF (v_json->'hive'->>'firmId') IS NOT NULL THEN
    RAISE EXCEPTION 'personal hive should have no firm: %', v_json;
  END IF;
  v_json := public.create_hive('Maya other', NULL, v_create_other, 'own');
  v_other_hive := (v_json->'hive'->>'id')::uuid;
  PERFORM public.create_invitation(v_hive, 'hb2-pro@example.test', 'professional', v_token);

  BEGIN
    PERFORM public.add_request(v_hive, 'Owner must not create this', NULL);
    RAISE EXCEPTION 'personal owner add_request should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  RESET ROLE;

  INSERT INTO hive.requests (hive_id, source, pack_row_key, title, position, state, created_by)
  VALUES (v_hive, 'pack', 'study-suggestion', 'Study suggestion', 1, 'WAITING', v_owner)
  RETURNING id INTO v_pack;

  -- Invited, not accepted: the Pro cannot see or create requests, or read the private thread.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pro::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.list_requests(v_hive);
    RAISE EXCEPTION 'invited pro list_requests should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLERRM NOT LIKE '%hive_not_found%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.add_request(v_hive, 'Too early', NULL);
    RAISE EXCEPTION 'invited pro add_request should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  v_json := public.accept_invitation(v_token);
  IF (v_json->>'memberState') <> 'pending' THEN
    RAISE EXCEPTION 'accept should stay pending: %', v_json;
  END IF;
  BEGIN
    PERFORM public.add_request(v_hive, 'Still pending', NULL);
    RAISE EXCEPTION 'pending pro add_request should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.activate_professional_membership(v_other_hive);
    RAISE EXCEPTION 'pro must not join a hive they were not invited to';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;

  v_json := public.activate_professional_membership(v_hive);
  IF (v_json->>'memberState') <> 'active' OR (v_json->>'duplicate')::boolean THEN
    RAISE EXCEPTION 'activate failed: %', v_json;
  END IF;
  v_json := public.activate_professional_membership(v_hive);
  IF (v_json->>'duplicate')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'second activate should replay: %', v_json;
  END IF;

  v_json := public.add_request(v_hive, 'Pay stubs', 'Last three months');
  v_request := (v_json->>'requestId')::uuid;
  BEGIN
    PERFORM public.add_request(v_other_hive, 'Cross hive', NULL);
    RAISE EXCEPTION 'pro add_request on another hive should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.respond_to_request(v_request, 'DONT_HAVE', 'No');
    RAISE EXCEPTION 'pro respond_to_request should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  v_json := public.post_hive_message(v_hive, 'Please send the stubs', v_msg, NULL, 'people', NULL);
  IF (v_json->'message'->>'id') IS NULL THEN
    RAISE EXCEPTION 'pro people message failed: %', v_json;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.post_hive_message(v_hive, 'What does this page say?', v_reply, NULL, 'assistant', NULL);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pro::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.list_hive_messages(v_hive, 'assistant', v_owner, NULL, NULL, 20);
    RAISE EXCEPTION 'pro must not read the owner Ask thread';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%hive_not_found%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.list_requests(v_hive);
  IF NOT EXISTS (
    SELECT 1 FROM json_array_elements(v_json->'requests') row
     WHERE row->>'id' = v_request::text AND row->>'source' = 'staff'
  ) THEN
    RAISE EXCEPTION 'staff request missing: %', v_json;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM json_array_elements(v_json->'requests') row
     WHERE row->>'id' = v_pack::text AND row->>'source' = 'pack'
  ) THEN
    RAISE EXCEPTION 'pack request must stay a pack row: %', v_json;
  END IF;
  v_json := public.respond_to_request(v_request, 'DONT_HAVE', 'Employer has not sent them');
  IF (v_json->>'state') <> 'NEEDS_REVIEW' THEN
    RAISE EXCEPTION 'owner respond failed: %', v_json;
  END IF;
  BEGIN
    PERFORM public.staff_resolve_request(v_request, 'ACCEPT', NULL);
    RAISE EXCEPTION 'owner staff_resolve should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  v_json := public.list_hive_messages(v_hive, 'people', NULL, NULL, NULL, 20);
  IF json_array_length(v_json->'messages') < 1 THEN
    RAISE EXCEPTION 'owner should see the shared conversation: %', v_json;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pro::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.staff_resolve_request(v_request, 'NOT_NEEDED', 'Not required');
  IF (v_json->>'state') <> 'NOT_NEEDED' THEN
    RAISE EXCEPTION 'pro resolve failed: %', v_json;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.list_requests(v_hive);
    RAISE EXCEPTION 'stranger list_requests should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLERRM NOT LIKE '%hive_not_found%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.list_hive_messages(v_hive, 'assistant', v_owner, NULL, NULL, 20);
    RAISE EXCEPTION 'stranger must not read Ask';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%hive_not_found%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- Firm staff can still add a request. A pending professional on a firm hive cannot join it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.create_firm('Board Law', 'Maya');
  v_firm := (v_json->>'firmId')::uuid;
  v_json := public.create_hive('Firm client', 'Client', v_create_firm, 'client');
  v_firm_hive := (v_json->'hive'->>'id')::uuid;
  v_json := public.add_request(v_firm_hive, 'Firm request', NULL);
  IF (v_json->>'requestId') IS NULL THEN
    RAISE EXCEPTION 'firm staff add_request failed: %', v_json;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.activate_professional_membership(v_firm_hive);
    RAISE EXCEPTION 'stranger activate on a firm hive should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' AND SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  RESET ROLE;

  SELECT count(*)::integer INTO v_study FROM hive.study_revisions WHERE hive_id IN (v_hive, v_other_hive, v_firm_hive);
  IF v_study <> 0 THEN
    RAISE EXCEPTION 'requests must not create study revisions';
  END IF;

  RAISE NOTICE 'ALL CHECKS PASSED';
END;
$check$;

ROLLBACK;
