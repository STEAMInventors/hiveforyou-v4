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

  it("strips a leading yes on eligibility questions but keeps supported claims", () => {
    const mayaBriefing = buildAssistantBriefing({
      viewer: { role: "client", roleLabel: "Client", firstName: "Maya" },
      hive: { name: "Maya", purpose: null, matterType: null, stage: null },
      pack: null,
      checklist: [],
      study: {
        revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        revisionNumber: 1,
        canonical: {
          schema: "hive.canonical-study/1",
          documents: [
            {
              sourceDocumentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              role: "SUPPORTING",
              typeInPlainWords: "Speech-language evaluation",
              date: null,
              version: null,
              chainPosition: null,
            },
          ],
          spineSource: null,
          spine: [],
          outsideSpine: [{ id: "O1", statement: "Eligibility was determined", factIds: ["F1"] }],
          conflicts: [],
          timeline: [],
          gaps: [],
          domainLabel: "sample",
        },
        sources: {
          documents: {},
          facts: {
            F1: {
              sourceDocumentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              pageNumber: 1,
              quote: "eligible",
            },
          },
        },
      },
      documents: [],
      messages: [],
      question: "Is Maya eligible for services?",
      assistantName: "Sam",
    });
    const result = validateAssistantReply(
      {
        intent: "answer",
        reply: "Yes. The eligibility team determined she meets the criteria in the file.",
        claims: [{ text: "The eligibility team determined she meets the criteria in the file.", factIds: ["F1"] }],
      },
      mayaBriefing,
      {
        revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        mapFact: (fact) => ({
          sourceDocumentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          pageNumber: 1,
          shortLabel: fact.sourceLabel,
          factId: fact.id,
          studyRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      },
      { teamFirstName: "Alex" },
    );
    expect(result.reply.startsWith("The eligibility team determined")).toBe(true);
    expect(result.reply.toLowerCase().startsWith("yes")).toBe(false);
    expect(result.sourceRefs).toHaveLength(1);
    expect(result.sourceRefs[0]?.shortLabel).toBe("Speech-language evaluation");
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

  it("attaches a fact ref when route_to_team text cites an unmatched academic metric", () => {
    const academicBriefing = buildAssistantBriefing({
      viewer: { role: "client", roleLabel: "Client", firstName: "Maya" },
      hive: { name: "Maya", purpose: null, matterType: null, stage: null },
      pack: null,
      checklist: [],
      study: {
        revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        revisionNumber: 1,
        canonical: {
          schema: "hive.canonical-study/1",
          documents: [
            {
              sourceDocumentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              role: "SUPPORTING",
              typeInPlainWords: "Academic evaluation",
              date: null,
              version: null,
              chainPosition: null,
            },
          ],
          spineSource: null,
          spine: [],
          outsideSpine: [
            {
              id: "O1",
              statement: "Maya read at 42 words correct per minute with 86% accuracy",
              factIds: ["F9"],
            },
          ],
          conflicts: [],
          timeline: [],
          gaps: [],
          domainLabel: "sample",
        },
        sources: {
          documents: {},
          facts: {
            F9: {
              sourceDocumentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              pageNumber: 2,
              quote: "42 words correct per minute",
            },
          },
        },
      },
      documents: [],
      messages: [],
      question: "How is Maya reading?",
      assistantName: "Sam",
    });
    const result = validateAssistantReply(
      {
        intent: "route_to_team",
        reply: "Maya read at 42 words correct per minute with 86% accuracy. I'll ask the team to weigh in.",
        claims: [],
      },
      academicBriefing,
      {
        revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        mapFact: (fact) => ({
          sourceDocumentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          pageNumber: 2,
          shortLabel: fact.sourceLabel,
          factId: fact.id,
          studyRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      },
      { teamFirstName: "Alex" },
    );
    expect(result.sourceRefs).toHaveLength(1);
    expect(result.sourceRefs[0]?.shortLabel).toBe("Academic evaluation");
  });

  it("replaces team language on firmless hives", () => {
    const result = validateAssistantReply(
      {
        intent: "route_to_team",
        reply: "I'll hand this to the team.",
        claims: [],
      },
      briefing,
      {
        revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        mapFact: () => null,
      },
      { teamFirstName: null, hasTeam: false },
    );
    expect(result.reply).toBe(
      "That's a question for a professional. I can only tell you what your documents say.",
    );
    expect(result.reply.toLowerCase()).not.toContain("team");
  });
});