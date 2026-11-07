import {
  createHiveError,
  defaultPipelineThroughput,
  INVOCATION_HANDOFF_MARGIN_MS,
  MIN_PLANNER_CALL_MS,
  invocationRemainingMs,
  type HiveError,
  type SnapshotDocument,
  type StageMetric,
  V5_CLIENT_TASK_TIMEOUT_MS,
} from "@hiveforyou/contracts";
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

function normalizedSourceSha256(document: SnapshotDocument): string {
  const raw = document.sha256.trim().toLowerCase();
  return raw.startsWith("sha256:") ? raw : `sha256:${raw}`;
}

function listDocumentPagesPayload(document: SnapshotDocument, texts: readonly string[]) {
  const sourceSha256 = normalizedSourceSha256(document);
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
  it("requires remaining route time to cover the minimum call budget plus handoff margin", () => {
    const start = 1_000;
    expect(canStartExtractingDocument(() => start, start)).toBe(true);

    const late = () => start + 300_000 - INVOCATION_HANDOFF_MARGIN_MS - MIN_PLANNER_CALL_MS + 1;
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

  it("does not start a call with less than 60 s available", () => {
    const start = 0;
    const remaining = INVOCATION_HANDOFF_MARGIN_MS + MIN_PLANNER_CALL_MS - 1;
    const clock = () => start + 300_000 - remaining;
    expect(
      extractPlannerTimeoutMs(clock, start, 1000, throughput),
    ).toBe("expired");
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
    expect(documentPagesFullyExtracted(25, new Set(["1-10"]))).toBe(false);
    expect(documentPagesFullyExtracted(25, new Set(["1-10", "11-20", "21-25"]))).toBe(true);
  });

  it("schedules adaptive sub-ranges after a split without redoing saved leaves", () => {
    const pages = Array.from({ length: 4 }, (_, index) => ({ pageNumber: index + 1, text: "x" }));
    const firstPass = missingExtractWorkItems(pages, new Set(), throughput);
    expect(firstPass.map((item) => pageRangeStorageKey(item.pageRange))).toEqual(["1-4"]);
    const afterSplit = missingExtractWorkItems(pages, new Set(["1-2"]), throughput);
    expect(afterSplit.map((item) => pageRangeStorageKey(item.pageRange))).toEqual(["3-4"]);
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
          if (fn === "put_doc_extraction_range") return { data: { saved: true }, error: null };
          if (fn === "get_doc_extraction_ranges_for_run") {
            return {
              data: {
                ranges: [
                  {
                    sourceDocumentId: DOC_1,
                    pageRange: "3",
                    extraction: { schema: "hive.doc-extraction/1" },
                    stats: {},
                    modelAlias: "harvester",
                  },
                ],
              },
              error: null,
            };
          }
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
          if (fn === "put_doc_extraction_range") return { data: { saved: true }, error: null };
          if (fn === "get_doc_extraction_ranges_for_run") return { data: { ranges: [] }, error: null };
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
