-- V4-004 — Disable recurring pg_cron workflow dispatcher (immediate server-side chaining).
--
-- Apply on production when `hive-dispatch-due-work` was scheduled by an earlier
-- `20261102150000_analysis_workflow.sql` apply. Safe no-op when pg_cron is absent or the job
-- does not exist. Does not remove `public.dispatch_due_work()` (optional manual recovery).
-- Authority: HiveForYou-DECISIONS.md (D-041 orchestration refinement, 2026-11-02).
-- Do not apply without explicit founder authorization.

BEGIN;

DO $$
DECLARE
  v_job_exists boolean;
BEGIN
  -- Guard rewritten 2026-11-05 for databases without pg_cron; behavior unchanged.
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''hive-dispatch-due-work'')'
      INTO v_job_exists;
    IF v_job_exists THEN
      EXECUTE 'SELECT cron.unschedule(''hive-dispatch-due-work'')';
    END IF;
  END IF;
END;
$$;

COMMIT;
