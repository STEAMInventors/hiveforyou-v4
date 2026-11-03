-- V4-004E — Resumable Analyze and Report Reuse (D-046).
--
-- Updates public.start_study_preparation so clicking Analyze reuses existing durable results
-- instead of repeating completed, paid processing:
--   1. Resolves the current case's source snapshot (sourceSnapshotDigest, coverageDigest) and
--      analysis configuration (intentSnapshotDigest).
--   2. When all eligible documents are read and no new reads are needed, finds the latest
--      compatible accepted Canonical Study revision whose snapshot and configuration identities
--      match (source_snapshot_digest, intent_snapshot_digest, coverage_digest) and whose execution
--      manifest uses the current binding format (hive.source-page-index/1).
--   3. Inspects Customer and Pro reports and Writer runs tied to that exact revision:
--      - If both valid reports exist, returns the revision and reports immediately (reportsReady = true)
--        without creating any Study or Writer run.
--      - If one valid report exists, preserves it and queues/reattaches only the missing audience.
--      - If a compatible Study exists but reports are missing or failed, queues only the required
--        Writer runs (trigger = 'OWNER_GENERATE').
--      - If a matching Writer run is already active (QUEUED/WRITING/VALIDATING/SAVING), reattaches
--        to it rather than creating duplicates.
--   4. If an active Study processing run exists, reattaches to it only when its snapshot and
--      configuration identities match; stale active runs are failed atomically with SOURCE_CHANGED
--      before starting a fresh full analysis workflow.
--   5. If no compatible Study exists, starts the full analysis workflow.
--   6. Preserves tenant ownership, atomic transitions, provenance, report-run idempotency, and
--      existing Writer, Study, A2UI and report schemas.
--
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

