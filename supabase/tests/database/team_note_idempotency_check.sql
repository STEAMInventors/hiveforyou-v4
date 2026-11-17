-- Manual check: team note idempotency (Supabase SQL editor safe)
-- Sets a synthetic firm member via request.jwt.claims; rolls back all writes.

BEGIN;

INSERT INTO auth.users (id, email, aud, role)
VALUES ('f1b30201-0000-4000-8000-000000000099', 'tn-editor@example.test', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO hive.user_profiles (user_id, display_name, starting_view, created_at, updated_at)
VALUES ('f1b30201-0000-4000-8000-000000000099', 'Editor', 'clients', now(), now())
ON CONFLICT (user_id) DO NOTHING;

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"f1b30201-0000-4000-8000-000000000099","role":"authenticated"}';

DO $$
DECLARE
  v_hive uuid;
  v_other uuid;
  v_key uuid := 'f1b30201-0000-4000-8000-00000000aa1';
  v_key2 uuid := 'f1b30201-0000-4000-8000-00000000aa2';
  v_first json;
  v_second json;
  v_count integer;
  v_status text := 'FAIL';
BEGIN
  IF (public.create_firm('TN Editor Firm', 'Assistant')->>'firmId') IS NULL THEN
    RAISE EXCEPTION 'create_firm failed';
  END IF;

  v_hive := (public.create_hive('Client', 'Note check', 'f1b30201-0000-4000-8000-00000000bb1', 'client')->'hive'->>'id')::uuid;
  v_other := (public.create_hive('Other', 'Hive', 'f1b30201-0000-4000-8000-00000000bb2', 'client')->'hive'->>'id')::uuid;

  SELECT public.add_team_note(v_hive, 'idempotency check note', NULL, v_key) INTO v_first;
  SELECT public.add_team_note(v_hive, 'idempotency check note', NULL, v_key) INTO v_second;

  IF (v_first->>'teamNoteId') IS DISTINCT FROM (v_second->>'teamNoteId') THEN
    RAISE EXCEPTION 'Retry did not return the same note id';
  END IF;

  SELECT count(*)::integer INTO v_count
    FROM hive.team_notes
   WHERE hive_id = v_hive AND client_request_id = v_key;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected one row for client_request_id, got %', v_count;
  END IF;

  PERFORM public.add_team_note(v_other, 'cross-hive same key', NULL, v_key);
  PERFORM public.add_team_note(v_hive, 'different key note', NULL, v_key2);

  SELECT count(*)::integer INTO v_count FROM hive.team_notes WHERE hive_id = v_hive;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'Expected at least two notes after distinct keys';
  END IF;

  PERFORM public.add_team_note(v_hive, 'null key a', NULL, NULL);
  PERFORM public.add_team_note(v_hive, 'null key b', NULL, NULL);

  v_status := 'PASS';
  RAISE NOTICE 'team_note idempotency check: % (hive %)', v_status, v_hive;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'team_note idempotency check: FAIL — %', SQLERRM;
    RAISE;
END;
$$;

ROLLBACK;