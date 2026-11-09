import {
  createHiveError,
  defaultPipelineThroughput,
  EXTRACT_INVOCATION_DEADLINE_MARGIN_MS,
  EXTRACT_MAX_PAGES_PER_RANGE,
  EXTRACT_PLANNER_CALL_DEADLINE_MS,
  invocationRemainingMs,
  parsePageNumbersFromRangeKey,
  validateDocExtraction,
  verifiedSavedRangeKeys,
  type HiveError,
  PLANNER_CONTRACT_VERSION,
  type SnapshotDocument,
  type StageMetric,
  V5_CLIENT_TASK_TIMEOUT_MS,
} from "@hiveforyou/contracts";
import { normalizeFileSha256 } from "@hiveforyou/contracts/document-read";
import { describe, expect, it, vi } from "vitest";

import {
  DOC_1,
  DOC_2,
  HIVE_ID,
  RUN_ID,
  runJson,
  snapshotDocument,
  sourceSnapshot,
} from "@/server/study-preparation/study-preparation.fixtures";
import * as logger from "@/server/observability/logger";
import { loadPromptCatalog, sha256Digest } from "@/server/study-preparation/prompt-catalog";

import type { AnalysisWorkflowDeps } from "./analysis-workflow";
import {
  EXTRACTING_CONCURRENCY,
  buildExtractWorkQueue,
  canStartExtractingDocument,
  completeExtractedDocumentIds,
  documentsNeedingExtraction,
  documentPagesFullyExtracted,
  extractOneRange,
  extractPlannerTimeoutMs,
  extractedDocumentIds,
  loadDocumentPages,
  runExtractingWorkerPool,
  savedRangeKeysByDocument,
  type ExtractOneRangeResult,
  type ExtractWorkItem,
} from "./v5-pipeline-stages";
import { missingExtractWorkItems, pageRangeStorageKey } from "@/server/pipeline/extract-runner";

const throughput = defaultPipelineThroughput("extract");

function storedFileSha256(document: SnapshotDocument): string {
  return normalizeFileSha256(document.sha256) ?? document.sha256.trim().toLowerCase();
}

function listDocumentPagesPayload(document: SnapshotDocument, texts: readonly string[]) {
  const sourceSha256 = storedFileSha256(document);
  return {
    found: true,
    source_document_id: document.sourceDocumentId,
    hive_id: HIVE_ID,
    source_sha256: sourceSha256,
    read_fingerprint: document.readFingerprint,
    page_set_digest: document.pageSetDigest,
    read_status: "SUCCEEDED",
    total_physical_pages: texts.length,
    pages: texts.map((text, index) => ({
      page_number: index + 1,
      page_count: texts.length,
      page_text: text,
      page_text_sha256: sha256Digest(text),
      page_byte_length: Buffer.byteLength(text, "utf8"),
      source_document_id: document.sourceDocumentId,
      hive_id: HIVE_ID,
      source_sha256: sourceSha256,
      read_fingerprint: document.readFingerprint,
      page_set_digest: document.pageSetDigest,
    })),
  };
}

describe("extract invocation budget", () => {
  it("allows another extract call while the configured deadline fits inside remaining invocation time", () => {
    const start = 1_000;
    expect(canStartExtractingDocument(() => start, start)).toBe(true);

    const late = () => start + 300_000 - EXTRACT_INVOCATION_DEADLINE_MARGIN_MS;
    expect(canStartExtractingDocument(late, start)).toBe(false);
  });

  it("never assigns a planner timeout above the per-task cap", () => {
    const start = 0;
    const clock = () => start;
    expect(
      extractPlannerTimeoutMs(clock, start, 5000, throughput),
    ).toBeLessThanOrEqual(V5_CLIENT_TASK_TIMEOUT_MS);
    expect(invocationRemainingMs(clock(), start)).toBe(300_000);
  });

  it("caps extract calls at min(90 s, remaining minus 15 s)", () => {
    const start = 0;
    expect(extractPlannerTimeoutMs(() => start, start, 1000, throughput)).toBe(EXTRACT_PLANNER_CALL_DEADLINE_MS);
    const remaining = 40_000;
    const clock = () => start + 300_000 - remaining;
    expect(extractPlannerTimeoutMs(clock, start, 1000, throughput)).toBe(
      remaining - EXTRACT_INVOCATION_DEADLINE_MARGIN_MS,
    );
    const expiredClock = () => start + 300_000 - EXTRACT_INVOCATION_DEADLINE_MARGIN_MS;
    expect(extractPlannerTimeoutMs(expiredClock, start, 1000, throughput)).toBe("expired");
  });
});

describe("documentsNeedingExtraction", () => {
  it("lists only documents missing from the extraction payload", () => {
    const snapshot = sourceSnapshot();
    const extracted = extractedDocumentIds({ extractions: [{ sourceDocumentId: DOC_1 }] });
    expect(documentsNeedingExtraction(snapshot, extracted).map((document) => document.sourceDocumentId)).toEqual([DOC_2]);
  });
});

