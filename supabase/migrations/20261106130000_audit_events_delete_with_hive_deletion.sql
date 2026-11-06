-- Allow DELETE of hive.audit_events only when teardown removes the Hive row or the Hive is marked
-- for deletion (deleting_at set), so CASCADE from permanent Hive deletion can complete. UPDATE and
-- all other DELETE cases keep raising 'hive.audit_events is append-only'.
-- Idempotent: replaces hive.prevent_audit_event_mutation only; triggers unchanged.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

CREATE OR REPLACE FUNCTION hive.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_may_delete boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'hive.audit_events is append-only';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.case_id IS NULL THEN
      RETURN OLD;
    END IF;

    SELECT (h.id IS NULL OR h.deleting_at IS NOT NULL)
      INTO v_may_delete
      FROM hive.cases c
      LEFT JOIN hive.hives h ON h.id = c.id
     WHERE c.id = OLD.case_id;

    IF NOT FOUND THEN
      RETURN OLD;
    END IF;

    IF v_may_delete THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION 'hive.audit_events is append-only';
END;
$$;

REVOKE ALL ON FUNCTION hive.prevent_audit_event_mutation() FROM PUBLIC, anon, authenticated;

COMMIT;