-- Expires stale active Writer runs (no progress after lease expiration for 15 minutes or older than 2 hours)
-- so Analyze can cleanly retry failed/abandoned report generation without orphaned active rows.
CREATE OR REPLACE FUNCTION hive.expire_stale_report_runs(p_hive_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_expired integer;
BEGIN
  UPDATE hive.report_runs r
     SET status = 'FAILED',
         error_code = coalesce(r.error_code, 'REPORT_INTERRUPTED'),
         error_message_safe = coalesce(r.error_message_safe, 'The report stopped before it finished. You can generate it again.'),
         retryable = true,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.status NOT IN ('SUCCEEDED', 'FAILED')
     AND (coalesce(r.lease_expires_at, r.next_dispatch_at, r.updated_at) < now() - interval '15 minutes'
          OR r.created_at < now() - interval '2 hours');
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_study_preparation(
  p_hive_id uuid,
  p_request_id uuid,
  p_correlation_id uuid,
  p_coverage_acknowledgement_digest text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run hive.processing_runs%ROWTYPE;
  v_sources jsonb;
  v_intents jsonb;
  v_ack text := lower(nullif(btrim(coalesce(p_coverage_acknowledgement_digest, '')), ''));
  v_attempt integer;
  v_live integer;
  v_needs_read integer;
  v_no_intent boolean;
  v_queued json := '[]'::json;
  v_queued_reports json := '[]'::json;
  v_gaps jsonb;
  v_known jsonb;
  v_unacked jsonb;
  v_acked_now boolean := false;
  v_coverage_status text;
  v_acknowledgement text;
  v_acknowledged_at timestamptz;
  v_revision hive.study_revisions%ROWTYPE;
  v_report_run hive.report_runs%ROWTYPE;
  v_audience text;
  v_has_valid_report boolean;
  v_queued_report_ids uuid[] := ARRAY[]::uuid[];
  v_customer_ready boolean := false;
  v_pro_ready boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
      AND h.owner_user_id = v_uid
      AND h.archived_at IS NULL
      AND h.deleting_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM hive.expire_stale_document_reads(p_hive_id);
  PERFORM hive.expire_stale_processing_runs(p_hive_id);
  PERFORM hive.expire_stale_report_runs(p_hive_id);

  -- 1. Idempotent replay by processing_runs.request_id
  SELECT * INTO v_run FROM hive.processing_runs
   WHERE owner_user_id = v_uid AND request_id = p_request_id;
  IF FOUND THEN
    IF v_run.hive_id <> p_hive_id THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    SELECT s.* INTO v_revision
      FROM hive.study_revisions s
     WHERE s.processing_run_id = v_run.id;
    IF FOUND THEN
      v_customer_ready := EXISTS (
        SELECT 1 FROM hive.reports p WHERE p.study_revision_id = v_revision.id AND p.audience = 'CUSTOMER'
      );
      v_pro_ready := EXISTS (
        SELECT 1 FROM hive.reports p WHERE p.study_revision_id = v_revision.id AND p.audience = 'PRO'
      );
      RETURN json_build_object(
        'processingRun', hive.processing_run_json(v_run),
        'created', false,
        'reusedStudy', true,
        'reportsReady', (v_customer_ready AND v_pro_ready),
        'studyRevision', hive.study_revision_summary_json(v_revision),
        'reportRuns', hive.latest_report_runs_json(v_revision.id),
        'queuedReadIds', '[]'::json,
        'queuedReportRunIds', '[]'::json
      );
    END IF;
    RETURN json_build_object(
      'processingRun', hive.processing_run_json(v_run),
      'created', false,
      'queuedReadIds', '[]'::json,
      'queuedReportRunIds', '[]'::json
    );
  END IF;

  -- 2. Idempotent replay by report_runs.request_id (when p_request_id previously queued Writer runs)
  SELECT * INTO v_report_run FROM hive.report_runs
   WHERE owner_user_id = v_uid AND request_id = p_request_id
   ORDER BY created_at DESC, id DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_report_run.hive_id <> p_hive_id THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_revision FROM hive.study_revisions WHERE id = v_report_run.study_revision_id;
    SELECT * INTO v_run FROM hive.processing_runs WHERE id = v_revision.processing_run_id;
    v_customer_ready := EXISTS (
      SELECT 1 FROM hive.reports p WHERE p.study_revision_id = v_revision.id AND p.audience = 'CUSTOMER'
    );
    v_pro_ready := EXISTS (
      SELECT 1 FROM hive.reports p WHERE p.study_revision_id = v_revision.id AND p.audience = 'PRO'
    );
    RETURN json_build_object(
      'processingRun', hive.processing_run_json(v_run),
      'created', false,
      'reusedStudy', true,
      'reportsReady', (v_customer_ready AND v_pro_ready),
      'studyRevision', hive.study_revision_summary_json(v_revision),
      'reportRuns', hive.latest_report_runs_json(v_revision.id),
      'queuedReadIds', '[]'::json,
      'queuedReportRunIds', '[]'::json
    );
  END IF;

  -- 3. Any active Study run whose frozen sources or intents no longer match is failed atomically
  --    so Analyze never reattaches to a stale in-flight run.
  UPDATE hive.processing_runs r
     SET status = 'FAILED',
         error_code = 'SOURCE_CHANGED',
         error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
         failure_diagnostic = jsonb_build_object(
           'contractVersion', 'failure-diagnostic@1',
           'component', 'analysis',
           'operation', 'analyze',
           'task', NULL,
           'stage', r.status,
           'errorCode', 'SOURCE_CHANGED',
           'diagnosticReason', 'source_changed',
           'diagnosticField', NULL,
           'retryable', true,
           'attempt', r.stage_attempt
         ),
         retryable = true,
         lease_expires_at = NULL,
         next_dispatch_at = NULL,
         finished_at = now()
   WHERE r.hive_id = p_hive_id
     AND r.kind = 'STUDY_PREPARATION'
     AND r.status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
     AND NOT hive.processing_run_snapshot_current(r);

  -- 4. Reattach to an active compatible Study run if one is already running.
  SELECT * INTO v_run FROM hive.processing_runs
   WHERE hive_id = p_hive_id
     AND kind = 'STUDY_PREPARATION'
     AND status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED');
  IF FOUND THEN
    RETURN json_build_object(
      'processingRun', hive.processing_run_json(v_run),
      'created', false,
      'queuedReadIds', '[]'::json,
      'queuedReportRunIds', '[]'::json
    );
  END IF;

  SELECT count(*) INTO v_live
    FROM hive.source_documents d
   WHERE d.case_id = p_hive_id AND d.lifecycle_status = 'ACTIVE' AND d.deleted_at IS NULL
     AND d.upload_status = 'UPLOADED';
  IF v_live = 0 THEN
    RAISE EXCEPTION 'no_eligible_documents' USING ERRCODE = 'P0001';
  END IF;

  v_intents := hive.compute_study_intent_snapshot(p_hive_id);
  v_no_intent := jsonb_array_length(v_intents -> 'intentRequestIds') = 0;
  v_sources := hive.compute_study_source_snapshot(p_hive_id);

  SELECT count(*) INTO v_needs_read
    FROM hive.source_documents d
   WHERE d.case_id = p_hive_id AND d.owner_user_id = v_uid
     AND d.lifecycle_status = 'ACTIVE' AND d.deleted_at IS NULL AND d.upload_status = 'UPLOADED'
     AND d.read_status IN ('PENDING', 'FAILED')
     AND NOT EXISTS (
       SELECT 1 FROM hive.document_reads a
        WHERE a.source_document_id = d.id AND a.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')
     );

  IF NOT v_no_intent AND v_needs_read = 0 AND (v_sources ->> 'activeReadCount')::integer = 0
     AND jsonb_array_length(v_sources -> 'documents') = 0 THEN
    RAISE EXCEPTION 'no_eligible_documents' USING ERRCODE = 'P0001';
  END IF;

  -- Gaps already known: every gap except those of documents about to be read (or being read).
  v_gaps := hive.classify_coverage_gaps(v_sources);
  SELECT coalesce(jsonb_agg(g ORDER BY g ->> 'key'), '[]'::jsonb) INTO v_known
    FROM jsonb_array_elements(v_gaps) g
   WHERE NOT EXISTS (
     SELECT 1 FROM hive.source_documents d
      WHERE d.id = (g ->> 'sourceDocumentId')::uuid
        AND (d.read_status IN ('PENDING', 'FAILED')
             OR EXISTS (SELECT 1 FROM hive.document_reads a
                         WHERE a.source_document_id = d.id
                           AND a.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')))
   );
  v_unacked := hive.unacknowledged_material_gaps(p_hive_id, v_known);
  IF NOT v_no_intent AND jsonb_array_length(v_unacked) > 0 THEN
    IF v_ack IS DISTINCT FROM (v_sources ->> 'coverageDigest') THEN
      RAISE EXCEPTION 'coverage_unacknowledged' USING ERRCODE = 'P0001';
    END IF;
    v_acked_now := true;
  END IF;

  -- 5. When all eligible documents are read and no reads are pending/active, check for the latest
  --    compatible accepted Canonical Study revision matching the exact source snapshot, coverage
  --    and intent configuration.
  IF NOT v_no_intent AND v_needs_read = 0 AND (v_sources ->> 'activeReadCount')::integer = 0 THEN
    SELECT s.* INTO v_revision
      FROM hive.study_revisions s
      JOIN hive.processing_runs r ON r.id = s.processing_run_id
      JOIN hive.study_prompt_previews p ON p.id = s.study_prompt_preview_id
     WHERE s.hive_id = p_hive_id
       AND s.owner_user_id = v_uid
       AND r.status = 'SUCCEEDED'
       AND s.source_snapshot_digest = (v_sources ->> 'sourceSnapshotDigest')
       AND s.intent_snapshot_digest = (v_intents ->> 'intentSnapshotDigest')
       AND s.coverage_digest = (v_sources ->> 'coverageDigest')
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(coalesce(p.execution_manifest -> 'bindings', '[]'::jsonb)) b
          WHERE b ->> 'format' IS DISTINCT FROM 'hive.source-page-index/1'
       )
     ORDER BY s.revision_number DESC, s.created_at DESC, s.id DESC
     LIMIT 1;

    IF FOUND THEN
      SELECT * INTO v_run FROM hive.processing_runs WHERE id = v_revision.processing_run_id;

      IF v_acked_now THEN
        PERFORM hive.record_coverage_acknowledgements(v_run, v_unacked, v_sources ->> 'coverageDigest');
      END IF;

      -- Ensure canonical_studies points at the compatible accepted revision if it was behind or unset.
      UPDATE hive.canonical_studies c
         SET current_revision_id = v_revision.id,
             updated_at = now()
       WHERE c.hive_id = p_hive_id
         AND c.owner_user_id = v_uid
         AND c.current_revision_id IS DISTINCT FROM v_revision.id
         AND NOT EXISTS (
           SELECT 1 FROM hive.study_revisions newer
            WHERE newer.id = c.current_revision_id
              AND newer.revision_number > v_revision.revision_number
         );

      -- Inspect Customer and Pro reports and Writer runs for this exact revision.
      FOREACH v_audience IN ARRAY ARRAY['CUSTOMER', 'PRO'] LOOP
        v_has_valid_report := EXISTS (
          SELECT 1
            FROM hive.reports rep
            JOIN hive.report_runs rr ON rr.id = rep.report_run_id
           WHERE rep.hive_id = p_hive_id
             AND rep.owner_user_id = v_uid
             AND rep.study_revision_id = v_revision.id
             AND rep.audience = v_audience
             AND rr.status = 'SUCCEEDED'
        );

        IF v_has_valid_report THEN
          IF v_audience = 'CUSTOMER' THEN
            v_customer_ready := true;
          ELSE
            v_pro_ready := true;
          END IF;
        ELSE
          -- Check if a Writer run for this revision and audience is already active.
          SELECT * INTO v_report_run
            FROM hive.report_runs rr
           WHERE rr.hive_id = p_hive_id
             AND rr.owner_user_id = v_uid
             AND rr.study_revision_id = v_revision.id
             AND rr.audience = v_audience
             AND rr.status NOT IN ('SUCCEEDED', 'FAILED')
           ORDER BY rr.created_at DESC, rr.id DESC
           LIMIT 1;

          IF NOT FOUND THEN
            -- Start only the missing/failed audience Writer run.
            INSERT INTO hive.report_runs (
              hive_id, owner_user_id, study_revision_id, audience, trigger, request_id, correlation_id, next_dispatch_at
            )
            VALUES (
              p_hive_id, v_uid, v_revision.id, v_audience, 'OWNER_GENERATE', p_request_id, p_correlation_id,
              now() + interval '30 seconds'
            )
            ON CONFLICT DO NOTHING
            RETURNING * INTO v_report_run;

            IF FOUND THEN
              v_queued_report_ids := array_append(v_queued_report_ids, v_report_run.id);
            END IF;
          ELSIF v_report_run.status = 'QUEUED'
                AND v_report_run.attempt_count = 0
                AND v_report_run.lease_expires_at IS NULL THEN
            -- Reattach and ensure an unclaimed initial QUEUED run is dispatched if no worker picked it up yet.
            v_queued_report_ids := array_append(v_queued_report_ids, v_report_run.id);
          END IF;
        END IF;
      END LOOP;

      SELECT coalesce(json_agg(x), '[]'::json) INTO v_queued_reports
        FROM unnest(v_queued_report_ids) AS x;

      RETURN json_build_object(
        'processingRun', hive.processing_run_json(v_run),
        'created', false,
        'reusedStudy', true,
        'reportsReady', (v_customer_ready AND v_pro_ready),
        'studyRevision', hive.study_revision_summary_json(v_revision),
        'reportRuns', hive.latest_report_runs_json(v_revision.id),
        'queuedReadIds', '[]'::json,
        'queuedReportRunIds', v_queued_reports
      );
    END IF;
  END IF;

  -- 6. No compatible Study exists (or documents still need reading): start the full analysis workflow.
  SELECT coalesce(max(r.attempt_number), 0) + 1 INTO v_attempt
    FROM hive.processing_runs r
   WHERE r.hive_id = p_hive_id AND r.kind = 'STUDY_PREPARATION';

  IF v_no_intent THEN
    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      intent_request_ids, intent_snapshot_digest,
      error_code, error_message_safe, retryable, finished_at
    )
    VALUES (
      p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt, 'NEEDS_CLARIFICATION', p_correlation_id,
      ARRAY[]::uuid[], v_intents ->> 'intentSnapshotDigest',
      'INTENT_MISSING', 'Tell us what you want to understand from these documents, then analyze again.', true, now()
    )
    RETURNING * INTO v_run;
  ELSIF v_needs_read > 0 OR (v_sources ->> 'activeReadCount')::integer > 0 THEN
    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      intent_request_ids, intent_snapshot_digest, next_dispatch_at
    )
    VALUES (
      p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt, 'READING_DOCUMENTS', p_correlation_id,
      ARRAY(SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_intents -> 'intentRequestIds') x),
      v_intents ->> 'intentSnapshotDigest',
      now() + interval '30 seconds'
    )
    RETURNING * INTO v_run;

    INSERT INTO hive.document_reads (
      hive_id, owner_user_id, source_document_id, request_id, attempt_number, status, correlation_id,
      lease_expires_at
    )
    SELECT p_hive_id, v_uid, d.id, p_request_id,
           coalesce((SELECT max(r.attempt_number) FROM hive.document_reads r WHERE r.source_document_id = d.id), 0) + 1,
           'QUEUED', p_correlation_id, now() + interval '330 seconds'
      FROM hive.source_documents d
     WHERE d.case_id = p_hive_id AND d.owner_user_id = v_uid
       AND d.lifecycle_status = 'ACTIVE' AND d.deleted_at IS NULL AND d.upload_status = 'UPLOADED'
       AND d.read_status IN ('PENDING', 'FAILED')
       AND NOT EXISTS (
         SELECT 1 FROM hive.document_reads a
          WHERE a.source_document_id = d.id AND a.status IN ('QUEUED', 'READING', 'SAVING', 'VERIFYING')
       )
     ORDER BY d.created_at, d.id
    ON CONFLICT DO NOTHING;

    SELECT coalesce(json_agg(r.id ORDER BY r.created_at, r.id), '[]'::json) INTO v_queued
      FROM hive.document_reads r
     WHERE r.hive_id = p_hive_id AND r.request_id = p_request_id AND r.status = 'QUEUED';
  ELSE
    v_coverage_status := hive.coverage_status_for(v_gaps);
    IF v_coverage_status <> 'MATERIAL_GAPS' THEN
      v_acknowledgement := 'NOT_REQUIRED';
    ELSIF v_acked_now THEN
      v_acknowledgement := 'OWNER';
      v_acknowledged_at := now();
    ELSE
      v_acknowledgement := 'PRIOR';
      SELECT max(a.acknowledged_at) INTO v_acknowledged_at
        FROM hive.coverage_acknowledgements a
        JOIN jsonb_array_elements(v_gaps) g ON g ->> 'key' = a.gap_key
       WHERE a.hive_id = p_hive_id;
    END IF;

    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id,
      authorized_source_document_ids, intent_request_ids, source_snapshot,
      source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
      coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement, coverage_acknowledged_at,
      snapshot_frozen_at, next_dispatch_at
    )
    VALUES (
      p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt, 'QUEUED', p_correlation_id,
      ARRAY(SELECT (d ->> 'sourceDocumentId')::uuid FROM jsonb_array_elements(v_sources -> 'documents') d),
      ARRAY(SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_intents -> 'intentRequestIds') x),
      jsonb_build_object(
        'documents', v_sources -> 'documents',
        'excluded', v_sources -> 'excluded',
        'coverageComplete', v_sources -> 'coverageComplete'
      ),
      v_sources ->> 'sourceSnapshotDigest',
      v_intents ->> 'intentSnapshotDigest',
      v_sources ->> 'coverageDigest',
      (v_sources ->> 'coverageComplete')::boolean,
      v_acknowledgement IN ('PRIOR', 'OWNER'),
      v_coverage_status,
      v_gaps,
      v_acknowledgement,
      v_acknowledged_at,
      now(),
      now() + interval '30 seconds'
    )
    RETURNING * INTO v_run;
  END IF;

  IF v_acked_now THEN
    PERFORM hive.record_coverage_acknowledgements(v_run, v_unacked, v_sources ->> 'coverageDigest');
  END IF;

  RETURN json_build_object(
    'processingRun', hive.processing_run_json(v_run),
    'created', true,
    'reusedStudy', false,
    'reportsReady', false,
    'queuedReadIds', v_queued,
    'queuedReportRunIds', '[]'::json
  );
END;
$$;

-- Also update get_study_preparation so stale report runs are expired on poll.
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
  IF NOT EXISTS (
    SELECT 1 FROM hive.hives h
     WHERE h.id = p_hive_id
       AND h.owner_user_id = v_uid
       AND h.archived_at IS NULL
       AND h.deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

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

REVOKE ALL ON FUNCTION hive.expire_stale_report_runs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_study_preparation(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_study_preparation(uuid, uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_study_preparation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_preparation(uuid, boolean) TO authenticated;

COMMIT;
