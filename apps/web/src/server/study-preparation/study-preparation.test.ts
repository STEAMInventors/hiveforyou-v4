import { describe, expect, it, vi } from "vitest";

import {
  CORRELATION_ID,
  DOC_1,
  HIVE_ID,
  REQUEST_ID,
  RUN_ID,
  runJson,
  snapshotDocument,
  sourceSnapshot,
} from "./study-preparation.fixtures";
import { acknowledgeStudyCoverage, getStudyPreparation, rebuildStudy, startStudyPreparation } from "./study-preparation";

const DIGEST = `sha256:${"e".repeat(64)}`;

function client(result: { data?: unknown; error?: { message: string } | null }) {
  return { rpc: vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null })) };
}

describe("rebuildStudy", () => {
  it("queues a new study run and never returns Writer work to dispatch", async () => {
    const db = client({
      data: {
        processingRun: runJson("QUEUED", { preparationMode: "REBUILD" }),
        created: true,
        reusedStudy: false,
        reportsReady: false,
        queuedReportRunIds: ["cccccccc-0000-4000-8000-000000000009"],
        reportRuns: [],
      },
    });
    const started = await rebuildStudy(db, {
      hiveId: HIVE_ID,
      rawBody: { clientRequestId: REQUEST_ID },
      correlationId: CORRELATION_ID,
    });
    expect(db.rpc).toHaveBeenCalledWith("rebuild_study", {
      p_hive_id: HIVE_ID,
      p_request_id: REQUEST_ID,
      p_correlation_id: CORRELATION_ID,
      p_coverage_acknowledgement_digest: null,
    });
    expect(started.process).toBe(true);
    expect(started.response.reusedStudy).toBe(false);
    expect(started.response.reportsReady).toBe(false);
    expect(started.response.reportRuns).toEqual([]);
  });

  it("does not process a replayed rebuild", async () => {
    const db = client({
      data: { processingRun: runJson("INVESTIGATING", { preparationMode: "REBUILD" }), created: false },
    });
    const started = await rebuildStudy(db, {
      hiveId: HIVE_ID,
      rawBody: { clientRequestId: REQUEST_ID },
      correlationId: CORRELATION_ID,
    });
    expect(started.process).toBe(false);
  });

  it("maps owner and document failures", async () => {
    const db = client({ error: { message: "documents_not_read" } });
    await expect(
      rebuildStudy(db, { hiveId: HIVE_ID, rawBody: { clientRequestId: REQUEST_ID }, correlationId: CORRELATION_ID }),
    ).rejects.toMatchObject({ errorCode: "COVERAGE_INCOMPLETE", diagnosticReason: "documents_not_read" });
  });
});

