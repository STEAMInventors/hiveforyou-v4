-- Stage 5E.3 — Allow iep-us-federal 0.5.0 on hive.domain_pack_selections.
-- Forward only. Does not UPDATE or DELETE any existing selection.
-- 0.4.0 rows remain valid. No Hive is pinned by this file.
--
-- public.set_domain_pack_selection inserts 0.5.0 for one Hive. A different
-- existing selection is left unchanged. Replay of the same row returns it.
-- service_role only. Authenticated and anon cannot execute it.
--
-- Do not apply to a live database without explicit founder authorization.

BEGIN;

ALTER TABLE hive.domain_pack_selections
  DROP CONSTRAINT IF EXISTS ck_domain_pack_selections__edition;

ALTER TABLE hive.domain_pack_selections
  ADD CONSTRAINT ck_domain_pack_selections__edition CHECK (
    pack_id = 'iep-us-federal'
    AND version IN ('0.4.0', '0.5.0')
    AND compiled_digest ~ '^[0-9a-f]{64}$'
  );

COMMENT ON TABLE hive.domain_pack_selections IS
  'Per-Hive Domain Pack selection for Rebuild Study. Editions iep-us-federal 0.4.0 and 0.5.0. Existing rows are not rewritten. The application accepts only 0.5.0 when its compiled digest matches the shipped source.';

CREATE OR REPLACE FUNCTION public.set_domain_pack_selection(
  p_hive_id uuid,
  p_pack_id text,
  p_version text,
  p_compiled_digest text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_existing hive.domain_pack_selections%ROWTYPE;
BEGIN
  PERFORM hive.require_service_role();
  IF p_hive_id IS NULL
     OR p_pack_id IS DISTINCT FROM 'iep-us-federal'
     OR p_version IS DISTINCT FROM '0.5.0'
     OR p_compiled_digest IS NULL
     OR p_compiled_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
      AND h.archived_at IS NULL
      AND h.deleting_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
    FROM hive.domain_pack_selections
   WHERE hive_id = p_hive_id;
  IF FOUND THEN
    IF v_existing.pack_id = p_pack_id
       AND v_existing.version = p_version
       AND v_existing.compiled_digest = p_compiled_digest THEN
      RETURN json_build_object(
        'hiveId', v_existing.hive_id,
        'packId', v_existing.pack_id,
        'version', v_existing.version,
        'compiledDigest', v_existing.compiled_digest,
        'created', false
      );
    END IF;
    RAISE EXCEPTION 'selection_exists' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO hive.domain_pack_selections (hive_id, pack_id, version, compiled_digest)
  VALUES (p_hive_id, p_pack_id, p_version, p_compiled_digest)
  RETURNING * INTO v_existing;

  RETURN json_build_object(
    'hiveId', v_existing.hive_id,
    'packId', v_existing.pack_id,
    'version', v_existing.version,
    'compiledDigest', v_existing.compiled_digest,
    'created', true
  );
END;
$$;

COMMENT ON FUNCTION public.set_domain_pack_selection(uuid, text, text, text) IS
  'Service-role insert of iep-us-federal 0.5.0 for one Hive. Does not update a different existing selection and does not touch any other Hive.';

REVOKE ALL ON FUNCTION public.set_domain_pack_selection(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_domain_pack_selection(uuid, text, text, text) TO service_role;

COMMIT;
