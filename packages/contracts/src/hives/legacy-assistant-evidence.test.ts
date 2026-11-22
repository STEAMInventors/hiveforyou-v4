import { describe, expect, it } from "vitest";

import { studyClaimCatalog, verifyStudyInvestigation } from "../analysis/study-verification";
import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "../pipeline/canonical-study-contracts";
import {
  MAYA_DOCS,
  MAYA_REVISION_6_PAGES,
  MAYA_REVISION_6_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaRevision6StudyOutput,
} from "../testing/maya-fixture";
import {
  briefingByteSize,
  buildAssistantBriefing,
} from "./assistant-briefing";
import {
  assistantAnswerNotFoundFallback,
  validateAssistantReply,
} from "./assistant-reply";
import {
  buildLegacyAssistantEvidence,
  EMPTY_LEGACY_ASSISTANT_EVIDENCE,
  mapLegacyAssistantFactRefs,
  type LegacyAuthorizedSnapshotDocument,
} from "./legacy-assistant-evidence";

const MAYA_V6_REVISION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";

function verifiedMayaRevision6() {
  const verified = verifyStudyInvestigation(mayaRevision6StudyOutput(), {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
    pages: new Map(Object.entries(MAYA_REVISION_6_PAGES)),
  });
  if (!verified.ok) throw new Error(verified.message);
  return verified.value;
}

function mayaRevision6AuthorizedDocs(): LegacyAuthorizedSnapshotDocument[] {
  return [
    { sourceDocumentId: MAYA_DOCS.iep2024, totalPhysicalPages: 1 },
    { sourceDocumentId: MAYA_DOCS.iep2025, totalPhysicalPages: 1 },
    { sourceDocumentId: MAYA_DOCS.progressNov, totalPhysicalPages: 1 },
    { sourceDocumentId: MAYA_DOCS.progressJan, totalPhysicalPages: 1 },
    { sourceDocumentId: MAYA_DOCS.serviceLog, totalPhysicalPages: 1 },
    { sourceDocumentId: MAYA_DOCS.evaluation, totalPhysicalPages: 1 },
    { sourceDocumentId: MAYA_DOCS.meetingNotice, totalPhysicalPages: 1 },
  ];
}

