-- FL-5 hotfix: SECURITY INVOKER RPCs (get_hive, get_hive_by_client_request_id) read hive.hive_members.
-- RLS policy pol_hive_members__select still limits rows to hives the caller is an active member of.
GRANT SELECT ON hive.hive_members TO authenticated;
