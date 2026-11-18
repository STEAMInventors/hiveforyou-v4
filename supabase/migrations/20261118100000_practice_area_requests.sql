-- FL-0b: practice-area requests; create_firm accepts initial practice_areas.
BEGIN;

CREATE TABLE IF NOT EXISTS hive.practice_area_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES hive.firms (id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_practice_area_requests__body CHECK (body = btrim(body) AND char_length(body) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_practice_area_requests__firm ON hive.practice_area_requests (firm_id, created_at DESC);

ALTER TABLE hive.practice_area_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.practice_area_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON hive.practice_area_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_practice_area_request(p_body text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_firm_id uuid := hive.caller_active_firm_id();
  v_body text := btrim(coalesce(p_body, ''));
  v_row hive.practice_area_requests%ROWTYPE;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF v_firm_id IS NULL OR hive.firm_role(v_firm_id) IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'invalid_request:body' USING ERRCODE = '22023';
  END IF;

  SELECT f.owner_user_id INTO v_owner FROM hive.firms f WHERE f.id = v_firm_id;

  INSERT INTO hive.practice_area_requests (firm_id, requester_user_id, body)
  VALUES (v_firm_id, v_uid, v_body)
  RETURNING * INTO v_row;

  PERFORM hive.write_firm_audit(
    v_owner, NULL, 'practice_area_requested',
    jsonb_build_object('requestId', v_row.id, 'firmId', v_firm_id)
  );

  RETURN json_build_object('requestId', v_row.id, 'createdAt', v_row.created_at);
END;
$$;

DROP FUNCTION IF EXISTS public.create_firm(text, text);

CREATE OR REPLACE FUNCTION public.create_firm(
  p_name text,
  p_assistant_name text DEFAULT NULL,
  p_practice_areas text[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_asst text := nullif(btrim(coalesce(p_assistant_name, '')), '');
  v_areas text[] := coalesce(p_practice_areas, '{}'::text[]);
  v_area text;
  v_row hive.firms%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'invalid_request:name' USING ERRCODE = '22023';
  END IF;
  IF v_asst IS NOT NULL AND char_length(v_asst) > 40 THEN
    RAISE EXCEPTION 'invalid_request:assistant_name' USING ERRCODE = '22023';
  END IF;
  IF hive.caller_active_firm_id() IS NOT NULL THEN
    RAISE EXCEPTION 'firm_membership_exists' USING ERRCODE = '23505';
  END IF;
  IF coalesce(array_length(v_areas, 1), 0) > 20 THEN
    RAISE EXCEPTION 'invalid_request:practice_areas' USING ERRCODE = '22023';
  END IF;
  FOREACH v_area IN ARRAY v_areas LOOP
    v_area := btrim(coalesce(v_area, ''));
    IF char_length(v_area) < 1 OR char_length(v_area) > 80 THEN
      RAISE EXCEPTION 'invalid_request:practice_area_id' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO hive.firms (owner_user_id, name, assistant_name, practice_areas)
  VALUES (v_uid, v_name, v_asst, v_areas)
  RETURNING * INTO v_row;
  INSERT INTO hive.firm_members (firm_id, user_id, invited_email, role, title, state)
  SELECT v_row.id, v_uid, lower(u.email), 'owner', 'Attorney', 'active'
    FROM auth.users u WHERE u.id = v_uid;
  PERFORM hive.write_firm_audit(v_uid, NULL, 'firm_created', jsonb_build_object('firmId', v_row.id));
  RETURN json_build_object(
    'firmId', v_row.id,
    'name', v_row.name,
    'assistantName', coalesce(v_row.assistant_name, 'HiveForYou'),
    'practiceAreas', v_row.practice_areas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_practice_area_request(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_practice_area_request(text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_firm(text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_firm(text, text, text[]) TO authenticated;

COMMIT;