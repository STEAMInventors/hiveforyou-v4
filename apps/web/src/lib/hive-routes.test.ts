import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/server/auth/redirects";

import {
  CREATE_HIVE_AFTER_SIGN_UP_PATH,
  MY_HIVES_CREATE_PATH,
  hiveDocumentsPath,
} from "./hive-routes";

describe("hive routes", () => {
  it("sends guests to sign up with a same-origin next path that opens Create Hive", () => {
    const url = new URL(CREATE_HIVE_AFTER_SIGN_UP_PATH, "https://example.test");
    expect(url.pathname).toBe("/register");
    const next = url.searchParams.get("next");
    expect(next).toBe(MY_HIVES_CREATE_PATH);
    expect(safeNextPath(next, "/fallback")).toBe("/hives?create=1");
  });

  it("builds the Documents tab path for a Hive", () => {
    expect(hiveDocumentsPath("6f1c2d3e-0000-4000-8000-000000000001")).toBe(
      "/hives/6f1c2d3e-0000-4000-8000-000000000001/documents",
    );
  });
});
