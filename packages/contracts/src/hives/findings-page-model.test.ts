import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "../pipeline/canonical-study-contracts";
import { parsePackMarkdown } from "../pipeline/pack-contracts";
import { buildStudyView } from "../pipeline/study-view-contracts";

import {
  buildFindingsOpenItems,
  buildFindingsTopics,
  findingsOpenItemCount,
  mapLegacyFindingsTab,
} from "./findings-page-model";

const ROOT = resolve(import.meta.dirname, "../../../..");
const FIXTURE = join(ROOT, "packages/contracts/src/testing/fixtures/widget-review-pack.md");

const study = (): CanonicalStudy => ({
  schema: CANONICAL_STUDY_SCHEMA,
  domainLabel: "widgets",
  spineSource: null,
  documents: [{ sourceDocumentId: "doc-1", role: "ANCHOR", typeInPlainWords: "Notice", date: null, version: null, chainPosition: null }],
  spine: [
    {
      id: "S1",
      label: "Notice copy",
      kind: "Notice",
      status: "SUPPORTED",
      supportingFactIds: ["F1"],
      contradictingFactIds: [],
      updatingFactIds: [],
      missing: [],
    },
  ],
  outsideSpine: [],
  conflicts: [{ id: "C1", statement: "Two amounts disagree", factIds: ["F1", "F2"] }],
  timeline: [],
  gaps: [
    {
      id: "G1",
      statement: "Warranty card missing",
      relatedSpineIds: ["S1"],
      kind: "REQUESTABLE_DOCUMENT",
      title: "Warranty card",
      why: "We did not find a warranty card in the uploads.",
      holder: "Customer",
      holderType: "ASKER_OR_CLIENT",
      when: null,
      basisType: "USUALLY_EXPECTED",
      relatedFactIds: ["F1"],
    },
  ],
  checklist: [
    { checkId: "T1", verdict: "PARTLY_SHOWN", factIds: ["F1"], note: "partial notice" },
    { checkId: "T2", verdict: "SHOWN", factIds: ["F1"], note: "" },
  ],
  packRef: { id: "widget-review", version: 2 },
});

describe("findings page model", () => {
  const pack = parsePackMarkdown(readFileSync(FIXTURE, "utf8"));
  if (!pack.ok) throw new Error("pack fixture failed");
  const view = buildStudyView(study(), { sections: [], blocks: [], components: [] }, [], {}, { pack: pack.value }).view;

  it("places each open item once across topics", () => {
    const canonical = study();
    const openItems = buildFindingsOpenItems(view, canonical);
    const built = buildFindingsTopics({
      view,
      canonicalStudy: canonical,
      pack: pack.value,
      openItems,
    });
    const placedIds = new Set<string>();
    for (const topic of built.topics) {
      for (const item of topic.openItems) {
        expect(placedIds.has(item.id)).toBe(false);
        placedIds.add(item.id);
      }
    }
    for (const item of built.otherOpenItems) {
      expect(placedIds.has(item.id)).toBe(false);
      placedIds.add(item.id);
    }
    expect(placedIds.size).toBe(openItems.length);
  });

  it("maps legacy tabs to anchors", () => {
    expect(mapLegacyFindingsTab("gaps")).toBe("open-items");
    expect(mapLegacyFindingsTab("timeline")).toBe("timeline");
    expect(mapLegacyFindingsTab("known")).toBe("topics");
  });

  it("counts open items for the rail badge", () => {
    const items = buildFindingsOpenItems(view, study());
    expect(findingsOpenItemCount(items)).toBe(items.length);
  });
});