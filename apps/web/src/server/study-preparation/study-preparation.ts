import {
  type AcknowledgeStudyCoverageResponse,
  createHiveError,
  type GetStudyPreparationResponse,
  type HiveError,
  isActiveProcessingRunStatus,
  isValidUuid,
  normalizeGetStudyPreparationResponse,
  normalizeProcessingRun,
  normalizeStartStudyPreparationResponse,
  type PageTextSlice,
  type SnapshotDocument,
  type StartStudyPreparationResponse,
  validateAcknowledgeStudyCoverageInput,
  validateStartStudyPreparationInput,
} from "@hiveforyou/contracts";

import { buildProgressEstimate } from "@/server/pipeline/pipeline-progress-estimate";
import { loadPipelineThroughput } from "@/server/pipeline/pipeline-throughput";
import { extractedDocumentIds, savedRangeKeysByDocument } from "@/server/workflow/v5-pipeline-stages";

import {
  type DocumentPageRpcClient,
  listDocumentPagesForSource,
} from "@/server/source-documents/document-pages-persistence";

/**
 * Owner operations for Analyze (authenticated client). The stages themselves run server-side in
 * `server/workflow/analysis-workflow.ts`.
 */
export type StudyPreparationRpcClient = DocumentPageRpcClient;

function rpcMessage(error: unknown): string {
  return typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message.toLowerCase()
    : "";
}

function ownerError(
  errorCode: HiveError["errorCode"],
  category: HiveError["category"],
  safeMessage: string,
  diagnosticReason: string,
  correlationId: string,
  retryable = false,
): HiveError {
  return createHiveError({ errorCode, category, stage: "ANALYZE", retryable, safeMessage, correlationId, diagnosticReason });
}

function mapOwnerRpcError(error: unknown, correlationId: string): HiveError {
  const message = rpcMessage(error);
  if (message.includes("hive_not_found")) {
    return ownerError("NOT_FOUND", "SECURITY", "We could not find that Hive.", "not_found", correlationId);
  }
  if (message.includes("auth_required")) {
    return ownerError("UNAUTHENTICATED", "SECURITY", "Sign in to continue.", "no_session", correlationId);
  }
  if (message.includes("no_eligible_documents")) {
    return ownerError(
      "COVERAGE_INCOMPLETE",
      "DOCUMENT",
      "Upload a document before analyzing.",
      "no_eligible_documents",
      correlationId,
    );
  }
  if (message.includes("documents_not_read")) {
    return ownerError(
      "COVERAGE_INCOMPLETE",
      "DOCUMENT",
      "Read the documents with Analyze before rebuilding the study. Rebuild uses the pages already saved.",
      "documents_not_read",
      correlationId,
    );
  }
  if (message.includes("intent_missing")) {
    return ownerError(
      "INVALID_REQUEST",
      "VALIDATION",
      "Tell us what you want to understand from these documents before rebuilding the study.",
      "intent_missing",
      correlationId,
    );
  }
  if (message.includes("study_not_accepted")) {
    return ownerError(
      "INVALID_REQUEST",
      "VALIDATION",
      "Analyze first. Rebuild starts a new revision after a study has been accepted.",
      "study_not_accepted",
      correlationId,
    );
  }
  if (message.includes("analysis_active")) {
    return ownerError(
      "INVALID_REQUEST",
      "VALIDATION",
      "An analysis is already running. Wait for it to finish before rebuilding the study.",
      "analysis_active",
      correlationId,
    );
  }
  if (message.includes("coverage_unacknowledged")) {
    return ownerError(
      "COVERAGE_INCOMPLETE",
      "DOCUMENT",
      "Your document coverage changed. Review what's missing and confirm again.",
      "coverage_unacknowledged",
      correlationId,
    );
  }
  if (message.includes("idempotency_conflict")) {
    return ownerError("IDEMPOTENCY_CONFLICT", "PERSISTENCE", "This request was already used.", "idempotency_conflict", correlationId);
  }
  if (message.includes("processing_run_not_found")) {
    return ownerError("NOT_FOUND", "VALIDATION", "We could not find that analysis.", "processing_run_not_found", correlationId);
  }
  if (message.includes("processing_run_not_awaiting")) {
    return ownerError(
      "INVALID_REQUEST",
      "VALIDATION",
      "This analysis is no longer waiting for your review.",
      "processing_run_not_awaiting",
      correlationId,
    );
  }
  return createHiveError({
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "ANALYZE",
    retryable: true,
    safeMessage: "Could not reach your Hive right now. Please try again.",
    correlationId,
    diagnosticReason: "persistence_failed",
    cause: error,
  });
}

