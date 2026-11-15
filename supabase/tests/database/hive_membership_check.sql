-- FL-5: paste into Supabase SQL editor (one transaction). Expect: ALL CHECKS PASSED, then ROLLBACK.
BEGIN;

DO $check$
DECLARE
  v_owner uuid := 'f0280001-0000-4000-8000-000000000001';
  v_client uuid := 'f0280001-0000-4000-8000-000000000002';
  v_pro uuid := 'f0280001-0000-4000-8000-000000000003';
  v_stranger uuid := 'f0280001-0000-4000-8000-000000000004';
  v_wrong uuid := 'f0280001-0000-4000-8000-000000000005';
  v_hive uuid := 'f0280002-0000-4000-8000-000000000001';
  v_client_req uuid := 'f0280003-0000-4000-8000-000000000001';
  v_token_hex text := repeat('a', 64);
  v_token_pro text := repeat('b', 64);
  v_token_reuse text := repeat('c', 64);
  v_inv uuid;
  v_json json;
  v_count integer;
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES
    (v_owner, 'f028-owner@example.test', 'authenticated', 'authenticated'),
    (v_client, 'f028-client@example.test', 'authenticated', 'authenticated'),
    (v_pro, 'f028-pro@example.test', 'authenticated', 'authenticated'),
    (v_stranger, 'f028-stranger@example.test', 'authenticated', 'authenticated'),
    (v_wrong, 'f028-wrong@example.test', 'authenticated', 'authenticated');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  v_json := public.create_hive('Membership check hive', NULL, v_client_req, 'client');
  v_hive := (v_json->'hive'->>'id')::uuid;

  INSERT INTO hive.hive_invitations (hive_id, email, role, invited_by, token_hash, expires_at)
  VALUES (v_hive, 'f028-client@example.test', 'client', v_owner, v_token_hex, now() + interval '7 days')
  RETURNING id INTO v_inv;

  INSERT INTO hive.hive_invitations (hive_id, email, role, invited_by, token_hash, expires_at)
  VALUES (v_hive, 'f028-pro@example.test', 'professional', v_owner, v_token_pro, now() + interval '7 days');

  -- Non-member sees nothing
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  v_json := public.list_hives();
  IF jsonb_array_length(v_json::jsonb) <> 0 THEN
    RAISE EXCEPTION 'non-member list_hives should be empty';
  END IF;
  BEGIN
    PERFORM public.get_hive(v_hive);
    RAISE EXCEPTION 'non-member get_hive should fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Client accepts
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  v_json := public.accept_invitation(v_token_hex);
  IF (v_json->>'role') <> 'client' OR (v_json->>'memberState') <> 'active' THEN
    RAISE EXCEPTION 'client accept state wrong: %', v_json;
  END IF;

  -- Active client can read, not write
  PERFORM public.get_hive(v_hive);
  PERFORM public.list_hive_source_documents(v_hive);
  PERFORM public.get_study_preparation(v_hive, false);
  PERFORM public.get_hive_reports(v_hive);
  BEGIN
    PERFORM public.start_study_preparation(v_hive, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'client start_study_preparation should fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM public.set_hive_kind(v_hive, 'own');
    RAISE EXCEPTION 'client set_hive_kind should fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM public.create_invitation(v_hive, 'x@example.test', 'client', repeat('d', 64));
    RAISE EXCEPTION 'client create_invitation should fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Welcome counts before professional accepts (invitation still open)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pro::text, 'role', 'authenticated')::text, true);
  v_json := public.get_invitation_welcome_context(v_token_pro);
  IF (v_json->>'hiveId')::uuid IS DISTINCT FROM v_hive THEN
    RAISE EXCEPTION 'welcome context hive mismatch';
  END IF;

  -- Professional accepts → pending
  v_json := public.accept_invitation(v_token_pro);
  IF (v_json->>'memberState') <> 'pending' THEN
    RAISE EXCEPTION 'pro should be pending: %', v_json;
  END IF;
  BEGIN
    PERFORM public.list_hive_source_documents(v_hive);
    RAISE EXCEPTION 'pending pro must not list documents';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM public.get_study_preparation(v_hive, false);
    RAISE EXCEPTION 'pending pro must not read study';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM public.get_hive_reports(v_hive);
    RAISE EXCEPTION 'pending pro must not read reports';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  -- Invitation reuse / wrong email
  BEGIN
    PERFORM public.accept_invitation(v_token_pro);
    RAISE EXCEPTION 'reused invitation should fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_wrong::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.accept_invitation(v_token_hex);
    RAISE EXCEPTION 'wrong email accept should fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Expired invitation
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  INSERT INTO hive.hive_invitations (hive_id, email, role, invited_by, token_hash, expires_at)
  VALUES (v_hive, 'expired@example.test', 'client', v_owner, v_token_reuse, now() - interval '1 hour');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.accept_invitation(v_token_reuse);
    RAISE EXCEPTION 'expired invitation should fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Revoked invitation
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  INSERT INTO hive.hive_invitations (hive_id, email, role, invited_by, token_hash, expires_at, revoked_at)
  VALUES (v_hive, 'revoked@example.test', 'client', v_owner, repeat('e', 64), now() + interval '7 days', now());

  -- Remove client → immediate loss
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  PERFORM public.remove_member(v_hive, v_client);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.get_hive(v_hive);
    RAISE EXCEPTION 'removed client should lose access';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Owner can do owner operations
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  PERFORM public.list_hive_people(v_hive);
  PERFORM public.create_invitation(v_hive, 'newclient@example.test', 'client', repeat('f', 64));

  SELECT count(*)::integer INTO v_count
    FROM hive.audit_events e
   WHERE e.case_id = v_hive
     AND e.event_type IN ('invitation_accepted', 'member_removed', 'invitation_created');
  IF v_count < 3 THEN
    RAISE EXCEPTION 'expected membership audit rows, got %', v_count;
  END IF;

  RAISE NOTICE 'ALL CHECKS PASSED';
END;
$check$;

ROLLBACK;