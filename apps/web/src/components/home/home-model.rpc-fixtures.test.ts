import {
  buildFindingsOpenItems,
  buildFindingsTopics,
  buildStudyTabViewFromRpc,
  normalizeGetStudyTabViewResponse,
} from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { MEDICAID_FINDINGS } from "@/dev/gallery/fixtures/findings-gallery";

import { buildHiveHomeContent } from "./home-model";

const NOW = new Date("2026-11-19T15:00:00.000Z");

/** investigation-1-shaped RPC payload (accepted revision, no canonical study block). */
const DOC_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const REV_INV = "aaaaaaaa-0000-4000-8000-000000000099";
const REV_CAN = "aaaaaaaa-0000-4000-8000-000000000001";

const INVESTIGATION_RPC = {
  revision: { id: REV_INV, revisionNumber: 6, format: "investigation-1" },
  canonicalStudy: null,
  intent: "What do the bank statements show?",
  facts: [],
  referencedDocuments: [],
  writerOutput: null,
  narrativeSections: null,
  narrativeBlockNames: null,
};

/** Minimal canonical-study-1 RPC (single fact, one statement topic). */
const CANONICAL_RPC = {
  revision: { id: REV_CAN, revisionNumber: 3, format: "canonical-study-1" },
  canonicalStudy: {
    schema: "hive.canonical-study/1",
    documents: [
      {
        sourceDocumentId: DOC_ID,
        role: "ANCHOR",
        typeInPlainWords: "Bank statement",
        date: null,
        version: null,
        chainPosition: null,
      },
    ],
    spineSource: "ANCHOR",
    spine: [
      {
        id: "S1",
        label: "Balance",
        kind: "AMOUNT",
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
    domainLabel: "neutral",
  },
  intent: "What is the balance?",
  facts: [
    {
      id: "F-bbbbbbbb-001",
      sourceDocumentId: DOC_ID,
      pageNumber: 1,
      quote: "$1,200.00",
      valueAsWritten: "1200",
      subject: "balance",
      attribute: "ending",
    },
  ],
  referencedDocuments: [],
  writerOutput: null,
  narrativeSections: null,
  narrativeBlockNames: null,
};

describe("buildHiveHomeContent from RPC-shaped study tab payloads", () => {
  it("older investigation-1 revision yields documents-in content without topics", () => {
    const tab = normalizeGetStudyTabViewResponse(INVESTIGATION_RPC);
    expect(tab?.revision?.format).toBe("investigation-1");
    expect(tab?.canonicalStudy).toBeNull();
    const built = buildStudyTabViewFromRpc(INVESTIGATION_RPC, new Map([[DOC_ID, "statement.pdf"]]));
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toBe("no_canonical_study");

    const content = buildHiveHomeContent({
      documentCount: 8,
      checklist: [],
      progress: null,
      openItems: [],
      topics: [],
      sources: null,
      messages: [],
      now: NOW,
      study: { revisionNumber: 6, acceptedAt: "2026-11-01T00:00:00.000Z" },
      documentRows: [],
      calculations: [],
    });
    expect(content.hasStudy).toBe(true);
    expect(content.documentsIn).toBe(8);
    expect(content.statementCount).toBe(0);
  });

  it("canonical RPC builds topics through the real findings builders", () => {
    const built = buildStudyTabViewFromRpc(CANONICAL_RPC, new Map([[DOC_ID, "statement.pdf"]]));
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const fixture = MEDICAID_FINDINGS;
    const canonical = normalizeGetStudyTabViewResponse(CANONICAL_RPC)!.canonicalStudy;
    const rpcOpenItems = buildFindingsOpenItems(built.view, canonical);
    const { topics: rpcTopics } = buildFindingsTopics({
      view: built.view,
      canonicalStudy: canonical,
      pack: null,
      openItems: rpcOpenItems,
    });
    expect(rpcTopics.length).toBeGreaterThan(0);

    const rpcContent = buildHiveHomeContent({
      documentCount: 1,
      checklist: [],
      progress: null,
      openItems: rpcOpenItems,
      topics: rpcTopics,
      sources: built.sources,
      messages: [],
      now: NOW,
      study: { revisionNumber: 3, acceptedAt: "2026-11-02T00:00:00.000Z" },
      documentRows: built.view.blocks.find((block) => block.name === "documents")?.rows ?? [],
      calculations: [],
    });
    expect(rpcContent.statementCount).toBeGreaterThan(0);
    expect(rpcContent.topics.length).toBe(rpcTopics.length);

    const openItems = buildFindingsOpenItems(fixture.view, fixture.canonicalStudy);
    const medicaidContent = buildHiveHomeContent({
      documentCount: 8,
      checklist: [],
      progress: null,
      openItems,
      topics: fixture.topics,
      sources: fixture.sources,
      messages: [],
      now: NOW,
      study: { revisionNumber: 3, acceptedAt: "2026-11-02T00:00:00.000Z" },
      documentRows: fixture.view.blocks.find((block) => block.name === "documents")?.rows ?? [],
      calculations: fixture.pack?.computedValues ?? [],
    });
    expect(fixture.topics.length).toBeGreaterThan(0);
    expect(medicaidContent.topics.length).toBe(fixture.topics.length);
    expect(medicaidContent.statementCount).toBeGreaterThan(0);
  });

  it("canonical study with zero statements still reports empty topics", () => {
    const content = buildHiveHomeContent({
      documentCount: 4,
      checklist: [],
      progress: null,
      openItems: [],
      topics: [],
      sources: MEDICAID_FINDINGS.sources,
      messages: [],
      now: NOW,
      study: { revisionNumber: 1, acceptedAt: "2026-11-03T00:00:00.000Z" },
      documentRows: [],
      calculations: [],
    });
    expect(content.hasStudy).toBe(true);
    expect(content.statementCount).toBe(0);
  });
});