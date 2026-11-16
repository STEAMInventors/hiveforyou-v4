-- QF-1a: shared pgTAP fixture helpers (loaded via \ir from each *.test.sql, or prepended in CI).
-- FL-5: direct hive.hives inserts must also create the owner hive_members row like public.create_hive.

CREATE OR REPLACE FUNCTION pg_temp.qf1a_seed_user(p_user_id uuid, p_email text)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (p_user_id, p_email, 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.qf1a_ensure_owner_memberships()
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by)
  SELECT h.id, h.owner_user_id, 'owner', 'active', h.owner_user_id
    FROM hive.hives h
   WHERE NOT EXISTS (
     SELECT 1
       FROM hive.hive_members m
      WHERE m.hive_id = h.id
        AND m.user_id = h.owner_user_id
        AND m.role = 'owner'
        AND m.state = 'active'
   );
$$;