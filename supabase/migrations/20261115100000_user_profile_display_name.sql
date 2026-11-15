-- FL-3c: optional display_name on user_profiles for greetings and account menu.
ALTER TABLE hive.user_profiles
  ADD COLUMN display_name text;

ALTER TABLE hive.user_profiles
  ADD CONSTRAINT user_profiles_display_name_length CHECK (
    display_name IS NULL
    OR (char_length(btrim(display_name)) >= 1 AND char_length(display_name) <= 60)
  );

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
    'displayName', p.display_name,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at
  )
    INTO v_row
    FROM hive.user_profiles p
   WHERE p.user_id = v_uid;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_display_name(p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'invalid_request:display_name_empty' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) > 60 THEN
    RAISE EXCEPTION 'invalid_request:display_name_length' USING ERRCODE = '22023';
  END IF;

  UPDATE hive.user_profiles
     SET display_name = btrim(v_name),
         updated_at = now()
   WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_request:profile_missing' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_display_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_display_name(text) TO authenticated;