function requireHiveId(hiveId: string, correlationId: string): string {
  const normalized = hiveId.trim().toLowerCase();
  if (!isValidUuid(normalized)) {
    throw ownerError("INVALID_REQUEST", "VALIDATION", "Invalid Hive identifier.", "invalid_hive_id", correlationId);
  }
  return normalized;
}

function parsePayload(data: unknown): Record<string, unknown> | null {
  const payload = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
}

function unexpectedShape(correlationId: string): HiveError {
  return createHiveError({
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "ANALYZE",
    retryable: true,
    safeMessage: "Could not load analysis progress. Please try again.",
    correlationId,
    diagnosticReason: "unexpected_edge_shape",
  });
}

function uuidElements(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => (typeof id === "string" ? id.trim().toLowerCase() : ""))
    .filter((id) => isValidUuid(id));
}

/**
 * Starts (or replays/resumes) Analyze.
 * - `process` is true only for a newly queued Study processing run.
 * - `queuedReportRunIds` contains any newly queued Writer runs when a compatible Study revision is reused
 *   and one or both audience reports are missing or failed.
 */
export async function startStudyPreparation(
  userClient: StudyPreparationRpcClient,
  input: { readonly hiveId: string; readonly rawBody: unknown; readonly correlationId: string },
): Promise<{ response: StartStudyPreparationResponse; process: boolean; queuedReportRunIds: string[] }> {
  const { correlationId } = input;
  const hiveId = requireHiveId(input.hiveId, correlationId);
  const validated = validateStartStudyPreparationInput(input.rawBody);
  if (!validated.ok) {
    throw ownerError("INVALID_REQUEST", "VALIDATION", validated.message, validated.diagnosticReason, correlationId);
  }
  const { data, error } = await userClient.rpc("start_study_preparation", {
    p_hive_id: hiveId,
    p_request_id: validated.value.clientRequestId,
    p_correlation_id: correlationId,
    p_coverage_acknowledgement_digest: validated.value.coverageAcknowledgementDigest,
  });
  if (error) throw mapOwnerRpcError(error, correlationId);
  const payload = parsePayload(data);
  const response = normalizeStartStudyPreparationResponse(payload);
  if (!response) throw unexpectedShape(correlationId);
  const { processingRun, created } = response;
  const queuedReportRunIds = uuidElements(payload?.queuedReportRunIds);
  return {
    response,
    process: created && (processingRun.status === "QUEUED" || processingRun.status === "READING_DOCUMENTS"),
    queuedReportRunIds,
  };
}

/**
 * Starts an explicit Rebuild Study. A new request freezes the current sources and intent and
 * queues the V5 pipeline (re-extract only documents whose content changed, then re-run
 * CANONICALIZING from cached extractions — the cheap path). The same client request replays that
 * run. An in-flight rebuild is not started twice. This path never queues document reads or Writer runs.
 */
export async function rebuildStudy(
  userClient: StudyPreparationRpcClient,
  input: { readonly hiveId: string; readonly rawBody: unknown; readonly correlationId: string },
): Promise<{ response: StartStudyPreparationResponse; process: boolean }> {
  const { correlationId } = input;
  const hiveId = requireHiveId(input.hiveId, correlationId);
  const validated = validateStartStudyPreparationInput(input.rawBody);
  if (!validated.ok) {
    throw ownerError("INVALID_REQUEST", "VALIDATION", validated.message, validated.diagnosticReason, correlationId);
  }
  const { data, error } = await userClient.rpc("rebuild_study", {
    p_hive_id: hiveId,
    p_request_id: validated.value.clientRequestId,
    p_correlation_id: correlationId,
    p_coverage_acknowledgement_digest: validated.value.coverageAcknowledgementDigest,
  });
  if (error) throw mapOwnerRpcError(error, correlationId);
  const payload = parsePayload(data);
  const response = normalizeStartStudyPreparationResponse(payload);
  if (!response) throw unexpectedShape(correlationId);
  if (response.processingRun.preparationMode !== "REBUILD") {
    throw ownerError(
      "PERSISTENCE_FAILED",
      "PERSISTENCE",
      "Could not rebuild the study. Please try again.",
      "unexpected_edge_shape",
      correlationId,
      true,
    );
  }
  return {
    response: { ...response, reusedStudy: false, reportsReady: false, reportRuns: [] },
    process: response.created && response.processingRun.status === "QUEUED",
  };
}

