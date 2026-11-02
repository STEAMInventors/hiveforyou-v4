-- Deterministic investigation questions (no hive-plan/1 model stage).
-- Allows DEVELOPING_QUESTIONS -> BUILDING_PROMPT; keeps PLANNING_INVESTIGATION for in-flight runs.

CREATE OR REPLACE FUNCTION hive.enforce_processing_run_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hive, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.hive_id IS DISTINCT FROM OLD.hive_id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.intent_request_ids IS DISTINCT FROM OLD.intent_request_ids
     OR NEW.intent_snapshot_digest IS DISTINCT FROM OLD.intent_snapshot_digest
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;

  IF OLD.source_snapshot IS NOT NULL AND (
       NEW.authorized_source_document_ids IS DISTINCT FROM OLD.authorized_source_document_ids
       OR NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot
       OR NEW.source_snapshot_digest IS DISTINCT FROM OLD.source_snapshot_digest
       OR NEW.coverage_digest IS DISTINCT FROM OLD.coverage_digest
       OR NEW.coverage_complete IS DISTINCT FROM OLD.coverage_complete
       OR NEW.coverage_status IS DISTINCT FROM OLD.coverage_status
       OR NEW.coverage_gaps IS DISTINCT FROM OLD.coverage_gaps
       OR NEW.snapshot_frozen_at IS DISTINCT FROM OLD.snapshot_frozen_at) THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;
  IF OLD.source_snapshot IS NOT NULL AND (
       NEW.coverage_acknowledgement IS DISTINCT FROM OLD.coverage_acknowledgement
       OR NEW.coverage_acknowledged_at IS DISTINCT FROM OLD.coverage_acknowledged_at
       OR NEW.coverage_acknowledged IS DISTINCT FROM OLD.coverage_acknowledged)
     AND NOT (OLD.status = 'AWAITING_ACKNOWLEDGEMENT' AND OLD.coverage_acknowledgement = 'PENDING'
              AND NEW.status = 'UNDERSTANDING_REQUEST' AND NEW.coverage_acknowledgement = 'OWNER'
              AND NEW.coverage_acknowledged AND NEW.coverage_acknowledged_at IS NOT NULL) THEN
    RAISE EXCEPTION 'hive.processing_runs identity and snapshot columns are immutable';
  END IF;

  IF OLD.status IN ('SUCCEEDED', 'NEEDS_CLARIFICATION', 'FAILED') THEN
    RAISE EXCEPTION 'processing_run_finished' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'QUEUED' AND NEW.status IN ('READING_DOCUMENTS', 'UNDERSTANDING_REQUEST', 'NEEDS_CLARIFICATION', 'FAILED'))
    OR (OLD.status = 'READING_DOCUMENTS' AND NEW.status IN ('AWAITING_ACKNOWLEDGEMENT', 'UNDERSTANDING_REQUEST', 'FAILED'))
    OR (OLD.status = 'AWAITING_ACKNOWLEDGEMENT' AND NEW.status IN ('UNDERSTANDING_REQUEST', 'FAILED'))
    OR (OLD.status = 'UNDERSTANDING_REQUEST' AND NEW.status IN ('IDENTIFYING_DOMAIN', 'FAILED'))
    OR (OLD.status = 'IDENTIFYING_DOMAIN' AND NEW.status IN ('DEVELOPING_QUESTIONS', 'FAILED'))
    OR (OLD.status = 'DEVELOPING_QUESTIONS' AND NEW.status IN ('PLANNING_INVESTIGATION', 'BUILDING_PROMPT', 'FAILED'))
    OR (OLD.status = 'PLANNING_INVESTIGATION' AND NEW.status IN ('BUILDING_PROMPT', 'FAILED'))
    OR (OLD.status = 'BUILDING_PROMPT' AND NEW.status IN ('SAVING', 'FAILED'))
    OR (OLD.status = 'SAVING' AND NEW.status IN ('INVESTIGATING', 'FAILED'))
    OR (OLD.status = 'INVESTIGATING' AND NEW.status IN ('VERIFYING_EVIDENCE', 'FAILED'))
    OR (OLD.status = 'VERIFYING_EVIDENCE' AND NEW.status IN ('ACCEPTING_STUDY', 'FAILED'))
    OR (OLD.status = 'ACCEPTING_STUDY' AND NEW.status IN ('SUCCEEDED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'processing_run_transition_invalid' USING ERRCODE = 'P0001';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
