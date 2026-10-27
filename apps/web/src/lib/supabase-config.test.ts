import { describe, expect, it } from "vitest";

import {
  assertBrowserSafeSupabaseAnonKey,
  assertPublicSupabaseUrl,
  getPublicSupabaseConfig,
} from "./supabase-config";

describe("supabase-config", () => {
  it("accepts valid supabase.co HTTPS URLs and publishable anon keys", () => {
    expect(() =>
      assertPublicSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co"),
    ).not.toThrow();
    expect(() =>
      assertBrowserSafeSupabaseAnonKey("sb_publishable_testKey123"),
    ).not.toThrow();

    const config = getPublicSupabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_testKey123",
    });
    expect(config.url).toBe("https://abcdefghijklmnopqrst.supabase.co");
    expect(config.anonKey).toBe("sb_publishable_testKey123");
  });

  it("rejects service_role, sb_secret_, and non-HTTPS URLs", () => {
    expect(() =>
      assertBrowserSafeSupabaseAnonKey("sb_secret_superSecretKey"),
    ).toThrow(/secret or service-role/);
    expect(() =>
      assertBrowserSafeSupabaseAnonKey("service_role_key_value"),
    ).toThrow(/secret or service-role/);
    expect(() =>
      assertPublicSupabaseUrl("http://abcdefghijklmnopqrst.supabase.co"),
    ).toThrow(/HTTPS/);
    expect(() => assertPublicSupabaseUrl("https://evil.example.com")).toThrow(
      /supabase\.co/,
    );
  });
});
