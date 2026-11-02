import { describe, expect, it } from "vitest";

import {
  analyzeAvailability,
  type CoverageGap,
  documentsToRead,
  knownGapsToAcknowledge,
  knownLimitations,
  normalizeCoverageGaps,
  normalizeGetStudyPreparationResponse,
  normalizeProcessingRun,
  normalizeReportRun,
  stageIndexForStatus,
  STUDY_PREPARATION_STAGES,
  type SnapshotDocument,
  type StudyPreparationEligibility,
  validateAcknowledgeStudyCoverageInput,
  validateStartStudyPreparationInput,
} from "./study-preparation-contracts";

const RUN_ID = "55555555-5555-4555-8555-555555555555";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_DOC_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const CORRELATION_ID = "77777777-7777-4777-8777-777777777777";
const REVISION_ID = "88888888-8888-4888-8888-888888888888";
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
    snapshotFrozen: true,
    stageAttempt: 1,
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

function rawReportRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    hiveId: HIVE_ID,
    studyRevisionId: REVISION_ID,
    audience: "CUSTOMER",
    trigger: "STUDY_ACCEPTED",
    status: "WRITING",
    attemptCount: 1,
    maxAttempts: 3,
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: CORRELATION_ID,
    reportId: null,
    createdAt: "2026-11-02T03:00:00Z",
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

function gap(overrides: Partial<CoverageGap> = {}): CoverageGap {
  return {
    key: `PAGES_NOT_READ:${DOC_ID}:${"a".repeat(64)}`,
    sourceDocumentId: DOC_ID,
    fileName: "lease.pdf",
    reason: "PAGES_NOT_READ",
    pageNumbers: [4],
    material: true,
    acknowledged: false,
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
    gaps: [],
    ...overrides,
  };
}

describe("validateStartStudyPreparationInput", () => {
  it("accepts a request id with or without a coverage acknowledgement", () => {
    expect(validateStartStudyPreparationInput({ clientRequestId: REQUEST_ID })).toEqual({
      ok: true,
      value: { clientRequestId: REQUEST_ID, coverageAcknowledgementDigest: null },
    });
    expect(
      validateStartStudyPreparationInput({ clientRequestId: REQUEST_ID, coverageAcknowledgementDigest: DIGEST }),
    ).toEqual({ ok: true, value: { clientRequestId: REQUEST_ID, coverageAcknowledgementDigest: DIGEST } });
  });

  it("rejects unexpected fields (including blanket partial-coverage consent), bad ids and malformed digests", () => {
    expect(validateStartStudyPreparationInput({ clientRequestId: REQUEST_ID, sourceDocumentIds: [] })).toMatchObject({
      ok: false,
      diagnosticReason: "unexpected_field",
    });
    expect(
      validateStartStudyPreparationInput({ clientRequestId: REQUEST_ID, acceptPartialCoverage: true }),
    ).toMatchObject({ ok: false, diagnosticReason: "unexpected_field" });
    expect(validateStartStudyPreparationInput({ clientRequestId: "nope" })).toMatchObject({
      ok: false,
      diagnosticReason: "invalid_client_request_id",
    });
    expect(
      validateStartStudyPreparationInput({ clientRequestId: REQUEST_ID, coverageAcknowledgementDigest: "yes" }),
    ).toMatchObject({ ok: false, diagnosticReason: "invalid_coverage_digest" });
  });
});

describe("validateAcknowledgeStudyCoverageInput", () => {
  it("accepts the paused run and the coverage digest the owner reviewed", () => {
    expect(validateAcknowledgeStudyCoverageInput({ processingRunId: RUN_ID.toUpperCase(), coverageDigest: DIGEST })).toEqual({
      ok: true,
      value: { processingRunId: RUN_ID, coverageDigest: DIGEST },
    });
  });

  it("rejects missing digests, bad ids and unexpected fields", () => {
    expect(validateAcknowledgeStudyCoverageInput({ processingRunId: RUN_ID })).toMatchObject({
      ok: false,
      diagnosticReason: "invalid_coverage_digest",
    });
    expect(validateAcknowledgeStudyCoverageInput({ processingRunId: "x", coverageDigest: DIGEST })).toMatchObject({
      ok: false,
      diagnosticReason: "invalid_processing_run_id",
    });
    expect(
      validateAcknowledgeStudyCoverageInput({ processingRunId: RUN_ID, coverageDigest: DIGEST, all: true }),
    ).toMatchObject({ ok: false, diagnosticReason: "unexpected_field" });
    expect(validateAcknowledgeStudyCoverageInput(null)).toMatchObject({ ok: false });
  });
});

