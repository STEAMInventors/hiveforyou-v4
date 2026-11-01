export const VAULT_ADMIN_CONFIG_DIAGNOSTIC_REASONS = [
  "vault_admin_url_missing",
  "vault_admin_secret_missing",
] as const;

export type VaultAdminConfigDiagnosticReason =
  (typeof VAULT_ADMIN_CONFIG_DIAGNOSTIC_REASONS)[number];

export class VaultAdminConfigError extends Error {
  override readonly name = "VaultAdminConfigError";

  constructor(readonly diagnosticReason: VaultAdminConfigDiagnosticReason) {
    super("vault_admin_config_invalid");
  }
}
