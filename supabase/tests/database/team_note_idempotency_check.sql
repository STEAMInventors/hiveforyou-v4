-- Manual staging check: team note idempotency (FL-4b-2b)
-- Usage: psql ... -f supabase/tests/database/team_note_idempotency_check.sql

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_owner uuid := auth.uid();
  v_hive uuid;
  v_key uuid := gen_random_uuid();
  v_first json;
  v_second json;
  v_count integer;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Sign in as a firm staff member before running this check';
  END IF;

  SELECT h.id INTO v_hive
    FROM hive.hives h
   WHERE hive.is_firm_staff(h.id)
   ORDER BY h.created_at DESC
   LIMIT 1;

  IF v_hive IS NULL THEN
    RAISE EXCEPTION 'No firm hive visible to this user';
  END IF;

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

  RAISE NOTICE 'team_note idempotency check passed for hive %', v_hive;
END;
$$;