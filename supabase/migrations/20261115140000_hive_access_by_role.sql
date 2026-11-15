-- FL-5: owner-only writes (require_owned_hive), active-member reads, pending professionals.
BEGIN;

ALTER TABLE hive.hive_members DROP CONSTRAINT IF EXISTS ck_hive_members__state;
ALTER TABLE hive.hive_members
  ADD CONSTRAINT ck_hive_members__state CHECK (state IN ('active', 'left', 'removed', 'pending'));

CREATE OR REPLACE FUNCTION hive.require_owned_hive(p_hive_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT hive.is_hive_owner(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hive_reports(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_revision hive.study_revisions%ROWTYPE;
  v_has_revision boolean;
BEGIN
  PERFORM hive.require_hive_member(p_hive_id);
  SELECT s.* INTO v_revision FROM hive.study_revisions s
    JOIN hive.canonical_studies c ON c.id = s.canonical_study_id
   WHERE c.hive_id = p_hive_id AND s.id = c.current_revision_id;
  v_has_revision := FOUND;
  RETURN json_build_object(
    'studyRevision', CASE WHEN v_has_revision THEN hive.study_revision_summary_json(v_revision) END,
    'reportRuns', CASE WHEN v_has_revision THEN hive.latest_report_runs_json(v_revision.id) ELSE '[]'::json END,
    'latest', coalesce((
      SELECT json_agg(hive.report_json(x.p) ORDER BY x.audience)
        FROM (
          SELECT DISTINCT ON (p.audience) p, p.audience
            FROM hive.reports p
           WHERE p.hive_id = p_hive_id AND v_has_revision AND p.study_revision_id = v_revision.id
           ORDER BY p.audience, p.created_at DESC, p.id DESC
        ) x
    ), '[]'::json),
    'history', coalesce((
      SELECT json_agg(hive.report_summary_json(p) ORDER BY p.created_at DESC, p.id DESC)
        FROM hive.reports p WHERE p.hive_id = p_hive_id
    ), '[]'::json)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_study_preparation(
  p_hive_id uuid,
  p_include_preview boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run hive.processing_runs%ROWTYPE;
  v_preview hive.study_prompt_previews%ROWTYPE;
  v_revision hive.study_revisions%ROWTYPE;
  v_sources jsonb;
  v_has_run boolean;
  v_has_preview boolean;
  v_has_revision boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  PERFORM hive.require_hive_member(p_hive_id);

  PERFORM hive.expire_stale_document_reads(p_hive_id);
  PERFORM hive.expire_stale_processing_runs(p_hive_id);
  PERFORM hive.expire_stale_report_runs(p_hive_id);

  SELECT * INTO v_run FROM hive.processing_runs
   WHERE hive_id = p_hive_id AND kind = 'STUDY_PREPARATION'
   ORDER BY attempt_number DESC
   LIMIT 1;
  v_has_run := FOUND;

  SELECT * INTO v_preview FROM hive.study_prompt_previews p
   WHERE p.hive_id = p_hive_id
     AND (p.processing_run_id = v_run.id
          OR EXISTS (SELECT 1 FROM hive.processing_runs r WHERE r.id = p.processing_run_id AND r.status = 'SUCCEEDED'))
   ORDER BY (p.processing_run_id = v_run.id) DESC, p.created_at DESC, p.id DESC
   LIMIT 1;
  v_has_preview := FOUND;

  SELECT s.* INTO v_revision FROM hive.study_revisions s
    JOIN hive.canonical_studies c ON c.id = s.canonical_study_id
   WHERE c.hive_id = p_hive_id AND s.id = c.current_revision_id;
  v_has_revision := FOUND;

  v_sources := hive.compute_study_source_snapshot(p_hive_id);

  RETURN json_build_object(
    'processingRun', CASE WHEN v_has_run THEN hive.processing_run_json(v_run) END,
    'preview', CASE WHEN v_has_preview AND p_include_preview THEN hive.study_prompt_preview_json(v_preview) END,
    'previewSummary', CASE WHEN v_has_preview THEN json_build_object(
      'id', v_preview.id,
      'processingRunId', v_preview.processing_run_id,
      'createdAt', v_preview.created_at
    ) END,
    'staleness', CASE WHEN v_has_preview THEN hive.study_prompt_preview_staleness(v_preview) END,
    'studyRevision', CASE WHEN v_has_revision THEN hive.study_revision_summary_json(v_revision) END,
    'reportRuns', CASE WHEN v_has_revision THEN hive.latest_report_runs_json(v_revision.id) ELSE '[]'::json END,
    'documentReads', hive.latest_document_reads_json(p_hive_id),
    'eligibility', json_build_object(
      'documents', v_sources -> 'documents',
      'excluded', v_sources -> 'excluded',
      'activeReadCount', v_sources -> 'activeReadCount',
      'coverageComplete', v_sources -> 'coverageComplete',
      'coverageDigest', v_sources -> 'coverageDigest',
      'gaps', (
        SELECT coalesce(jsonb_agg(g || jsonb_build_object('acknowledged', EXISTS (
                 SELECT 1 FROM hive.coverage_acknowledgements a
                  WHERE a.hive_id = p_hive_id AND a.gap_key = g ->> 'key')) ORDER BY g ->> 'key'), '[]'::jsonb)
          FROM jsonb_array_elements(hive.classify_coverage_gaps(v_sources)) g
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_document_reads(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  PERFORM hive.require_hive_member(p_hive_id);

  PERFORM hive.expire_stale_document_reads(p_hive_id);

  RETURN json_build_object('documentReads', hive.latest_document_reads_json(p_hive_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_failure_diagnostics(p_hive_id uuid, p_correlation_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_rows json;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  v_owner := hive.require_hive_member(p_hive_id);

  SELECT coalesce(json_agg(row_to_json(found) ORDER BY found.sort_at DESC), '[]'::json)
    INTO v_rows
    FROM (
      SELECT 'processing_run' AS kind,
             r.id AS "operationId",
             r.status,
             hive.support_failure_diagnostic(
               r.failure_diagnostic,
               'analysis',
               'analyze',
               NULL,
               coalesce(
                 CASE WHEN r.stage_metrics -> -1 ->> 'stage' ~ '^[A-Z][A-Z0-9_]{0,63}$'
                      THEN r.stage_metrics -> -1 ->> 'stage' END,
                 r.status
               ),
               r.error_code,
               r.retryable,
               r.stage_attempt
             ) AS diagnostic,
             r.updated_at AS sort_at
        FROM hive.processing_runs r
       WHERE r.hive_id = p_hive_id
         AND r.owner_user_id = v_owner
         AND r.correlation_id = p_correlation_id
         AND (r.failure_diagnostic IS NOT NULL OR r.error_code IS NOT NULL OR r.status = 'FAILED')
      UNION ALL
      SELECT 'report_run',
             r.id,
             r.status,
             hive.support_failure_diagnostic(
               r.failure_diagnostic, 'writer', 'write_report', 'writer', 'WRITING',
               r.error_code, r.retryable, r.attempt_count
             ),
             r.updated_at
        FROM hive.report_runs r
       WHERE r.hive_id = p_hive_id
         AND r.owner_user_id = v_owner
         AND r.correlation_id = p_correlation_id
         AND (r.failure_diagnostic IS NOT NULL OR r.error_code IS NOT NULL OR r.status = 'FAILED')
      UNION ALL
      SELECT 'document_read',
             r.id,
             r.status,
             hive.support_failure_diagnostic(
               r.failure_diagnostic, 'reader', 'read_document', 'read', 'READ',
               r.error_code, r.retryable, r.attempt_number
             ),
             r.updated_at
        FROM hive.document_reads r
       WHERE r.hive_id = p_hive_id
         AND r.owner_user_id = v_owner
         AND r.correlation_id = p_correlation_id
         AND (r.failure_diagnostic IS NOT NULL OR r.error_code IS NOT NULL OR r.status IN ('FAILED', 'UNREADABLE'))
    ) found
   WHERE found.diagnostic IS NOT NULL;

  RETURN json_build_object('correlationId', p_correlation_id, 'diagnostics', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_study_tab_view(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  PERFORM hive.require_hive_member(p_hive_id);
  RETURN hive.build_study_tab_view(p_hive_id, v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_study_tab_view_definer(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  PERFORM hive.require_hive_member(p_hive_id);
  RETURN hive.build_study_tab_view(p_hive_id, v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_invitation_welcome_context(p_token_hash text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_email text;
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_row hive.hive_invitations%ROWTYPE;
  v_doc_count integer := 0;
  v_read_count integer := 0;
  v_inviter_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF v_hash = '' OR char_length(v_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT lower(u.email) INTO v_user_email FROM auth.users u WHERE u.id = v_uid;
  SELECT * INTO v_row FROM hive.hive_invitations i WHERE i.token_hash = v_hash LIMIT 1;
  IF NOT FOUND OR v_row.revoked_at IS NOT NULL OR v_row.accepted_at IS NOT NULL OR v_row.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation_invalid' USING ERRCODE = 'P0002';
  END IF;
  IF v_user_email IS DISTINCT FROM v_row.email THEN
    RAISE EXCEPTION 'invitation_email_mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(p.display_name, 'Your contact') INTO v_inviter_name
    FROM hive.user_profiles p WHERE p.user_id = v_row.invited_by;
  SELECT count(*)::integer, count(*) FILTER (WHERE coalesce(d.read_status, 'PENDING') = 'SUCCEEDED')::integer
    INTO v_doc_count, v_read_count
    FROM hive.source_documents d
   WHERE d.case_id = v_row.hive_id AND d.deleted_at IS NULL AND d.lifecycle_status = 'ACTIVE';
  RETURN json_build_object(
    'hiveId', v_row.hive_id,
    'hiveName', (SELECT h.name FROM hive.hives h WHERE h.id = v_row.hive_id),
    'role', v_row.role,
    'inviterDisplayName', v_inviter_name,
    'documentCount', v_doc_count,
    'documentsReadCount', v_read_count,
    'documentsReadLabel', CASE WHEN v_doc_count > 0 AND v_read_count = v_doc_count THEN v_doc_count::text || ' documents, read and checked'
                               WHEN v_doc_count > 0 THEN 'The documents are not read yet' ELSE 'No documents yet' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token_hash text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_email text;
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_row hive.hive_invitations%ROWTYPE;
  v_owner uuid;
  v_starting_view text;
  v_member_state text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501'; END IF;
  IF v_hash = '' OR char_length(v_hash) <> 64 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023'; END IF;
  SELECT lower(u.email) INTO v_user_email FROM auth.users u WHERE u.id = v_uid;
  SELECT * INTO v_row FROM hive.hive_invitations i WHERE i.token_hash = v_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_invalid' USING ERRCODE = 'P0002'; END IF;
  IF v_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'invitation_revoked' USING ERRCODE = '42501'; END IF;
  IF v_row.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'invitation_used' USING ERRCODE = '42501'; END IF;
  IF v_row.expires_at <= now() THEN RAISE EXCEPTION 'invitation_expired' USING ERRCODE = '42501'; END IF;
  IF v_user_email IS DISTINCT FROM v_row.email THEN RAISE EXCEPTION 'invitation_email_mismatch' USING ERRCODE = '42501'; END IF;
  IF hive.is_hive_owner(v_row.hive_id) THEN
    RAISE EXCEPTION 'invitation_invalid' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM hive.hive_members m
     WHERE m.hive_id = v_row.hive_id AND m.user_id = v_uid AND m.state = 'active'
  ) THEN
    RAISE EXCEPTION 'member_already_active' USING ERRCODE = '42501';
  END IF;
  SELECT h.owner_user_id INTO v_owner FROM hive.hives h WHERE h.id = v_row.hive_id;
  v_member_state := CASE WHEN v_row.role = 'professional' THEN 'pending' ELSE 'active' END;
  INSERT INTO hive.hive_members (hive_id, user_id, role, state, invited_by)
  VALUES (v_row.hive_id, v_uid, v_row.role, v_member_state, v_row.invited_by)
  ON CONFLICT (hive_id, user_id) DO UPDATE
    SET role = CASE WHEN hive.hive_members.state = 'active' THEN hive.hive_members.role ELSE EXCLUDED.role END,
        state = CASE WHEN hive.hive_members.state = 'active' THEN hive.hive_members.state ELSE EXCLUDED.state END,
        invited_by = EXCLUDED.invited_by,
        updated_at = now();
  UPDATE hive.hive_invitations SET accepted_at = now(), accepted_by = v_uid WHERE id = v_row.id;
  v_starting_view := CASE WHEN v_row.role = 'client' THEN 'own' ELSE 'clients' END;
  INSERT INTO hive.user_profiles (user_id, starting_view, created_at, updated_at) VALUES (v_uid, v_starting_view, now(), now()) ON CONFLICT (user_id) DO NOTHING;
  PERFORM hive.write_membership_audit(v_row.hive_id, v_owner, 'invitation_accepted', jsonb_build_object('invitationId', v_row.id, 'role', v_row.role, 'memberState', v_member_state));
  RETURN json_build_object('hiveId', v_row.hive_id, 'role', v_row.role, 'memberState', v_member_state);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_hives()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result json;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(json_agg(json_build_object(
    'id', h.id, 'hiveId', h.id, 'name', h.name, 'description', h.description, 'kind', h.kind,
    'clientRequestId', h.client_request_id, 'createdAt', h.created_at, 'updatedAt', h.updated_at,
    'deletingAt', h.deleting_at, 'membershipRole', m.role, 'isOwner', m.role = 'owner',
    'memberState', m.state, 'ownerDisplayName', op.display_name,
    'clientShareStatus', CASE WHEN m.role <> 'owner' OR h.kind <> 'client' THEN NULL
      WHEN EXISTS (SELECT 1 FROM hive.hive_members cm WHERE cm.hive_id = h.id AND cm.role = 'client' AND cm.state = 'active') THEN 'client_joined'
      WHEN EXISTS (SELECT 1 FROM hive.hive_invitations i WHERE i.hive_id = h.id AND i.role = 'client' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN 'invited'
      ELSE NULL END,
    'homeKicker', CASE WHEN m.role = 'client' AND m.state = 'active' THEN 'Your hive with ' || coalesce(op.display_name, 'the owner')
      WHEN m.role = 'professional' AND m.state = 'pending' THEN 'invited'
      WHEN m.role = 'owner' AND h.kind = 'client' THEN coalesce(h.description, h.name) || coalesce(
        CASE WHEN EXISTS (SELECT 1 FROM hive.hive_members cm WHERE cm.hive_id = h.id AND cm.role = 'client' AND cm.state = 'active') THEN ' · client joined'
             WHEN EXISTS (SELECT 1 FROM hive.hive_invitations i WHERE i.hive_id = h.id AND i.role = 'client' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN ' · invited'
        END, '') ELSE NULL END
  ) ORDER BY (h.deleting_at IS NOT NULL) DESC, h.created_at DESC, h.id DESC), '[]'::json)
  INTO v_result
  FROM hive.hive_members m
  JOIN hive.hives h ON h.id = m.hive_id
  LEFT JOIN hive.user_profiles op ON op.user_id = h.owner_user_id
 WHERE m.user_id = v_uid AND m.state IN ('active', 'pending') AND h.archived_at IS NULL;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_invitation_welcome_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_welcome_context(text) TO authenticated;

COMMIT;