describe("range work queue", () => {
  it("skips page ranges already saved and resumes uncovered slices", async () => {
    const document = snapshotDocument(DOC_1, "Long.pdf");
    const documentWithPages = { ...document, verifiedPageCount: 25 };
    const saved = savedRangeKeysByDocument({
      ranges: [{ sourceDocumentId: DOC_1, pageRange: "1-10" }],
    });
    const dense = "x".repeat(throughput.inputTokensPerPage * 4 * 8);
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "get_study_source_pages") {
          return { data: { snapshotCurrent: true, pages: [] }, error: null };
        }
        if (fn === "list_document_pages") {
          return {
            data: listDocumentPagesPayload(documentWithPages, Array.from({ length: 25 }, () => dense)),
            error: null,
          };
        }
        if (fn === "get_doc_extraction_attempt_totals_for_run") {
          return { data: { totals: [] }, error: null };
        }
        if (fn === "get_doc_extraction_gap_pages_for_run") {
          return { data: { gaps: [] }, error: null };
        }
        if (fn === "get_doc_extractions_for_run") {
          return { data: { extractions: [] }, error: null };
        }
        throw new Error(fn);
      }),
    };
    const items = await buildExtractWorkQueue({
      client,
      hiveId: HIVE_ID,
      runId: RUN_ID,
      snapshot: { documents: [documentWithPages], excluded: [], coverageComplete: true },
      extractedIds: new Set(),
      savedRangeKeysByDocument: saved,
      correlationId: "corr",
      catalog: loadPromptCatalog(),
      throughput,
    });
    expect(items.length).toBeGreaterThan(1);
    expect(items.every((item) => item.pageRange !== "1-10")).toBe(true);
    const partialKeys = verifiedSavedRangeKeys(
      [
        {
          pageRange: "1-10",
          extraction: { coverage: { pagesRead: [1, 2, 3], pagesBlankOrUnreadable: [] } },
        } as never,
      ],
      25,
    );
    expect(documentPagesFullyExtracted(25, partialKeys)).toBe(false);
    const fullKeys = verifiedSavedRangeKeys(
      [
        {
          pageRange: "1-10",
          extraction: {
            coverage: { pagesRead: Array.from({ length: 10 }, (_, i) => i + 1), pagesBlankOrUnreadable: [] },
          },
        } as never,
        {
          pageRange: "11-20",
          extraction: {
            coverage: { pagesRead: Array.from({ length: 10 }, (_, i) => i + 11), pagesBlankOrUnreadable: [] },
          },
        } as never,
        {
          pageRange: "21-25",
          extraction: { coverage: { pagesRead: [21, 22, 23, 24, 25], pagesBlankOrUnreadable: [] } },
        } as never,
      ],
      25,
    );
    expect(documentPagesFullyExtracted(25, fullKeys)).toBe(true);
  });

  it("schedules adaptive sub-ranges after a split without redoing saved leaves", () => {
    const pages = Array.from({ length: 4 }, (_, index) => ({ pageNumber: index + 1, text: "x" }));
    const firstPass = missingExtractWorkItems(pages, new Set(), throughput);
    expect(firstPass.map((item) => pageRangeStorageKey(item.pageRange))).toEqual(
      expect.arrayContaining(["1-3", "4"]),
    );
    const afterSplit = missingExtractWorkItems(pages, new Set(["1-2"]), throughput, 4);
    expect(afterSplit.map((item) => pageRangeStorageKey(item.pageRange))).toEqual(["3-4"]);
  });

  it("regroups after partial success without redoing verified pages and respects page caps", () => {
    const pages = Array.from({ length: 20 }, (_, index) => ({
      pageNumber: index + 1,
      text: "brief",
    }));
    const saved = new Set(["5-9", "10-11"]);
    const items = missingExtractWorkItems(pages, saved, throughput, 20);
    const covered = new Set<number>();
    for (const key of saved) {
      for (const page of parsePageNumbersFromRangeKey(key, 20)) covered.add(page);
    }
    for (const item of items) {
      expect(item.pages.length).toBeLessThanOrEqual(EXTRACT_MAX_PAGES_PER_RANGE);
      const chars = item.pages.reduce((total, page) => total + page.text.length, 0);
      expect(chars).toBeLessThanOrEqual(4_000);
      for (const page of item.pages) {
        expect(covered.has(page.pageNumber)).toBe(false);
      }
    }
    const regrouped = new Set(items.flatMap((item) => item.pages.map((page) => page.pageNumber)));
    for (let page = 1; page <= 20; page += 1) {
      if (covered.has(page)) continue;
      expect(regrouped.has(page)).toBe(true);
    }
  });
});

function workItemsForDocuments(documents: ReturnType<typeof snapshotDocument>[]): ExtractWorkItem[] {
  return documents.map((document) => ({ document, pageRange: null }));
}

