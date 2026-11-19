-- FL-8b: read-only verification for hive_assistant migration (SQL editor safe, SELECTs only).

SELECT c.column_name, c.data_type, c.is_nullable, c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'hive'
  AND c.table_name = 'hives'
  AND c.column_name IN ('content_class', 'assistant_replies_on')
ORDER BY c.column_name;

SELECT c.column_name, c.data_type, c.is_nullable
FROM information_schema.columns c
WHERE c.table_schema = 'hive'
  AND c.table_name = 'assistant_runs'
ORDER BY c.ordinal_position;

SELECT tc.constraint_name, tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'hive'
  AND tc.table_name = 'assistant_runs'
ORDER BY tc.constraint_type, tc.constraint_name;

SELECT cl.relname, cl.relrowsecurity, cl.relforcerowsecurity
FROM pg_class cl
  JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'hive'
  AND cl.relname = 'assistant_runs';

SELECT g.grantee, g.privilege_type
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'hive'
  AND g.table_name = 'assistant_runs'
  AND g.grantee IN ('anon', 'authenticated', 'PUBLIC');

SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef
FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'set_hive_assistant_replies',
    'claim_assistant_run',
    'finish_assistant_run',
    'list_hive_messages'
  )
ORDER BY p.proname;

SELECT
  has_function_privilege('authenticated', 'public.set_hive_assistant_replies(uuid, boolean)', 'EXECUTE') AS auth_set_assistant,
  has_function_privilege('anon', 'public.set_hive_assistant_replies(uuid, boolean)', 'EXECUTE') AS anon_set_assistant,
  has_function_privilege('service_role', 'public.claim_assistant_run(uuid)', 'EXECUTE') AS svc_claim,
  has_function_privilege('authenticated', 'public.claim_assistant_run(uuid)', 'EXECUTE') AS auth_claim,
  has_function_privilege('service_role', 'public.finish_assistant_run(uuid, text, text, jsonb, uuid, text, text, integer, text)', 'EXECUTE') AS svc_finish,
  has_function_privilege('authenticated', 'public.finish_assistant_run(uuid, text, text, jsonb, uuid, text, text, integer, text)', 'EXECUTE') AS auth_finish;