/**
 * The owner continues a run that paused because reading found material gaps. `process` is true
 * when the run resumed; the caller then continues it server-side from its frozen snapshot.
 */
export async function acknowledgeStudyCoverage(
  userClient: StudyPreparationRpcClient,
  input: { readonly hiveId: string; readonly rawBody: unknown; readonly correlationId: string },
): Promise<{ response: AcknowledgeStudyCoverageResponse; process: boolean }> {
  const { correlationId } = input;
  const hiveId = requireHiveId(input.hiveId, correlationId);
  const validated = validateAcknowledgeStudyCoverageInput(input.rawBody);
  if (!validated.ok) {
    throw ownerError("INVALID_REQUEST", "VALIDATION", validated.message, validated.diagnosticReason, correlationId);
  }
  const { data, error } = await userClient.rpc("acknowledge_study_coverage", {
    p_hive_id: hiveId,
    p_processing_run_id: validated.value.processingRunId,
    p_coverage_digest: validated.value.coverageDigest,
  });
  if (error) throw mapOwnerRpcError(error, correlationId);
  const payload = parsePayload(data);
  const processingRun = normalizeProcessingRun(payload?.processingRun);
  if (!processingRun) throw unexpectedShape(correlationId);
  const resumed = payload?.resumed === true;
  return { response: { processingRun, resumed }, process: resumed };
}

async function loadProgressEstimateSnapshotState(
  client: StudyPreparationRpcClient,
  input: {
    readonly hiveId: string;
    readonly runId: string;
    readonly correlationId: string;
    readonly documents: readonly SnapshotDocument[];
    readonly fallbackExtractedDocumentCount: number;
  },
): Promise<{
  pagesByDocument: Map<string, readonly PageTextSlice[]>;
  savedRangeKeysByDocument: Map<string, ReadonlySet<string>>;
  extractedDocumentIds: Set<string>;
}> {
  const pagesByDocument = new Map<string, readonly PageTextSlice[]>();
  const digestByDocument = new Map(
    input.documents.map((doc) => [doc.sourceDocumentId.toLowerCase(), doc.pageSetDigest.toLowerCase()]),
  );

  let sourcePagesLoaded = false;
  try {
    const { data, error } = await client.rpc("get_study_source_pages", { p_run_id: input.runId });
    const payload = !error ? parsePayload(data) : null;
    if (payload && Array.isArray(payload.pages)) {
      const grouped = new Map<string, Map<number, string>>();
      for (const raw of payload.pages as Record<string, unknown>[]) {
        const docId = typeof raw.sourceDocumentId === "string" ? raw.sourceDocumentId.toLowerCase() : "";
        const pageNumber = Number(raw.pageNumber);
        const text = typeof raw.pageText === "string" ? raw.pageText : "";
        if (!docId || !Number.isInteger(pageNumber) || pageNumber <= 0) continue;
        const docPages = grouped.get(docId) ?? new Map<number, string>();
        docPages.set(pageNumber, text);
        grouped.set(docId, docPages);
      }
      for (const document of input.documents) {
        const docId = document.sourceDocumentId.toLowerCase();
        const textByPage = grouped.get(docId);
        pagesByDocument.set(
          docId,
          Array.from({ length: document.verifiedPageCount }, (_, index) => {
            const pageNumber = index + 1;
            return { pageNumber, text: textByPage?.get(pageNumber) ?? "" };
          }),
        );
      }
      sourcePagesLoaded = true;
    }
  } catch {
    sourcePagesLoaded = false;
  }

  if (!sourcePagesLoaded) {
    await Promise.all(
      input.documents.map(async (document) => {
        const docId = document.sourceDocumentId.toLowerCase();
        try {
          const listed = await listDocumentPagesForSource(client, {
            hiveId: input.hiveId,
            sourceDocumentId: document.sourceDocumentId,
            readFingerprint: document.readFingerprint,
            pageSetDigest: document.pageSetDigest,
            expectedSourceSha256: document.sha256,
            correlationId: input.correlationId,
          });
          const textByPage = new Map(listed.pages.map((page) => [page.page_number, page.page_text]));
          pagesByDocument.set(
            docId,
            Array.from({ length: document.verifiedPageCount }, (_, index) => {
              const pageNumber = index + 1;
              return { pageNumber, text: textByPage.get(pageNumber) ?? "" };
            }),
          );
        } catch {
          pagesByDocument.set(
            docId,
            Array.from({ length: document.verifiedPageCount }, (_, index) => ({
              pageNumber: index + 1,
              text: "",
            })),
          );
        }
      }),
    );
  }

  let savedRanges = new Map<string, ReadonlySet<string>>();
  try {
    const { data, error } = await client.rpc("get_doc_extraction_ranges_for_run", {
      p_processing_run_id: input.runId,
    });
    const payload = !error ? parsePayload(data) : null;
    if (payload && Array.isArray(payload.ranges)) {
      const filtered = (payload.ranges as Record<string, unknown>[]).filter((row) => {
        const docId = typeof row.sourceDocumentId === "string" ? row.sourceDocumentId.toLowerCase() : "";
        const expectedDigest = digestByDocument.get(docId);
        if (!expectedDigest) return false;
        const rowDigest = typeof row.contentDigest === "string" ? row.contentDigest.toLowerCase() : null;
        return rowDigest === null || rowDigest === expectedDigest;
      });
      savedRanges = savedRangeKeysByDocument({ ranges: filtered });
    }
  } catch {
    savedRanges = new Map();
  }

  let extractedIds: Set<string> | null = null;
  try {
    const { data, error } = await client.rpc("get_doc_extractions_for_run", {
      p_processing_run_id: input.runId,
    });
    const payload = !error ? parsePayload(data) : null;
    if (payload && Array.isArray(payload.extractions)) {
      const filtered = (payload.extractions as Record<string, unknown>[]).filter((row) => {
        const docId = typeof row.sourceDocumentId === "string" ? row.sourceDocumentId.toLowerCase() : "";
        const expectedDigest = digestByDocument.get(docId);
        if (!expectedDigest) return false;
        const rowDigest = typeof row.contentDigest === "string" ? row.contentDigest.toLowerCase() : null;
        return rowDigest === null || rowDigest === expectedDigest;
      });
      extractedIds = extractedDocumentIds({ extractions: filtered });
    }
  } catch {
    extractedIds = null;
  }

  if (!extractedIds) {
    extractedIds = new Set(
      input.documents
        .slice(0, input.fallbackExtractedDocumentCount)
        .map((document) => document.sourceDocumentId.toLowerCase()),
    );
  }

  return {
    pagesByDocument,
    savedRangeKeysByDocument: savedRanges,
    extractedDocumentIds: extractedIds,
  };
}

