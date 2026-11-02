import { describe, expect, it } from "vitest";

import {
  analyzeAvailability,
  describeCoverageGaps,
  normalizeGetStudyPreparationResponse,
  normalizeProcessingRun,
  stageIndexForStatus,
  STUDY_PREPARATION_STAGES,
  type SnapshotDocument,
  type StudyPreparationEligibility,
  validateStartStudyPreparationInput,
} from "./study-preparation-contracts";

const RUN_ID = "55555555-5555-4555-8555-555555555555";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const CORRELATION_ID = "77777777-7777-4777-8777-777777777777";
const DIGEST = `sha256:${"a".repeat(64)}`;

function rawRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    hiveId: HIVE_ID,
    kind: "STUDY_PREPARATION",
    requestId: REQUEST_ID,
    attemptNumber: 1,
    status: "IDENTIFYING_DOMAIN",
    authorizedSourceDocumentIds: [DOC_ID],
    intentRequestIds: [REQUEST_ID],
    coverageComplete: false,
    coverageAcknowledged: true,
    stageMetrics: [],
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: CORRELATION_ID,
    createdAt: "2026-11-02T03:00:00Z",
    startedAt: "2026-11-02T03:00:01Z",
    updatedAt: "2026-11-02T03:00:02Z",
    finishedAt: null,
    ...overrides,
  };
}

function snapshotDocument(overrides: Partial<SnapshotDocument> = {}): SnapshotDocument {
  return {
    sourceDocumentId: DOC_ID,
    fileName: "lease.pdf",
    mimeType: "application/pdf",
    sha256: "b".repeat(64),
    readId: RUN_ID,
    readStatus: "SUCCEEDED",
    readFingerprint: "reader-document-read@1:x",
    pageSetDigest: DIGEST,
    totalPhysicalPages: 2,
    verifiedPageCount: 2,
    missingPageNumbers: [],
    emptyPageNumbers: [],
    createdAt: "2026-11-02T03:00:00Z",
    ...overrides,
  };
}

function eligibility(overrides: Partial<StudyPreparationEligibility> = {}): StudyPreparationEligibility {
  return {
    documents: [snapshotDocument()],
    excluded: [],
    coverageComplete: true,
    activeReadCount: 0,
    coverageDigest: DIGEST,
    ...overrides,
  };
}

describe("validateStartStudyPreparationInput", () => {
  it("accepts a request id with or without a coverage acknowledgment", () => {
    expect(validateStartStudyPreparationInput({ clientRequestId: REQUEST_ID })).toEqual({
      ok: true,
      value: { clientRequestId: REQUEST_ID, coverageAcknowledgementDigest: null },
    });
    expect(
      validateStartStudyPreparationInput({ clientRequestId: REQUEST_ID, coverageAcknowledgementDigest: DIGEST }),
    ).toEqual({ ok: true, value: { clientRequestId: REQUEST_ID, coverageAcknowledgementDigest: DIGEST } });
  });

  it("rejects unexpected fields, bad ids and malformed digests", () => {
    expect(validateStartStudyPreparationInput({ clientRequestId: REQUEST_ID, sourceDocumentIds: [] })).toMatchObject({
      ok: false,
      diagnosticReason: "unexpected_field",
    });
    expect(validateStartStudyPreparationInput({ clientRequestId: "nope" })).toMatchObject({
      ok: false,
      diagnosticReason: "invalid_client_request_id",
    });
    expect(
      validateStartStudyPreparationInput({ clientRequestId: REQUEST_ID, coverageAcknowledgementDigest: "yes" }),
    ).toMatchObject({ ok: false, diagnosticReason: "invalid_coverage_digest" });
  });
});

describe("normalizeProcessingRun", () => {
  it("normalizes a persisted run", () => {
    expect(normalizeProcessingRun(rawRun())?.status).toBe("IDENTIFYING_DOMAIN");
  });

  it("rejects unknown statuses and kinds", () => {
    expect(normalizeProcessingRun(rawRun({ status: "DONE" }))).toBeNull();
    expect(normalizeProcessingRun(rawRun({ kind: "EXTRACTION" }))).toBeNull();
  });

  it("normalizes the full GET response", () => {
    const response = normalizeGetStudyPreparationResponse({
      processingRun: rawRun(),
      preview: null,
      previewSummary: null,
      staleness: null,
      eligibility: eligibility(),
    });
    expect(response?.processingRun?.id).toBe(RUN_ID);
    expect(normalizeGetStudyPreparationResponse({ eligibility: { documents: [] } })).toBeNull();
  });
});

describe("stages", () => {
  it("maps statuses onto the five visible stages", () => {
    expect(STUDY_PREPARATION_STAGES.map((stage) => stage.label)).toEqual([
      "Understanding your request",
      "Identifying the domain",
      "Developing specialist questions",
      "Planning the investigation",
      "Constructing your study prompt",
    ]);
    expect(stageIndexForStatus("QUEUED")).toBe(-1);
    expect(stageIndexForStatus("DEVELOPING_QUESTIONS")).toBe(2);
    expect(stageIndexForStatus("PLANNING_INVESTIGATION")).toBe(3);
    expect(stageIndexForStatus("SAVING")).toBe(4);
  });
});

describe("analyzeAvailability", () => {
  it("enables Analyze after a verified read with complete coverage", () => {
    expect(analyzeAvailability(eligibility(), null)).toEqual({
      canAnalyze: true,
      requiresCoverageAcknowledgement: false,
    });
  });

  it("requires acknowledgment for partial coverage", () => {
    expect(analyzeAvailability(eligibility({ coverageComplete: false }), null)).toEqual({
      canAnalyze: true,
      requiresCoverageAcknowledgement: true,
    });
  });

  it("blocks Analyze while reads or a preparation are active, or when nothing is read", () => {
    expect(analyzeAvailability(eligibility({ activeReadCount: 1 }), null)).toMatchObject({ reason: "READ_ACTIVE" });
    expect(analyzeAvailability(eligibility(), { status: "PLANNING_INVESTIGATION" })).toMatchObject({
      reason: "PREPARATION_ACTIVE",
    });
    expect(analyzeAvailability(eligibility({ documents: [] }), null)).toMatchObject({
      reason: "NO_ELIGIBLE_DOCUMENTS",
    });
    expect(analyzeAvailability(eligibility(), { status: "FAILED" })).toMatchObject({ canAnalyze: true });
  });
});

describe("describeCoverageGaps", () => {
  it("lists excluded documents, partial reads, missing and blank pages", () => {
    const gaps = describeCoverageGaps({
      documents: [
        snapshotDocument({ readStatus: "PARTIAL", totalPhysicalPages: 4, missingPageNumbers: [4], emptyPageNumbers: [2] }),
      ],
      excluded: [{ sourceDocumentId: RUN_ID, fileName: "scan.png", reason: "UNREADABLE" }],
    });
    expect(gaps.map((gap) => gap.kind)).toEqual(["EXCLUDED", "PARTIAL_READ", "MISSING_PAGES", "EMPTY_PAGES"]);
    expect(gaps[2].pageNumbers).toEqual([4]);
  });

  it("reports no gaps when coverage is complete", () => {
    expect(describeCoverageGaps({ documents: [snapshotDocument()], excluded: [] })).toEqual([]);
  });
});