describe("normalizeProcessingRun", () => {
  it("normalizes a persisted run", () => {
    expect(normalizeProcessingRun(rawRun())?.status).toBe("IDENTIFYING_DOMAIN");
  });

  it("normalizes a run that is still reading documents (no coverage yet)", () => {
    const run = normalizeProcessingRun(rawRun({ status: "READING_DOCUMENTS", authorizedSourceDocumentIds: [], snapshotFrozen: false }));
    expect(run).toMatchObject({
      status: "READING_DOCUMENTS",
      snapshotFrozen: false,
      coverageStatus: null,
      coverageGaps: [],
      coverageAcknowledgement: null,
    });
  });

  it("normalizes a run paused for coverage review with its persisted gaps", () => {
    const run = normalizeProcessingRun(
      rawRun({
        status: "AWAITING_ACKNOWLEDGEMENT",
        coverageDigest: DIGEST,
        coverageStatus: "MATERIAL_GAPS",
        coverageGaps: [gap(), { key: "bad" }],
        coverageAcknowledgement: "PENDING",
        coverageAcknowledgedAt: null,
      }),
    );
    expect(run).toMatchObject({
      status: "AWAITING_ACKNOWLEDGEMENT",
      coverageDigest: DIGEST,
      coverageStatus: "MATERIAL_GAPS",
      coverageAcknowledgement: "PENDING",
    });
    expect(run?.coverageGaps).toHaveLength(1);
    expect(stageIndexForStatus("AWAITING_ACKNOWLEDGEMENT")).toBe(0);
  });

  it("rejects unknown statuses and kinds, and drops unknown coverage values", () => {
    expect(normalizeProcessingRun(rawRun({ status: "DONE" }))).toBeNull();
    expect(normalizeProcessingRun(rawRun({ kind: "EXTRACTION" }))).toBeNull();
    expect(normalizeProcessingRun(rawRun({ coverageStatus: "MOSTLY", coverageAcknowledgement: "MAYBE" }))).toMatchObject({
      coverageStatus: null,
      coverageAcknowledgement: null,
    });
  });

  it("normalizes the full GET response with the accepted revision, its limitations and Writer runs", () => {
    const response = normalizeGetStudyPreparationResponse({
      processingRun: rawRun({ status: "SUCCEEDED", finishedAt: "2026-11-02T03:05:00Z" }),
      preview: null,
      previewSummary: null,
      staleness: null,
      eligibility: eligibility({ gaps: [gap({ acknowledged: true })] }),
      studyRevision: {
        id: REVISION_ID,
        canonicalStudyId: HIVE_ID,
        revisionNumber: 1,
        predecessorRevisionId: null,
        processingRunId: RUN_ID,
        coverageComplete: false,
        coverageStatus: "MATERIAL_GAPS",
        coverageGaps: [gap()],
        coverageAcknowledgement: "OWNER",
        createdAt: "2026-11-02T03:05:00Z",
      },
      reportRuns: [rawReportRun(), rawReportRun({ audience: "PRO", status: "BOGUS" })],
    });
    expect(response?.processingRun?.id).toBe(RUN_ID);
    expect(response?.eligibility.gaps).toHaveLength(1);
    expect(response?.studyRevision).toMatchObject({ revisionNumber: 1, coverageStatus: "MATERIAL_GAPS", coverageAcknowledgement: "OWNER" });
    expect(response?.studyRevision?.coverageGaps).toHaveLength(1);
    expect(response?.reportRuns.map((run) => run.audience)).toEqual(["CUSTOMER"]);
    expect(normalizeGetStudyPreparationResponse({ eligibility: { documents: [] } })).toBeNull();
  });
});

describe("normalizeCoverageGaps", () => {
  it("keeps well-formed gaps and drops anything else", () => {
    expect(normalizeCoverageGaps(null)).toEqual([]);
    expect(
      normalizeCoverageGaps([
        gap({ sourceDocumentId: DOC_ID.toUpperCase() }),
        gap({ reason: "SOMETHING" as CoverageGap["reason"] }),
        { ...gap(), material: "yes" },
      ]),
    ).toEqual([gap()]);
  });
});

describe("normalizeReportRun", () => {
  it("rejects unknown audiences and triggers", () => {
    expect(normalizeReportRun(rawReportRun())?.status).toBe("WRITING");
    expect(normalizeReportRun(rawReportRun({ audience: "BOTH" }))).toBeNull();
    expect(normalizeReportRun(rawReportRun({ trigger: "BROWSER" }))).toBeNull();
  });
});

describe("stages", () => {
  it("maps statuses onto the visible stages from reading to checking the evidence", () => {
    expect(STUDY_PREPARATION_STAGES.map((stage) => stage.label)).toEqual([
      "Reading your documents",
      "Understanding your request",
      "Identifying the domain",
      "Developing specialist questions",
      "Planning the investigation",
      "Constructing your study prompt",
      "Investigating your documents",
      "Checking the evidence",
    ]);
    expect(stageIndexForStatus("QUEUED")).toBe(-1);
    expect(stageIndexForStatus("READING_DOCUMENTS")).toBe(0);
    expect(stageIndexForStatus("DEVELOPING_QUESTIONS")).toBe(3);
    expect(stageIndexForStatus("SAVING")).toBe(5);
    expect(stageIndexForStatus("INVESTIGATING")).toBe(6);
    expect(stageIndexForStatus("ACCEPTING_STUDY")).toBe(7);
  });
});

