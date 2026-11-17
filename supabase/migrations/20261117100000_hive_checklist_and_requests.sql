-- FL-6a-1: checklist requests, upload gate helpers, item-check storage.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Chosen pack on hive.hives
-- ---------------------------------------------------------------------------
ALTER TABLE hive.hives
  ADD COLUMN IF NOT EXISTS pack_id text,
  ADD COLUMN IF NOT EXISTS pack_version integer;

ALTER TABLE hive.hives DROP CONSTRAINT IF EXISTS ck_hives__pack_pair;
ALTER TABLE hive.hives
  ADD CONSTRAINT ck_hives__pack_pair CHECK (
    (pack_id IS NULL AND pack_version IS NULL)
    OR (pack_id IS NOT NULL AND pack_version IS NOT NULL AND btrim(pack_id) <> '')
  );

-- ---------------------------------------------------------------------------
-- 2. Upload gate + source_documents.uploader
-- ---------------------------------------------------------------------------
ALTER TABLE hive.source_documents
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION hive.can_upload_to_hive(p_hive_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hive.hives h
     WHERE h.id = p_hive_id
       AND h.archived_at IS NULL
       AND h.deleting_at IS NULL
       AND (
         hive.can_write_hive(p_hive_id)
         OR EXISTS (
           SELECT 1
             FROM hive.hive_members m
            WHERE m.hive_id = h.id
              AND m.user_id = auth.uid()
              AND m.state = 'active'
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_upload_context(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_can boolean := false;
  v_owner uuid;
  v_belongs boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;

  v_can := hive.can_upload_to_hive(p_hive_id);
  IF v_can THEN
    SELECT h.owner_user_id, (h.firm_id IS NOT NULL)
      INTO v_owner, v_belongs
      FROM hive.hives h
     WHERE h.id = p_hive_id;
  END IF;

  RETURN json_build_object(
    'canUpload', v_can,
    'ownerUserId', CASE WHEN v_can THEN v_owner ELSE NULL END,
    'belongsToFirm', CASE WHEN v_can THEN v_belongs ELSE false END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_upload_quota_for_hive(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT hive.can_upload_to_hive(p_hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT h.owner_user_id INTO v_owner
    FROM hive.hives h
   WHERE h.id = p_hive_id;

  RETURN hive.upload_quota_json(v_owner);
END;
$$;

-- apply_vault_transaction: accept uploaded_by_user_id on insert_source_document
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
  v_gap_id text;
  v_gap_revision uuid;
  v_gap_title text;
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
      WHEN 'insert_upload_pending' THEN
        INSERT INTO hive.upload_operations (
          id, case_id, owner_user_id, source_document_id, original_filename, mime_type, byte_size,
          sha256, storage_bucket, storage_path, status, error_code, error_category,
          client_request_id, created_at, updated_at
        ) VALUES (
          (row_data->>'id')::uuid,
          (row_data->>'case_id')::uuid,
          (row_data->>'owner_user_id')::uuid,
          (row_data->>'source_document_id')::uuid,
          row_data->>'original_filename',
          row_data->>'mime_type',
          (row_data->>'byte_size')::integer,
          row_data->>'sha256',
          row_data->>'storage_bucket',
          row_data->>'storage_path',
          'PENDING',
          NULL,
          NULL,
          hive.jsonb_text_or_null(row_data->'client_request_id')::uuid,
          (row_data->>'created_at')::timestamptz,
          (row_data->>'updated_at')::timestamptz
        );
      WHEN 'insert_source_document' THEN
        v_gap_id := hive.jsonb_text_or_null(row_data->'canonical_gap_id');
        IF v_gap_id IS NOT NULL AND v_gap_id !~ '^X[0-9]+$' THEN
          RAISE EXCEPTION 'invalid canonical_gap_id';
        END IF;
        v_gap_revision := NULL;
        v_gap_title := hive.jsonb_text_or_null(row_data->'canonical_gap_title');
        IF row_data ? 'canonical_gap_study_revision_id' AND row_data->'canonical_gap_study_revision_id' IS NOT NULL THEN
          v_gap_revision := (row_data->>'canonical_gap_study_revision_id')::uuid;
        END IF;
        IF v_gap_id IS NOT NULL AND (v_gap_revision IS NULL OR v_gap_title IS NULL OR btrim(v_gap_title) = '') THEN
          RAISE EXCEPTION 'invalid canonical_gap_link';
        END IF;
        INSERT INTO hive.source_documents (
          id, case_id, owner_user_id, uploaded_by_user_id, original_filename, mime_type, byte_size, sha256,
          storage_bucket, storage_path, page_count, upload_status, lifecycle_status,
          canonical_gap_id, canonical_gap_study_revision_id, canonical_gap_title,
          created_at, deleted_at
        ) VALUES (
          (row_data->>'id')::uuid,
          (row_data->>'case_id')::uuid,
          (row_data->>'owner_user_id')::uuid,
          hive.jsonb_text_or_null(row_data->'uploaded_by_user_id')::uuid,
          row_data->>'original_filename',
          row_data->>'mime_type',
          (row_data->>'byte_size')::integer,
          row_data->>'sha256',
          row_data->>'storage_bucket',
          row_data->>'storage_path',
          hive.jsonb_text_or_null(row_data->'page_count')::integer,
          row_data->>'upload_status',
          row_data->>'lifecycle_status',
          v_gap_id,
          v_gap_revision,
          v_gap_title,
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
      WHEN 'mark_upload_stored' THEN
        UPDATE hive.upload_operations
        SET status = 'STORED', updated_at = (row_data->>'updated_at')::timestamptz
        WHERE id = (row_data->>'id')::uuid;
      WHEN 'mark_upload_failed' THEN
        UPDATE hive.upload_operations
        SET
          status = 'FAILED',
          updated_at = (row_data->>'updated_at')::timestamptz,
          error_code = row_data->>'error_code',
          error_category = row_data->>'error_category'
        WHERE id = (row_data->>'id')::uuid;
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

CREATE OR REPLACE FUNCTION public.start_document_reads(
  p_hive_id uuid,
  p_request_id uuid,
  p_correlation_id uuid,
  p_source_document_ids uuid[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted integer := 0;
  v_queued json;
  v_can_write boolean;
  v_can_upload boolean;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  v_can_write := hive.can_write_hive(p_hive_id);
  v_can_upload := hive.can_upload_to_hive(p_hive_id);
  IF NOT v_can_write AND NOT v_can_upload THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT h.owner_user_id
    INTO v_owner
    FROM hive.hives h
   WHERE h.id = p_hive_id
     AND h.archived_at IS NULL
     AND h.deleting_at IS NULL
   FOR SHARE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_can_write AND p_source_document_ids IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT v_can_write AND p_source_document_ids IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
        FROM hive.source_documents d
       WHERE d.id = ANY (p_source_document_ids)
         AND (
           d.case_id IS DISTINCT FROM p_hive_id
           OR d.uploaded_by_user_id IS DISTINCT FROM v_uid
         )
    ) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM hive.expire_stale_document_reads(p_hive_id);

  IF NOT EXISTS (
    SELECT 1 FROM hive.document_reads r
     WHERE r.hive_id = p_hive_id AND r.request_id = p_request_id
  ) THEN
    INSERT INTO hive.document_reads (
      hive_id, owner_user_id, source_document_id, request_id, attempt_number,
      status, correlation_id, lease_expires_at
    )
    SELECT p_hive_id,
           v_owner,
           d.id,
           p_request_id,
           coalesce((SELECT max(r.attempt_number) FROM hive.document_reads r
                      WHERE r.source_document_id = d.id), 0) + 1,
           'QUEUED',
           p_correlation_id,
           now() + interval '330 seconds'
      FROM hive.source_documents d
     WHERE d.case_id = p_hive_id
       AND d.lifecycle_status = 'ACTIVE'
       AND d.deleted_at IS NULL
       AND d.upload_status = 'UPLOADED'
       AND d.read_status IN ('PENDING', 'FAILED')
       AND d.owner_user_id = v_owner
       AND (p_source_document_ids IS NULL OR d.id = ANY (p_source_document_ids))
       AND (
         v_can_write
         OR d.uploaded_by_user_id = v_uid
       )
       AND NOT EXISTS (
         SELECT 1 FROM hive.document_reads a
          WHERE a.source_document_id = d.id
            AND a.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')
       )
     ORDER BY d.created_at, d.id
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  SELECT coalesce(json_agg(r.id ORDER BY r.created_at, r.id), '[]'::json)
    INTO v_queued
    FROM hive.document_reads r
   WHERE r.hive_id = p_hive_id
     AND r.request_id = p_request_id
     AND r.status = 'QUEUED';

  RETURN json_build_object(
    'documentReads', hive.latest_document_reads_json(p_hive_id),
    'queuedReadIds', v_queued,
    'created', v_inserted
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Request tables
-- ---------------------------------------------------------------------------
CREATE TABLE hive.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hive_id uuid NOT NULL REFERENCES hive.hives (id) ON DELETE CASCADE,
  source text NOT NULL,
  pack_row_key text,
  title text NOT NULL,
  detail text,
  position integer NOT NULL,
  state text NOT NULL,
  state_note text,
  accepted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_requests__source CHECK (source IN ('pack', 'staff')),
  CONSTRAINT ck_requests__state CHECK (
    state IN (
      'WAITING', 'RECEIVED', 'READING', 'CHECKED', 'NEEDS_FIX',
      'DOESNT_MATCH', 'NEEDS_REVIEW', 'NOT_NEEDED'
    )
  )
);

CREATE UNIQUE INDEX uq_requests__hive_pack_row
  ON hive.requests (hive_id, pack_row_key)
  WHERE pack_row_key IS NOT NULL;

CREATE INDEX idx_requests__hive_position ON hive.requests (hive_id, position);

CREATE TABLE hive.request_documents (
  request_id uuid NOT NULL REFERENCES hive.requests (id) ON DELETE CASCADE,
  source_document_id uuid NOT NULL REFERENCES hive.source_documents (id) ON DELETE CASCADE,
  added_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_request_documents PRIMARY KEY (request_id, source_document_id)
);

CREATE TABLE hive.request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES hive.requests (id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  actor_kind text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_request_events__actor_kind CHECK (actor_kind IN ('person', 'system'))
);

CREATE INDEX idx_request_events__request ON hive.request_events (request_id, created_at);

CREATE TABLE hive.request_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES hive.requests (id) ON DELETE CASCADE,
  source_document_ids uuid[] NOT NULL,
  verdict text NOT NULL,
  sentence text NOT NULL,
  page_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text NOT NULL,
  prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_request_checks__verdict CHECK (verdict IN ('FITS', 'WRONG_DOCUMENT', 'WRONG_PERIOD', 'UNSURE'))
);

CREATE INDEX idx_request_checks__request_created ON hive.request_checks (request_id, created_at DESC);

ALTER TABLE hive.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.requests FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.request_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.request_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.request_events FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.request_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.request_checks FORCE ROW LEVEL SECURITY;

GRANT SELECT ON hive.requests TO authenticated;
GRANT SELECT ON hive.request_documents TO authenticated;
GRANT SELECT ON hive.request_events TO authenticated;
GRANT SELECT ON hive.request_checks TO authenticated;

CREATE POLICY requests_select_member ON hive.requests
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

CREATE POLICY request_documents_select_member ON hive.request_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hive.requests r
       WHERE r.id = request_id AND hive.is_hive_member(r.hive_id)
    )
  );

CREATE POLICY request_events_select_staff_owner ON hive.request_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hive.requests r
       WHERE r.id = request_id
         AND (hive.is_hive_owner(r.hive_id) OR hive.is_firm_staff(r.hive_id))
    )
  );

CREATE POLICY request_checks_select_member ON hive.request_checks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hive.requests r
       WHERE r.id = request_id AND hive.is_hive_member(r.hive_id)
    )
  );

CREATE OR REPLACE FUNCTION hive.normalize_pack_row_key(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT lower(regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION hive.append_request_event(
  p_request_id uuid,
  p_from_state text,
  p_to_state text,
  p_actor_user_id uuid,
  p_actor_kind text,
  p_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
BEGIN
  INSERT INTO hive.request_events (
    request_id, from_state, to_state, actor_user_id, actor_kind, note
  ) VALUES (
    p_request_id, p_from_state, p_to_state, p_actor_user_id, p_actor_kind, p_note
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_checklist(
  p_hive_id uuid,
  p_pack_id text,
  p_pack_version integer,
  p_items jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hive hive.hives%ROWTYPE;
  v_item jsonb;
  v_key text;
  v_title text;
  v_detail text;
  v_position integer;
  v_count integer;
  v_inserted integer := 0;
  v_row hive.requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT hive.can_write_hive(p_hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_pack_id IS NULL OR btrim(p_pack_id) = '' OR p_pack_version IS NULL OR p_pack_version < 1 THEN
    RAISE EXCEPTION 'invalid_request:pack' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'invalid_request:items' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_hive FROM hive.hives h WHERE h.id = p_hive_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_hive.pack_id IS NOT NULL AND (v_hive.pack_id IS DISTINCT FROM p_pack_id OR v_hive.pack_version IS DISTINCT FROM p_pack_version) THEN
    RAISE EXCEPTION 'pack_conflict' USING ERRCODE = '23505';
  END IF;

  IF v_hive.pack_id IS NULL THEN
    UPDATE hive.hives
    SET pack_id = p_pack_id, pack_version = p_pack_version, updated_at = now()
    WHERE id = p_hive_id;
  END IF;

  v_count := jsonb_array_length(p_items);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
  v_row := NULL;
  v_key := hive.normalize_pack_row_key(v_item->>'key');
  v_title := nullif(btrim(v_item->>'title'), '');
  v_detail := nullif(btrim(v_item->>'detail'), '');
  IF v_key IS NULL OR v_key = '' OR v_title IS NULL THEN
    RAISE EXCEPTION 'invalid_request:item_shape' USING ERRCODE = '22023';
  END IF;
  IF v_key IS DISTINCT FROM hive.normalize_pack_row_key(v_title) THEN
    RAISE EXCEPTION 'invalid_request:item_key' USING ERRCODE = '22023';
  END IF;
  IF (v_item->>'position')::integer IS NULL OR (v_item->>'position')::integer < 1 THEN
    RAISE EXCEPTION 'invalid_request:item_position' USING ERRCODE = '22023';
  END IF;
  v_position := (v_item->>'position')::integer;

  INSERT INTO hive.requests (
    hive_id, source, pack_row_key, title, detail, position, state, created_by
  ) VALUES (
    p_hive_id, 'pack', v_key, v_title, v_detail, v_position, 'WAITING', v_uid
  )
  ON CONFLICT (hive_id, pack_row_key) WHERE pack_row_key IS NOT NULL DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NOT NULL THEN
    v_inserted := v_inserted + 1;
    PERFORM hive.append_request_event(v_row.id, NULL, 'WAITING', v_uid, 'person', NULL);
  END IF;
  END LOOP;

  RETURN json_build_object('created', v_inserted, 'itemCount', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_requests(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_items json;
  v_counts json;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT hive.is_hive_member(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(json_agg(row_to_json(req_row) ORDER BY req_row.position, req_row.id), '[]'::json)
    INTO v_items
    FROM (
      SELECT
        r.id,
        r.hive_id AS "hiveId",
        r.source,
        r.pack_row_key AS "packRowKey",
        r.title,
        r.detail,
        r.position,
        r.state,
        r.state_note AS "stateNote",
        r.accepted_by AS "acceptedBy",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        coalesce(docs.documents, '[]'::json) AS documents,
        chk.latest AS "latestCheck"
        FROM hive.requests r
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object(
            'id', sd.id,
            'fileName', sd.original_filename,
            'pageCount', sd.page_count,
            'createdAt', sd.created_at,
            'uploadedByDisplayName', up.display_name
          ) ORDER BY rd.added_at, sd.id) AS documents
            FROM hive.request_documents rd
            JOIN hive.source_documents sd ON sd.id = rd.source_document_id
            LEFT JOIN hive.user_profiles up ON up.user_id = sd.uploaded_by_user_id
           WHERE rd.request_id = r.id
        ) docs ON true
        LEFT JOIN LATERAL (
          SELECT json_build_object(
            'verdict', c.verdict,
            'sentence', c.sentence,
            'pageRefs', c.page_refs
          ) AS latest
            FROM hive.request_checks c
           WHERE c.request_id = r.id
           ORDER BY c.created_at DESC, c.id DESC
           LIMIT 1
        ) chk ON true
       WHERE r.hive_id = p_hive_id
    ) req_row;

  SELECT coalesce(json_object_agg(state, cnt), '{}'::json)
    INTO v_counts
    FROM (
      SELECT r.state, count(*)::integer AS cnt
        FROM hive.requests r
       WHERE r.hive_id = p_hive_id
       GROUP BY r.state
    ) s;

  RETURN json_build_object('requests', v_items, 'countsByState', v_counts);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_request(
  p_hive_id uuid,
  p_title text,
  p_detail text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_title text := nullif(btrim(p_title), '');
  v_detail text := nullif(btrim(coalesce(p_detail, '')), '');
  v_row hive.requests%ROWTYPE;
  v_position integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT hive.can_write_hive(p_hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_title IS NULL OR char_length(v_title) > 500 THEN
    RAISE EXCEPTION 'invalid_request:title' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(r.position), 0) + 1 INTO v_position FROM hive.requests r WHERE r.hive_id = p_hive_id;

  INSERT INTO hive.requests (
    hive_id, source, pack_row_key, title, detail, position, state, created_by
  ) VALUES (
    p_hive_id, 'staff', NULL, v_title, v_detail, v_position, 'WAITING', v_uid
  )
  RETURNING * INTO v_row;

  PERFORM hive.append_request_event(v_row.id, NULL, 'WAITING', v_uid, 'person', NULL);

  RETURN json_build_object(
    'requestId', v_row.id,
    'hiveId', v_row.hive_id,
    'title', v_row.title,
    'state', v_row.state,
    'position', v_row.position
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_document_to_request(
  p_request_id uuid,
  p_source_document_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req hive.requests%ROWTYPE;
  v_doc hive.source_documents%ROWTYPE;
  v_prev_state text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM hive.requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT hive.can_upload_to_hive(v_req.hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc
    FROM hive.source_documents d
   WHERE d.id = p_source_document_id
     AND d.case_id = v_req.hive_id
     AND d.lifecycle_status = 'ACTIVE'
     AND d.deleted_at IS NULL
     AND d.upload_status = 'UPLOADED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.state = 'NOT_NEEDED' THEN
    RAISE EXCEPTION 'request_not_needed' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM hive.request_documents rd
     WHERE rd.request_id = p_request_id
       AND rd.source_document_id = p_source_document_id
  ) THEN
    RAISE EXCEPTION 'document_already_on_request' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM hive.request_documents rd
      JOIN hive.requests r ON r.id = rd.request_id
     WHERE rd.source_document_id = p_source_document_id
       AND r.hive_id = v_req.hive_id
       AND rd.request_id IS DISTINCT FROM p_request_id
  ) THEN
    RAISE EXCEPTION 'document_already_on_other_request' USING ERRCODE = '22023';
  END IF;

  INSERT INTO hive.request_documents (request_id, source_document_id, added_by)
  VALUES (p_request_id, p_source_document_id, v_uid);

  v_prev_state := v_req.state;
  IF v_prev_state IS DISTINCT FROM 'RECEIVED' THEN
    UPDATE hive.requests
    SET state = 'RECEIVED', state_note = NULL, updated_at = now()
    WHERE id = p_request_id;

    PERFORM hive.append_request_event(
      p_request_id, v_prev_state, 'RECEIVED', v_uid, 'person', NULL
    );
  END IF;

  RETURN json_build_object('requestId', p_request_id, 'state', 'RECEIVED');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_request_state(
  p_request_id uuid,
  p_to_state text,
  p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_req hive.requests%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  SELECT * INTO v_req FROM hive.requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.state = 'RECEIVED' AND p_to_state = 'READING' THEN
    NULL;
  ELSIF v_req.state = 'READING' AND p_to_state IN ('CHECKED', 'NEEDS_FIX', 'DOESNT_MATCH', 'NEEDS_REVIEW') THEN
    NULL;
  ELSIF v_req.state IN ('CHECKED', 'NEEDS_FIX', 'DOESNT_MATCH', 'NEEDS_REVIEW') AND p_to_state = 'RECEIVED' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023';
  END IF;

  UPDATE hive.requests
  SET state = p_to_state, state_note = v_note, updated_at = now()
  WHERE id = p_request_id;

  PERFORM hive.append_request_event(
    p_request_id, v_req.state, p_to_state, NULL, 'system', v_note
  );

  RETURN json_build_object('requestId', p_request_id, 'state', p_to_state);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_request_check(
  p_request_id uuid,
  p_document_ids uuid[],
  p_verdict text,
  p_sentence text,
  p_page_refs jsonb,
  p_model text,
  p_prompt_version text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_row hive.request_checks%ROWTYPE;
  v_refs jsonb := coalesce(p_page_refs, '[]'::jsonb);
BEGIN
  IF p_verdict IN ('FITS', 'WRONG_DOCUMENT', 'WRONG_PERIOD') AND jsonb_array_length(v_refs) < 1 THEN
    RAISE EXCEPTION 'page_refs_required' USING ERRCODE = '22023';
  END IF;
  IF p_document_ids IS NULL OR array_length(p_document_ids, 1) IS NULL OR array_length(p_document_ids, 1) < 1 THEN
    RAISE EXCEPTION 'invalid_request:documents' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hive.requests r WHERE r.id = p_request_id) THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO hive.request_checks (
    request_id, source_document_ids, verdict, sentence, page_refs, model, prompt_version
  ) VALUES (
    p_request_id, p_document_ids, p_verdict, p_sentence, v_refs, p_model, p_prompt_version
  )
  RETURNING * INTO v_row;

  RETURN json_build_object('checkId', v_row.id, 'requestId', p_request_id, 'verdict', v_row.verdict);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_resolve_request(
  p_request_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req hive.requests%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_to text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM hive.requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT hive.can_write_hive(v_req.hive_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('ACCEPT', 'NOT_NEEDED', 'ASK_AGAIN') THEN
    RAISE EXCEPTION 'invalid_request:action' USING ERRCODE = '22023';
  END IF;

  v_to := CASE p_action
    WHEN 'ACCEPT' THEN 'CHECKED'
    WHEN 'NOT_NEEDED' THEN 'NOT_NEEDED'
    WHEN 'ASK_AGAIN' THEN 'WAITING'
  END;

  UPDATE hive.requests
  SET
    state = v_to,
    state_note = CASE WHEN p_action = 'ASK_AGAIN' THEN v_note ELSE state_note END,
    accepted_by = CASE WHEN p_action = 'ACCEPT' THEN v_uid ELSE accepted_by END,
    updated_at = now()
  WHERE id = p_request_id;

  PERFORM hive.append_request_event(
    p_request_id, v_req.state, v_to, v_uid, 'person', v_note
  );

  RETURN json_build_object('requestId', p_request_id, 'state', v_to, 'stateNote', v_note);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION hive.can_upload_to_hive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hive.can_upload_to_hive(uuid) TO authenticated;

REVOKE ALL ON FUNCTION hive.normalize_pack_row_key(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION hive.append_request_event(uuid, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_upload_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_upload_context(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_upload_quota_for_hive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_upload_quota_for_hive(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.start_checklist(uuid, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_checklist(uuid, text, integer, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.list_requests(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_requests(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.add_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_request(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.attach_document_to_request(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_document_to_request(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.staff_resolve_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_resolve_request(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_request_state(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_request_state(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.record_request_check(uuid, uuid[], text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_request_check(uuid, uuid[], text, text, jsonb, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_hive_chosen_pack(p_hive_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
  SELECT CASE
    WHEN h.pack_id IS NULL OR h.pack_version IS NULL THEN NULL
    ELSE json_build_object('packId', h.pack_id, 'packVersion', h.pack_version)
  END
    FROM hive.hives h
   WHERE h.id = p_hive_id;
$$;

REVOKE ALL ON FUNCTION public.get_hive_chosen_pack(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hive_chosen_pack(uuid) TO service_role;

COMMIT;