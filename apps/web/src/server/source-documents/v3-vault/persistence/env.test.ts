import { describe, expect, it } from "vitest";

import { loadSupabaseAdminEnv } from "./env";
import { VaultAdminConfigError } from "./vault-admin-config-error";

describe("loadSupabaseAdminEnv", () => {
  it("uses NEXT_PUBLIC_SUPABASE_URL when SUPABASE_URL is unset", () => {
    const env = loadSupabaseAdminEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "service-role-key",
    });
    expect(env.SUPABASE_URL).toBe("https://project.supabase.co");
    expect(env.SUPABASE_SECRET_KEY).toBe("service-role-key");
  });

  it("treats empty SUPABASE_URL as missing and falls back to NEXT_PUBLIC", () => {
    const env = loadSupabaseAdminEnv({
      SUPABASE_URL: "   ",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-key",
    });
    expect(env.SUPABASE_URL).toBe("https://project.supabase.co");
    expect(env.SUPABASE_SECRET_KEY).toBe("legacy-key");
  });

  it("throws VaultAdminConfigError when the project URL is missing", () => {
    expect(() => loadSupabaseAdminEnv({ SUPABASE_SECRET_KEY: "key" })).toThrow(
      VaultAdminConfigError,
    );
    try {
      loadSupabaseAdminEnv({ SUPABASE_SECRET_KEY: "key" });
    } catch (error) {
      expect(error).toBeInstanceOf(VaultAdminConfigError);
      expect((error as VaultAdminConfigError).diagnosticReason).toBe("vault_admin_url_missing");
    }
  });

  it("throws VaultAdminConfigError when the service secret is missing", () => {
    expect(() =>
      loadSupabaseAdminEnv({ SUPABASE_URL: "https://project.supabase.co" }),
    ).toThrow(VaultAdminConfigError);
    try {
      loadSupabaseAdminEnv({ SUPABASE_URL: "https://project.supabase.co" });
    } catch (error) {
      expect((error as VaultAdminConfigError).diagnosticReason).toBe("vault_admin_secret_missing");
    }
  });
});
