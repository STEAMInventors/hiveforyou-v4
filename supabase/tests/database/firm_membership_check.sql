-- FL-11: paste into Supabase SQL editor (one transaction). Expect: ALL CHECKS PASSED, then ROLLBACK.
BEGIN;

DO $check$
DECLARE
  v_owner uuid := 'f1100010-0000-4000-8000-000000000001';
  v_member uuid := 'f1100010-0000-4000-8000-000000000002';
  v_stranger uuid := 'f1100010-0000-4000-8000-000000000003';
  v_hive uuid;
  v_firm uuid;
  v_client_req uuid := 'f1100020-0000-4000-8000-000000000001';
  v_token_hash text := repeat('c', 64);
  v_json json;
  v_count integer;
  v_dummy text;
BEGIN
  RESET ROLE;

  INSERT INTO auth.users (id, email, aud, role)
  VALUES
    (v_owner, 'f11-owner@example.test', 'authenticated', 'authenticated'),
    (v_member, 'f11-member@example.test', 'authenticated', 'authenticated'),
    (v_stranger, 'f11-stranger@example.test', 'authenticated', 'authenticated');

  INSERT INTO hive.user_profiles (user_id, display_name, starting_view, created_at, updated_at)
  VALUES (v_owner, 'Firm Owner', 'client', now(), now())
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_json := public.create_firm('Rivera Law', 'Sarah');
  v_firm := (v_json->>'firmId')::uuid;
  IF v_firm IS NULL THEN
    RAISE EXCEPTION 'create_firm failed: %', v_json;
  END IF;

  SELECT count(*)::integer INTO v_count FROM hive.firms WHERE id = v_firm;
  IF v_count <> 1 THEN RAISE EXCEPTION 'owner firms select failed'; END IF;

  SELECT count(*)::integer INTO v_count
    FROM hive.firm_members
   WHERE firm_id = v_firm AND state = 'active';
  IF v_count <> 1 THEN RAISE EXCEPTION 'owner firm_members select failed'; END IF;

  BEGIN
    SELECT fm.token_hash INTO v_dummy
      FROM hive.firm_members fm
     WHERE fm.firm_id = v_firm AND fm.state = 'active'
     LIMIT 1;
    RAISE EXCEPTION 'owner direct firm_members token_hash select should fail';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      RAISE;
  END;

  v_json := public.invite_firm_member('f11-member@example.test', 'Paralegal', 'member', v_token_hash);
  IF (v_json->>'firmMemberId') IS NULL THEN
    RAISE EXCEPTION 'invite_firm_member failed: %', v_json;
  END IF;

  v_json := public.lookup_firm_invitation(v_token_hash);
  IF (v_json->>'status') <> 'valid' OR position('token_hash' in lower(v_json::text)) > 0 THEN
    RAISE EXCEPTION 'lookup_firm_invitation wrong: %', v_json;
  END IF;

  BEGIN
    PERFORM 1
      FROM hive.firm_members
     WHERE firm_id = v_firm AND state = 'invited' AND token_hash IS NOT NULL;
    RAISE EXCEPTION 'owner must not read firm_members token_hash via table';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      RAISE;
  END;

  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_json := public.accept_firm_invitation(v_token_hash);
  IF (v_json->>'firmId')::uuid IS DISTINCT FROM v_firm THEN
    RAISE EXCEPTION 'accept_firm_invitation failed: %', v_json;
  END IF;

  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_json := public.create_hive('Client intake', 'M. Lopez', v_client_req, 'client');
  v_hive := (v_json->'hive'->>'id')::uuid;
  IF (v_json->'hive'->>'firmId')::uuid IS DISTINCT FROM v_firm THEN
    RAISE EXCEPTION 'firm hive create wrong firmId: %', v_json;
  END IF;

  v_json := public.assign_hive(v_hive, v_member, 'You have this one');
  IF (v_json->>'assigneeUserId')::uuid IS DISTINCT FROM v_member THEN
    RAISE EXCEPTION 'assign_hive failed: %', v_json;
  END IF;

  SELECT count(*)::integer INTO v_count FROM hive.hive_handovers WHERE hive_id = v_hive;
  IF v_count < 1 THEN RAISE EXCEPTION 'owner hive_handovers select failed'; END IF;

  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.get_hive(v_hive);

  v_count := 0;
  SELECT count(*)::integer INTO v_count
    FROM jsonb_array_elements(public.list_hives()::jsonb) AS row
   WHERE (row->>'id')::uuid = v_hive;
  IF v_count <> 1 THEN RAISE EXCEPTION 'member list_hives missing firm hive: count=%', v_count; END IF;

  PERFORM public.add_team_note(v_hive, 'Called client; waiting on pay stubs.');

  BEGIN
    PERFORM public.invite_firm_member('f11-stranger@example.test', 'Paralegal', 'member', repeat('d', 64));
    RAISE EXCEPTION 'member invite_firm_member should fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    INSERT INTO hive.team_notes (hive_id, author_user_id, body)
    VALUES (v_hive, v_member, 'Direct insert');
    RAISE EXCEPTION 'member direct team_notes insert should fail';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      RAISE;
  END;

  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.get_hive(v_hive);
    RAISE EXCEPTION 'stranger get_hive should fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  SELECT count(*)::integer INTO v_count FROM hive.firms;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'stranger firms select should see no rows';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'ALL CHECKS PASSED';
END;
$check$;

ROLLBACK;