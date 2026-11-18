-- FL-8a: read-only verification for the hive_conversation migration (SQL editor safe, SELECTs only).

-- Tables and columns.
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'hive'
  AND c.table_name IN ('hive_messages', 'hive_message_reads', 'hive_message_notices')
ORDER BY c.table_name, c.ordinal_position;

-- Constraints (checks, unique, primary and foreign keys).
SELECT tc.table_name, tc.constraint_name, tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'hive'
  AND tc.table_name IN ('hive_messages', 'hive_message_reads', 'hive_message_notices')
  AND tc.constraint_type IN ('CHECK', 'UNIQUE', 'PRIMARY KEY', 'FOREIGN KEY')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- RLS enabled and forced on every new table (expect true / true).
SELECT cl.relname, cl.relrowsecurity, cl.relforcerowsecurity
FROM pg_class cl
  JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'hive'
  AND cl.relname IN ('hive_messages', 'hive_message_reads', 'hive_message_notices')
ORDER BY cl.relname;

-- No table grants to anon or authenticated (expect zero rows).
SELECT g.table_name, g.grantee, g.privilege_type
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'hive'
  AND g.table_name IN ('hive_messages', 'hive_message_reads', 'hive_message_notices')
  AND g.grantee IN ('anon', 'authenticated', 'PUBLIC');

-- No user triggers on the new tables (expect zero rows).
SELECT t.tgname, cl.relname
FROM pg_trigger t
  JOIN pg_class cl ON cl.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'hive'
  AND cl.relname IN ('hive_messages', 'hive_message_reads', 'hive_message_notices')
  AND NOT t.tgisinternal;

-- Functions, security definer and search_path.
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef, p.proconfig
FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE (n.nspname = 'public' AND p.proname IN (
        'post_hive_message', 'list_hive_messages', 'mark_hive_messages_read', 'hive_unread_message_count'))
   OR (n.nspname = 'hive' AND p.proname IN (
        'can_converse', 'hive_participant_ids', 'hive_participant_role', 'hive_message_json', 'hive_message_replay'))
ORDER BY n.nspname, p.proname;

-- Execute privileges: public RPCs authenticated only; hive helpers nobody (expect anon false everywhere).
SELECT
  has_function_privilege('anon', 'public.post_hive_message(uuid, text, uuid, uuid)', 'EXECUTE') AS anon_post,
  has_function_privilege('authenticated', 'public.post_hive_message(uuid, text, uuid, uuid)', 'EXECUTE') AS auth_post,
  has_function_privilege('anon', 'public.list_hive_messages(uuid, timestamptz, uuid, integer)', 'EXECUTE') AS anon_list,
  has_function_privilege('authenticated', 'public.list_hive_messages(uuid, timestamptz, uuid, integer)', 'EXECUTE') AS auth_list,
  has_function_privilege('anon', 'public.mark_hive_messages_read(uuid, timestamptz)', 'EXECUTE') AS anon_mark,
  has_function_privilege('authenticated', 'public.mark_hive_messages_read(uuid, timestamptz)', 'EXECUTE') AS auth_mark,
  has_function_privilege('anon', 'public.hive_unread_message_count(uuid)', 'EXECUTE') AS anon_unread,
  has_function_privilege('authenticated', 'public.hive_unread_message_count(uuid)', 'EXECUTE') AS auth_unread,
  has_function_privilege('anon', 'hive.can_converse(uuid)', 'EXECUTE') AS anon_can_converse,
  has_function_privilege('authenticated', 'hive.can_converse(uuid)', 'EXECUTE') AS auth_can_converse,
  has_function_privilege('authenticated', 'hive.hive_message_json(uuid, uuid)', 'EXECUTE') AS auth_message_json;
