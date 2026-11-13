import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parsePackMarkdown } from "./pack-contracts";
import { PACK_SELECTION_THRESHOLD, scorePack, selectDomainPack } from "./pack-selection";

const ROOT = resolve(import.meta.dirname, "../../../..");

describe("selectDomainPack", () => {
  const widgetFixture = readFileSync(
    join(ROOT, "packages/contracts/src/testing/fixtures/widget-review-pack.md"),
    "utf8",
  );
  const widget = parsePackMarkdown(widgetFixture);
  expect(widget.ok).toBe(true);
  if (!widget.ok) return;
  const entries = [{ id: widget.value.meta.pack, fileName: "widget.md", pack: widget.value }];
  const low = {
    ...entries[0],
    pack: { ...entries[0].pack, meta: { ...entries[0].pack.meta, pack: "low-pack", matches: { intent: ["alpha"], documents: [] } } },
  };
  const high = {
    ...entries[0],
    id: "high-pack",
    pack: {
      ...entries[0].pack,
      meta: { ...entries[0].pack.meta, pack: "high-pack", matches: { intent: ["widget", "quality", "review"], documents: ["widget spec"] } },
    },
  };
  const all = [low, high];

  it("picks the higher-scoring pack", () => {
    const extractions = [
      {
        documentId: "d1",
        fileName: "widget-spec.pdf",
        schema: "hive.doc-extraction/1",
        document: { documentType: "widget spec", titleAsPrinted: "spec", summary: "quality review" },
        facts: [],
        emptyFields: [],
        referencedDocuments: [],
        coverage: { pagesRead: [1] },
      },
    ] as const;
    const selected = selectDomainPack(all, "widget quality review before release", extractions as never);
    expect(selected?.id).toBe("high-pack");
  });

  it("returns null below threshold", () => {
    const selected = selectDomainPack(entries, "unrelated groceries receipt", [] as never);
    expect(selected).toBeNull();
  });

  it("scores at or above threshold when intent matches", () => {
    const scoreA = scorePack(high, "widget quality review", [] as never);
    expect(scoreA).toBeGreaterThanOrEqual(PACK_SELECTION_THRESHOLD);
  });

  it("prefers the higher pack version when scores tie", () => {
    const older = {
      ...entries[0],
      pack: {
        ...entries[0].pack,
        meta: { ...entries[0].pack.meta, version: 1 },
      },
    };
    const newer = {
      ...entries[0],
      pack: {
        ...entries[0].pack,
        meta: { ...entries[0].pack.meta, version: 9 },
      },
    };
    const selected = selectDomainPack(
      [older, newer],
      "widget batch review acceptance test",
      [
        {
          documentId: "d1",
          fileName: "widget-spec.pdf",
          schema: "hive.doc-extraction/1",
          document: { documentType: "widget spec sheet", titleAsPrinted: "spec", summary: "" },
          facts: [],
          emptyFields: [],
          referencedDocuments: [],
          coverage: { pagesRead: [1] },
        },
      ] as never,
    );
    expect(selected?.version).toBe(9);
  });
});
