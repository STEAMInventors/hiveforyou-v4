import { describe, expect, it } from "vitest";

import { buildAssistantBriefing } from "./assistant-briefing";
import {
  assistantAnswerNotFoundFallback,
  assistantRouteFallback,
  ASSISTANT_ROUTE_GUARD_PHRASES,
  validateAssistantReply,
} from "./assistant-reply";

const briefing = buildAssistantBriefing({
  viewer: { role: "client", roleLabel: "Client", firstName: "Sam" },
  hive: { name: "Hive", purpose: null, matterType: null, stage: null },
  pack: null,
  checklist: [{ id: "1", hiveId: "h", source: "pack", packRowKey: "w2", title: "W-2", detail: null, position: 0, state: "WAITING", stateNote: null, acceptedBy: null, createdAt: "", updatedAt: "", documents: [], latestCheck: null }],
  study: {
    revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    revisionNumber: 1,
    canonical: {
      schema: "hive.canonical-study/1",
      documents: [],
      spineSource: null,
      spine: [],
      outsideSpine: [{ id: "O1", statement: "Pay was listed", factIds: ["F1"] }],
      conflicts: [],
      timeline: [],
      gaps: [],
      domainLabel: "sample",
    },
    sources: {
      documents: {},
      facts: {
        F1: {
          sourceDocumentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          pageNumber: 2,
          quote: "pay",
        },
      },
    },
  },
  documents: [],
  messages: [],
  question: "What about pay?",
  assistantName: "Sam",
});

describe("assistant fallbacks without a firm team", () => {
  it("uses owner-only wording for not-found and route", () => {
    const solo = { teamFirstName: null, hasTeam: false as const };
    expect(assistantAnswerNotFoundFallback(solo)).toBe(
      "I couldn't find that in the documents yet. Try adding the document it would be in, or ask me another way.",
    );
    expect(assistantRouteFallback(solo)).toBe(
      "That's a question for a professional. I can only tell you what your documents say.",
    );
  });
});

describe("validateAssistantReply", () => {
  it("drops unknown fact ids and falls back when nothing is supported", () => {
    const result = validateAssistantReply(
      { intent: "answer", reply: "Pay appears on the form", claims: [{ text: "Pay appears on the form", factIds: ["F9"] }] },
      briefing,
      {
        revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        mapFact: (fact) => ({
          sourceDocumentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          pageNumber: 2,
          shortLabel: fact.sourceLabel,
          factId: fact.id,
          studyRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      },
      { teamFirstName: "Alex" },
    );
    expect(result.reply).toContain("Alex");
    expect(result.sourceRefs).toHaveLength(0);
  });

  it("routes on every guard phrase", () => {
    for (const phrase of ASSISTANT_ROUTE_GUARD_PHRASES) {
      const result = validateAssistantReply(
        { intent: "answer", reply: `You might ask: ${phrase}`, claims: [] },
        briefing,
        {
          revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          mapFact: () => null,
        },
        { teamFirstName: null },
      );
      expect(result.intent).toBe("route_to_team");
      expect(result.reply).toBe(assistantRouteFallback({ teamFirstName: null }));
    }
  });

  it("nulls a bad itemKey and caps reply length", () => {
    const result = validateAssistantReply(
      {
        intent: "ask_for_item",
        reply: "Please upload the W-2. http://evil.test",
        claims: [],
        itemKey: "not-a-key",
      },
      briefing,
      {
        revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        mapFact: () => null,
      },
      { teamFirstName: null },
    );
    expect(result.itemKey).toBeNull();
    expect(result.reply).not.toContain("http://");
  });
});