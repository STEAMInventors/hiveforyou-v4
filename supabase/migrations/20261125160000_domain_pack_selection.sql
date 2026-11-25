-- Stage 5D.2 — Durable per-Hive Domain Pack selection.
-- One row names the pack a Rebuild Study may run. The only allowed edition is
-- iep-us-federal 0.4.0. The server compiles the shipped source and refuses the
-- row unless compiled_digest equals that compilation. This does not read or
-- write hive.hives.pack_id / pack_version, so legacy checklist selection is
-- unchanged.
--
-- Independent of 20261125140000_relationship_verification_append.sql.
-- Do not apply that relationship migration as part of this change.
-- Do not apply this file to a live database without explicit founder authorization.

BEGIN;

CREATE TABLE IF NOT EXISTS hive.domain_pack_selections (
  hive_id uuid NOT NULL,
  pack_id text NOT NULL,
  version text NOT NULL,
  compiled_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_domain_pack_selections PRIMARY KEY (hive_id),
  CONSTRAINT fk_domain_pack_selections__hives
    FOREIGN KEY (hive_id) REFERENCES hive.hives (id) ON DELETE CASCADE,
  CONSTRAINT ck_domain_pack_selections__edition CHECK (
    pack_id = 'iep-us-federal'
    AND version = '0.4.0'
    AND compiled_digest ~ '^[0-9a-f]{64}$'
  )
);

COMMENT ON TABLE hive.domain_pack_selections IS
  'Per-Hive Domain Pack selection for Rebuild Study. Restricted to iep-us-federal 0.4.0. The application pins the row to the compiled digest of the shipped source.';

ALTER TABLE hive.domain_pack_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.domain_pack_selections FORCE ROW LEVEL SECURITY;

REVOKE ALL ON hive.domain_pack_selections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hive.domain_pack_selections TO service_role;

CREATE OR REPLACE FUNCTION public.get_domain_pack_selection(p_hive_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT CASE
    WHEN s.hive_id IS NULL THEN NULL
    ELSE json_build_object(
      'packId', s.pack_id,
      'version', s.version,
      'compiledDigest', s.compiled_digest
    )
  END
    FROM (SELECT p_hive_id AS hive_id) requested
    LEFT JOIN hive.domain_pack_selections s ON s.hive_id = requested.hive_id;
$$;

COMMENT ON FUNCTION public.get_domain_pack_selection(uuid) IS
  'Service-role read of the Domain Pack selection for one Hive. Null when the Hive is unpinned.';

REVOKE ALL ON FUNCTION public.get_domain_pack_selection(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_domain_pack_selection(uuid) TO service_role;

COMMIT;
