-- QF-1a-3: failure_diagnostic CHECK constraints call hive.is_valid_failure_diagnostic during
-- UPDATE even when the statement runs inside a SECURITY DEFINER RPC invoked as authenticated
-- (e.g. public.recover_expired_workflow_leases on study preparation / reports poll).
-- REVOKE in 20261102170000_failure_diagnostics.sql removed EXECUTE from authenticated; the
-- validator itself must run with definer rights so CHECK does not fail with permission denied.
BEGIN;

CREATE OR REPLACE FUNCTION hive.is_valid_failure_diagnostic(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = hive, pg_temp
AS $$
  SELECT p IS NOT NULL
     AND jsonb_typeof(p) = 'object'
     AND p ->> 'contractVersion' = 'failure-diagnostic@1'
     AND p ->> 'component' IN ('reader', 'planner', 'analysis', 'writer', 'scenario', 'a2ui')
     AND coalesce(p ->> 'operation', '') ~ '^[a-z][a-z0-9_]{0,63}$'
     AND (jsonb_typeof(p -> 'task') = 'null' OR coalesce(p ->> 'task', '') ~ '^[a-z][a-z0-9_]{0,63}$')
     AND coalesce(p ->> 'stage', '') ~ '^[A-Z][A-Z0-9_]{0,63}$'
     AND coalesce(p ->> 'errorCode', '') ~ '^[A-Z][A-Z0-9_]{0,63}$'
     AND coalesce(p ->> 'diagnosticReason', '') ~ '^[a-z][a-z0-9_]{0,63}$'
     AND (
       jsonb_typeof(p -> 'diagnosticField') = 'null'
       OR coalesce(p ->> 'diagnosticField', '') ~ '^[][A-Za-z0-9_.:/@+-]{1,128}$'
     )
     AND jsonb_typeof(p -> 'retryable') = 'boolean'
     AND coalesce(p ->> 'attempt', '') ~ '^[0-9]{1,4}$'
     AND (
       SELECT count(*)
         FROM jsonb_object_keys(p) AS key
        WHERE key IN (
          'contractVersion', 'component', 'operation', 'task', 'stage', 'errorCode',
          'diagnosticReason', 'diagnosticField', 'retryable', 'attempt'
        )
     ) = 10
     AND (SELECT count(*) FROM jsonb_object_keys(p)) = 10
     AND octet_length(p::text) <= 2048;
$$;

REVOKE ALL ON FUNCTION hive.is_valid_failure_diagnostic(jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;