import { describe, expect, it } from "vitest";

import { buildStudyTabViewFromRpc, normalizeGetStudyTabViewResponse } from "./study-tab-view-contracts";

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
});
