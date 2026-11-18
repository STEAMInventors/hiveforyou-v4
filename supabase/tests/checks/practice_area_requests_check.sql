-- FL-0b-2: read-only verification for practice_area_requests migration (SQL editor safe).
SELECT
  c.column_name,
  c.is_nullable,
  c.data_type
FROM information_schema.columns c
WHERE c.table_schema = 'hive'
  AND c.table_name = 'practice_area_requests'
  AND c.column_name = 'idempotency_key';

SELECT
  tc.constraint_name,
  tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'hive'
  AND tc.table_name = 'practice_area_requests'
  AND tc.constraint_type = 'UNIQUE';

SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('submit_practice_area_request', 'create_firm');

SELECT
  has_function_privilege('anon', 'public.submit_practice_area_request(text, uuid)', 'EXECUTE') AS anon_submit,
  has_function_privilege('authenticated', 'public.submit_practice_area_request(text, uuid)', 'EXECUTE') AS auth_submit,
  has_function_privilege('anon', 'public.create_firm(text, text, text[])', 'EXECUTE') AS anon_create,
  has_function_privilege('authenticated', 'public.create_firm(text, text, text[])', 'EXECUTE') AS auth_create;

SELECT pol.policyname, pol.cmd, pol.roles
FROM pg_policies pol
WHERE pol.schemaname = 'hive'
  AND pol.tablename = 'practice_area_requests';