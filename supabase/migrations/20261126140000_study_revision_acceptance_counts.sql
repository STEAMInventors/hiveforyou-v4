-- Stage 5E.3 — Read acceptance counts without turning a missing count into zero.
-- Replaces hive.study_revision_summary_json only. Does not update study_revisions,
-- reports, or domain_pack_selections.
--
-- A canonical study stores verifiedFacts. documentFindings: 0 on that payload is
-- not a measured claim count. An investigation revision still uses its document
-- finding array or its recorded documentFindings count, including a real zero.
--
-- Do not apply to a live database without explicit founder authorization.

BEGIN;

CREATE OR REPLACE FUNCTION hive.study_revision_summary_json(s hive.study_revisions)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = hive, pg_temp
AS $$
  SELECT json_build_object(
    'id', s.id,
    'canonicalStudyId', s.canonical_study_id,
    'revisionNumber', s.revision_number,
    'predecessorRevisionId', s.predecessor_revision_id,
    'processingRunId', s.processing_run_id,
    'format', s.format,
    'coverageComplete', s.coverage_complete,
    'coverageStatus', s.coverage_status,
    'coverageGaps', s.coverage_gaps,
    'coverageAcknowledgement', s.coverage_acknowledgement,
    'audienceConfiguration', s.audience_configuration,
    'counts', s.verification -> 'counts',
    'sourceCount', CASE
      WHEN coalesce(s.verification #>> '{counts,documents}', '') ~ '^[0-9]+$'
        THEN (s.verification #>> '{counts,documents}')::integer
      WHEN jsonb_typeof(s.investigation -> 'documents') = 'array'
        THEN jsonb_array_length(s.investigation -> 'documents')
      WHEN jsonb_typeof(s.verification -> 'documentCoverage') = 'array'
        THEN jsonb_array_length(s.verification -> 'documentCoverage')
      ELSE NULL
    END,
    'documentFindingCount', CASE
      WHEN coalesce(s.verification #>> '{counts,verifiedFacts}', '') ~ '^[0-9]+$'
        THEN (s.verification #>> '{counts,verifiedFacts}')::integer
      WHEN jsonb_typeof(s.investigation -> 'documentFindings') = 'array'
        THEN jsonb_array_length(s.investigation -> 'documentFindings')
      WHEN s.format IS DISTINCT FROM 'canonical-study-1'
           AND coalesce(s.verification #>> '{counts,documentFindings}', '') ~ '^[0-9]+$'
        THEN (s.verification #>> '{counts,documentFindings}')::integer
      ELSE NULL
    END,
    'investigationEngine', CASE
      WHEN coalesce(s.verification #>> '{counts,investigationEngine}', '') ~ '^[[:alnum:]_./:-]{1,80}$'
        THEN s.verification #>> '{counts,investigationEngine}'
      WHEN jsonb_typeof(s.investigation -> 'questionOrder') = 'array'
           AND EXISTS (
             SELECT 1
               FROM jsonb_array_elements_text(s.investigation -> 'questionOrder') AS item(value)
              WHERE item.value LIKE 'pack-digest:%'
           )
        THEN 'hive.domain-investigation/1'
      WHEN coalesce(s.investigation #>> '{packRef,id}', '') <> ''
        THEN 'hive-canonicalize/1'
      WHEN s.format = 'investigation-1'
        THEN 'hive.study-investigation/1'
      ELSE NULL
    END,
    'domainPackId', CASE
      WHEN coalesce(s.verification #>> '{counts,domainPackId}', '') ~ '^[[:alnum:]_./:-]{1,80}$'
        THEN s.verification #>> '{counts,domainPackId}'
      WHEN coalesce(s.investigation #>> '{packRef,id}', '') ~ '^[[:alnum:]_./:-]{1,80}$'
        THEN s.investigation #>> '{packRef,id}'
      ELSE NULL
    END,
    'domainPackVersion', CASE
      WHEN coalesce(s.verification #>> '{counts,domainPackVersion}', '') ~ '^[[:alnum:]_./:-]{1,32}$'
        THEN s.verification #>> '{counts,domainPackVersion}'
      WHEN coalesce(s.investigation #>> '{packRef,version}', '') ~ '^[[:alnum:]_./:-]{1,32}$'
        THEN s.investigation #>> '{packRef,version}'
      ELSE NULL
    END,
    'revisionStatus', 'accepted',
    'createdAt', s.created_at
  );
$$;

COMMENT ON FUNCTION hive.study_revision_summary_json(hive.study_revisions) IS
  'Owner summary of one accepted revision. A missing finding or source count is null, not zero. Does not rewrite the revision.';

COMMIT;
