-- SECURITY INVOKER chain: public.get_study_tab_view invokes hive.build_study_tab_view, which may call
-- hive.canonical_study_cited_fact_ids. Both helpers must be EXECUTE-granted to authenticated so
-- the owner session can run the RPC (mirrors grants on public.get_study_tab_view).
-- Idempotent: GRANT EXECUTE is repeatable.

BEGIN;

GRANT EXECUTE ON FUNCTION hive.build_study_tab_view(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION hive.canonical_study_cited_fact_ids(jsonb) TO authenticated;

COMMIT;