export async function getStudyPreparation(
  userClient: StudyPreparationRpcClient,
  input: {
    readonly hiveId: string;
    readonly correlationId: string;
    readonly includePreview: boolean;
    readonly clock?: () => number;
  },
): Promise<GetStudyPreparationResponse> {
  const hiveId = requireHiveId(input.hiveId, input.correlationId);
  const { data, error } = await userClient.rpc("get_study_preparation", {
    p_hive_id: hiveId,
    p_include_preview: input.includePreview,
  });
  if (error) throw mapOwnerRpcError(error, input.correlationId);
  const normalized = normalizeGetStudyPreparationResponse(parsePayload(data));
  if (!normalized) throw unexpectedShape(input.correlationId);
  const run = normalized.processingRun;
  if (run && isActiveProcessingRunStatus(run.status)) {
    const nowMs = (input.clock ?? Date.now)();
    const [extractThroughput, canonicalizeThroughput, writeThroughput, snapshotState] = await Promise.all([
      loadPipelineThroughput(userClient, "extract", nowMs),
      loadPipelineThroughput(userClient, "canonicalize", nowMs),
      loadPipelineThroughput(userClient, "write", nowMs),
      loadProgressEstimateSnapshotState(userClient, {
        hiveId,
        runId: run.id,
        correlationId: input.correlationId,
        documents: normalized.eligibility.documents,
        fallbackExtractedDocumentCount: run.extractedDocumentCount,
      }),
    ]);
    const progressEstimate = buildProgressEstimate({
      nowMs,
      run,
      snapshot: {
        documents: normalized.eligibility.documents,
        excluded: normalized.eligibility.excluded,
        coverageComplete: normalized.eligibility.coverageComplete,
      },
      extractedDocumentIds: snapshotState.extractedDocumentIds,
      savedRangeKeysByDocument: snapshotState.savedRangeKeysByDocument,
      pagesByDocument: snapshotState.pagesByDocument,
      extractThroughput,
      canonicalizeThroughput,
      writeThroughput,
      reportRuns: normalized.reportRuns,
    });
    normalized.processingRun = { ...run, progressEstimate };
  }
  return normalized;
}