describe("analyzeAvailability (B5)", () => {
  it("starts directly after verified reads with complete coverage", () => {
    expect(analyzeAvailability(eligibility(), null)).toEqual({ canAnalyze: true, requiresCoverageAcknowledgement: false });
  });

  it("does not ask for consent up front just because documents still need reading", () => {
    const unread = eligibility({
      documents: [],
      excluded: [{ sourceDocumentId: DOC_ID, fileName: "lease.pdf", reason: "NOT_READ" }],
      coverageComplete: false,
      gaps: [gap({ key: `EXCLUDED:${DOC_ID}:NOT_READ`, reason: "NOT_READ", pageNumbers: [] })],
    });
    expect(analyzeAvailability(unread, null)).toEqual({ canAnalyze: true, requiresCoverageAcknowledgement: false });
    expect(analyzeAvailability(eligibility({ activeReadCount: 1 }), null)).toMatchObject({ canAnalyze: true });
  });

  it("asks for acknowledgement of known material gaps never acknowledged in this Hive", () => {
    expect(analyzeAvailability(eligibility({ gaps: [gap()] }), null)).toEqual({
      canAnalyze: true,
      requiresCoverageAcknowledgement: true,
    });
  });

  it("reuses previously acknowledged gaps and lets nonmaterial gaps proceed", () => {
    const acknowledged = eligibility({ gaps: [gap({ acknowledged: true })] });
    expect(analyzeAvailability(acknowledged, null)).toEqual({ canAnalyze: true, requiresCoverageAcknowledgement: false });
    const blank = eligibility({
      gaps: [gap({ key: `PAGES_WITHOUT_TEXT:${DOC_ID}:${"a".repeat(64)}`, reason: "PAGES_WITHOUT_TEXT", material: false })],
    });
    expect(analyzeAvailability(blank, null)).toEqual({ canAnalyze: true, requiresCoverageAcknowledgement: false });
    expect(knownLimitations(blank).map((item) => item.reason)).toEqual(["PAGES_WITHOUT_TEXT"]);
  });

  it("blocks Analyze while a run is active or paused for review, or when there are no documents", () => {
    expect(analyzeAvailability(eligibility(), { status: "INVESTIGATING" })).toMatchObject({ reason: "PREPARATION_ACTIVE" });
    expect(analyzeAvailability(eligibility(), { status: "AWAITING_ACKNOWLEDGEMENT" })).toMatchObject({
      reason: "AWAITING_ACKNOWLEDGEMENT",
    });
    expect(analyzeAvailability(eligibility({ documents: [] }), null)).toMatchObject({ reason: "NO_DOCUMENTS" });
    expect(analyzeAvailability(eligibility(), { status: "FAILED" })).toMatchObject({ canAnalyze: true });
  });
});

describe("documentsToRead and known gaps", () => {
  it("lists documents Analyze will read, not ones known to be unreadable", () => {
    const docs = documentsToRead({
      excluded: [
        { sourceDocumentId: DOC_ID, fileName: "a.pdf", reason: "NOT_READ" },
        { sourceDocumentId: RUN_ID, fileName: "b.png", reason: "UNREADABLE" },
        { sourceDocumentId: HIVE_ID, fileName: "c.pdf", reason: "READ_FAILED" },
        { sourceDocumentId: OTHER_DOC_ID, fileName: "d.pdf", reason: "READ_ACTIVE" },
      ],
    });
    expect(docs.map((doc) => doc.fileName)).toEqual(["a.pdf", "c.pdf", "d.pdf"]);
  });

  it("excludes gaps of documents about to be read from what needs acknowledging now", () => {
    const gaps = knownGapsToAcknowledge({
      excluded: [
        { sourceDocumentId: DOC_ID, fileName: "a.pdf", reason: "READ_FAILED" },
        { sourceDocumentId: OTHER_DOC_ID, fileName: "scan.png", reason: "UNREADABLE" },
      ],
      gaps: [
        gap({ key: `EXCLUDED:${DOC_ID}:READ_FAILED`, reason: "READ_FAILED" }),
        gap({ key: `EXCLUDED:${OTHER_DOC_ID}:UNREADABLE`, sourceDocumentId: OTHER_DOC_ID, reason: "UNREADABLE" }),
      ],
    });
    expect(gaps.map((item) => item.reason)).toEqual(["UNREADABLE"]);
  });
});
