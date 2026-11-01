-- V4-003 — Reuse V3 Vault uploader (`hive.cases`, `hive.source_documents`,
-- `hive.upload_operations`, `hive.audit_events`, `hive.storage_orphans`,
-- `hive.apply_vault_transaction`, private bucket `hive-source-documents`)
-- alongside V4 `hive.hives` and `hive.intent_requests`.
--
-- Authority: HiveForYou-DATA-MODEL.md, HiveForYou-NAMING-CONVENTIONS.md,
-- HiveForYou-SECURITY-AND-PRIVACY.md, HiveForYou-DECISIONS.md (D-012, D-026, D-027).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Ensure hive.hives exposes (id, owner_user_id) for 1:1 Hive -> Case FK
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_hives__id_owner'
      AND conrelid = 'hive.hives'::regclass
  ) THEN
    ALTER TABLE hive.hives
      ADD CONSTRAINT uq_hives__id_owner UNIQUE (id, owner_user_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. hive.intent_requests — what the owner wants to understand (write-once, D-026)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.intent_requests (
  id uuid DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL,
  owner_user_id uuid NOT NULL DEFAULT auth.uid(),
  intent_text text NOT NULL,
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_intent_requests PRIMARY KEY (id),
  CONSTRAINT fk_intent_requests__hives FOREIGN KEY (hive_id) REFERENCES hive.hives (id) ON DELETE CASCADE,
  CONSTRAINT fk_intent_requests__users FOREIGN KEY (owner_user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT uq_intent_requests__owner_client_request UNIQUE (owner_user_id, client_request_id),
  CONSTRAINT ck_intent_requests__text_length CHECK (
    intent_text = btrim(intent_text) AND char_length(intent_text) BETWEEN 1 AND 2000
  )
);

COMMENT ON TABLE hive.intent_requests IS 'Owner questions for a Hive; write-once; input to later intent analysis.';

CREATE INDEX IF NOT EXISTS idx_intent_requests__hive_created_at
  ON hive.intent_requests (hive_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. V3 Vault tables (reused from @hives/persistence 003_hive_tables.sql)
--    1:1 Hive-to-Case relationship: hive.cases.id === hive.hives.id
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hive.cases (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  tenant_id UUID,
  title TEXT NOT NULL,
  domain TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT cases_id_owner_user_id_key UNIQUE (id, owner_user_id),
  CONSTRAINT fk_cases__hive_owner
    FOREIGN KEY (id, owner_user_id) REFERENCES hive.hives (id, owner_user_id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION hive.sync_case_from_hive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, pg_temp
AS $$
BEGIN
  INSERT INTO hive.cases (id, owner_user_id, title, status, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.owner_user_id,
    NEW.name,
    CASE WHEN NEW.archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END,
    NEW.created_at,
    NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET title = EXCLUDED.title,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hives__sync_case ON hive.hives;
CREATE TRIGGER trg_hives__sync_case
  AFTER INSERT OR UPDATE OF name, archived_at ON hive.hives
  FOR EACH ROW
  EXECUTE FUNCTION hive.sync_case_from_hive();

CREATE TABLE IF NOT EXISTS hive.source_documents (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL CHECK (char_length(sha256) = 64),
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  page_count INTEGER CHECK (page_count IS NULL OR page_count >= 0),
  upload_status TEXT NOT NULL CHECK (upload_status IN ('UPLOADED')),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('ACTIVE', 'DELETE_REQUESTED', 'SOFT_DELETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT source_documents_storage_location_key UNIQUE (storage_bucket, storage_path),
  CONSTRAINT source_documents_id_case_id_key UNIQUE (id, case_id),
  CONSTRAINT source_documents_case_owner_fk
    FOREIGN KEY (case_id, owner_user_id) REFERENCES hive.cases (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT source_documents_lifecycle_deleted_at_chk CHECK (
    (lifecycle_status = 'ACTIVE' AND deleted_at IS NULL)
    OR (lifecycle_status IN ('DELETE_REQUESTED', 'SOFT_DELETED') AND deleted_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS hive.upload_operations (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  source_document_id UUID NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL CHECK (char_length(sha256) = 64),
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'STORED', 'REGISTERED', 'FAILED')),
  error_code TEXT,
  error_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT upload_operations_storage_location_key UNIQUE (storage_bucket, storage_path),
  CONSTRAINT upload_operations_source_document_id_key UNIQUE (source_document_id),
  CONSTRAINT upload_operations_id_case_id_key UNIQUE (id, case_id),
  CONSTRAINT upload_operations_case_owner_fk
    FOREIGN KEY (case_id, owner_user_id) REFERENCES hive.cases (id, owner_user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hive.audit_events (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  case_id UUID REFERENCES hive.cases (id) ON DELETE CASCADE,
  source_document_id UUID,
  intake_run_id UUID,
  event_type TEXT NOT NULL,
  actor_user_id UUID,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM', 'SERVICE')),
  correlation_id UUID,
  safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_references_require_case_chk
    CHECK (
      (source_document_id IS NULL OR case_id IS NOT NULL)
      AND (intake_run_id IS NULL OR case_id IS NOT NULL)
    ),
  CONSTRAINT audit_events_source_document_case_fk
    FOREIGN KEY (source_document_id, case_id) REFERENCES hive.source_documents (id, case_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hive.storage_orphans (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  case_id UUID NOT NULL,
  source_document_id UUID NOT NULL,
  upload_operation_id UUID,
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_at TIMESTAMPTZ,
  CONSTRAINT storage_orphans_case_owner_fk
    FOREIGN KEY (case_id, owner_user_id) REFERENCES hive.cases (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT storage_orphans_upload_operation_case_fk
    FOREIGN KEY (upload_operation_id, case_id) REFERENCES hive.upload_operations (id, case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS source_documents_case_id_idx ON hive.source_documents (case_id);
CREATE INDEX IF NOT EXISTS source_documents_owner_user_id_idx ON hive.source_documents (owner_user_id);
CREATE INDEX IF NOT EXISTS source_documents_sha256_idx ON hive.source_documents (sha256);
CREATE INDEX IF NOT EXISTS source_documents_lifecycle_status_idx ON hive.source_documents (lifecycle_status);
CREATE INDEX IF NOT EXISTS upload_operations_case_id_idx ON hive.upload_operations (case_id);
CREATE INDEX IF NOT EXISTS upload_operations_status_idx ON hive.upload_operations (status);
CREATE INDEX IF NOT EXISTS audit_events_owner_user_id_idx ON hive.audit_events (owner_user_id);
CREATE INDEX IF NOT EXISTS audit_events_case_id_idx ON hive.audit_events (case_id);

-- ---------------------------------------------------------------------------
-- 4. V3 Vault triggers & immutability guards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cases_touch_updated_at ON hive.cases;
CREATE TRIGGER cases_touch_updated_at
  BEFORE UPDATE ON hive.cases
  FOR EACH ROW
  EXECUTE FUNCTION hive.touch_updated_at();

DROP TRIGGER IF EXISTS upload_operations_touch_updated_at ON hive.upload_operations;
CREATE TRIGGER upload_operations_touch_updated_at
  BEFORE UPDATE ON hive.upload_operations
  FOR EACH ROW
  EXECUTE FUNCTION hive.touch_updated_at();

CREATE OR REPLACE FUNCTION hive.prevent_source_document_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.case_id IS DISTINCT FROM OLD.case_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
    OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
    OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
    OR NEW.sha256 IS DISTINCT FROM OLD.sha256
    OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket
    OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
  THEN
    RAISE EXCEPTION 'hive.source_documents identity columns are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_documents_immutable_identity ON hive.source_documents;
CREATE TRIGGER source_documents_immutable_identity
  BEFORE UPDATE ON hive.source_documents
  FOR EACH ROW
  EXECUTE FUNCTION hive.prevent_source_document_identity_mutation();

CREATE OR REPLACE FUNCTION hive.enforce_source_document_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF OLD.lifecycle_status IS NOT DISTINCT FROM NEW.lifecycle_status THEN
    RETURN NEW;
  END IF;
  IF OLD.lifecycle_status = 'ACTIVE' AND NEW.lifecycle_status = 'DELETE_REQUESTED' THEN
    RETURN NEW;
  END IF;
  IF OLD.lifecycle_status = 'DELETE_REQUESTED' AND NEW.lifecycle_status = 'SOFT_DELETED' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'illegal hive.source_documents lifecycle transition: % -> %', OLD.lifecycle_status, NEW.lifecycle_status;
END;
$$;

DROP TRIGGER IF EXISTS source_documents_lifecycle_guard ON hive.source_documents;
CREATE TRIGGER source_documents_lifecycle_guard
  BEFORE UPDATE ON hive.source_documents
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_source_document_lifecycle();

CREATE OR REPLACE FUNCTION hive.enforce_upload_operation_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'PENDING' AND NEW.status IN ('STORED', 'FAILED') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'STORED' AND NEW.status IN ('REGISTERED', 'FAILED') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'illegal hive.upload_operations status transition: % -> %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS upload_operations_status_guard ON hive.upload_operations;
CREATE TRIGGER upload_operations_status_guard
  BEFORE UPDATE ON hive.upload_operations
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_upload_operation_status();

CREATE OR REPLACE FUNCTION hive.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'hive.audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only_update ON hive.audit_events;
CREATE TRIGGER audit_events_append_only_update
  BEFORE UPDATE ON hive.audit_events
  FOR EACH ROW
  EXECUTE FUNCTION hive.prevent_audit_event_mutation();

DROP TRIGGER IF EXISTS audit_events_append_only_delete ON hive.audit_events;
CREATE TRIGGER audit_events_append_only_delete
  BEFORE DELETE ON hive.audit_events
  FOR EACH ROW
  EXECUTE FUNCTION hive.prevent_audit_event_mutation();

CREATE OR REPLACE FUNCTION hive.enforce_audit_case_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
DECLARE
  case_owner UUID;
BEGIN
  IF NEW.case_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT owner_user_id INTO case_owner FROM hive.cases WHERE id = NEW.case_id;
  IF case_owner IS DISTINCT FROM NEW.owner_user_id THEN
    RAISE EXCEPTION 'hive.audit_events.owner_user_id must match parent case owner';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_events_case_owner ON hive.audit_events;
CREATE TRIGGER audit_events_case_owner
  BEFORE INSERT ON hive.audit_events
  FOR EACH ROW
  EXECUTE FUNCTION hive.enforce_audit_case_owner();

-- ---------------------------------------------------------------------------
-- 5. V3 transactional RPC hive.apply_vault_transaction (reused from 007)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.jsonb_text_or_null(value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = hive, pg_temp
AS $$
  SELECT CASE
    WHEN value IS NULL OR value = 'null'::jsonb THEN NULL
    ELSE value #>> '{}'
  END;
$$;

CREATE OR REPLACE FUNCTION hive.apply_vault_transaction(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, pg_temp
AS $$
DECLARE
  op jsonb;
  op_type text;
  row_data jsonb;
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'apply_vault_transaction payload must be an object';
  END IF;

  FOR op IN SELECT jsonb_array_elements(COALESCE(payload->'operations', '[]'::jsonb))
  LOOP
    op_type := op->>'op';
    row_data := COALESCE(op->'row', '{}'::jsonb);
    CASE op_type
      WHEN 'insert_case' THEN
        INSERT INTO hive.cases (
          id, owner_user_id, tenant_id, title, domain, status, created_at, updated_at, deleted_at
        ) VALUES (
          (row_data->>'id')::uuid,
          (row_data->>'owner_user_id')::uuid,
          hive.jsonb_text_or_null(row_data->'tenant_id')::uuid,
          row_data->>'title',
          hive.jsonb_text_or_null(row_data->'domain'),
          row_data->>'status',
          (row_data->>'created_at')::timestamptz,
          (row_data->>'updated_at')::timestamptz,
          hive.jsonb_text_or_null(row_data->'deleted_at')::timestamptz
        )
        ON CONFLICT (id) DO NOTHING;
      WHEN 'insert_source_document' THEN
        INSERT INTO hive.source_documents (
          id, case_id, owner_user_id, original_filename, mime_type, byte_size, sha256,
          storage_bucket, storage_path, page_count, upload_status, lifecycle_status,
          created_at, deleted_at
        ) VALUES (
          (row_data->>'id')::uuid,
          (row_data->>'case_id')::uuid,
          (row_data->>'owner_user_id')::uuid,
          row_data->>'original_filename',
          row_data->>'mime_type',
          (row_data->>'byte_size')::integer,
          row_data->>'sha256',
          row_data->>'storage_bucket',
          row_data->>'storage_path',
          hive.jsonb_text_or_null(row_data->'page_count')::integer,
          row_data->>'upload_status',
          row_data->>'lifecycle_status',
          (row_data->>'created_at')::timestamptz,
          hive.jsonb_text_or_null(row_data->'deleted_at')::timestamptz
        );
      WHEN 'append_audit' THEN
        INSERT INTO hive.audit_events (
          id, owner_user_id, case_id, source_document_id, intake_run_id, event_type,
          actor_user_id, actor_type, correlation_id, safe_metadata, created_at
        ) VALUES (
          (row_data->>'id')::uuid,
          (row_data->>'owner_user_id')::uuid,
          hive.jsonb_text_or_null(row_data->'case_id')::uuid,
          hive.jsonb_text_or_null(row_data->'source_document_id')::uuid,
          hive.jsonb_text_or_null(row_data->'intake_run_id')::uuid,
          row_data->>'event_type',
          hive.jsonb_text_or_null(row_data->'actor_user_id')::uuid,
          row_data->>'actor_type',
          hive.jsonb_text_or_null(row_data->'correlation_id')::uuid,
          COALESCE(row_data->'safe_metadata', '{}'::jsonb),
          (row_data->>'created_at')::timestamptz
        );
      WHEN 'mark_upload_registered' THEN
        UPDATE hive.upload_operations
        SET
          status = 'REGISTERED',
          updated_at = (row_data->>'updated_at')::timestamptz
        WHERE id = (row_data->>'id')::uuid;
      ELSE
        RAISE EXCEPTION 'unsupported vault operation: %', op_type;
    END CASE;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Row-Level Security (ENABLE + FORCE) & least-privilege grants
-- ---------------------------------------------------------------------------
ALTER TABLE hive.intent_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.intent_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.cases FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.source_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.upload_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.upload_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.storage_orphans ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.storage_orphans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_intent_requests__select__owner ON hive.intent_requests;
DROP POLICY IF EXISTS pol_intent_requests__insert__owner ON hive.intent_requests;
DROP POLICY IF EXISTS hive_cases_select_own ON hive.cases;
DROP POLICY IF EXISTS hive_source_documents_select_own ON hive.source_documents;
DROP POLICY IF EXISTS hive_upload_operations_select_own ON hive.upload_operations;
DROP POLICY IF EXISTS hive_audit_events_select_own ON hive.audit_events;

CREATE POLICY pol_intent_requests__select__owner
  ON hive.intent_requests
  FOR SELECT
  TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY pol_intent_requests__insert__owner
  ON hive.intent_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = hive_id AND h.owner_user_id = auth.uid() AND h.archived_at IS NULL
    )
  );

CREATE POLICY hive_cases_select_own
  ON hive.cases
  FOR SELECT
  TO authenticated
  USING (owner_user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY hive_source_documents_select_own
  ON hive.source_documents
  FOR SELECT
  TO authenticated
  USING (
    source_documents.deleted_at IS NULL
    AND source_documents.lifecycle_status <> 'SOFT_DELETED'
    AND EXISTS (
      SELECT 1 FROM hive.cases c
      WHERE c.id = source_documents.case_id
        AND c.owner_user_id = auth.uid()
        AND c.owner_user_id = source_documents.owner_user_id
        AND c.deleted_at IS NULL
    )
  );

CREATE POLICY hive_upload_operations_select_own
  ON hive.upload_operations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hive.cases c
      WHERE c.id = upload_operations.case_id
        AND c.owner_user_id = auth.uid()
        AND c.deleted_at IS NULL
    )
  );

CREATE POLICY hive_audit_events_select_own
  ON hive.audit_events
  FOR SELECT
  TO authenticated
  USING (owner_user_id = auth.uid());

REVOKE ALL ON hive.intent_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hive.cases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hive.source_documents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hive.upload_operations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hive.audit_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hive.storage_orphans FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON hive.intent_requests TO authenticated;
GRANT SELECT ON hive.cases TO authenticated;
GRANT SELECT ON hive.source_documents TO authenticated;
GRANT SELECT ON hive.upload_operations TO authenticated;
GRANT SELECT ON hive.audit_events TO authenticated;

GRANT USAGE ON SCHEMA hive TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA hive TO service_role;

REVOKE ALL ON FUNCTION hive.apply_vault_transaction(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hive.apply_vault_transaction(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Private bucket `hive-source-documents` (reused from V3 @hives/persistence)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hive-source-documents',
  'hive-source-documents',
  false,
  26214400,
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 8. User-scoped SECURITY INVOKER RPCs for intent capture & monthly quota
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.upload_quota_json(p_owner_user_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = hive, pg_temp
AS $$
DECLARE
  v_limit constant integer := 10;
  v_period_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_period_end timestamptz := (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';
  v_used integer;
BEGIN
  SELECT count(*)::integer
    INTO v_used
    FROM hive.source_documents d
   WHERE d.owner_user_id = p_owner_user_id
     AND d.upload_status = 'UPLOADED'
     AND d.lifecycle_status = 'ACTIVE'
     AND d.deleted_at IS NULL
     AND d.created_at >= v_period_start
     AND d.created_at < v_period_end;

  RETURN json_build_object(
    'limit', v_limit,
    'used', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'periodStart', v_period_start,
    'periodEnd', v_period_end
  );
END;
$$;

REVOKE ALL ON FUNCTION hive.upload_quota_json(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hive.upload_quota_json(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_intent_request(
  p_hive_id uuid,
  p_intent_text text,
  p_client_request_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_text text := btrim(coalesce(p_intent_text, ''));
  v_row hive.intent_requests%ROWTYPE;
  v_created boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:id_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_text) < 1 OR char_length(v_text) > 2000 THEN
    RAISE EXCEPTION 'invalid_request:intent_length' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hive.hives h
     WHERE h.id = p_hive_id AND h.owner_user_id = v_uid AND h.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO hive.intent_requests (hive_id, owner_user_id, intent_text, client_request_id)
  VALUES (p_hive_id, v_uid, v_text, p_client_request_id)
  ON CONFLICT ON CONSTRAINT uq_intent_requests__owner_client_request DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_created := true;
  ELSE
    SELECT * INTO v_row
      FROM hive.intent_requests r
     WHERE r.owner_user_id = v_uid AND r.client_request_id = p_client_request_id;
    IF v_row.hive_id IS DISTINCT FROM p_hive_id OR v_row.intent_text IS DISTINCT FROM v_text THEN
      RAISE EXCEPTION 'idempotency_conflict'
        USING ERRCODE = '23505', CONSTRAINT = 'uq_intent_requests__owner_client_request';
    END IF;
  END IF;

  RETURN json_build_object(
    'intentRequest', json_build_object(
      'id', v_row.id,
      'intentRequestId', v_row.id,
      'hiveId', v_row.hive_id,
      'clientRequestId', v_row.client_request_id,
      'createdAt', v_row.created_at
    ),
    'created', v_created
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_upload_quota()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  RETURN hive.upload_quota_json(v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.create_intent_request(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_upload_quota() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_intent_request(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_upload_quota() TO authenticated;

COMMIT;
