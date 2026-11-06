-- Hive permanent deletion: allow CASCADE removal of hive.doc_extractions (V5 cache).
-- Root cause: trg_doc_extractions__immutable_delete blocked DELETE during hive.hives ON DELETE CASCADE.
-- canonical-study-1 study_revisions, study-view reports, and other hive-scoped rows already
-- cascade from hive.hives; complete_hive_deletion deletes the Hive row after storage cleanup.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

DROP TRIGGER IF EXISTS trg_doc_extractions__immutable_delete ON hive.doc_extractions;

COMMENT ON TABLE hive.doc_extractions IS
  'Verified hive.doc-extraction/1 payloads with final ids; insert-only cache keyed by document content, prompt and model. Rows may be deleted when the owning Hive or source document is removed.';

COMMIT;
