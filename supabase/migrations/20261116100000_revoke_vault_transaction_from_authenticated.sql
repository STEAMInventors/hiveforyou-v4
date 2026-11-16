-- QF-1a-8: `public.apply_vault_transaction(jsonb)` is SECURITY DEFINER and writes
-- cases / source_documents / upload_operations / audit with caller-supplied owner ids and no
-- authorization check. The app invokes it only via the admin client
-- (`apps/web/src/server/source-documents/hive-vault-upload-adapter.ts` ~L1113).
-- AB already ran REVOKE in production; this migration records it.
-- Do not apply to a live Supabase project without explicit founder authorization.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.apply_vault_transaction(jsonb) FROM authenticated;

-- pgTAP-style grant assertions (no plan/finish — migration-safe)
DO $assert$
BEGIN
  IF has_function_privilege('authenticated', 'public.apply_vault_transaction(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'apply_vault_transaction: authenticated must not have EXECUTE';
  END IF;
  IF has_function_privilege('anon', 'public.apply_vault_transaction(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'apply_vault_transaction: anon must not have EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.apply_vault_transaction(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'apply_vault_transaction: service_role must have EXECUTE';
  END IF;
END;
$assert$;

COMMIT;