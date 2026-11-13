import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parsePackMarkdown } from "../pipeline/pack-contracts";
import { buildStudyTabViewFromRpc, normalizeGetStudyTabViewResponse } from "./study-tab-view-contracts";

const FIXTURE = join(import.meta.dirname, "../testing/fixtures/widget-review-pack.md");
const widgetPack = parsePackMarkdown(readFileSync(FIXTURE, "utf8"));

describe("study-tab-view-contracts", () => {
  it("normalizes RPC payload with canonical study and facts", () => {
    const raw = {
      revision: { id: "aaaaaaaa-0000-4000-8000-000000000001", revisionNumber: 1, format: "canonical-study-1" },
      canonicalStudy: {
        schema: "hive.canonical-study/1",
        documents: [
          {
            sourceDocumentId: "bbbbbbbb-0000-4000-8000-000000000001",
            role: "ANCHOR",
            typeInPlainWords: "Test",
            date: null,
            version: null,
            chainPosition: null,
          },
        ],
        spineSource: "ANCHOR",
        spine: [
          {
            id: "S1",
            label: "One item",
            kind: "k",
            status: "CURRENT",
            supportingFactIds: ["F-bbbbbbbb-001"],
            contradictingFactIds: [],
            updatingFactIds: [],
            missing: [],
          },
        ],
        outsideSpine: [],
        conflicts: [],
        timeline: [],
        gaps: [],
        domainLabel: "unknown",
      },
      intent: "What is in the file?",
      facts: [
        {
          id: "F-bbbbbbbb-001",
          sourceDocumentId: "bbbbbbbb-0000-4000-8000-000000000001",
          pageNumber: 1,
          quote: "hello",
          valueAsWritten: "1",
          subject: "s",
          attribute: "a",
        },
      ],
      referencedDocuments: [],
      writerOutput: null,
      narrativeSections: null,
      narrativeBlockNames: null,
    };
    const tab = normalizeGetStudyTabViewResponse(raw);
    expect(tab).not.toBeNull();
    expect(tab!.facts).toHaveLength(1);
    const fileNames = new Map([["bbbbbbbb-0000-4000-8000-000000000001", "t.pdf"]]);
    const built = buildStudyTabViewFromRpc(raw, fileNames);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.view.blocks.some((b) => b.name === "documents")).toBe(true);
    }
  });

  it("includes pack checklist and persona coverage when packRef is set and pack is passed", () => {
    if (!widgetPack.ok) throw new Error("widget-review pack load failed");
    const pack = widgetPack.value;
    const raw = {
      revision: { id: "aaaaaaaa-0000-4000-8000-000000000002", revisionNumber: 6, format: "canonical-study-1" },
      canonicalStudy: {
        schema: "hive.canonical-study/1",
        packRef: { id: pack.meta.pack, version: pack.meta.version },
        documents: [],
        spineSource: "ANCHOR",
        spine: [],
        outsideSpine: [],
        conflicts: [],
        timeline: [],
        gaps: [],
        checklist: [{ checkId: "T1", verdict: "NOT_SHOWN", factIds: [], note: "" }],
        personaCoverage: [],
        domainLabel: "neutral",
      },
      intent: null,
      facts: [],
      referencedDocuments: [],
      writerOutput: null,
      narrativeSections: null,
      narrativeBlockNames: null,
    };
    const built = buildStudyTabViewFromRpc(raw, new Map(), pack);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const checklist = built.view.blocks.find((block) => block.name === "checklist");
    expect(checklist?.rows.length).toBeGreaterThan(0);
    expect(built.view.personaCoverageCard?.length).toBeGreaterThan(0);
    expect(built.view.packMeta?.packTitle).toBe(pack.meta.title);
  });
});
