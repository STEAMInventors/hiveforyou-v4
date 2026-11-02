import type { SnapshotDocument, SourceSnapshot } from "@hiveforyou/contracts";

export const HIVE_ID = "11111111-1111-4111-8111-111111111111";
export const RUN_ID = "22222222-2222-4222-8222-222222222222";
export const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
export const CORRELATION_ID = "66666666-6666-4666-8666-666666666666";
export const INTENT_A = "77777777-7777-4777-8777-777777777777";
export const INTENT_B = "88888888-8888-4888-8888-888888888888";
export const DOC_1 = "33333333-3333-4333-8333-333333333333";
export const DOC_2 = "44444444-4444-4444-8444-444444444444";

const SHA = `sha256:${"a".repeat(64)}`;

export const INTENTS = [
  { id: INTENT_A, intentText: "Which supplier gave us the better deal across both quotes?" },
  { id: INTENT_B, intentText: "What deadlines do we have to meet?" },
];

export function snapshotDocument(id: string, fileName: string, overrides: Partial<SnapshotDocument> = {}): SnapshotDocument {
  return {
    sourceDocumentId: id,
    fileName,
    mimeType: "application/pdf",
    sha256: "b".repeat(64),
    readId: "99999999-9999-4999-8999-999999999999",
    readStatus: "SUCCEEDED",
    readFingerprint: `fp-${id.slice(0, 8)}`,
    pageSetDigest: SHA,
    totalPhysicalPages: 3,
    verifiedPageCount: 3,
    missingPageNumbers: [],
    emptyPageNumbers: [],
    createdAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}

export function sourceSnapshot(overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    documents: [snapshotDocument(DOC_1, "Quote A.pdf"), snapshotDocument(DOC_2, "Quote B.pdf")],
    excluded: [],
    coverageComplete: true,
    ...overrides,
  };
}

export function samplePages(id: string) {
  return {
    sourceDocumentId: id,
    pages: [1, 2, 3].map((pageNumber) => ({ pageNumber, text: `Supplier quotation ${id.slice(0, 4)} page ${pageNumber}` })),
  };
}

export function intentOutput() {
  return {
    objectives: [
      {
        id: "O1",
        intentRequestId: INTENT_A,
        title: "Compare the two supplier quotes",
        description: "Find which quote costs less in total for the same scope.",
        questions: [
          {
            id: "Q1",
            text: "What is the total price, including fees, in each quote?",
            answerType: "COMPARISON",
            dependsOn: [],
            requiredEvidence: ["Price table in each quote"],
            comparisons: ["Quote A total versus Quote B total"],
            expectedOutput: "Both totals and the difference.",
          },
        ],
      },
      {
        id: "O2",
        intentRequestId: INTENT_B,
        title: "Deadlines",
        description: "Every date by which the buyer must act.",
        questions: [
          {
            id: "Q2",
            text: "By which dates must the buyer accept, pay or respond?",
            answerType: "CHRONOLOGY",
            dependsOn: [],
            requiredEvidence: ["Validity and payment terms"],
            comparisons: [],
            expectedOutput: "Dated list in order.",
          },
        ],
      },
    ],
    expectedOutputs: ["Cost comparison table", "Deadline list"],
    ambiguities: [],
    missingContext: [],
  };
}

export function domainOutput() {
  return {
    primary: {
      label: "Procurement",
      subdomain: "Supplier quotations",
      confidence: "MEDIUM",
      reasoning: "Both documents are headed as quotations with price tables.",
      supportingRefs: [{ sourceDocumentId: DOC_1, pageNumber: 1 }],
    },
    alternatives: [
      {
        label: "Contract law",
        subdomain: null,
        reasoning: "Quotes contain acceptance terms.",
        supportingRefs: [{ sourceDocumentId: DOC_2, pageNumber: 1 }],
      },
    ],
    unknownDomain: false,
    mixedDomain: false,
    ambiguous: false,
    ambiguityNotes: [],
  };
}

export function planOutput() {
  return {
    domainBasis: {
      primaryDomain: "Procurement",
      uncertain: false,
      considerations: [
        { text: "Quotes usually expire after a validity period.", supportingRefs: [{ sourceDocumentId: DOC_1, pageNumber: 1 }] },
      ],
    },
    questions: [
      {
        id: "P1",
        objectiveId: "O1",
        sourceQuestionIds: ["Q1"],
        establish: "The all-in price of each quote for the same delivered scope.",
        requiredEvidence: ["Line items and fees in each quote"],
        comparison: "Quote A all-in total against Quote B all-in total",
        chronology: null,
        calculation: null,
        missingEvidenceConditions: ["A quote lists no total and no line prices"],
        answerType: "COMPARISON",
        deliverable: "Table: supplier, total, fees, difference",
        dependsOn: [],
        domainConsiderationRefs: [],
      },
      {
        id: "P2",
        objectiveId: "O2",
        sourceQuestionIds: ["Q2"],
        establish: "Each acceptance, payment and response date stated in either quote.",
        requiredEvidence: ["Validity period and payment terms"],
        comparison: null,
        chronology: "Order every stated date from earliest to latest",
        calculation: null,
        missingEvidenceConditions: ["No dates or validity period on any page"],
        answerType: "CHRONOLOGY",
        deliverable: "Dated list with the source page for each date",
        dependsOn: [],
        domainConsiderationRefs: [{ sourceDocumentId: DOC_1, pageNumber: 1 }],
      },
    ],
  };
}

export function runJson(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    hiveId: HIVE_ID,
    kind: "STUDY_PREPARATION",
    requestId: REQUEST_ID,
    attemptNumber: 1,
    status,
    authorizedSourceDocumentIds: [DOC_1, DOC_2],
    intentRequestIds: [INTENT_A, INTENT_B],
    coverageComplete: true,
    coverageAcknowledged: false,
    stageMetrics: [],
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: CORRELATION_ID,
    createdAt: "2026-11-01T10:00:00.000Z",
    startedAt: null,
    updatedAt: "2026-11-01T10:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}
