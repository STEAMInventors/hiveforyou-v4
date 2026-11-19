import { describe, expect, it } from "vitest";

import {
  ASSISTANT_BRIEFING_DEFAULT_BUDGET_BYTES,
  briefingByteSize,
  buildAssistantBriefing,
  canonicalStudyDocumentRoleLabel,
} from "./assistant-briefing";

describe("buildAssistantBriefing", () => {
  it("keeps gaps and conflicts when trimming facts for budget", () => {
    const facts = Array.from({ length: 200 }, (_, index) => ({
      id: `F${index}`,
      statement: `Fact number ${index} about wages and hours for the client.`,
      sourceLabel: "Notice",
      page: 1,
    }));
    const gaps = [
      {
        id: "G1",
        statement: "Missing form",
        relatedSpineIds: [],
        kind: "REQUESTABLE_DOCUMENT" as const,
        title: "Missing form",
        why: "Not uploaded",
        holder: "Client",
        holderType: null,
        when: null,
        basisType: "USUALLY_EXPECTED" as const,
        relatedFactIds: [],
      },
    ];
    const briefing = buildAssistantBriefing({
      viewer: { role: "client", roleLabel: "Client", firstName: "Sam" },
      hive: { name: "Maya", purpose: null, matterType: "Sample", stage: "open" },
      pack: null,
      checklist: [],
      study: {
        revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        revisionNumber: 1,
        canonical: {
          schema: "hive.canonical-study/1",
          documents: [],
          spineSource: null,
          spine: [],
          outsideSpine: facts.map((fact, index) => ({
            id: `O${index}`,
            statement: fact.statement,
            factIds: [fact.id],
          })),
          conflicts: [{ id: "C1", statement: "Two dates disagree", factIds: ["F0", "F1"] }],
          timeline: [],
          gaps,
          domainLabel: "sample",
        },
        sources: null,
      },
      documents: [{ label: "Notice", pages: 2, readState: "SUCCEEDED", unreadablePages: [] }],
      messages: [],
      question: "What do the documents say about wages?",
      assistantName: "Sam",
      budgetBytes: 4 * 1024,
    });

    expect(briefing.study.gaps).toEqual([{ id: "G1", title: "Missing form", why: "Not uploaded" }]);
    expect(briefing.study.conflicts).toHaveLength(1);
    expect(briefing.study.facts.length).toBeLessThan(facts.length);
    expect(briefingByteSize(briefing)).toBeLessThanOrEqual(ASSISTANT_BRIEFING_DEFAULT_BUDGET_BYTES);
  });

  it("uses the canonical document role label on facts", () => {
    const study = {
      schema: "hive.canonical-study/1" as const,
      documents: [
        {
          sourceDocumentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          role: "SUPPORTING" as const,
          typeInPlainWords: "Speech-language evaluation",
          date: null,
          version: null,
          chainPosition: null,
        },
      ],
      spineSource: null,
      spine: [],
      outsideSpine: [{ id: "O1", statement: "Score noted", factIds: ["F1"] }],
      conflicts: [],
      timeline: [],
      gaps: [],
      domainLabel: "sample",
    };
    expect(
      canonicalStudyDocumentRoleLabel(study, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
    ).toBe("Speech-language evaluation");
    const briefing = buildAssistantBriefing({
      viewer: { role: "client", roleLabel: "Client", firstName: "Maya" },
      hive: { name: "Maya", purpose: null, matterType: null, stage: null },
      pack: null,
      checklist: [],
      study: {
        revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        revisionNumber: 1,
        canonical: study,
        sources: {
          documents: {},
          facts: {
            F1: {
              sourceDocumentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              pageNumber: 1,
              quote: "score",
            },
          },
        },
      },
      documents: [],
      messages: [],
      question: "What does the evaluation say?",
      assistantName: "Sam",
    });
    expect(briefing.study.facts[0]?.sourceLabel).toBe("Speech-language evaluation");
  });

  it("does not put emails or file names in the briefing JSON", () => {
    const briefing = buildAssistantBriefing({
      viewer: { role: "staff", roleLabel: "Owner", firstName: "Alex" },
      hive: { name: "Test", purpose: "review", matterType: null, stage: null },
      pack: null,
      checklist: [],
      study: {
        revisionId: null,
        revisionNumber: null,
        canonical: null,
        sources: null,
      },
      documents: [],
      messages: [
        {
          id: "1",
          authorKind: "person",
          authorRole: "client",
          authorUserId: null,
          authorDisplayName: "Client",
          authorRoleLabel: "Client",
          isMine: false,
          body: "See report.pdf and email me at user@example.com",
          sourceRefs: [],
          replyToMessageId: null,
          createdAt: new Date().toISOString(),
        },
      ],
      question: "Any updates on report.pdf?",
      assistantName: "HiveForYou",
    });
    const text = JSON.stringify(briefing);
    expect(text.toLowerCase()).not.toContain("@example.com");
    expect(text.toLowerCase()).not.toContain(".pdf");
  });
});