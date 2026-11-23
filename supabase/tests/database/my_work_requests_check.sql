-- HB-1 Addendum (D-059): request history, client responses, replies linked to requests.
-- Run after 20261122100000_my_work_requests.sql. Expect: ALL CHECKS PASSED, then ROLLBACK.
BEGIN;

DO $check$
DECLARE
  v_owner uuid := 'b1a00001-0000-4000-8000-000000000001';
  v_staff uuid := 'b1a00001-0000-4000-8000-000000000002';
  v_client uuid := 'b1a00001-0000-4000-8000-000000000003';
  v_stranger uuid := 'b1a00001-0000-4000-8000-000000000004';
  v_firm uuid;
  v_hive uuid;
  v_create_req uuid := 'b1a00002-0000-4000-8000-000000000001';
  v_reply_req uuid := 'b1a00002-0000-4000-8000-000000000002';
  v_firm_token text := repeat('d', 64);
  v_client_token text := repeat('e', 64);
  v_request uuid;
  v_request_b uuid;
  v_json json;
  v_item json;
  v_count integer;
  v_study_before integer;
BEGIN
  RESET ROLE;
  INSERT INTO auth.users (id, email, aud, role)
  VALUES
    (v_owner, 'hb1-owner@example.test', 'authenticated', 'authenticated'),
    (v_staff, 'hb1-staff@example.test', 'authenticated', 'authenticated'),
    (v_client, 'hb1-client@example.test', 'authenticated', 'authenticated'),
    (v_stranger, 'hb1-stranger@example.test', 'authenticated', 'authenticated');
  INSERT INTO hive.user_profiles (user_id, display_name, starting_view, created_at, updated_at)
  VALUES
    (v_owner, 'Pat Pro', 'clients', now(), now()),
    (v_client, 'Casey Client', 'own', now(), now())
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.create_firm('Board Law', 'Jamie');
  v_firm := (v_json->>'firmId')::uuid;
  PERFORM public.invite_firm_member('hb1-staff@example.test', 'Paralegal', 'member', v_firm_token);
  v_json := public.create_hive('Client hive', 'C. Client', v_create_req, 'client');
  v_hive := (v_json->'hive'->>'id')::uuid;
  PERFORM public.create_invitation(v_hive, 'hb1-client@example.test', 'client', v_client_token);
  v_json := public.add_request(v_hive, 'Pay stubs', 'Last three months');
  v_request := (v_json->>'requestId')::uuid;
  v_json := public.add_request(v_hive, 'Lease', NULL);
  v_request_b := (v_json->>'requestId')::uuid;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.accept_firm_invitation(v_firm_token);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.accept_invitation(v_client_token);
  RESET ROLE;

  SELECT count(*)::integer INTO v_study_before FROM hive.study_revisions WHERE hive_id = v_hive;

  -- Client sees requester and history.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.list_requests(v_hive);
  SELECT value INTO v_item FROM json_array_elements(v_json->'requests') WHERE value->>'id' = v_request::text;
  IF v_item->'requestedBy'->>'displayName' IS DISTINCT FROM 'Pat Pro' THEN
    RAISE EXCEPTION 'requestedBy missing: %', v_item->'requestedBy';
  END IF;
  IF json_array_length(v_item->'history') <> 1 OR v_item->'history'->0->>'kind' IS DISTINCT FROM 'state' THEN
    RAISE EXCEPTION 'initial history wrong: %', v_item->'history';
  END IF;
  SELECT count(*)::integer INTO v_count FROM hive.request_events WHERE request_id = v_request;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'client should read request_events via RLS, saw %', v_count;
  END IF;

  -- Client responds "I don't have it" → NEEDS_REVIEW; repeat is a replay.
  v_json := public.respond_to_request(v_request, 'DONT_HAVE', 'Employer has not sent them');
  IF v_json->>'state' IS DISTINCT FROM 'NEEDS_REVIEW' OR (v_json->>'duplicate')::boolean THEN
    RAISE EXCEPTION 'respond_to_request wrong: %', v_json;
  END IF;
  v_json := public.respond_to_request(v_request, 'DONT_HAVE', 'Employer has not sent them');
  IF NOT (v_json->>'duplicate')::boolean THEN
    RAISE EXCEPTION 'repeat response should replay: %', v_json;
  END IF;
  BEGIN
    PERFORM public.respond_to_request(v_request, 'DOESNT_APPLY', NULL);
    RAISE EXCEPTION 'different response from NEEDS_REVIEW should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%invalid_transition%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.respond_to_request(v_request_b, 'MAYBE', NULL);
    RAISE EXCEPTION 'unknown response should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%invalid_request:response%' THEN RAISE; END IF;
  END;

  -- Client replies about a request: message + reply event; replay is idempotent.
  v_json := public.reply_to_request(v_request_b, 'Uploading tonight', v_reply_req);
  IF v_json->'message'->>'requestId' IS DISTINCT FROM v_request_b::text OR (v_json->>'duplicate')::boolean THEN
    RAISE EXCEPTION 'reply_to_request wrong: %', v_json;
  END IF;
  v_json := public.reply_to_request(v_request_b, 'Uploading tonight', v_reply_req);
  IF NOT (v_json->>'duplicate')::boolean THEN
    RAISE EXCEPTION 'reply replay should be duplicate: %', v_json;
  END IF;
  BEGIN
    PERFORM public.reply_to_request(v_request, 'Uploading tonight', v_reply_req);
    RAISE EXCEPTION 'same client request id on another request should conflict';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%idempotency_conflict%' THEN RAISE; END IF;
  END;
  RESET ROLE;

  SELECT count(*)::integer INTO v_count
    FROM hive.request_events WHERE request_id = v_request_b AND kind = 'reply';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected one reply event, got %', v_count;
  END IF;

  -- Staff cannot use the client response; staff sees history and resolves.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.respond_to_request(v_request_b, 'DONT_HAVE', NULL);
    RAISE EXCEPTION 'staff respond_to_request should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' THEN RAISE; END IF;
  END;
  v_json := public.list_requests(v_hive);
  SELECT value INTO v_item FROM json_array_elements(v_json->'requests') WHERE value->>'id' = v_request::text;
  IF v_item->'history'->1->>'response' IS DISTINCT FROM 'DONT_HAVE'
     OR v_item->'history'->1->'actor'->>'displayName' IS DISTINCT FROM 'Casey Client' THEN
    RAISE EXCEPTION 'staff history missing client response: %', v_item->'history';
  END IF;
  SELECT value INTO v_item FROM json_array_elements(v_json->'requests') WHERE value->>'id' = v_request_b::text;
  IF json_array_length(v_item->'messages') <> 1 THEN
    RAISE EXCEPTION 'linked message missing: %', v_item->'messages';
  END IF;
  PERFORM public.staff_resolve_request(v_request, 'NOT_NEEDED', NULL);
  RESET ROLE;

  -- Completed work and history are preserved; client sees the resolution.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.list_requests(v_hive);
  SELECT value INTO v_item FROM json_array_elements(v_json->'requests') WHERE value->>'id' = v_request::text;
  IF v_item->>'state' IS DISTINCT FROM 'NOT_NEEDED' OR json_array_length(v_item->'history') <> 3 THEN
    RAISE EXCEPTION 'resolved history wrong: %', v_item;
  END IF;
  BEGIN
    PERFORM public.respond_to_request(v_request, 'DONT_HAVE', NULL);
    RAISE EXCEPTION 'respond on NOT_NEEDED should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%invalid_transition%' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- Strangers see nothing and cannot act.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::integer INTO v_count FROM hive.request_events WHERE request_id IN (v_request, v_request_b);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'stranger should not see request_events';
  END IF;
  BEGIN
    PERFORM public.respond_to_request(v_request_b, 'DONT_HAVE', NULL);
    RAISE EXCEPTION 'stranger respond should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%access_denied%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.reply_to_request(v_request_b, 'hello', gen_random_uuid());
    RAISE EXCEPTION 'stranger reply should fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%request_not_found%' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- Status changes do not touch the Study.
  SELECT count(*)::integer INTO v_count FROM hive.study_revisions WHERE hive_id = v_hive;
  IF v_count <> v_study_before THEN
    RAISE EXCEPTION 'request actions changed study revisions';
  END IF;

  -- Assistant messages cannot be linked to a request.
  BEGIN
    UPDATE hive.hive_messages SET channel = 'assistant', thread_owner_user_id = v_client
     WHERE request_id = v_request_b;
    RAISE EXCEPTION 'assistant message with request_id should fail';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'ALL CHECKS PASSED';
END;
$check$;

ROLLBACK;