describe("runExtractingWorkerPool", () => {
  const catalog = loadPromptCatalog();
  const run = runJson("EXTRACTING", { id: RUN_ID });
  const deps = {
    client: {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "record_extracting_document_success") return { data: { saved: true }, error: null };
        if (fn === "get_pipeline_throughput") return { data: { sampleCount: 0 }, error: null };
        if (fn === "record_doc_extraction_attempt") return { data: { recorded: true }, error: null };
        if (fn === "fail_stale_in_flight_doc_extraction_attempts") return { data: { failedCount: 0 }, error: null };
        if (fn === "begin_doc_extraction_attempt") return { data: { id: "aaaaaaaa-0000-4000-8000-000000000099" }, error: null };
        if (fn === "update_doc_extraction_attempt_outcome") return { data: { updated: true }, error: null };
        throw new Error(`unexpected rpc ${fn}`);
      }),
    },
  } as unknown as AnalysisWorkflowDeps;

  function metricFor(): StageMetric {
    return {
      stage: "EXTRACTING",
      attempt: 1,
      outcome: "SUCCEEDED",
      promptId: catalog.extract.id,
      promptDigest: catalog.extract.digest,
      modelAliasRequested: "harvester",
      resolvedModel: "test",
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      latencyMs: 1,
      finishReason: "stop",
      startedAt: "2026-11-05T00:00:00.000Z",
      completedAt: "2026-11-05T00:00:01.000Z",
    };
  }

  const successOutcome = (): ExtractOneRangeResult => ({
    ok: true,
    metric: metricFor(),
    modelAlias: "harvester",
    documentMetric: metricFor(),
    callsStarted: 1,
  });

  const poolInput = (input: {
    workItems: ExtractWorkItem[];
    clock: () => number;
    invocationStartedAt: number;
    extract?: typeof import("./v5-pipeline-stages").extractOneRange;
    canStart?: (clock: () => number, invocationStartedAt: number) => boolean;
    deps?: AnalysisWorkflowDeps;
  }) => ({
    deps: input.deps ?? deps,
    run,
    sourceSnapshot: { documents: [], excluded: [], coverageComplete: true },
    catalog,
    correlationId: "corr",
    now: () => new Date("2026-11-05T00:00:00.000Z"),
    clock: input.clock,
    invocationStartedAt: input.invocationStartedAt,
    workItems: input.workItems,
    extract: input.extract,
    canStart: input.canStart,
    throughput,
  });

  it(`runs at most ${EXTRACTING_CONCURRENCY} overlapping extractions`, async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const pending = [
      snapshotDocument(DOC_1, "A.pdf"),
      snapshotDocument(DOC_2, "B.pdf"),
      snapshotDocument("55555555-5555-4555-8555-555555555555", "C.pdf"),
      snapshotDocument("66666666-6666-4666-8666-666666666666", "D.pdf"),
      snapshotDocument("77777777-7777-4777-8777-777777777777", "E.pdf"),
    ];
    const extract = vi.fn(async (): Promise<ExtractOneRangeResult> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return successOutcome();
    });
    await runExtractingWorkerPool(
      poolInput({
        workItems: workItemsForDocuments(pending),
        clock: () => Date.now(),
        invocationStartedAt: Date.now(),
        extract,
      }),
    );
    expect(extract).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBeLessThanOrEqual(EXTRACTING_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("re-queues retryable failures without blocking other documents", async () => {
    const failures = new Map<string, number>();
    const extract = vi.fn(async (input): Promise<ExtractOneRangeResult> => {
      const id = input.workItem.document.sourceDocumentId;
      if (id === DOC_1) {
        const count = (failures.get(id) ?? 0) + 1;
        failures.set(id, count);
        if (count < 2) {
          return {
            ok: false,
            calls: [
              {
                pageRange: null,
                attempt: 1,
                rangeAttempt: 1,
                callStartedAt: "2026-11-05T00:00:00.000Z",
                outcome: "failed" as const,
                inputTokens: null,
                outputTokens: null,
                latencyMs: null,
                roundTripMs: 1,
                finishReason: null,
                modelAlias: null,
                resolvedModel: null,
                errorCode: "MODEL_TIMEOUT",
                diagnosticReason: "planner_timeout",
                httpStatus: 504,
                abortedByOurDeadline: false,
              },
            ],
            metric: null,
            error: createHiveError({
              errorCode: "MODEL_TIMEOUT",
              category: "DEPENDENCY",
              stage: "ANALYZE",
              retryable: true,
              safeMessage: "timeout",
              correlationId: "corr",
              diagnosticReason: "planner_timeout",
            }),
            callsStarted: 1,
          };
        }
      }
      return successOutcome();
    });
    await runExtractingWorkerPool(
      poolInput({
        workItems: workItemsForDocuments([snapshotDocument(DOC_1, "A.pdf"), snapshotDocument(DOC_2, "B.pdf")]),
        clock: () => Date.now(),
        invocationStartedAt: Date.now(),
        extract,
      }),
    );
    expect(extract.mock.calls.filter((call) => call[0]!.workItem.document.sourceDocumentId === DOC_1)).toHaveLength(2);
    expect(extract.mock.calls.filter((call) => call[0]!.workItem.document.sourceDocumentId === DOC_2)).toHaveLength(1);
  });

  it("records a single-page timeout as a gap instead of failing the pool", async () => {
    const error = createHiveError({
      errorCode: "MODEL_TIMEOUT",
      category: "DEPENDENCY",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "timeout",
      correlationId: "corr",
    }) as HiveError;
    const failedCall = {
      pageRange: "3",
      attempt: 1 as const,
      rangeAttempt: 1,
      callStartedAt: "2026-11-05T00:00:00.000Z",
      outcome: "failed" as const,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      roundTripMs: 1,
      finishReason: null,
      modelAlias: null,
      resolvedModel: null,
      errorCode: "MODEL_TIMEOUT",
      diagnosticReason: "planner_timeout",
      httpStatus: 504,
      abortedByOurDeadline: false,
    };
    const extract = vi.fn(async (): Promise<ExtractOneRangeResult> => ({
      ok: false,
      calls: [failedCall],
      metric: null,
      error,
      callsStarted: 1,
    }));
    const gapDeps = {
      client: {
        rpc: vi.fn(async (fn: string) => {
          if (fn === "record_extracting_document_success") return { data: { saved: true }, error: null };
          if (fn === "get_pipeline_throughput") return { data: { sampleCount: 0 }, error: null };
          if (fn === "record_doc_extraction_attempt") return { data: { recorded: true }, error: null };
          if (fn === "fail_stale_in_flight_doc_extraction_attempts") return { data: { failedCount: 0 }, error: null };
          if (fn === "begin_doc_extraction_attempt") return { data: { id: "aaaaaaaa-0000-4000-8000-000000000099" }, error: null };
          if (fn === "update_doc_extraction_attempt_outcome") return { data: { updated: true }, error: null };
          if (fn === "record_doc_extraction_attempt") return { data: { recorded: true }, error: null };
          if (fn === "get_doc_extraction_ranges_for_run") return { data: { ranges: [] }, error: null };
          if (fn === "get_doc_extraction_gap_pages_for_run") return { data: { gaps: [] }, error: null };
          if (fn === "put_doc_extraction") return { data: { saved: true }, error: null };
          throw new Error(fn);
        }),
      },
      planner: { getConfig: () => ({ baseUrl: "https://x", serviceToken: "t", timeoutMs: 1 }), fetchFn: fetch },
    } as unknown as AnalysisWorkflowDeps;
    await runExtractingWorkerPool(
      poolInput({
        workItems: [{ document: snapshotDocument(DOC_1, "A.pdf"), pageRange: "3" }],
        clock: () => Date.now(),
        invocationStartedAt: Date.now(),
        extract,
        deps: gapDeps,
      }),
    );
    expect(extract).toHaveBeenCalledTimes(3);
  });

  it("splits a multi-page range after repeated cut-offs instead of failing the pool", async () => {
    const error = createHiveError({
      errorCode: "MODEL_TIMEOUT",
      category: "DEPENDENCY",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "timeout",
      correlationId: "corr",
      diagnosticReason: "planner_timeout",
    }) as HiveError;
    const failedCall = {
      pageRange: "1-4",
      attempt: 1 as const,
      rangeAttempt: 1,
      callStartedAt: "2026-11-05T00:00:00.000Z",
      outcome: "failed" as const,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      roundTripMs: 1,
      finishReason: null,
      modelAlias: null,
      resolvedModel: null,
      errorCode: "MODEL_TIMEOUT",
      diagnosticReason: "planner_timeout",
      httpStatus: 504,
      abortedByOurDeadline: false,
    };
    const extract = vi.fn(async (): Promise<ExtractOneRangeResult> => ({
      ok: false,
      calls: [failedCall],
      metric: null,
      error,
      callsStarted: 1,
    }));
    const splitDeps = {
      client: {
        rpc: vi.fn(async (fn: string) => {
          if (fn === "record_extracting_document_success") return { data: { saved: true }, error: null };
          if (fn === "get_pipeline_throughput") return { data: { sampleCount: 0 }, error: null };
          if (fn === "record_doc_extraction_attempt") return { data: { recorded: true }, error: null };
          if (fn === "fail_stale_in_flight_doc_extraction_attempts") return { data: { failedCount: 0 }, error: null };
          if (fn === "begin_doc_extraction_attempt") return { data: { id: "aaaaaaaa-0000-4000-8000-000000000099" }, error: null };
          if (fn === "update_doc_extraction_attempt_outcome") return { data: { updated: true }, error: null };
          if (fn === "record_doc_extraction_attempt") return { data: { recorded: true }, error: null };
          if (fn === "put_doc_extraction_range") return { data: { saved: true }, error: null };
          if (fn === "get_doc_extraction_ranges_for_run") return { data: { ranges: [] }, error: null };
          if (fn === "get_doc_extraction_gap_pages_for_run") return { data: { gaps: [] }, error: null };
          throw new Error(fn);
        }),
      },
      planner: { getConfig: () => ({ baseUrl: "https://x", serviceToken: "t", timeoutMs: 1 }), fetchFn: fetch },
    } as unknown as AnalysisWorkflowDeps;
    const document = { ...snapshotDocument(DOC_1, "A.pdf"), verifiedPageCount: 4 };
    await runExtractingWorkerPool(
      poolInput({
        workItems: [{ document, pageRange: "1-4" }],
        clock: () => Date.now(),
        invocationStartedAt: Date.now(),
        extract,
        deps: splitDeps,
      }),
    );
    expect(extract.mock.calls.map((call) => call[0]!.workItem.pageRange)).toEqual(
      expect.arrayContaining(["1-4", "1-2", "3-4"]),
    );
    expect(extract.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("requeues work without caching empty ranges when two timeouts exhaust the invocation budget", async () => {
    const deadlineError = createHiveError({
      errorCode: "CLIENT_DEADLINE",
      category: "DEPENDENCY",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "timeout",
      correlationId: "corr",
      diagnosticReason: "client_deadline",
    }) as HiveError;
    const failedCall = {
      pageRange: "5",
      attempt: 1 as const,
      rangeAttempt: 1,
      callStartedAt: "2026-11-05T00:00:00.000Z",
      outcome: "failed" as const,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      roundTripMs: 1,
      finishReason: null,
      modelAlias: null,
      resolvedModel: null,
      errorCode: "CLIENT_DEADLINE",
      diagnosticReason: "client_deadline",
      httpStatus: null,
      abortedByOurDeadline: true,
    };
    let extractCalls = 0;
    const extract = vi.fn(async (): Promise<ExtractOneRangeResult> => {
      extractCalls += 1;
      if (extractCalls <= 2) {
        return { ok: false, calls: [failedCall], metric: null, error: deadlineError, callsStarted: 0 };
      }
      return successOutcome();
    });
    const putRange = vi.fn();
    const deps = {
      client: {
        rpc: vi.fn(async (fn: string) => {
          if (fn === "record_extracting_document_success") return { data: { saved: true }, error: null };
          if (fn === "get_pipeline_throughput") return { data: { sampleCount: 0 }, error: null };
          if (fn === "fail_stale_in_flight_doc_extraction_attempts") return { data: { failedCount: 0 }, error: null };
          if (fn === "put_doc_extraction_range") {
            putRange();
            return { data: { saved: true }, error: null };
          }
          if (fn === "get_doc_extraction_ranges_for_run") return { data: { ranges: [] }, error: null };
          if (fn === "get_doc_extraction_gap_pages_for_run") return { data: { gaps: [] }, error: null };
          throw new Error(fn);
        }),
      },
      planner: { getConfig: () => ({ baseUrl: "https://x", serviceToken: "t", timeoutMs: 1 }), fetchFn: fetch },
    } as unknown as AnalysisWorkflowDeps;
    const invocationStart = Date.now();
  const workItems = [
    { document: snapshotDocument(DOC_1, "Petition.pdf", { verifiedPageCount: 6 }), pageRange: "5" },
    { document: snapshotDocument(DOC_1, "Petition.pdf", { verifiedPageCount: 6 }), pageRange: "6" },
  ];
    let clock = invocationStart;
    const result = await runExtractingWorkerPool({
      deps,
      run: runJson({ status: "EXTRACTING" }),
      sourceSnapshot: sourceSnapshot([snapshotDocument(DOC_1, "Petition.pdf", { verifiedPageCount: 6 })]),
      workItems,
      catalog: loadPromptCatalog(),
      correlationId: "corr",
      now: () => new Date(clock),
      clock: () => {
        clock += 120_000;
        return clock;
      },
      invocationStartedAt: invocationStart,
      extract,
      canStart: () => extractCalls < 3,
    });
    expect(result.deferred).toBe(true);
    expect(putRange).not.toHaveBeenCalled();
    expect(extractCalls).toBeGreaterThanOrEqual(2);
  });

  it("defers when the route budget cannot fit another document start", async () => {
    const extract = vi.fn(async (): Promise<ExtractOneRangeResult> => successOutcome());
    const docIds = [
      "aaaaaaaa-0000-4000-8000-000000000001",
      "bbbbbbbb-0000-4000-8000-000000000002",
      "cccccccc-0000-4000-8000-000000000003",
      "dddddddd-0000-4000-8000-000000000004",
      "eeeeeeee-0000-4000-8000-000000000005",
      "ffffffff-0000-4000-8000-000000000006",
    ];
    const workItems = docIds.map((id, index) => ({ document: snapshotDocument(id, `Doc ${index}.pdf`), pageRange: null }));
    const result = await runExtractingWorkerPool(
      poolInput({
        workItems,
        clock: () => Date.now(),
        invocationStartedAt: Date.now(),
        extract,
        canStart: () => false,
      }),
    );
    expect(result.deferred).toBe(true);
    expect(extract).not.toHaveBeenCalled();
  });
});

describe("loadDocumentPages", () => {
  it("loads persisted pages via list_document_pages for the frozen read fingerprint", async () => {
    const document = snapshotDocument(DOC_1, "Petition.pdf", { verifiedPageCount: 35, totalPhysicalPages: 35 });
    const texts = Array.from({ length: 35 }, (_, index) => `Petition page ${index + 1} content`);
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "get_study_source_pages") return { data: { snapshotCurrent: true, pages: [] }, error: null };
        if (fn === "list_document_pages") return { data: listDocumentPagesPayload(document, texts), error: null };
        throw new Error(fn);
      }),
    };
    const pages = await loadDocumentPages({
      client,
      hiveId: HIVE_ID,
      runId: RUN_ID,
      document,
      correlationId: "corr",
    });
    expect(pages).toHaveLength(35);
    expect(pages[0]?.text).toBe(texts[0]);
    expect(pages[34]?.pageNumber).toBe(35);
    expect(client.rpc.mock.calls.some((call) => call[0] === "list_document_pages")).toBe(true);
  });

  it("raises when a persisted page row is missing", async () => {
    const document = snapshotDocument(DOC_1, "Petition.pdf", { verifiedPageCount: 35, totalPhysicalPages: 35 });
    const texts = Array.from({ length: 34 }, (_, index) => `Petition page ${index + 1}`);
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "get_study_source_pages") return { data: { snapshotCurrent: true, pages: [] }, error: null };
        if (fn === "list_document_pages") return { data: listDocumentPagesPayload(document, texts), error: null };
        throw new Error(fn);
      }),
    };
    await expect(
      loadDocumentPages({ client, hiveId: HIVE_ID, runId: RUN_ID, document, correlationId: "corr" }),
    ).rejects.toMatchObject({ diagnosticReason: "extract_pages_missing" });
  });

  const petitionId = "9bb4d995-9b44-4e5f-95b9-3eb38019f3a2";
  const petitionFileSha = "c8590f8d3ad9085d04e76ebabd9f2f92b884bdf6869b003bb9f953fa3e23b122";
  const petitionPageSet = "sha256:e3dd8c9afe5c5f3c5683ab60e6f04440b16ce5b6050e5c1aec3daab543162fa0";
  const petitionReadFingerprint = "049452f644ffef53b0bd337b039592fc3dc68f00104ee581890f268b49f28004";

  function petitionDocument(sha256: string) {
    return snapshotDocument(petitionId, "01_petition_schedules.pdf", {
      sha256,
      readFingerprint: petitionReadFingerprint,
      pageSetDigest: petitionPageSet,
      verifiedPageCount: 35,
      totalPhysicalPages: 35,
    });
  }

  it("loads the petition's 35 pages when the stored file sha256 has no prefix", async () => {
    const document = petitionDocument(petitionFileSha);
    const texts = Array.from({ length: 35 }, (_, index) => `Petition page ${index + 1}`);
    const client = {
      rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
        if (fn === "get_study_source_pages") return { data: { snapshotCurrent: true, pages: [] }, error: null };
        if (fn === "list_document_pages") {
          expect(args?.p_page_set_digest).toBe(petitionPageSet);
          expect(args?.p_read_fingerprint).toBe(petitionReadFingerprint);
          const payload = listDocumentPagesPayload(document, texts);
          expect(payload.source_sha256).toBe(petitionFileSha);
          expect(payload.source_sha256.startsWith("sha256:")).toBe(false);
          return { data: payload, error: null };
        }
        throw new Error(fn);
      }),
    };
    const pages = await loadDocumentPages({
      client,
      hiveId: HIVE_ID,
      runId: RUN_ID,
      document,
      correlationId: "corr",
    });
    expect(pages).toHaveLength(35);
    expect(pages[34]?.pageNumber).toBe(35);

    const prefixedSnapshot = petitionDocument(`sha256:${petitionFileSha}`);
    const prefixedPages = await loadDocumentPages({
      client,
      hiveId: HIVE_ID,
      runId: RUN_ID,
      document: prefixedSnapshot,
      correlationId: "corr",
    });
    expect(prefixedPages).toHaveLength(35);
  });

  it("still rejects a different file sha256 with the registered-source message", async () => {
    const stored = petitionDocument(petitionFileSha);
    const requested = petitionDocument("d".repeat(64));
    const texts = Array.from({ length: 35 }, (_, index) => `Petition page ${index + 1}`);
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "get_study_source_pages") return { data: { snapshotCurrent: true, pages: [] }, error: null };
        if (fn === "list_document_pages") return { data: listDocumentPagesPayload(stored, texts), error: null };
        throw new Error(fn);
      }),
    };
    await expect(
      loadDocumentPages({ client, hiveId: HIVE_ID, runId: RUN_ID, document: requested, correlationId: "corr" }),
    ).rejects.toMatchObject({
      errorCode: "INVALID_DOCUMENT",
      safeMessage: "The document content hash did not match the registered source.",
      diagnosticReason: "page_source_sha256_mismatch",
      diagnosticField: "expectedPrefix:0.expectedLength:64.actualPrefix:0.actualLength:64",
    });
  });
});