describe("buildLegacyAssistantEvidence — Maya Study v6", () => {
  it("adapts all verified FACT claims preserving claim IDs, statements, docs, pages, and quotes without leaking quotes into briefingFacts", () => {
    const verified = verifiedMayaRevision6();
    const expectedFactClaims = studyClaimCatalog(verified).filter((claim) => claim.kind === "FACT");

    const adapted = buildLegacyAssistantEvidence({
      expectedProcessingRunId: MAYA_RUN_ID,
      investigation: verified.investigation,
      verification: verified.verification,
      authorizedDocuments: mayaRevision6AuthorizedDocs(),
      authorizedPageText: new Map(Object.entries(MAYA_REVISION_6_PAGES)),
    });

    expect(adapted.rejectedFactCount).toBe(0);
    expect(adapted.briefingFacts.length).toBe(expectedFactClaims.length);
    expect(adapted.briefingFacts.length).toBeGreaterThanOrEqual(14);
    expect(adapted.briefingFacts.map((fact) => fact.id)).toEqual(expectedFactClaims.map((claim) => claim.id));

    const speechFact = adapted.factsById.get("P3.F0");
    expect(speechFact).toBeDefined();
    expect(speechFact?.statement).toBe(
      "360 speech therapy minutes were delivered between September and November 2025.",
    );
    expect(speechFact?.sourceDocumentId).toBe(MAYA_DOCS.serviceLog);
    expect(speechFact?.pageNumber).toBe(1);
    expect(speechFact?.quote).toContain("360 minutes");

    const compoundFact = adapted.factsById.get("P1.F1");
    expect(compoundFact?.evidence.length).toBe(4);

    // briefingFacts must NEVER embed verbatim quotes
    const briefing = buildAssistantBriefing({
      viewer: { role: "owner", roleLabel: "Owner", firstName: "Maya" },
      hive: { name: "Maya's Hive", purpose: null, matterType: null, stage: null },
      pack: null,
      checklist: [],
      study: {
        revisionId: MAYA_V6_REVISION_ID,
        revisionNumber: 6,
        canonical: null,
        sources: null,
        legacyFacts: adapted.briefingFacts,
      },
      documents: mayaRevision6AuthorizedDocs().map((doc, index) => ({
        label: adapted.documentLabels[doc.sourceDocumentId] ?? `Document ${index + 1}`,
        pages: doc.totalPhysicalPages,
        readState: "SUCCEEDED",
        unreadablePages: [],
      })),
      messages: [],
      question: "How many speech therapy minutes were delivered?",
      assistantName: "HiveForYou",
      hasTeam: false,
    });

    expect(briefing.study.facts.length).toBe(expectedFactClaims.length);
    expect(briefing.study.facts.some((f) => f.id === "P3.F0")).toBe(true);
    expect(JSON.stringify(briefing)).not.toContain("Speech therapy minutes delivered September to November 2025: 360 minutes.");
    expect(JSON.stringify(briefing).toLowerCase()).not.toContain(".pdf");
  });

  it("reuses existing briefing budgeting and question-relevance selection for legacy facts", () => {
    const verified = verifiedMayaRevision6();
    const adapted = buildLegacyAssistantEvidence({
      expectedProcessingRunId: MAYA_RUN_ID,
      investigation: verified.investigation,
      verification: verified.verification,
      authorizedDocuments: mayaRevision6AuthorizedDocs(),
    });

    const tightBriefing = buildAssistantBriefing({
      viewer: { role: "owner", roleLabel: "Owner", firstName: "Maya" },
      hive: { name: "Maya's Hive", purpose: null, matterType: null, stage: null },
      pack: null,
      checklist: [],
      study: {
        revisionId: MAYA_V6_REVISION_ID,
        revisionNumber: 6,
        canonical: null,
        sources: null,
        legacyFacts: adapted.briefingFacts,
      },
      documents: [],
      messages: [],
      question: "How many speech therapy minutes were delivered and required?",
      assistantName: "HiveForYou",
      hasTeam: false,
      budgetBytes: 1700,
    });

    expect(tightBriefing.study.facts.length).toBeGreaterThan(0);
    expect(tightBriefing.study.facts.length).toBeLessThan(adapted.briefingFacts.length);
    expect(briefingByteSize(tightBriefing)).toBeLessThanOrEqual(1700);
    // Question-relevance scoring prioritizes the speech therapy facts
    expect(tightBriefing.study.facts.some((fact) => fact.id === "P3.F0" || fact.id === "P3.F1")).toBe(true);
  });

  it("produces verified clickable citations for a supported plan question and blocks unsupported factual claims", () => {
    const verified = verifiedMayaRevision6();
    const adapted = buildLegacyAssistantEvidence({
      expectedProcessingRunId: MAYA_RUN_ID,
      investigation: verified.investigation,
      verification: verified.verification,
      authorizedDocuments: mayaRevision6AuthorizedDocs(),
    });

    const briefing = buildAssistantBriefing({
      viewer: { role: "owner", roleLabel: "Owner", firstName: "Maya" },
      hive: { name: "Maya's Hive", purpose: null, matterType: null, stage: null },
      pack: null,
      checklist: [],
      study: {
        revisionId: MAYA_V6_REVISION_ID,
        revisionNumber: 6,
        canonical: null,
        sources: null,
        legacyFacts: adapted.briefingFacts,
      },
      documents: [],
      messages: [],
      question: "How many speech therapy minutes were delivered and when is the annual review meeting?",
      assistantName: "HiveForYou",
      hasTeam: false,
    });

    const supported = validateAssistantReply(
      {
        intent: "answer",
        reply: "360 speech therapy minutes were delivered between September and November 2025. The annual review meeting is scheduled for March 3, 2026.",
        claims: [
          {
            text: "360 speech therapy minutes were delivered between September and November 2025.",
            factIds: ["P3.F0"],
          },
          {
            text: "The annual review meeting is scheduled for March 3, 2026.",
            factIds: ["P6.F1"],
          },
        ],
      },
      briefing,
      {
        revisionId: MAYA_V6_REVISION_ID,
        mapFact: (fact) => mapLegacyAssistantFactRefs(adapted, fact.id, MAYA_V6_REVISION_ID),
      },
      { teamFirstName: null, hasTeam: false },
    );

    expect(supported.intent).toBe("answer");
    expect(supported.routedOnly).toBe(false);
    expect(supported.reply).toContain("360 speech therapy minutes");
    expect(supported.sourceRefs).toEqual([
      {
        sourceDocumentId: MAYA_DOCS.serviceLog,
        pageNumber: 1,
        shortLabel: adapted.documentLabels[MAYA_DOCS.serviceLog],
        factId: "P3.F0",
        studyRevisionId: MAYA_V6_REVISION_ID,
      },
      {
        sourceDocumentId: MAYA_DOCS.meetingNotice,
        pageNumber: 1,
        shortLabel: adapted.documentLabels[MAYA_DOCS.meetingNotice],
        factId: "P6.F1",
        studyRevisionId: MAYA_V6_REVISION_ID,
      },
    ]);

    // Unsupported factual question cannot emit a factual claim
    const unsupported = validateAssistantReply(
      {
        intent: "answer",
        reply: "Maya takes 15 mg of allergy medicine daily.",
        claims: [{ text: "Maya takes 15 mg of allergy medicine daily.", factIds: ["P9.F0"] }],
      },
      { ...briefing, question: "What allergy medication does Maya take?" },
      {
        revisionId: MAYA_V6_REVISION_ID,
        mapFact: (fact) => mapLegacyAssistantFactRefs(adapted, fact.id, MAYA_V6_REVISION_ID),
      },
      { teamFirstName: null, hasTeam: false },
    );

    expect(unsupported.sourceRefs).toEqual([]);
    expect(unsupported.reply).toBe(assistantAnswerNotFoundFallback({ teamFirstName: null, hasTeam: false }));
    expect(unsupported.reply).not.toContain("15 mg");
  });

  it("maps multi-evidence facts to all unique verified document/page citations", () => {
    const verified = verifiedMayaRevision6();
    const adapted = buildLegacyAssistantEvidence({
      expectedProcessingRunId: MAYA_RUN_ID,
      investigation: verified.investigation,
      verification: verified.verification,
      authorizedDocuments: mayaRevision6AuthorizedDocs(),
    });

    const refs = mapLegacyAssistantFactRefs(adapted, "P1.F1", MAYA_V6_REVISION_ID);
    expect(refs).not.toBeNull();
    expect(refs?.map((ref) => `${ref.sourceDocumentId}:${ref.pageNumber}`)).toEqual([
      `${MAYA_DOCS.iep2024}:1`,
      `${MAYA_DOCS.progressNov}:1`,
      `${MAYA_DOCS.iep2025}:1`,
    ]);
  });

  it("keeps navigation questions independent of citations on legacy studies", () => {
    const verified = verifiedMayaRevision6();
    const adapted = buildLegacyAssistantEvidence({
      expectedProcessingRunId: MAYA_RUN_ID,
      investigation: verified.investigation,
      verification: verified.verification,
      authorizedDocuments: mayaRevision6AuthorizedDocs(),
    });

    const navBriefing = buildAssistantBriefing({
      viewer: { role: "owner", roleLabel: "Owner", firstName: "Maya" },
      hive: { name: "Maya's Hive", purpose: null, matterType: null, stage: null },
      pack: null,
      checklist: [],
      study: {
        revisionId: MAYA_V6_REVISION_ID,
        revisionNumber: 6,
        canonical: null,
        sources: null,
        legacyFacts: adapted.briefingFacts,
      },
      documents: [],
      messages: [],
      question: "Where are my documents?",
      assistantName: "HiveForYou",
      hasTeam: false,
    });

    const navReply = validateAssistantReply(
      { intent: "route_to_team", reply: "", claims: [] },
      navBriefing,
      {
        revisionId: MAYA_V6_REVISION_ID,
        mapFact: (fact) => mapLegacyAssistantFactRefs(adapted, fact.id, MAYA_V6_REVISION_ID),
      },
      { teamFirstName: null, hasTeam: false },
    );

    expect(navReply.intent).toBe("answer");
    expect(navReply.reply).toContain("Documents");
    expect(navReply.sourceRefs).toEqual([]);
  });
});

