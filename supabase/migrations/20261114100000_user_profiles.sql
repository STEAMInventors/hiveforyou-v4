-- FL-1: per-user starting view (own paperwork vs client hives); owner read via RLS, writes via RPC only.
CREATE TABLE hive.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  starting_view text NOT NULL CHECK (starting_view IN ('own', 'clients')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hive.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_profiles_select_own ON hive.user_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'userId', p.user_id,
    'startingView', p.starting_view,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at
  )
    INTO v_row
    FROM hive.user_profiles p
   WHERE p.user_id = v_uid;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_starting_view(p_view text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_view text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  v_view := lower(trim(coalesce(p_view, '')));
  IF v_view NOT IN ('own', 'clients') THEN
    RAISE EXCEPTION 'invalid_request:starting_view' USING ERRCODE = '22023';
  END IF;

  INSERT INTO hive.user_profiles (user_id, starting_view, created_at, updated_at)
  VALUES (v_uid, v_view, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET starting_view = EXCLUDED.starting_view,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_starting_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_starting_view(text) TO authenticated;