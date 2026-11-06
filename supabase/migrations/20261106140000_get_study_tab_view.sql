-- Study tab: canonical study JSON + cited extraction facts + referenced documents + optional writer output.
-- Intent from hive.intent_requests via the revision's processing_run.intent_request_ids (not study_prompt_previews).
-- Primary entry: public.get_study_tab_view (SECURITY INVOKER). Fallback: public.get_study_tab_view_definer (same ownership check as get_study_preparation).
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fact ids cited by hive.canonical-study/1 (deduplicated JSON array of strings).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.canonical_study_cited_fact_ids(p_study jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = hive, public, pg_temp
AS $$
  SELECT coalesce(
    (
      SELECT jsonb_agg(to_jsonb(u.fid) ORDER BY u.fid)
        FROM (
          SELECT DISTINCT fid
            FROM (
              SELECT jsonb_array_elements_text(
                       coalesce(elem->'supportingFactIds', '[]'::jsonb)
                       || coalesce(elem->'contradictingFactIds', '[]'::jsonb)
                       || coalesce(elem->'updatingFactIds', '[]'::jsonb)
                     ) AS fid
                FROM jsonb_array_elements(coalesce(p_study->'spine', '[]'::jsonb)) elem
              UNION ALL
              SELECT jsonb_array_elements_text(coalesce(elem->'factIds', '[]'::jsonb)) AS fid
                FROM jsonb_array_elements(coalesce(p_study->'outsideSpine', '[]'::jsonb)) elem
              UNION ALL
              SELECT jsonb_array_elements_text(coalesce(elem->'factIds', '[]'::jsonb)) AS fid
                FROM jsonb_array_elements(coalesce(p_study->'conflicts', '[]'::jsonb)) elem
              UNION ALL
              SELECT jsonb_array_elements_text(coalesce(elem->'factIds', '[]'::jsonb)) AS fid
                FROM jsonb_array_elements(coalesce(p_study->'timeline', '[]'::jsonb)) elem
            ) u
           WHERE length(btrim(coalesce(fid, ''))) > 0
        ) u
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION hive.canonical_study_cited_fact_ids(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hive.canonical_study_cited_fact_ids(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Internal payload (caller supplies verified owner uid).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hive.build_study_tab_view(p_hive_id uuid, p_owner uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_revision hive.study_revisions%ROWTYPE;
  v_has_revision boolean;
  v_run hive.processing_runs%ROWTYPE;
  v_has_run boolean;
  v_study jsonb;
  v_fact_ids jsonb;
  v_intent text;
  v_facts json;
  v_ref_docs json;
  v_writer jsonb;
  v_narrative jsonb;
  v_block_names jsonb;
BEGIN
  SELECT s.* INTO v_revision FROM hive.study_revisions s
    JOIN hive.canonical_studies c ON c.id = s.canonical_study_id
   WHERE c.hive_id = p_hive_id AND s.id = c.current_revision_id;
  v_has_revision := FOUND;

  IF NOT v_has_revision THEN
    RETURN json_build_object(
      'revision', NULL,
      'canonicalStudy', NULL,
      'intent', NULL,
      'facts', '[]'::json,
      'referencedDocuments', '[]'::json,
      'writerOutput', NULL,
      'narrativeSections', NULL,
      'narrativeBlockNames', NULL
    );
  END IF;

  SELECT * INTO v_run FROM hive.processing_runs WHERE id = v_revision.processing_run_id;
  v_has_run := FOUND;

  IF v_has_run AND v_run.intent_request_ids IS NOT NULL AND array_length(v_run.intent_request_ids, 1) IS NOT NULL THEN
    SELECT string_agg(btrim(i.intent_text), E'\n\n' ORDER BY i.created_at, i.id)
      INTO v_intent
      FROM hive.intent_requests i
     WHERE i.hive_id = p_hive_id
       AND i.owner_user_id = p_owner
       AND i.id = ANY (v_run.intent_request_ids)
       AND btrim(coalesce(i.intent_text, '')) <> '';
  END IF;

  IF v_revision.format = 'canonical-study-1'
     AND jsonb_typeof(v_revision.investigation) = 'object'
     AND v_revision.investigation->>'schema' = 'hive.canonical-study/1'
     AND v_has_run
     AND jsonb_typeof(v_run.source_snapshot) = 'object' THEN

    v_study := v_revision.investigation;
    v_fact_ids := hive.canonical_study_cited_fact_ids(v_study);

    WITH snap AS (
      SELECT (d->>'sourceDocumentId')::uuid AS doc_id,
             lower(btrim(d->>'pageSetDigest')) AS content_digest
        FROM jsonb_array_elements(coalesce(v_run.source_snapshot->'documents', '[]'::jsonb)) d
    ),
    extr AS (
      SELECT e.extraction AS ex, e.source_document_id
        FROM hive.doc_extractions e
        JOIN snap ON snap.doc_id = e.source_document_id AND snap.content_digest = e.content_digest
       WHERE e.hive_id = p_hive_id
    ),
    fact_pick AS (
      SELECT DISTINCT ON ((f->>'id'))
             ex,
             f AS fact_json
        FROM extr
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(ex->'facts', '[]'::jsonb)) f
       WHERE f->>'id' IN (SELECT jsonb_array_elements_text(v_fact_ids))
       ORDER BY f->>'id', source_document_id
    )
    SELECT coalesce(json_agg(
             json_build_object(
               'id', fact_json->>'id',
               'sourceDocumentId', ex->>'documentId',
               'pageNumber', coalesce((fact_json->'evidence'->0->>'page')::integer, 0),
               'quote', coalesce(fact_json->'evidence'->0->>'quote', ''),
               'valueAsWritten', fact_json->>'valueAsWritten',
               'subject', fact_json->>'subject',
               'attribute', fact_json->>'attribute'
             )
             ORDER BY fact_json->>'id'
           ), '[]'::json)
      INTO v_facts
      FROM fact_pick;

    WITH snap AS (
      SELECT (d->>'sourceDocumentId')::uuid AS doc_id,
             lower(btrim(d->>'pageSetDigest')) AS content_digest
        FROM jsonb_array_elements(coalesce(v_run.source_snapshot->'documents', '[]'::jsonb)) d
    ),
    extr AS (
      SELECT e.extraction AS ex, e.source_document_id
        FROM hive.doc_extractions e
        JOIN snap ON snap.doc_id = e.source_document_id AND snap.content_digest = e.content_digest
       WHERE e.hive_id = p_hive_id
    ),
    ref_rows AS (
      SELECT DISTINCT extr.source_document_id AS supplying_document_id,
             btrim(r->>'description') AS description,
             coalesce((r->>'page')::integer, 1) AS page,
             coalesce(r->>'quote', '') AS quote
        FROM extr
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(extr.ex->'referencedDocuments', '[]'::jsonb)) r
       WHERE length(btrim(coalesce(r->>'description', ''))) > 0
    )
    SELECT coalesce(json_agg(
             json_build_object(
               'sourceDocumentId', supplying_document_id::text,
               'description', description,
               'page', page,
               'quote', quote
             )
             ORDER BY supplying_document_id::text, description, page
           ), '[]'::json)
      INTO v_ref_docs
      FROM ref_rows;

  ELSIF v_revision.format = 'canonical-study-1'
        AND jsonb_typeof(v_revision.investigation) = 'object'
        AND v_revision.investigation->>'schema' = 'hive.canonical-study/1' THEN
    v_study := v_revision.investigation;
    v_facts := '[]'::json;
    v_ref_docs := '[]'::json;
  ELSE
    v_study := NULL;
    v_facts := '[]'::json;
    v_ref_docs := '[]'::json;
  END IF;

  SELECT p.writer_output,
         p.view->'sections',
         (
           SELECT coalesce(jsonb_agg(b->>'name' ORDER BY ord), '[]'::jsonb)
             FROM jsonb_array_elements(coalesce(p.view->'blocks', '[]'::jsonb)) WITH ORDINALITY AS t(b, ord)
            WHERE jsonb_typeof(b) = 'object' AND b ? 'name' AND length(btrim(coalesce(b->>'name', ''))) > 0
         )
    INTO v_writer, v_narrative, v_block_names
    FROM hive.reports p
   WHERE p.hive_id = p_hive_id
     AND p.owner_user_id = p_owner
     AND p.study_revision_id = v_revision.id
     AND p.view->>'schema' = 'hive.study-view/1'
     AND jsonb_typeof(p.writer_output) = 'object'
     AND p.writer_output->>'schema' = 'hive.write-run/1'
   ORDER BY (p.audience = 'CUSTOMER') DESC, p.created_at DESC, p.id DESC
   LIMIT 1;

  RETURN json_build_object(
    'revision', json_build_object(
      'id', v_revision.id,
      'revisionNumber', v_revision.revision_number,
      'format', v_revision.format
    ),
    'canonicalStudy', CASE WHEN v_study IS NOT NULL THEN (v_study::json) ELSE NULL END,
    'intent', v_intent,
    'facts', coalesce(v_facts, '[]'::json),
    'referencedDocuments', coalesce(v_ref_docs, '[]'::json),
    'writerOutput', CASE WHEN v_writer IS NOT NULL THEN (v_writer::json) ELSE NULL END,
    'narrativeSections', CASE
      WHEN v_narrative IS NOT NULL AND jsonb_typeof(v_narrative) = 'array' THEN (v_narrative::json)
      ELSE NULL
    END,
    'narrativeBlockNames', CASE
      WHEN v_block_names IS NOT NULL AND jsonb_typeof(v_block_names) = 'array' THEN (v_block_names::json)
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION hive.build_study_tab_view(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hive.build_study_tab_view(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- public.get_study_tab_view — SECURITY INVOKER (RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_study_tab_view(p_hive_id uuid)
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
  IF NOT EXISTS (
    SELECT 1 FROM hive.hives h
     WHERE h.id = p_hive_id
       AND h.owner_user_id = v_uid
       AND h.archived_at IS NULL
       AND h.deleting_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN hive.build_study_tab_view(p_hive_id, v_uid);
END;
$$;

-- ---------------------------------------------------------------------------
-- public.get_study_tab_view_definer — fallback if INVOKER joins ever lack RLS
-- ---------------------------------------------------------------------------
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
  v_uid := hive.require_owned_hive(p_hive_id);
  RETURN hive.build_study_tab_view(p_hive_id, v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.get_study_tab_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_tab_view(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_study_tab_view_definer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_tab_view_definer(uuid) TO authenticated;

COMMIT;
