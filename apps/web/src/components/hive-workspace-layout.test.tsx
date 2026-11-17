import { describe, expect, it } from "vitest";

import { hiveMetaLine } from "./hive-workspace-layout";

describe("hiveMetaLine", () => {
  it("formats document count and attention sentence", () => {
    const line = hiveMetaLine({
      documentCount: 2,
      attention: { sentence: "Everything is in.", code: "ALL_CLEAR", priority: 0, headline: "All clear" },
      intake: { total: 2, received: 2 },
      study: null,
    });
    expect(line).toBe("2 documents · Everything is in.");
  });
});