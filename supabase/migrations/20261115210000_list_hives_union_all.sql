-- FL-11 hotfix: list_hives combined rows with UNION, which needs an equality operator for json
-- ("could not identify an equality operator for type json"). The two branches never overlap
-- (the second excludes hives where the caller is a member), so UNION ALL is correct.

CREATE OR REPLACE FUNCTION public.list_hives()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result json;
  v_firm_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  v_firm_id := hive.caller_active_firm_id();

  SELECT coalesce(json_agg(row ORDER BY row ->> 'sortKey' DESC), '[]'::json)
    INTO v_result
    FROM (
      SELECT json_build_object(
        'id', h.id,
        'hiveId', h.id,
        'name', h.name,
        'description', h.description,
        'kind', h.kind,
        'clientRequestId', h.client_request_id,
        'createdAt', h.created_at,
        'updatedAt', h.updated_at,
        'deletingAt', h.deleting_at,
        'membershipRole', m.role,
        'isOwner', m.role = 'owner',
        'memberState', m.state,
        'ownerDisplayName', op.display_name,
        'firmId', h.firm_id,
        'assigneeUserId', h.assignee_user_id,
        'stage', h.stage,
        'assigneeDisplayName', ap.display_name,
        'clientShareStatus', CASE WHEN m.role <> 'owner' OR h.kind <> 'client' THEN NULL
          WHEN EXISTS (SELECT 1 FROM hive.hive_members cm WHERE cm.hive_id = h.id AND cm.role = 'client' AND cm.state = 'active') THEN 'client_joined'
          WHEN EXISTS (SELECT 1 FROM hive.hive_invitations i WHERE i.hive_id = h.id AND i.role = 'client' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN 'invited'
          ELSE NULL END,
        'homeKicker', CASE
          WHEN m.role = 'client' AND m.state = 'active' THEN 'Your hive with ' || coalesce(op.display_name, 'the owner')
          WHEN m.role = 'professional' AND m.state = 'pending' THEN 'invited'
          WHEN m.role = 'owner' AND h.kind = 'client' THEN coalesce(h.description, h.name) || coalesce(
            CASE WHEN EXISTS (SELECT 1 FROM hive.hive_members cm WHERE cm.hive_id = h.id AND cm.role = 'client' AND cm.state = 'active') THEN ' · client joined'
                 WHEN EXISTS (SELECT 1 FROM hive.hive_invitations i WHERE i.hive_id = h.id AND i.role = 'client' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN ' · invited'
            END, '')
          ELSE NULL END
          || CASE WHEN h.firm_id IS NOT NULL AND m.state IN ('active', 'pending') THEN
            CASE WHEN h.stage = 'closed' THEN ' · closed'
                 WHEN h.assignee_user_id IS NULL THEN ' · unassigned'
                 WHEN h.assignee_user_id = v_uid THEN ' · you on it'
                 ELSE ' · ' || split_part(btrim(coalesce(nullif(ap.display_name, ''), 'someone')), ' ', 1) || ' on it'
            END
          ELSE '' END,
        'sortKey', (h.deleting_at IS NOT NULL)::text || h.created_at::text || h.id::text
      ) AS row
        FROM hive.hive_members m
        JOIN hive.hives h ON h.id = m.hive_id
        LEFT JOIN hive.user_profiles op ON op.user_id = h.owner_user_id
        LEFT JOIN hive.user_profiles ap ON ap.user_id = h.assignee_user_id
       WHERE m.user_id = v_uid AND m.state IN ('active', 'pending') AND h.archived_at IS NULL

      UNION ALL

      SELECT json_build_object(
        'id', h.id,
        'hiveId', h.id,
        'name', h.name,
        'description', h.description,
        'kind', h.kind,
        'clientRequestId', h.client_request_id,
        'createdAt', h.created_at,
        'updatedAt', h.updated_at,
        'deletingAt', h.deleting_at,
        'membershipRole', 'firm',
        'isOwner', false,
        'memberState', 'active',
        'ownerDisplayName', op.display_name,
        'firmId', h.firm_id,
        'assigneeUserId', h.assignee_user_id,
        'stage', h.stage,
        'assigneeDisplayName', ap.display_name,
        'clientShareStatus', CASE
          WHEN EXISTS (SELECT 1 FROM hive.hive_members cm WHERE cm.hive_id = h.id AND cm.role = 'client' AND cm.state = 'active') THEN 'client_joined'
          WHEN EXISTS (SELECT 1 FROM hive.hive_invitations i WHERE i.hive_id = h.id AND i.role = 'client' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN 'invited'
          ELSE NULL END,
        'homeKicker', coalesce(h.description, h.name)
          || CASE WHEN h.stage = 'closed' THEN ' · closed'
                  WHEN h.assignee_user_id IS NULL THEN ' · unassigned'
                  WHEN h.assignee_user_id = v_uid THEN ' · you on it'
                  ELSE ' · ' || split_part(btrim(coalesce(nullif(ap.display_name, ''), 'someone')), ' ', 1) || ' on it' END,
        'sortKey', (h.deleting_at IS NOT NULL)::text || h.created_at::text || h.id::text
      ) AS row
        FROM hive.hives h
        LEFT JOIN hive.user_profiles op ON op.user_id = h.owner_user_id
        LEFT JOIN hive.user_profiles ap ON ap.user_id = h.assignee_user_id
       WHERE v_firm_id IS NOT NULL
         AND h.firm_id = v_firm_id
         AND h.kind = 'client'
         AND h.archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM hive.hive_members m
            WHERE m.hive_id = h.id AND m.user_id = v_uid AND m.state IN ('active', 'pending')
         )
    ) combined;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.list_hives() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hives() TO authenticated;
