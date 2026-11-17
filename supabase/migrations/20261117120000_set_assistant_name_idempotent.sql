-- FL-3d / FL-4b: skip duplicate assistant rename audit rows when the name is unchanged.

CREATE OR REPLACE FUNCTION public.set_assistant_name(p_assistant_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_firm_id uuid := hive.caller_active_firm_id();
  v_name text := nullif(btrim(coalesce(p_assistant_name, '')), '');
  v_owner uuid;
  v_prev text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF v_firm_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT f.owner_user_id, f.assistant_name INTO v_owner, v_prev
    FROM hive.firms f WHERE f.id = v_firm_id;
  IF v_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NOT NULL AND char_length(v_name) > 40 THEN
    RAISE EXCEPTION 'invalid_request:assistant_name_too_long' USING ERRCODE = '22023';
  END IF;

  IF v_prev IS NOT DISTINCT FROM v_name THEN
    RETURN;
  END IF;

  UPDATE hive.firms SET assistant_name = v_name, updated_at = now() WHERE id = v_firm_id;

  PERFORM hive.write_firm_audit(
    v_owner, NULL, 'firm_assistant_name_set',
    jsonb_build_object('firmId', v_firm_id, 'previousAssistantName', v_prev, 'assistantName', v_name)
  );
END;
$$;