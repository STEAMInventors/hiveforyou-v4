import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "../pipeline/canonical-study-contracts";
import { parsePackMarkdown } from "../pipeline/pack-contracts";
import { buildStudyView, type StudyView } from "../pipeline/study-view-contracts";
import type { SnapshotDocument } from "../study-preparation/study-preparation-contracts";

import {
  buildFindingsChainEvidence,
  buildFindingsGlanceMetrics,
  buildFindingsOpenItems,
  buildFindingsTopics,
  chainLinkStatusLabel,
  findingsDisplayContainsForbiddenStatusCodes,
  findingsFileReadCounts,
  fromDocumentTopicTitle,
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

const snapshotDoc = (overrides: Partial<SnapshotDocument> = {}): SnapshotDocument => ({
  sourceDocumentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  fileName: "a.pdf",
  mimeType: "application/pdf",
  sha256: "a".repeat(64),
  readId: "read-1",
  readStatus: "SUCCEEDED",
  readFingerprint: "fp",
  pageSetDigest: `sha256:${"b".repeat(64)}`,
  totalPhysicalPages: 10,
  verifiedPageCount: 9,
  missingPageNumbers: [],
  emptyPageNumbers: [],
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
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

  it("does not build glance metrics from chains rows", () => {
    const chainsView: StudyView = {
      ...view,
      blocks: [
        ...view.blocks.filter((block) => block.name !== "chains"),
        {
          name: "chains",
          rows: [
            {
              id: "CH1-R1",
              kind: "worth-asking",
              statement: "Chain row",
              values: [
                {
                  factId: "F1",
                  valueAsWritten: "9",
                  sourceRef: { sourceDocumentId: "doc-1", pageNumber: 1, quote: "x" },
                },
              ],
            },
          ],
        },
      ],
    };
    const metrics = buildFindingsGlanceMetrics({
      view: chainsView,
      pack: pack.value,
      canonicalStudy: study(),
      snapshotDocuments: [snapshotDoc(), snapshotDoc({ sha256: "c".repeat(64), sourceDocumentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })],
      coverageGaps: [],
    });
    expect(metrics.every((metric) => !metric.id.startsWith("CH"))).toBe(true);
    expect(metrics.find((metric) => metric.label === "Files read")).toBeTruthy();
  });

  it("omits file and page tiles when snapshot data is missing", () => {
    const metrics = buildFindingsGlanceMetrics({
      view,
      pack: pack.value,
      canonicalStudy: study(),
      snapshotDocuments: [],
      coverageGaps: [],
    });
    expect(metrics.some((metric) => metric.label === "Files read")).toBe(false);
    expect(metrics.some((metric) => metric.label === "Pages read")).toBe(false);
  });

  it("counts unique files and exact duplicates by sha256", () => {
    const counts = findingsFileReadCounts([
      snapshotDoc({ sha256: "d".repeat(64) }),
      snapshotDoc({ sha256: "d".repeat(64), sourceDocumentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", fileName: "dup.pdf" }),
    ]);
    expect(counts).toEqual({ filesRead: 2, uniqueFiles: 1, exactDuplicates: 1 });
  });

  it("uses plain-language chain link labels instead of status codes", () => {
    expect(chainLinkStatusLabel(false)).not.toBe("matches");
    expect(chainLinkStatusLabel(true)).not.toBe("worth-asking");
    const evidence = buildFindingsChainEvidence(
      {
        ...study(),
        chains: [{ chainId: "CH1", rows: [{ label: "Row", links: [{ missing: true }, { factIds: ["F1"] }] }] }],
      },
      pack.value,
      view,
    );
    const text = evidence.flatMap((section) => section.links.map((link) => link.statusLabel)).join(" ");
    expect(findingsDisplayContainsForbiddenStatusCodes(text)).toBe(false);
  });

  it("groups topics by source document instead of spine kind", () => {
    const canonical: CanonicalStudy = {
      ...study(),
      documents: [
        {
          sourceDocumentId: "11111111-1111-4111-8111-111111111111",
          role: "SUPPORTING",
          typeInPlainWords: "Academic evaluation report",
          date: null,
          version: null,
          chainPosition: null,
        },
      ],
      spine: [
        {
          id: "S-decision",
          label: "Eligibility",
          kind: "decision",
          status: "SUPPORTED",
          supportingFactIds: ["F1"],
          contradictingFactIds: [],
          updatingFactIds: [],
          missing: [],
        },
        {
          id: "S-figure",
          label: "Minutes",
          kind: "figure",
          status: "SUPPORTED",
          supportingFactIds: ["F1"],
          contradictingFactIds: [],
          updatingFactIds: [],
          missing: [],
        },
      ],
    };
    const spineView = buildStudyView(
      canonical,
      { sections: [], blocks: [], components: [] },
      [
        {
          id: "F1",
          sourceDocumentId: "11111111-1111-4111-8111-111111111111",
          pageNumber: 2,
          quote: "Eligible",
          valueAsWritten: "Eligible",
          subject: "Person",
          attribute: "status",
        },
      ],
      {},
      {},
    ).view;
    const built = buildFindingsTopics({
      view: spineView,
      canonicalStudy: canonical,
      pack: null,
      openItems: [],
    });
    const kinds = new Set(["decision", "figure"]);
    for (const topic of built.topics) {
      expect(kinds.has(topic.title)).toBe(false);
    }
    expect(built.topics[0]?.title).toBe(fromDocumentTopicTitle("Academic evaluation report"));
  });
});