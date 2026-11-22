import { describe, expect, it } from "vitest";

import { buildAssistantBriefing } from "./assistant-briefing";
import {
  assistantAnswerNotFoundFallback,
  assistantHiveNavigationAnswer,
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

describe("assistantHiveNavigationAnswer", () => {
  it("answers only allowlisted navigation patterns", () => {
    expect(assistantHiveNavigationAnswer("How do I open the audit trail?")).toContain("Audit trail");
    expect(assistantHiveNavigationAnswer("What does the notice say about pay?")).toBeNull();
  });

  it("points document location questions to Documents without citing study facts", () => {
    expect(assistantHiveNavigationAnswer("Where are my documents?")).toContain("Documents");
    const validated = validateAssistantReply(
      { intent: "route_to_team", reply: "", claims: [] },
      { ...briefing, question: "Where are my uploaded files?" },
      { revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", mapFact: () => null },
      { teamFirstName: "Alex" },
    );
    expect(validated.intent).toBe("answer");
    expect(validated.reply).toContain("Documents");
    expect(validated.sourceRefs).toHaveLength(0);
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

  describe("P0.5-B citation-mapping fail-closed guarantees", () => {
    const REV_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const OTHER_REV_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
    const DOC_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const DOC_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    const multiFactBriefing = buildAssistantBriefing({
      viewer: { role: "owner", roleLabel: "Owner", firstName: "Maya" },
      hive: { name: "Maya", purpose: null, matterType: null, stage: null },
      pack: null,
      checklist: [],
      study: {
        revisionId: REV_ID,
        revisionNumber: 1,
        canonical: {
          schema: "hive.canonical-study/1",
          documents: [
            {
              sourceDocumentId: DOC_A,
              role: "SUPPORTING",
              typeInPlainWords: "Service log",
              date: null,
              version: null,
              chainPosition: null,
            },
            {
              sourceDocumentId: DOC_B,
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
              statement: "360 speech therapy minutes were delivered between September and November 2025",
              factIds: ["F1"],
            },
            {
              id: "O2",
              statement: "Maya read at 42 words correct per minute with 86% accuracy",
              factIds: ["F2"],
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
            F1: { sourceDocumentId: DOC_A, pageNumber: 1, quote: "360 minutes" },
            F2: { sourceDocumentId: DOC_B, pageNumber: 2, quote: "42 words correct per minute" },
          },
        },
      },
      documents: [],
      messages: [],
      question: "What do the records say about speech therapy and reading?",
      assistantName: "HiveForYou",
      hasTeam: false,
    });

    it("rejects factual claims and falls back when mapFact returns null", () => {
      const result = validateAssistantReply(
        {
          intent: "answer",
          reply: "360 speech therapy minutes were delivered between September and November 2025.",
          claims: [
            {
              text: "360 speech therapy minutes were delivered between September and November 2025.",
              factIds: ["F1"],
            },
          ],
        },
        multiFactBriefing,
        { revisionId: REV_ID, mapFact: () => null },
        { teamFirstName: null, hasTeam: false },
      );

      expect(result.sourceRefs).toEqual([]);
      expect(result.reply).toBe(assistantAnswerNotFoundFallback({ teamFirstName: null, hasTeam: false }));
      expect(result.reply).not.toContain("360");
    });

    it("rejects factual claims and falls back when mapFact returns an empty array", () => {
      const result = validateAssistantReply(
        {
          intent: "answer",
          reply: "360 speech therapy minutes were delivered between September and November 2025.",
          claims: [
            {
              text: "360 speech therapy minutes were delivered between September and November 2025.",
              factIds: ["F1"],
            },
          ],
        },
        multiFactBriefing,
        { revisionId: REV_ID, mapFact: () => [] },
        { teamFirstName: null, hasTeam: false },
      );

      expect(result.sourceRefs).toEqual([]);
      expect(result.reply).toBe(assistantAnswerNotFoundFallback({ teamFirstName: null, hasTeam: false }));
      expect(result.reply).not.toContain("360");
    });

    it("rejects invalid mapped references (bad UUID, bad page, blank label, mismatched factId/revisionId, non-object)", () => {
      const invalidCases: Array<{
        name: string;
        revisionId?: string;
        mapped: ReturnType<Parameters<typeof validateAssistantReply>[2]["mapFact"]>;
      }> = [
        {
          name: "non-UUID sourceDocumentId",
          mapped: { sourceDocumentId: "not-a-uuid", pageNumber: 1, shortLabel: "Service log", factId: "F1", studyRevisionId: REV_ID },
        },
        {
          name: "zero pageNumber",
          mapped: { sourceDocumentId: DOC_A, pageNumber: 0, shortLabel: "Service log", factId: "F1", studyRevisionId: REV_ID },
        },
        {
          name: "negative pageNumber",
          mapped: { sourceDocumentId: DOC_A, pageNumber: -2, shortLabel: "Service log", factId: "F1", studyRevisionId: REV_ID },
        },
        {
          name: "fractional pageNumber",
          mapped: { sourceDocumentId: DOC_A, pageNumber: 1.5, shortLabel: "Service log", factId: "F1", studyRevisionId: REV_ID },
        },
        {
          name: "NaN pageNumber",
          mapped: { sourceDocumentId: DOC_A, pageNumber: Number.NaN, shortLabel: "Service log", factId: "F1", studyRevisionId: REV_ID },
        },
        {
          name: "blank shortLabel",
          mapped: { sourceDocumentId: DOC_A, pageNumber: 1, shortLabel: "   ", factId: "F1", studyRevisionId: REV_ID },
        },
        {
          name: "mismatched factId",
          mapped: { sourceDocumentId: DOC_A, pageNumber: 1, shortLabel: "Service log", factId: "F2", studyRevisionId: REV_ID },
        },
        {
          name: "mismatched studyRevisionId",
          mapped: { sourceDocumentId: DOC_A, pageNumber: 1, shortLabel: "Service log", factId: "F1", studyRevisionId: OTHER_REV_ID },
        },
        {
          name: "invalid studyRevisionId on ref",
          mapped: { sourceDocumentId: DOC_A, pageNumber: 1, shortLabel: "Service log", factId: "F1", studyRevisionId: "bad-rev" },
        },
        {
          name: "invalid revisionId input",
          revisionId: "not-a-uuid",
          mapped: { sourceDocumentId: DOC_A, pageNumber: 1, shortLabel: "Service log", factId: "F1", studyRevisionId: "not-a-uuid" },
        },
        {
          name: "array of invalid/null entries",
          mapped: [
            null as never,
            { sourceDocumentId: "bad", pageNumber: 1, shortLabel: "Service log", factId: "F1", studyRevisionId: REV_ID },
            { sourceDocumentId: DOC_A, pageNumber: 0, shortLabel: "Service log", factId: "F1", studyRevisionId: REV_ID },
          ],
        },
      ];

      for (const testCase of invalidCases) {
        const result = validateAssistantReply(
          {
            intent: "answer",
            reply: "360 speech therapy minutes were delivered between September and November 2025.",
            claims: [
              {
                text: "360 speech therapy minutes were delivered between September and November 2025.",
                factIds: ["F1"],
              },
            ],
          },
          multiFactBriefing,
          {
            revisionId: testCase.revisionId ?? REV_ID,
            mapFact: () => testCase.mapped,
          },
          { teamFirstName: null, hasTeam: false },
        );

        expect(result.sourceRefs, testCase.name).toEqual([]);
        expect(result.reply, testCase.name).toBe(assistantAnswerNotFoundFallback({ teamFirstName: null, hasTeam: false }));
        expect(result.reply, testCase.name).not.toContain("360");
      }
    });

    it("retains only the valid citation when a claim maps to mixed invalid and valid references, and strips unmapped sibling claims", () => {
      const result = validateAssistantReply(
        {
          intent: "answer",
          reply:
            "360 speech therapy minutes were delivered between September and November 2025. 360 speech therapy minutes were delivered between September and November 2025. Maya read at 42 words correct per minute with 86% accuracy.",
          claims: [
            {
              text: "360 speech therapy minutes were delivered between September and November 2025.",
              factIds: ["F1"],
            },
            {
              text: "Maya read at 42 words correct per minute with 86% accuracy.",
              factIds: ["F2"],
            },
          ],
        },
        multiFactBriefing,
        {
          revisionId: REV_ID,
          mapFact: (fact) => {
            if (fact.id === "F1") return [];
            return [
              { sourceDocumentId: "invalid-uuid", pageNumber: 2, shortLabel: "Academic evaluation", factId: "F2", studyRevisionId: REV_ID },
              { sourceDocumentId: DOC_B, pageNumber: 2, shortLabel: "Academic evaluation", factId: "F2", studyRevisionId: REV_ID },
              { sourceDocumentId: DOC_B, pageNumber: 2, shortLabel: "Academic evaluation", factId: "F2", studyRevisionId: REV_ID },
            ];
          },
        },
        { teamFirstName: null, hasTeam: false },
      );

      expect(result.intent).toBe("answer");
      expect(result.reply).toBe("Maya read at 42 words correct per minute with 86% accuracy.");
      expect(result.reply).not.toContain("360");
      expect(result.sourceRefs).toEqual([
        {
          sourceDocumentId: DOC_B,
          pageNumber: 2,
          shortLabel: "Academic evaluation",
          factId: "F2",
          studyRevisionId: REV_ID,
        },
      ]);
    });

    it("enforceReplyFactCitations drops factual sentences and does not mark them supported when all citation mappings fail", () => {
      const failingMappers = [
        { name: "null", mapFact: () => null },
        { name: "empty array", mapFact: () => [] },
        {
          name: "invalid mapped ref",
          mapFact: (fact: { id: string; sourceLabel: string }) => ({
            sourceDocumentId: DOC_B,
            pageNumber: 0,
            shortLabel: fact.sourceLabel,
            factId: fact.id,
            studyRevisionId: REV_ID,
          }),
        },
      ] as const;

      for (const mapper of failingMappers) {
        // 1. answer intent with uncited factual sentence (claims: []) -> must fall back, not keep factual sentence
        const answerResult = validateAssistantReply(
          {
            intent: "answer",
            reply: "Maya read at 42 words correct per minute with 86% accuracy.",
            claims: [],
          },
          multiFactBriefing,
          { revisionId: REV_ID, mapFact: mapper.mapFact },
          { teamFirstName: null, hasTeam: false },
        );
        expect(answerResult.sourceRefs, `answer:${mapper.name}`).toEqual([]);
        expect(answerResult.reply, `answer:${mapper.name}`).toBe(
          assistantAnswerNotFoundFallback({ teamFirstName: null, hasTeam: false }),
        );
        expect(answerResult.reply, `answer:${mapper.name}`).not.toContain("42 words");

        // 2. route_to_team intent with uncited factual sentence + non-factual sentence -> factual sentence dropped
        const routeResult = validateAssistantReply(
          {
            intent: "route_to_team",
            reply: "Maya read at 42 words correct per minute with 86% accuracy. I'll ask Alex to take a look.",
            claims: [],
          },
          multiFactBriefing,
          { revisionId: REV_ID, mapFact: mapper.mapFact },
          { teamFirstName: "Alex", hasTeam: true },
        );
        expect(routeResult.sourceRefs, `route:${mapper.name}`).toEqual([]);
        expect(routeResult.reply, `route:${mapper.name}`).toBe("I'll ask Alex to take a look.");
        expect(routeResult.reply, `route:${mapper.name}`).not.toContain("42 words");
      }
    });

    it("enforceReplyFactCitations drops a sentence matching multiple facts when all fail, and keeps it when one maps validly", () => {
      const combinedSentence =
        "360 speech therapy minutes were delivered and Maya read at 42 words correct per minute with 86% accuracy.";

      const allFailed = validateAssistantReply(
        {
          intent: "answer",
          reply: combinedSentence,
          claims: [],
        },
        multiFactBriefing,
        {
          revisionId: REV_ID,
          mapFact: (fact) => (fact.id === "F1" ? null : []),
        },
        { teamFirstName: null, hasTeam: false },
      );
      expect(allFailed.sourceRefs).toEqual([]);
      expect(allFailed.reply).toBe(assistantAnswerNotFoundFallback({ teamFirstName: null, hasTeam: false }));

      const oneSucceeded = validateAssistantReply(
        {
          intent: "answer",
          reply: combinedSentence,
          claims: [],
        },
        multiFactBriefing,
        {
          revisionId: REV_ID,
          mapFact: (fact) =>
            fact.id === "F1"
              ? null
              : {
                  sourceDocumentId: DOC_B,
                  pageNumber: 2,
                  shortLabel: "Academic evaluation",
                  factId: "F2",
                  studyRevisionId: REV_ID,
                },
        },
        { teamFirstName: null, hasTeam: false },
      );
      expect(oneSucceeded.intent).toBe("answer");
      expect(oneSucceeded.reply).toBe(combinedSentence);
      expect(oneSucceeded.sourceRefs).toEqual([
        {
          sourceDocumentId: DOC_B,
          pageNumber: 2,
          shortLabel: "Academic evaluation",
          factId: "F2",
          studyRevisionId: REV_ID,
        },
      ]);
    });
  });
});