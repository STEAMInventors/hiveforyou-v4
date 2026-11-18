import { describe, expect, it } from "vitest";

import { matterTypesForFirm, normalizePracticeAreaIds } from "./practice-areas";

describe("practice areas", () => {
  it("normalizes allowed pack ids and drops unknown values", () => {
    const allowed = new Set(["pack-a", "pack-b"]);
    expect(normalizePracticeAreaIds(["pack-a", "unknown", "pack-a"], allowed)).toEqual(["pack-a"]);
  });

  it("filters matter types to firm practice areas unless show all", () => {
    const catalog = [
      { id: "pack-a", title: "A" },
      { id: "pack-b", title: "B" },
      { id: "pack-c", title: "C" },
    ];
    const areas = ["pack-a", "pack-c"];
    const filtered = matterTypesForFirm(catalog, areas, false);
    expect(filtered.map((row) => row.id)).toEqual(areas);
    expect(matterTypesForFirm(catalog, areas, true)).toHaveLength(catalog.length);
  });

  it("requires an explicit allowlist for normalization", () => {
    const allowed = new Set<string>();
    expect(normalizePracticeAreaIds(["pack-a"], allowed)).toEqual([]);
  });
});