describe("extractOneRange attempt recording", () => {
  const catalog = loadPromptCatalog();

  it("logs and terminates the range without calling the planner when begin_doc_extraction_attempt fails", async () => {
    const document = snapshotDocument(DOC_1, "Petition.pdf", { verifiedPageCount: 2 });
    const texts = ["alpha", "beta"];
    const logSpy = vi.spyOn(logger, "emitStructuredEvent");
    const plannerFetch = vi.fn(async () => {
      throw new Error("planner should not run when attempt recording fails");
    });
    const deps = {
      client: {
        rpc: vi.fn(async (fn: string) => {
          if (fn === "get_study_source_pages") return { data: { snapshotCurrent: true }, error: null };
          if (fn === "list_document_pages") {
            return { data: listDocumentPagesPayload(document, texts), error: null };
          }
          if (fn === "get_pipeline_throughput") return { data: { sampleCount: 0 }, error: null };
          if (fn === "begin_doc_extraction_attempt") {
            return { data: null, error: { code: "PGRST202", message: "function not found" } };
          }
          throw new Error(fn);
        }),
      },
      planner: { getConfig: () => ({ baseUrl: "https://x", serviceToken: "t", timeoutMs: 1 }), fetchFn: plannerFetch },
    } as unknown as AnalysisWorkflowDeps;
    const outcome = await extractOneRange({
      deps,
      run: runJson("EXTRACTING", { id: RUN_ID, hiveId: HIVE_ID }),
      workItem: { document, pageRange: null },
      catalog,
      correlationId: "corr",
      stageAttempt: 1,
      now: () => new Date("2026-11-06T15:00:00.000Z"),
      throughput,
    });
    expect(outcome.ok).toBe(false);
    expect(plannerFetch).not.toHaveBeenCalled();
    if (!outcome.ok) expect(outcome.calls.length).toBeGreaterThanOrEqual(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "pipeline.extract.attempt_record_failed",
        diagnosticReason: "extract_attempt_record_failed",
      }),
    );
    logSpy.mockRestore();
  });
});