describe("buildLegacyAssistantEvidence — provenance & rejection guarantees", () => {
  it("excludes invalid, unverified, unauthorized, missing-page, empty-quote, and out-of-bounds references", () => {
    const verified = verifiedMayaRevision6();
    const mutatedInvestigation = structuredClone(verified.investigation);
    const mutatedVerification = structuredClone(verified.verification);

    // 1. Unverified claim: remove P1.F0 from verification.claimIds
    mutatedVerification.claimIds = mutatedVerification.claimIds.filter((id) => id !== "P1.F0");

    // 2. Unauthorized document on P2.F0
    mutatedInvestigation.answers[1]!.facts[0]!.evidence[0]!.sourceDocumentId =
      "99999999-9999-4999-8999-999999999999";

    // 3. Out-of-bounds page number on P2.F1 (doc only has 1 page)
    mutatedInvestigation.answers[1]!.facts[1]!.evidence[0]!.pageNumber = 2;

    // 4. Empty quote on P3.F0
    mutatedInvestigation.answers[2]!.facts[0]!.evidence[0]!.quote = "   ";

    // 5. Missing/empty page on P3.F1 (mark page 1 of serviceLog as missing in snapshot)
    const docs = mayaRevision6AuthorizedDocs().map((doc) =>
      doc.sourceDocumentId === MAYA_DOCS.serviceLog
        ? { ...doc, missingPageNumbers: [1] }
        : doc,
    );

    const adapted = buildLegacyAssistantEvidence({
      expectedProcessingRunId: MAYA_RUN_ID,
      investigation: mutatedInvestigation,
      verification: mutatedVerification,
      authorizedDocuments: docs,
    });

    expect(adapted.factsById.has("P1.F0")).toBe(false);
    expect(adapted.factsById.has("P2.F0")).toBe(false);
    expect(adapted.factsById.has("P2.F1")).toBe(false);
    expect(adapted.factsById.has("P3.F0")).toBe(false);
    expect(adapted.factsById.has("P3.F1")).toBe(false);
    expect(adapted.factsById.has("P4.F0")).toBe(false); // P4.F0 cites serviceLog:1 which is missing
    // Valid unaffected facts remain present
    expect(adapted.factsById.has("P1.F2")).toBe(true);
    expect(adapted.factsById.has("P6.F1")).toBe(true);
    expect(adapted.rejectedFactCount).toBeGreaterThanOrEqual(6);
  });

  it("fails closed when verification is missing, wrong schema, or mismatched processingRunId", () => {
    const verified = verifiedMayaRevision6();
    const docs = mayaRevision6AuthorizedDocs();

    expect(
      buildLegacyAssistantEvidence({
        expectedProcessingRunId: MAYA_RUN_ID,
        investigation: verified.investigation,
        verification: null,
        authorizedDocuments: docs,
      }),
    ).toBe(EMPTY_LEGACY_ASSISTANT_EVIDENCE);

    expect(
      buildLegacyAssistantEvidence({
        expectedProcessingRunId: "5a5a5a5a-0000-4000-8000-0000000000ff",
        investigation: verified.investigation,
        verification: verified.verification,
        authorizedDocuments: docs,
      }),
    ).toBe(EMPTY_LEGACY_ASSISTANT_EVIDENCE);

    expect(
      buildLegacyAssistantEvidence({
        expectedProcessingRunId: MAYA_RUN_ID,
        investigation: verified.investigation,
        verification: { ...verified.verification, schema: "wrong.schema/1" },
        authorizedDocuments: docs,
      }),
    ).toBe(EMPTY_LEGACY_ASSISTANT_EVIDENCE);

    expect(
      buildLegacyAssistantEvidence({
        expectedProcessingRunId: MAYA_RUN_ID,
        investigation: verified.investigation,
        verification: verified.verification,
        authorizedDocuments: [],
      }),
    ).toBe(EMPTY_LEGACY_ASSISTANT_EVIDENCE);
  });

  it("rejects cross-document or ungrounded DF findings and unread pages in documentCoverage", () => {
    const docA = MAYA_DOCS.iep2024;
    const docB = MAYA_DOCS.iep2025;
    const investigation = {
      schema: "hive.study-investigation/1",
      processingRunId: MAYA_RUN_ID,
      documents: [
        {
          sourceDocumentId: docA,
          role: "PRIMARY",
          roleReasoning: "Main plan",
          documentType: "Individualized Education Program",
          temporalStatus: "CURRENT",
          declaredReadCoverage: "FULL_DOCUMENT_READ",
          pagesRead: [1],
          pagesCited: [1],
          evidence: [{ sourceDocumentId: docA, pageNumber: 1, quote: "Baseline: 62 words correct per minute." }],
        },
      ],
      documentFindings: [
        {
          id: "DF1",
          sourceDocumentId: docA,
          category: "Reading",
          subject: "Maya",
          attribute: "Baseline",
          valueAsWritten: "62 words correct per minute",
          statement: "Baseline reading fluency is 62 words correct per minute.",
          modality: "MEASURED",
          itemKey: null,
          dates: [],
          evidence: [{ sourceDocumentId: docA, pageNumber: 1, quote: "Baseline: 62 words correct per minute." }],
        },
        {
          // Cross-document evidence must be rejected
          id: "DF2",
          sourceDocumentId: docA,
          category: "Reading",
          subject: "Maya",
          attribute: "Goal",
          valueAsWritten: "90 words correct per minute",
          statement: "Annual goal is 90 words correct per minute.",
          modality: "PLANNED",
          itemKey: null,
          dates: [],
          evidence: [{ sourceDocumentId: docB, pageNumber: 1, quote: "Goal 1: Maya will read 90 words correct per minute by March 2026." }],
        },
        {
          // Ungrounded number (999 not in quote) must be rejected
          id: "DF3",
          sourceDocumentId: docA,
          category: "Reading",
          subject: "Maya",
          attribute: "Bad metric",
          valueAsWritten: "999 words",
          statement: "Baseline was 999 words correct per minute.",
          modality: "MEASURED",
          itemKey: null,
          dates: [],
          evidence: [{ sourceDocumentId: docA, pageNumber: 1, quote: "Baseline: 62 words correct per minute." }],
        },
        {
          // Unread page (page 2 not in pagesRead) must be rejected
          id: "DF4",
          sourceDocumentId: docA,
          category: "Reading",
          subject: "Maya",
          attribute: "Page 2",
          valueAsWritten: "62 words",
          statement: "Baseline was 62 words.",
          modality: "MEASURED",
          itemKey: null,
          dates: [],
          evidence: [{ sourceDocumentId: docA, pageNumber: 2, quote: "Baseline: 62 words correct per minute." }],
        },
      ],
      answers: [
        {
          planQuestionId: "P1",
          status: "ANSWERED",
          answer: "Baseline is 62.",
          facts: [],
          calculations: [],
          assessments: [],
          uncertainties: [],
          professionalDeterminations: [],
          evidence: [],
          conflicts: [],
          limitations: [],
        },
      ],
      coverageNotes: [],
      instructionsIgnored: [],
    };
    const verification = {
      schema: "hive.study-verification/1",
      processingRunId: MAYA_RUN_ID,
      questionIds: ["P1"],
      claimIds: ["DF1", "DF2", "DF3", "DF4", "P1"],
      calculations: [],
      documentCoverage: [
        {
          sourceDocumentId: docA,
          role: "PRIMARY",
          temporalStatus: "CURRENT",
          declaredReadCoverage: "PARTIAL_DOCUMENT_READ",
          readCoverageStatus: "PARTIAL_PAGES_READ",
          extractionCompletenessStatus: "UNVERIFIED_BY_READ_COVERAGE",
          authorizedPageNumbers: [1, 2],
          authorizedNonEmptyPageNumbers: [1, 2],
          pagesRead: [1],
          pagesCited: [1],
          findingCount: 4,
        },
      ],
      counts: { answers: 1, facts: 0, documentFindings: 4, calculations: 0, verifiedCalculations: 0, quotes: 4, citedPages: 2 },
    };

    const adapted = buildLegacyAssistantEvidence({
      expectedProcessingRunId: MAYA_RUN_ID,
      investigation,
      verification,
      authorizedDocuments: [
        { sourceDocumentId: docA, totalPhysicalPages: 2 },
        { sourceDocumentId: docB, totalPhysicalPages: 1 },
      ],
    });

    expect(adapted.briefingFacts.map((f) => f.id)).toEqual(["DF1"]);
    expect(adapted.factsById.get("DF1")?.sourceLabel).toBe("Individualized Education Program");
    expect(adapted.rejectedFactCount).toBe(3);
  });

  it("never falls back to legacyFacts when canonical study is present in buildAssistantBriefing", () => {
    const canonical: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "Records review",
      spineSource: "ANCHOR",
      documents: [
        {
          sourceDocumentId: MAYA_DOCS.iep2025,
          role: "ANCHOR",
          typeInPlainWords: "2025 Plan Amendment",
          date: "2025-03-04",
          version: null,
          chainPosition: 1,
        },
      ],
      spine: [],
      outsideSpine: [{ id: "O1", statement: "Canonical reading target is 90 words per minute", factIds: ["CF1"] }],
      conflicts: [],
      timeline: [],
      gaps: [],
    };

    const briefing = buildAssistantBriefing({
      viewer: { role: "owner", roleLabel: "Owner", firstName: "Maya" },
      hive: { name: "Maya's Hive 11/05", purpose: null, matterType: null, stage: null },
      pack: null,
      checklist: [],
      study: {
        revisionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        revisionNumber: 1,
        canonical,
        sources: {
          documents: {},
          facts: {
            CF1: {
              sourceDocumentId: MAYA_DOCS.iep2025,
              pageNumber: 1,
              quote: "90 words correct per minute",
            },
          },
        },
        legacyFacts: [
          { id: "P1.F0", statement: "Legacy fact must not appear", sourceLabel: "Document 1", page: 1 },
        ],
      },
      documents: [],
      messages: [],
      question: "What is the reading target?",
      assistantName: "HiveForYou",
    });

    expect(briefing.study.facts.map((f) => f.id)).toEqual(["CF1"]);
    expect(briefing.study.facts.some((f) => f.id === "P1.F0")).toBe(false);
  });
});
