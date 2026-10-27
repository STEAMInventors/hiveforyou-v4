import { describe, expect, it } from "vitest";

import {
  CANONICAL_APP_ORIGIN,
  isTrustedAppHostname,
  resolveAppOrigin,
} from "./app-origin";

describe("app-origin", () => {
  it("accepts localhost and V4 Vercel preview/canonical hostnames", () => {
    expect(isTrustedAppHostname("localhost")).toBe(true);
    expect(isTrustedAppHostname("127.0.0.1")).toBe(true);
    expect(isTrustedAppHostname("hiveforyou-v4.vercel.app")).toBe(true);
    expect(isTrustedAppHostname("hiveforyou-v4-git-main.vercel.app")).toBe(true);
    expect(isTrustedAppHostname("evil.example.com")).toBe(false);
    expect(isTrustedAppHostname("hiveforyou-v3.vercel.app")).toBe(false);
  });

  it("ignores untrusted Host headers and falls back to canonical origin", () => {
    expect(resolveAppOrigin({ hostHeader: "evil.example.com" })).toBe(
      CANONICAL_APP_ORIGIN,
    );
    expect(resolveAppOrigin({ hostHeader: "localhost:3000" })).toBe(
      "http://localhost:3000",
    );
  });
});