describe("startStudyPreparation", () => {
  it("passes an acknowledgement of known gaps and processes a run that starts by reading documents", async () => {
    const db = client({ data: { processingRun: runJson("READING_DOCUMENTS"), created: true, queuedReadIds: [] } });

    const started = await startStudyPreparation(db, {
      hiveId: HIVE_ID,
      rawBody: { clientRequestId: REQUEST_ID, coverageAcknowledgementDigest: DIGEST },
      correlationId: CORRELATION_ID,
    });

    expect(db.rpc).toHaveBeenCalledWith("start_study_preparation", {
      p_hive_id: HIVE_ID,
      p_request_id: REQUEST_ID,
      p_correlation_id: CORRELATION_ID,
      p_coverage_acknowledgement_digest: DIGEST,
    });
    expect(started.process).toBe(true);
    expect(started.response.processingRun.status).toBe("READING_DOCUMENTS");
  });

  it("does not process a replayed run", async () => {
    const db = client({ data: { processingRun: runJson("BUILDING_PROMPT"), created: false } });
    const started = await startStudyPreparation(db, {
      hiveId: HIVE_ID,
      rawBody: { clientRequestId: REQUEST_ID },
      correlationId: CORRELATION_ID,
    });
    expect(started.process).toBe(false);
    expect(db.rpc.mock.calls[0]![1]).toMatchObject({ p_coverage_acknowledgement_digest: null });
    expect(db.rpc.mock.calls[0]![1]).not.toHaveProperty("p_accept_partial_coverage");
  });

  it("does not process a run that needs clarification", async () => {
    const db = client({ data: { processingRun: runJson("NEEDS_CLARIFICATION"), created: true } });
    const started = await startStudyPreparation(db, {
      hiveId: HIVE_ID,
      rawBody: { clientRequestId: REQUEST_ID },
      correlationId: CORRELATION_ID,
    });
    expect(started.process).toBe(false);
    expect(started.queuedReportRunIds).toEqual([]);
  });

  it("reuses a compatible accepted Study when both reports exist without queueing Study or Writer work", async () => {
    const revisionId = "dddddddd-0000-4000-8000-000000000001";
    const customerRunId = "cccccccc-0000-4000-8000-000000000001";
    const proRunId = "cccccccc-0000-4000-8000-000000000002";
    const db = client({
      data: {
        processingRun: runJson("SUCCEEDED", { finishedAt: "2026-11-01T10:05:00.000Z" }),
        created: false,
        reusedStudy: true,
        reportsReady: true,
        studyRevision: {
          id: revisionId,
          canonicalStudyId: HIVE_ID,
          revisionNumber: 1,
          predecessorRevisionId: null,
          processingRunId: RUN_ID,
          coverageComplete: true,
          coverageStatus: "COMPLETE",
          coverageGaps: [],
          coverageAcknowledgement: "NOT_REQUIRED",
          createdAt: "2026-11-01T10:05:00.000Z",
        },
        reportRuns: [
          {
            id: customerRunId,
            hiveId: HIVE_ID,
            studyRevisionId: revisionId,
            audience: "CUSTOMER",
            trigger: "STUDY_ACCEPTED",
            status: "SUCCEEDED",
            attemptCount: 1,
            maxAttempts: 3,
            errorCode: null,
            errorMessageSafe: null,
            retryable: null,
            correlationId: CORRELATION_ID,
            reportId: "eeeeeeee-0000-4000-8000-000000000001",
            createdAt: "2026-11-01T10:05:00.000Z",
            finishedAt: "2026-11-01T10:06:00.000Z",
          },
          {
            id: proRunId,
            hiveId: HIVE_ID,
            studyRevisionId: revisionId,
            audience: "PRO",
            trigger: "STUDY_ACCEPTED",
            status: "SUCCEEDED",
            attemptCount: 1,
            maxAttempts: 3,
            errorCode: null,
            errorMessageSafe: null,
            retryable: null,
            correlationId: CORRELATION_ID,
            reportId: "eeeeeeee-0000-4000-8000-000000000002",
            createdAt: "2026-11-01T10:05:00.000Z",
            finishedAt: "2026-11-01T10:06:00.000Z",
          },
        ],
        queuedReadIds: [],
        queuedReportRunIds: [],
      },
    });

    const started = await startStudyPreparation(db, {
      hiveId: HIVE_ID,
      rawBody: { clientRequestId: REQUEST_ID },
      correlationId: CORRELATION_ID,
    });

    expect(started.process).toBe(false);
    expect(started.queuedReportRunIds).toEqual([]);
    expect(started.response.reusedStudy).toBe(true);
    expect(started.response.reportsReady).toBe(true);
    expect(started.response.studyRevision?.id).toBe(revisionId);
    expect(started.response.reportRuns).toHaveLength(2);
  });

  it("reuses a compatible accepted Study and returns only newly queued Writer run IDs when a report is missing or failed", async () => {
    const revisionId = "dddddddd-0000-4000-8000-000000000001";
    const proRunId = "cccccccc-0000-4000-8000-000000000002";
    const db = client({
      data: {
        processingRun: runJson("SUCCEEDED", { finishedAt: "2026-11-01T10:05:00.000Z" }),
        created: false,
        reusedStudy: true,
        reportsReady: false,
        studyRevision: {
          id: revisionId,
          canonicalStudyId: HIVE_ID,
          revisionNumber: 1,
          predecessorRevisionId: null,
          processingRunId: RUN_ID,
          coverageComplete: true,
          coverageStatus: "COMPLETE",
          coverageGaps: [],
          coverageAcknowledgement: "NOT_REQUIRED",
          createdAt: "2026-11-01T10:05:00.000Z",
        },
        reportRuns: [
          {
            id: "cccccccc-0000-4000-8000-000000000001",
            hiveId: HIVE_ID,
            studyRevisionId: revisionId,
            audience: "CUSTOMER",
            trigger: "STUDY_ACCEPTED",
            status: "SUCCEEDED",
            attemptCount: 1,
            maxAttempts: 3,
            errorCode: null,
            errorMessageSafe: null,
            retryable: null,
            correlationId: CORRELATION_ID,
            reportId: "eeeeeeee-0000-4000-8000-000000000001",
            createdAt: "2026-11-01T10:05:00.000Z",
            finishedAt: "2026-11-01T10:06:00.000Z",
          },
          {
            id: proRunId,
            hiveId: HIVE_ID,
            studyRevisionId: revisionId,
            audience: "PRO",
            trigger: "OWNER_GENERATE",
            status: "QUEUED",
            attemptCount: 0,
            maxAttempts: 3,
            errorCode: null,
            errorMessageSafe: null,
            retryable: null,
            correlationId: CORRELATION_ID,
            reportId: null,
            createdAt: "2026-11-01T10:07:00.000Z",
            finishedAt: null,
          },
        ],
        queuedReadIds: [],
        queuedReportRunIds: [proRunId],
      },
    });

    const started = await startStudyPreparation(db, {
      hiveId: HIVE_ID,
      rawBody: { clientRequestId: REQUEST_ID },
      correlationId: CORRELATION_ID,
    });

    expect(started.process).toBe(false);
    expect(started.queuedReportRunIds).toEqual([proRunId]);
    expect(started.response.reusedStudy).toBe(true);
    expect(started.response.reportsReady).toBe(false);
  });

  it("rejects blanket partial-coverage consent before calling the database", async () => {
    const db = client({});
    await expect(
      startStudyPreparation(db, {
        hiveId: HIVE_ID,
        rawBody: { clientRequestId: REQUEST_ID, acceptPartialCoverage: true },
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toMatchObject({ errorCode: "INVALID_REQUEST" });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["no_eligible_documents", "COVERAGE_INCOMPLETE", "Upload a document before analyzing."],
    ["coverage_unacknowledged", "COVERAGE_INCOMPLETE", undefined],
    ["hive_not_found", "NOT_FOUND", undefined],
    ["idempotency_conflict", "IDEMPOTENCY_CONFLICT", undefined],
  ])("maps %s to %s", async (message, errorCode, safeMessage) => {
    const db = client({ error: { message } });
    const error = await startStudyPreparation(db, {
      hiveId: HIVE_ID,
      rawBody: { clientRequestId: REQUEST_ID },
      correlationId: CORRELATION_ID,
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ errorCode, ...(safeMessage ? { safeMessage } : {}) });
  });
});

describe("acknowledgeStudyCoverage", () => {
  it("resumes the paused run and asks the caller to continue it", async () => {
    const db = client({ data: { processingRun: runJson("UNDERSTANDING_REQUEST"), resumed: true } });
    const acknowledged = await acknowledgeStudyCoverage(db, {
      hiveId: HIVE_ID,
      rawBody: { processingRunId: RUN_ID, coverageDigest: DIGEST },
      correlationId: CORRELATION_ID,
    });
    expect(db.rpc).toHaveBeenCalledWith("acknowledge_study_coverage", {
      p_hive_id: HIVE_ID,
      p_processing_run_id: RUN_ID,
      p_coverage_digest: DIGEST,
    });
    expect(acknowledged).toMatchObject({ process: true, response: { resumed: true } });
  });

  it("does not process a replayed acknowledgement or a run whose sources changed", async () => {
    const replay = client({ data: { processingRun: runJson("INVESTIGATING"), resumed: false } });
    const changed = client({ data: { processingRun: runJson("FAILED"), resumed: false, sourceChanged: true } });
    for (const db of [replay, changed]) {
      const acknowledged = await acknowledgeStudyCoverage(db, {
        hiveId: HIVE_ID,
        rawBody: { processingRunId: RUN_ID, coverageDigest: DIGEST },
        correlationId: CORRELATION_ID,
      });
      expect(acknowledged.process).toBe(false);
    }
  });

  it("requires the reviewed digest before calling the database", async () => {
    const db = client({});
    await expect(
      acknowledgeStudyCoverage(db, { hiveId: HIVE_ID, rawBody: { processingRunId: RUN_ID }, correlationId: CORRELATION_ID }),
    ).rejects.toMatchObject({ errorCode: "INVALID_REQUEST", diagnosticReason: "invalid_coverage_digest" });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["processing_run_not_awaiting", "INVALID_REQUEST"],
    ["processing_run_not_found", "NOT_FOUND"],
    ["coverage_unacknowledged", "COVERAGE_INCOMPLETE"],
  ])("maps %s to %s", async (message, errorCode) => {
    const db = client({ error: { message } });
    const error = await acknowledgeStudyCoverage(db, {
      hiveId: HIVE_ID,
      rawBody: { processingRunId: RUN_ID, coverageDigest: DIGEST },
      correlationId: CORRELATION_ID,
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ errorCode, diagnosticReason: message });
  });
});

describe("getStudyPreparation progress estimate", () => {
  it("builds the estimate from real document_pages text sizes and saved range keys for the run's snapshot", async () => {
    const doc = snapshotDocument(DOC_1, "Dense.pdf", { totalPhysicalPages: 8, verifiedPageCount: 8 });
    const denseText = "x".repeat(20_000);
    const makeDb = (
      pageText: string,
      savedRanges: { sourceDocumentId: string; pageRange: string; contentDigest?: string }[],
    ) => ({
      rpc: vi.fn(async (fn: string) => {
        if (fn === "get_study_preparation") {
          return {
            data: {
              processingRun: runJson("EXTRACTING", { extractedDocumentCount: 0 }),
              preview: null,
              previewSummary: null,
              staleness: null,
              studyRevision: null,
              reportRuns: [],
              documentReads: [],
              eligibility: {
                ...sourceSnapshot({ documents: [doc] }),
                activeReadCount: 0,
                coverageDigest: DIGEST,
                gaps: [],
              },
            },
            error: null,
          };
        }
        if (fn === "get_study_source_pages") {
          return {
            data: {
              snapshotCurrent: true,
              pages: Array.from({ length: 8 }, (_, index) => ({
                sourceDocumentId: DOC_1,
                pageNumber: index + 1,
                pageText,
                pageSetDigest: doc.pageSetDigest,
              })),
            },
            error: null,
          };
        }
        if (fn === "get_doc_extraction_ranges_for_run") {
          return { data: { ranges: savedRanges }, error: null };
        }
        if (fn === "get_doc_extractions_for_run") {
          return { data: { extractions: [] }, error: null };
        }
        if (fn === "get_pipeline_throughput") {
          return { data: { sampleCount: 0 }, error: null };
        }
        return { data: null, error: null };
      }),
    });

    const fixedNow = 1_000_000;
    const withShortPages = await getStudyPreparation(makeDb("brief", []), {
      hiveId: HIVE_ID,
      correlationId: CORRELATION_ID,
      includePreview: false,
      clock: () => fixedNow,
    });
    const withoutSavedRanges = await getStudyPreparation(makeDb(denseText, []), {
      hiveId: HIVE_ID,
      correlationId: CORRELATION_ID,
      includePreview: false,
      clock: () => fixedNow,
    });
    const withPartialSavedRanges = await getStudyPreparation(
      makeDb(denseText, [
        { sourceDocumentId: DOC_1, pageRange: "1", contentDigest: doc.pageSetDigest },
        { sourceDocumentId: DOC_1, pageRange: "2", contentDigest: doc.pageSetDigest },
        { sourceDocumentId: DOC_1, pageRange: "3", contentDigest: doc.pageSetDigest },
        { sourceDocumentId: DOC_1, pageRange: "4", contentDigest: doc.pageSetDigest },
      ]),
      {
        hiveId: HIVE_ID,
        correlationId: CORRELATION_ID,
        includePreview: false,
        clock: () => fixedNow,
      },
    );

    const shortCompletionMs = Date.parse(withShortPages.processingRun!.progressEstimate!.estimatedCompletionAt);
    const fullCompletionMs = Date.parse(withoutSavedRanges.processingRun!.progressEstimate!.estimatedCompletionAt);
    const partialCompletionMs = Date.parse(withPartialSavedRanges.processingRun!.progressEstimate!.estimatedCompletionAt);
    expect(fullCompletionMs).toBeGreaterThan(shortCompletionMs);
    expect(fullCompletionMs).toBeGreaterThan(partialCompletionMs);
  });
});