describe("extractOneRange blank pages", () => {
  it("persists unreadable pages and completes extraction for a single readable page", async () => {
    const document = snapshotDocument(DOC_1, "Petition.pdf", { verifiedPageCount: 3, totalPhysicalPages: 3 });
    const texts = ["page one text", "", ""];
    const putRange = vi.fn(async () => ({ inserted: true, replayed: false }));
    const putDoc = vi.fn(async () => ({ inserted: true, replayed: false }));
    const savedRanges: Record<string, unknown>[] = [];
    const client = {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        if (fn === "get_study_source_pages") return { data: { snapshotCurrent: true, pages: [] }, error: null };
        if (fn === "list_document_pages") return { data: listDocumentPagesPayload(document, texts), error: null };
        if (fn === "get_pipeline_throughput") return { data: { sampleCount: 0 }, error: null };
        if (fn === "begin_doc_extraction_attempt") return { data: { id: "aaaaaaaa-0000-4000-8000-000000000099" }, error: null };
        if (fn === "update_doc_extraction_attempt_outcome") return { data: { updated: true }, error: null };
        if (fn === "put_doc_extraction_range") {
          putRange();
          savedRanges.push({
            sourceDocumentId: String(args.p_source_document_id ?? "").toLowerCase(),
            pageRange: String(args.p_page_range ?? "").toLowerCase(),
            extraction: args.p_extraction,
            stats: args.p_stats ?? {},
            modelAlias: String(args.p_model_alias ?? "harvester"),
          });
          return { data: { inserted: true, replayed: false }, error: null };
        }
        if (fn === "put_doc_extraction") {
          putDoc();
          return { data: { inserted: true, replayed: false }, error: null };
        }
        if (fn === "get_doc_extraction_ranges_for_run") return { data: { ranges: savedRanges.map((row) => ({ ...row })) }, error: null };
        if (fn === "get_doc_extraction_gap_pages_for_run") return { data: { gaps: [] }, error: null };
        if (fn === "get_doc_extraction_attempt_totals_for_run") return { data: { totals: [] }, error: null };
        if (fn === "record_extracting_document_success") return { data: { saved: true }, error: null };
        throw new Error(fn);
      }),
    };
    const extractAnswer = {
      schema: "hive.doc-extraction/1",
      document: { titleAsPrinted: "t", documentType: "q", summary: "s", issuer: { name: "x" } },
      facts: [
        {
          id: "F1",
          subject: "s",
          attribute: "a",
          valueAsWritten: "v",
          modality: "stated",
          evidence: [{ page: 1, quote: "page one" }],
        },
      ],
      emptyFields: [],
      referencedDocuments: [],
      coverage: {
        pageCount: 1,
        pagesRead: [1],
        pagesBlankOrUnreadable: [],
        truncated: false,
        lastPageCompleted: 1,
      },
    };
    const plannerFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            contract_version: PLANNER_CONTRACT_VERSION,
            task: "extract",
            model_alias: "harvester",
            resolved_model: "synthetic-model",
            content_json: extractAnswer,
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            latency_ms: 1,
            finish_reason: "stop",
          }),
          { status: 200 },
        ),
    );
    const deps = {
      client,
      planner: { getConfig: () => ({ baseUrl: "https://x", serviceToken: "t", timeoutMs: 60000 }), fetchFn: plannerFetch },
    } as unknown as AnalysisWorkflowDeps;
    const outcome = await extractOneRange({
      deps,
      run: runJson("EXTRACTING", { id: RUN_ID, hiveId: HIVE_ID }),
      workItem: { document, pageRange: null },
      catalog: loadPromptCatalog(),
      correlationId: "corr",
      stageAttempt: 1,
      now: () => new Date("2026-11-06T15:00:00.000Z"),
      throughput,
    });
    expect(outcome.ok).toBe(true);
    expect(putRange).toHaveBeenCalled();
    expect(putDoc).toHaveBeenCalled();
  });
});

