import { describe, expect, it } from "vitest";

import { authEmailRedirectTo } from "./auth-callback-url";

describe("authEmailRedirectTo", () => {
  it("embeds a safe next path for the auth callback", () => {
    const url = new URL(authEmailRedirectTo("https://app.example.test", "/hives/x"));
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("next")).toBe("/hives/x");
  });

  it("falls back when next is an open redirect", () => {
    const url = new URL(authEmailRedirectTo("https://app.example.test", "https://evil.example"));
    expect(url.searchParams.get("next")).toBe("/hives");
  });
});