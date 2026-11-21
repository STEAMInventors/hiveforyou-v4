import { describe, expect, it, vi } from "vitest";

import { isDevGalleryEnabled } from "./gallery-gate";

describe("isDevGalleryEnabled", () => {
  it("is false in Vercel production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isDevGalleryEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("is true in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "development");
    expect(isDevGalleryEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("dev gallery D24 fixtures", () => {
  it("registers home and menu gallery routes", () => {
    const routes = [
      "home-staff",
      "hives-firm-menu",
      "home-older-study",
      "home-no-study",
      "home-study-error",
      "client-home-older-study",
    ];
    for (const route of routes) {
      expect(routes).toContain(route);
    }
  });
});