describe("completeExtractedDocumentIds", () => {
  it("treats validated cached extractions like workflow CACHED fixtures", async () => {
    const validated = validateDocExtraction(
      {
        document: { titleAsPrinted: "Quote", documentType: "quote", issuer: { name: "Supplier" }, summary: "A quote." },
        facts: [
          {
            id: "F-33333333-001",
            subject: "Total price",
            attribute: "amount",
            valueAsWritten: "$1,200.00",
            modality: "stated",
            evidence: [{ page: 1, quote: "the total price is $1,200.00" }],
          },
        ],
        emptyFields: [],
        referencedDocuments: [],
      },
      { documentId: DOC_1, fileName: "Quote A.pdf", pageRange: null },
    );
    expect(validated.ok).toBe(true);
    const document = snapshotDocument(DOC_1, "Quote A.pdf", { verifiedPageCount: 1, totalPhysicalPages: 1 });
    const extractionsPayload = {
      extractions: [{ sourceDocumentId: DOC_1, extraction: validated.value }],
    };
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "get_doc_extraction_gap_pages_for_run") return { data: { gaps: [] }, error: null };
        if (fn === "get_doc_extraction_ranges_for_run") return { data: { ranges: [] }, error: null };
        throw new Error(fn);
      }),
    };
    const complete = await completeExtractedDocumentIds({
      client,
      runId: RUN_ID,
      snapshot: sourceSnapshot({ documents: [document] }),
      extractionsPayload,
      extractProgress: { extractGapRetryCompleted: {} },
    });
    expect([...complete]).toEqual([DOC_1.toLowerCase()]);
  });

  it("excludes cached extractions with pageExtractionGaps until a one-time gap retry is recorded", async () => {
    const document = snapshotDocument(DOC_1, "Cached.pdf", { verifiedPageCount: 3 });
    const snapshot = sourceSnapshot({ documents: [document] });
    const extractionsPayload = {
      extractions: [
        {
          sourceDocumentId: DOC_1,
          stats: { pageExtractionGaps: [2] },
          extraction: { schema: "hive.doc-extraction/1", coverage: { pagesRead: [1, 3] } },
        },
      ],
    };
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "get_doc_extraction_gap_pages_for_run") return { data: { gaps: [] }, error: null };
        if (fn === "get_doc_extraction_ranges_for_run") return { data: { ranges: [] }, error: null };
        throw new Error(fn);
      }),
    };
    const pending = await completeExtractedDocumentIds({
      client,
      runId: RUN_ID,
      snapshot,
      extractionsPayload,
      extractProgress: { extractGapRetryCompleted: {} },
    });
    expect([...pending]).toEqual([]);
    const afterRetry = await completeExtractedDocumentIds({
      client,
      runId: RUN_ID,
      snapshot,
      extractionsPayload,
      extractProgress: { extractGapRetryCompleted: { [DOC_1.toLowerCase()]: true } },
    });
    expect([...afterRetry]).toEqual([DOC_1.toLowerCase()]);
  });
});
