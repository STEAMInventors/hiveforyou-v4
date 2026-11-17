import { describe, expect, it } from "vitest";

import { hiveFactsPath, hiveMissingPath, hiveTimelinePath, mapStudyLegacyHash } from "./hive-routes";

const HIVE = "11111111-1111-4111-8111-111111111111";

describe("mapStudyLegacyHash", () => {
  it("maps disagree and missing hashes to the missing page", () => {
    expect(mapStudyLegacyHash(HIVE, "missing")).toBe(hiveMissingPath(HIVE));
    expect(mapStudyLegacyHash(HIVE, "#disagree")).toBe(hiveMissingPath(HIVE));
  });

  it("maps timeline to the timeline page", () => {
    expect(mapStudyLegacyHash(HIVE, "timeline")).toBe(hiveTimelinePath(HIVE));
  });

  it("maps everything else to facts", () => {
    expect(mapStudyLegacyHash(HIVE, "establish")).toBe(hiveFactsPath(HIVE));
    expect(mapStudyLegacyHash(HIVE, "")).toBe(hiveFactsPath(HIVE));
  });
});