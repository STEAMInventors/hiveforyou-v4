-- FL-4b-2b: idempotent team note inserts via client_request_id (Idempotency-Key).

ALTER TABLE hive.team_notes
  ADD COLUMN IF NOT EXISTS client_request_id uuid NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_team_notes__hive_client_request
  ON hive.team_notes (hive_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.add_team_note(
  p_hive_id uuid,
  p_body text,
  p_item_ref text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_item_ref text := nullif(btrim(coalesce(p_item_ref, '')), '');
  v_owner uuid;
  v_row hive.team_notes%ROWTYPE;
  v_existing hive.team_notes%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT hive.is_firm_staff(p_hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'invalid_request:body' USING ERRCODE = '22023';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM hive.team_notes n
     WHERE n.hive_id = p_hive_id AND n.client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN json_build_object(
        'teamNoteId', v_existing.id,
        'hiveId', v_existing.hive_id,
        'authorUserId', v_existing.author_user_id,
        'body', v_existing.body,
        'itemRef', v_existing.item_ref,
        'createdAt', v_existing.created_at,
        'deduplicated', true
      );
    END IF;
  END IF;

  SELECT h.owner_user_id INTO v_owner FROM hive.hives h WHERE h.id = p_hive_id;

  BEGIN
    INSERT INTO hive.team_notes (hive_id, author_user_id, body, item_ref, client_request_id)
    VALUES (p_hive_id, v_uid, v_body, v_item_ref, p_client_request_id)
    RETURNING * INTO v_row;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_existing
        FROM hive.team_notes n
       WHERE n.hive_id = p_hive_id AND n.client_request_id = p_client_request_id;
      IF NOT FOUND THEN
        RAISE;
      END IF;
      RETURN json_build_object(
        'teamNoteId', v_existing.id,
        'hiveId', v_existing.hive_id,
        'authorUserId', v_existing.author_user_id,
        'body', v_existing.body,
        'itemRef', v_existing.item_ref,
        'createdAt', v_existing.created_at,
        'deduplicated', true
      );
  END;

  PERFORM hive.write_firm_audit(
    v_owner, p_hive_id, 'team_note_added',
    jsonb_build_object('teamNoteId', v_row.id, 'itemRef', v_item_ref)
  );

  RETURN json_build_object(
    'teamNoteId', v_row.id,
    'hiveId', v_row.hive_id,
    'authorUserId', v_row.author_user_id,
    'body', v_row.body,
    'itemRef', v_row.item_ref,
    'createdAt', v_row.created_at,
    'deduplicated', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.add_team_note(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_team_note(uuid, text, text, uuid) TO authenticated;