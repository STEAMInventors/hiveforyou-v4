-- FL-5: RLS policies use active hive membership (is_hive_member / is_hive_owner).
BEGIN;

ALTER TABLE hive.hive_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.hive_members FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.hive_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.hive_invitations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_hive_members__select ON hive.hive_members;
CREATE POLICY pol_hive_members__select ON hive.hive_members
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_hives__select__owner ON hive.hives;
CREATE POLICY pol_hives__select__member ON hive.hives
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(id));

DROP POLICY IF EXISTS pol_hives__update__owner_deletion ON hive.hives;
CREATE POLICY pol_hives__update__owner_deletion ON hive.hives
  FOR UPDATE TO authenticated
  USING (hive.is_hive_owner(id) AND archived_at IS NULL)
  WITH CHECK (hive.is_hive_owner(id));

DROP POLICY IF EXISTS pol_intent_requests__select__owner ON hive.intent_requests;
CREATE POLICY pol_intent_requests__select__member ON hive.intent_requests
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_intent_requests__insert__owner ON hive.intent_requests;
CREATE POLICY pol_intent_requests__insert__member ON hive.intent_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    hive.is_hive_member(hive_id)
    AND EXISTS (
      SELECT 1 FROM hive.hives h
       WHERE h.id = hive_id AND h.archived_at IS NULL AND h.deleting_at IS NULL
    )
  );

DROP POLICY IF EXISTS hive_cases_select_own ON hive.cases;
CREATE POLICY hive_cases_select_member ON hive.cases
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(id) AND deleted_at IS NULL);

DROP POLICY IF EXISTS hive_source_documents_select_own ON hive.source_documents;
CREATE POLICY hive_source_documents_select_member ON hive.source_documents
  FOR SELECT TO authenticated
  USING (
    source_documents.deleted_at IS NULL
    AND source_documents.lifecycle_status <> 'SOFT_DELETED'
    AND hive.is_hive_member(case_id)
  );

DROP POLICY IF EXISTS hive_upload_operations_select_own ON hive.upload_operations;
CREATE POLICY hive_upload_operations_select_member ON hive.upload_operations
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(case_id));

DROP POLICY IF EXISTS hive_audit_events_select_own ON hive.audit_events;
CREATE POLICY hive_audit_events_select_member ON hive.audit_events
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(case_id));

DROP POLICY IF EXISTS pol_document_pages__select__owner ON hive.document_pages;
CREATE POLICY pol_document_pages__select__member ON hive.document_pages
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_document_reads__select__owner ON hive.document_reads;
CREATE POLICY pol_document_reads__select__member ON hive.document_reads
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_processing_runs__select__owner ON hive.processing_runs;
CREATE POLICY pol_processing_runs__select__member ON hive.processing_runs
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_study_prompt_previews__select__owner ON hive.study_prompt_previews;
CREATE POLICY pol_study_prompt_previews__select__member ON hive.study_prompt_previews
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_coverage_acknowledgements__select__owner ON hive.coverage_acknowledgements;
CREATE POLICY pol_coverage_acknowledgements__select__member ON hive.coverage_acknowledgements
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_canonical_studies__select__owner ON hive.canonical_studies;
CREATE POLICY pol_canonical_studies__select__member ON hive.canonical_studies
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_study_revisions__select__owner ON hive.study_revisions;
CREATE POLICY pol_study_revisions__select__member ON hive.study_revisions
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_report_runs__select__owner ON hive.report_runs;
CREATE POLICY pol_report_runs__select__member ON hive.report_runs
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_reports__select__owner ON hive.reports;
CREATE POLICY pol_reports__select__member ON hive.reports
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_doc_extractions__select__owner ON hive.doc_extractions;
CREATE POLICY pol_doc_extractions__select__member ON hive.doc_extractions
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_doc_extraction_ranges__select__owner ON hive.doc_extraction_ranges;
CREATE POLICY pol_doc_extraction_ranges__select__member ON hive.doc_extraction_ranges
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

DROP POLICY IF EXISTS pol_doc_extraction_attempts__select__owner ON hive.doc_extraction_attempts;
CREATE POLICY pol_doc_extraction_attempts__select__member ON hive.doc_extraction_attempts
  FOR SELECT TO authenticated
  USING (hive.is_hive_member(hive_id));

COMMIT;