-- study_revisions immutability: allow the single FK-driven UPDATE where predecessor_revision_id
-- becomes NULL (ON DELETE SET NULL) so chained revisions can be deleted; any other change still
-- raises study_revisions_immutable (P0001).
-- Idempotent: replaces the trigger function and trigger target.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

CREATE OR REPLACE FUNCTION hive.enforce_study_revision_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  -- Allowed: only predecessor_revision_id changes from non-NULL to NULL; every other column unchanged
  -- (jsonb row compare is stable for all current and future columns on this table).
  IF NEW.predecessor_revision_id IS NULL
     AND OLD.predecessor_revision_id IS NOT NULL
     AND (to_jsonb(NEW) - 'predecessor_revision_id') = (to_jsonb(OLD) - 'predecessor_revision_id') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'study_revisions_immutable' USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_study_revisions__immutable ON hive.study_revisions;
CREATE TRIGGER trg_study_revisions__immutable
  BEFORE UPDATE ON hive.study_revisions
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_study_revision_immutable();

REVOKE ALL ON FUNCTION hive.enforce_study_revision_immutable() FROM PUBLIC, anon, authenticated;

COMMIT;
