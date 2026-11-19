-- FL-8h: read-only verification for hive_message_channels migration (SQL editor safe, SELECTs only).

SELECT c.column_name, c.data_type, c.is_nullable, c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'hive'
  AND c.table_name = 'hive_messages'
  AND c.column_name IN ('channel', 'thread_owner_user_id', 'handoff_from_message_id')
ORDER BY c.ordinal_position;

SELECT tc.constraint_name, tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'hive'
  AND tc.table_name = 'hive_messages'
  AND tc.constraint_name IN ('ck_hive_messages__channel', 'ck_hive_messages__assistant_thread');

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'hive'
  AND tablename = 'hive_messages'
  AND indexname = 'idx_hive_messages__hive_channel_thread_created';

SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef
FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE (n.nspname = 'public' AND p.proname IN (
        'post_hive_message', 'list_hive_messages', 'hive_unread_message_count', 'finish_assistant_run'))
   OR (n.nspname = 'hive' AND p.proname IN (
        'is_active_hive_client', 'can_read_assistant_thread', 'hive_message_json'))
ORDER BY n.nspname, p.proname;

SELECT
  has_function_privilege('anon', 'public.post_hive_message(uuid, text, uuid, uuid)', 'EXECUTE') AS old_post_exists,
  has_function_privilege('authenticated', 'public.post_hive_message(uuid, text, uuid, uuid, text, uuid)', 'EXECUTE') AS new_post,
  has_function_privilege('anon', 'public.list_hive_messages(uuid, timestamptz, uuid, integer)', 'EXECUTE') AS old_list_exists,
  has_function_privilege('authenticated', 'public.list_hive_messages(uuid, text, uuid, timestamptz, uuid, integer)', 'EXECUTE') AS new_list;