-- FL-5: member read fixes and owner-only write gates on study/intent RPCs.
BEGIN;

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
    IF p_request_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  v_uid := hive.require_owned_hive(p_hive_id);

  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
      AND h.archived_at IS NULL
      AND h.deleting_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM hive.expire_stale_document_reads(p_hive_id);
  PERFORM hive.expire_stale_processing_runs(p_hive_id);
  PERFORM hive.expire_stale_report_runs(p_hive_id);

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

  IF NOT v_no_intent AND v_needs_read = 0 AND (v_sources ->> 'activeReadCount')::integer = 0 THEN
    SELECT s.* INTO v_revision
      FROM hive.study_revisions s
      JOIN hive.processing_runs r ON r.id = s.processing_run_id
      LEFT JOIN hive.study_prompt_previews p ON p.id = s.study_prompt_preview_id
     WHERE s.hive_id = p_hive_id
       AND s.owner_user_id = v_uid
       AND r.status = 'SUCCEEDED'
       AND s.source_snapshot_digest = (v_sources ->> 'sourceSnapshotDigest')
       AND s.intent_snapshot_digest = (v_intents ->> 'intentSnapshotDigest')
       AND s.coverage_digest = (v_sources ->> 'coverageDigest')
       AND (
         s.format = 'canonical-study-1'
         OR (
           p.id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
               FROM jsonb_array_elements(coalesce(p.execution_manifest -> 'bindings', '[]'::jsonb)) b
              WHERE b ->> 'format' IS DISTINCT FROM 'hive.source-page-index/1'
           )
         )
       )
     ORDER BY s.revision_number DESC, s.created_at DESC, s.id DESC
     LIMIT 1;

    IF FOUND THEN
      SELECT * INTO v_run FROM hive.processing_runs WHERE id = v_revision.processing_run_id;

      IF v_acked_now THEN
        PERFORM hive.record_coverage_acknowledgements(v_run, v_unacked, v_sources ->> 'coverageDigest');
      END IF;

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
    'queuedReadIds', coalesce(v_queued, '[]'::json),
    'queuedReportRunIds', '[]'::json
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_study(
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
  v_revision hive.study_revisions%ROWTYPE;
  v_sources jsonb;
  v_intents jsonb;
  v_ack text := lower(nullif(btrim(coalesce(p_coverage_acknowledgement_digest, '')), ''));
  v_attempt integer;
  v_needs_read integer;
  v_gaps jsonb;
  v_known jsonb;
  v_unacked jsonb;
  v_acked_now boolean := false;
  v_coverage_status text;
  v_acknowledgement text;
  v_acknowledged_at timestamptz;
  v_created boolean := true;
  v_has_revision boolean := false;
BEGIN
    IF p_request_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  v_uid := hive.require_owned_hive(p_hive_id);

  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
      AND h.archived_at IS NULL
      AND h.deleting_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM hive.expire_stale_document_reads(p_hive_id);
  PERFORM hive.expire_stale_processing_runs(p_hive_id);
  PERFORM hive.expire_stale_report_runs(p_hive_id);

  SELECT * INTO v_run FROM hive.processing_runs
   WHERE owner_user_id = v_uid AND request_id = p_request_id;
  IF FOUND THEN
    IF v_run.hive_id <> p_hive_id OR v_run.preparation_mode IS DISTINCT FROM 'REBUILD' THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
    END IF;
    IF v_run.status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED')
       AND NOT hive.processing_run_snapshot_current(v_run) THEN
      UPDATE hive.processing_runs
         SET status = 'FAILED',
             error_code = 'SOURCE_CHANGED',
             error_message_safe = 'Your documents or request changed while rebuilding the study. Rebuild again to use the latest versions.',
             retryable = true,
             lease_expires_at = NULL,
             next_dispatch_at = NULL,
             finished_at = now()
       WHERE id = v_run.id
      RETURNING * INTO v_run;
    END IF;
    SELECT * INTO v_revision FROM hive.study_revisions WHERE processing_run_id = v_run.id;
    v_has_revision := FOUND;
    RETURN json_build_object(
      'processingRun', hive.processing_run_json(v_run),
      'created', false,
      'reusedStudy', false,
      'reportsReady', false,
      'studyRevision', CASE WHEN v_has_revision THEN hive.study_revision_summary_json(v_revision) END,
      'reportRuns', '[]'::json,
      'queuedReadIds', '[]'::json,
      'queuedReportRunIds', '[]'::json
    );
  END IF;

  UPDATE hive.processing_runs r
     SET status = 'FAILED',
         error_code = 'SOURCE_CHANGED',
         error_message_safe = 'Your documents or request changed while rebuilding the study. Rebuild again to use the latest versions.',
         failure_diagnostic = jsonb_build_object(
           'contractVersion', 'failure-diagnostic@1',
           'component', 'analysis',
           'operation', 'rebuild_study',
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

  SELECT * INTO v_run FROM hive.processing_runs
   WHERE hive_id = p_hive_id
     AND kind = 'STUDY_PREPARATION'
     AND status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED');
  IF FOUND THEN
    IF v_run.preparation_mode IS DISTINCT FROM 'REBUILD' THEN
      RAISE EXCEPTION 'analysis_active' USING ERRCODE = 'P0001';
    END IF;
    RETURN json_build_object(
      'processingRun', hive.processing_run_json(v_run),
      'created', false,
      'reusedStudy', false,
      'reportsReady', false,
      'reportRuns', '[]'::json,
      'queuedReadIds', '[]'::json,
      'queuedReportRunIds', '[]'::json
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM hive.study_revisions s
     WHERE s.hive_id = p_hive_id AND s.owner_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'study_not_accepted' USING ERRCODE = 'P0001';
  END IF;

  v_intents := hive.compute_study_intent_snapshot(p_hive_id);
  IF jsonb_array_length(v_intents -> 'intentRequestIds') = 0 THEN
    RAISE EXCEPTION 'intent_missing' USING ERRCODE = 'P0001';
  END IF;

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

  IF v_needs_read > 0
     OR coalesce((v_sources ->> 'activeReadCount')::integer, 0) > 0
     OR jsonb_array_length(coalesce(v_sources -> 'documents', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'documents_not_read' USING ERRCODE = 'P0001';
  END IF;

  v_gaps := hive.classify_coverage_gaps(v_sources);
  SELECT coalesce(jsonb_agg(g ORDER BY g ->> 'key'), '[]'::jsonb) INTO v_known
    FROM jsonb_array_elements(v_gaps) g;
  v_unacked := hive.unacknowledged_material_gaps(p_hive_id, v_known);
  IF jsonb_array_length(v_unacked) > 0 THEN
    IF v_ack IS DISTINCT FROM (v_sources ->> 'coverageDigest') THEN
      RAISE EXCEPTION 'coverage_unacknowledged' USING ERRCODE = 'P0001';
    END IF;
    v_acked_now := true;
  END IF;

  SELECT coalesce(max(r.attempt_number), 0) + 1 INTO v_attempt
    FROM hive.processing_runs r
   WHERE r.hive_id = p_hive_id AND r.kind = 'STUDY_PREPARATION';

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

  BEGIN
    INSERT INTO hive.processing_runs (
      hive_id, owner_user_id, kind, request_id, attempt_number, status, correlation_id, preparation_mode,
      authorized_source_document_ids, intent_request_ids, source_snapshot,
      source_snapshot_digest, intent_snapshot_digest, coverage_digest, coverage_complete,
      coverage_acknowledged, coverage_status, coverage_gaps, coverage_acknowledgement, coverage_acknowledged_at,
      snapshot_frozen_at, next_dispatch_at
    )
    VALUES (
      p_hive_id, v_uid, 'STUDY_PREPARATION', p_request_id, v_attempt, 'QUEUED', p_correlation_id, 'REBUILD',
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
  EXCEPTION
    WHEN unique_violation THEN
      v_created := false;
      SELECT * INTO v_run FROM hive.processing_runs
       WHERE owner_user_id = v_uid AND request_id = p_request_id;
      IF FOUND THEN
        IF v_run.hive_id <> p_hive_id OR v_run.preparation_mode IS DISTINCT FROM 'REBUILD' THEN
          RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001';
        END IF;
      ELSE
        SELECT * INTO v_run FROM hive.processing_runs
         WHERE hive_id = p_hive_id
           AND kind = 'STUDY_PREPARATION'
           AND preparation_mode = 'REBUILD'
           AND status NOT IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED');
        IF NOT FOUND THEN
          RAISE EXCEPTION 'analysis_active' USING ERRCODE = 'P0001';
        END IF;
      END IF;
  END;

  IF v_created AND v_acked_now THEN
    PERFORM hive.record_coverage_acknowledgements(v_run, v_unacked, v_sources ->> 'coverageDigest');
  END IF;

  RETURN json_build_object(
    'processingRun', hive.processing_run_json(v_run),
    'created', v_created,
    'reusedStudy', false,
    'reportsReady', false,
    'queuedReadIds', '[]'::json,
    'queuedReportRunIds', '[]'::json
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_study_coverage(
  p_hive_id uuid,
  p_processing_run_id uuid,
  p_coverage_digest text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run hive.processing_runs%ROWTYPE;
  v_digest text := lower(nullif(btrim(coalesce(p_coverage_digest, '')), ''));
BEGIN
    v_uid := hive.require_owned_hive(p_hive_id);

  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
      AND h.archived_at IS NULL
      AND h.deleting_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM hive.expire_stale_processing_runs(p_hive_id);

  SELECT * INTO v_run FROM hive.processing_runs
   WHERE id = p_processing_run_id AND hive_id = p_hive_id AND owner_user_id = v_uid
     AND kind = 'STUDY_PREPARATION'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_run.status <> 'AWAITING_ACKNOWLEDGEMENT' THEN
    IF v_run.coverage_acknowledgement = 'OWNER' AND v_run.coverage_digest = v_digest THEN
      RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'resumed', false);
    END IF;
    RAISE EXCEPTION 'processing_run_not_awaiting' USING ERRCODE = 'P0001';
  END IF;
  IF v_digest IS DISTINCT FROM v_run.coverage_digest THEN
    RAISE EXCEPTION 'coverage_unacknowledged' USING ERRCODE = 'P0001';
  END IF;

  IF NOT hive.processing_run_snapshot_current(v_run) THEN
    UPDATE hive.processing_runs
       SET status = 'FAILED',
           error_code = 'SOURCE_CHANGED',
           error_message_safe = 'Your documents or request changed while analyzing. Analyze again to use the latest versions.',
           retryable = true,
           lease_expires_at = NULL,
           next_dispatch_at = NULL,
           finished_at = now()
     WHERE id = v_run.id
    RETURNING * INTO v_run;
    RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'resumed', false, 'sourceChanged', true);
  END IF;

  PERFORM hive.record_coverage_acknowledgements(v_run, v_run.coverage_gaps, v_run.coverage_digest);

  UPDATE hive.processing_runs
     SET status = 'EXTRACTING',
         coverage_acknowledgement = 'OWNER',
         coverage_acknowledged = true,
         coverage_acknowledged_at = now(),
         started_at = coalesce(started_at, now()),
         stage_attempt = 1,
         lease_expires_at = NULL,
         next_dispatch_at = now() + interval '30 seconds'
   WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN json_build_object('processingRun', hive.processing_run_json(v_run), 'resumed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_intent_request(
  p_hive_id uuid,
  p_intent_text text,
  p_client_request_id uuid,
  p_audience text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_text text := btrim(coalesce(p_intent_text, ''));
  v_audience text := nullif(btrim(regexp_replace(coalesce(p_audience, ''), '\s+', ' ', 'g')), '');
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
  IF v_audience IS NOT NULL AND char_length(v_audience) > 200 THEN
    RAISE EXCEPTION 'invalid_request:audience_length' USING ERRCODE = '22023';
  END IF;
    v_uid := hive.require_owned_hive(p_hive_id);

  INSERT INTO hive.intent_requests (hive_id, owner_user_id, intent_text, client_request_id, audience)
  VALUES (p_hive_id, v_uid, v_text, p_client_request_id, v_audience)
  ON CONFLICT ON CONSTRAINT uq_intent_requests__owner_client_request DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_created := true;
  ELSE
    SELECT * INTO v_row
      FROM hive.intent_requests r
     WHERE r.owner_user_id = v_uid AND r.client_request_id = p_client_request_id;
    IF v_row.hive_id IS DISTINCT FROM p_hive_id
       OR v_row.intent_text IS DISTINCT FROM v_text
       OR v_row.audience IS DISTINCT FROM v_audience THEN
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

CREATE OR REPLACE FUNCTION public.list_hive_source_documents(p_hive_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_docs json;
BEGIN
  PERFORM hive.require_hive_member(p_hive_id);
  SELECT h.owner_user_id INTO v_owner
    FROM hive.hives h
   WHERE h.id = p_hive_id AND h.archived_at IS NULL;

  SELECT COALESCE(json_agg(row ORDER BY row->>'createdAt' DESC), '[]'::json)
    INTO v_docs
    FROM (
      SELECT json_build_object(
        'id', d.id,
        'hiveId', d.case_id,
        'clientRequestId', COALESCE(u.client_request_id, d.id),
        'fileName', d.original_filename,
        'mimeType', d.mime_type,
        'byteSize', d.byte_size,
        'status', 'REGISTERED',
        'failureReason', NULL,
        'scanStatus', 'UNKNOWN_TO_SCANNER',
        'readStatus', COALESCE(d.read_status, 'PENDING'),
        'registeredAt', d.created_at,
        'createdAt', d.created_at,
        'updatedAt', d.created_at,
        'canonicalGapId', d.canonical_gap_id,
        'canonicalGapStudyRevisionId', d.canonical_gap_study_revision_id,
        'canonicalGapTitle', d.canonical_gap_title
      ) AS row
        FROM hive.source_documents d
        LEFT JOIN hive.upload_operations u
          ON u.source_document_id = d.id AND u.status = 'REGISTERED'
       WHERE d.case_id = p_hive_id
         AND d.owner_user_id = v_owner
         AND d.lifecycle_status = 'ACTIVE'
         AND d.deleted_at IS NULL
      UNION ALL
      SELECT json_build_object(
        'id', u.source_document_id,
        'hiveId', u.case_id,
        'clientRequestId', u.client_request_id,
        'fileName', u.original_filename,
        'mimeType', u.mime_type,
        'byteSize', u.byte_size,
        'status', CASE WHEN u.status = 'FAILED' THEN 'REJECTED' ELSE 'PENDING' END,
        'failureReason', CASE WHEN u.status = 'FAILED' THEN 'TYPE_MISMATCH' ELSE NULL END,
        'scanStatus', 'UNKNOWN_TO_SCANNER',
        'readStatus', 'PENDING',
        'registeredAt', NULL,
        'createdAt', u.created_at,
        'updatedAt', u.updated_at,
        'canonicalGapId', NULL,
        'canonicalGapStudyRevisionId', NULL,
        'canonicalGapTitle', NULL
      ) AS row
        FROM hive.upload_operations u
       WHERE u.case_id = p_hive_id
         AND u.owner_user_id = v_owner
         AND u.status IN ('PENDING', 'STORED')
         AND NOT EXISTS (
           SELECT 1 FROM hive.source_documents d WHERE d.id = u.source_document_id
         )
    ) combined;

  RETURN json_build_object('sourceDocuments', v_docs);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_hive(p_hive_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hive_owner uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  PERFORM hive.require_hive_member(p_hive_id);
  SELECT h.owner_user_id INTO v_hive_owner FROM hive.hives h WHERE h.id = p_hive_id;
  SELECT m.role
    INTO v_role
    FROM hive.hive_members m
   WHERE m.hive_id = p_hive_id AND m.user_id = v_uid AND m.state = 'active';
  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  UPDATE hive.hive_members
     SET state = 'left', updated_at = now()
   WHERE hive_id = p_hive_id AND user_id = v_uid;
  PERFORM hive.write_membership_audit(
    p_hive_id, v_hive_owner, 'member_left',
    jsonb_build_object('userId', v_uid)
  );
END;
$$;

COMMIT;
