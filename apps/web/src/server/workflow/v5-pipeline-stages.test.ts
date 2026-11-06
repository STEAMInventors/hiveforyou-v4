import {
  createHiveError,
  defaultPipelineThroughput,
  INVOCATION_HANDOFF_MARGIN_MS,
  MIN_PLANNER_CALL_MS,
  invocationRemainingMs,
  type HiveError,
  type StageMetric,
  V5_CLIENT_TASK_TIMEOUT_MS,
} from "@hiveforyou/contracts";
import { describe, expect, it, vi } from "vitest";

import { DOC_1, DOC_2, RUN_ID, runJson, snapshotDocument, sourceSnapshot } from "@/server/study-preparation/study-preparation.fixtures";
import { loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";

import type { AnalysisWorkflowDeps } from "./analysis-workflow";
import {
  EXTRACTING_ATTEMPT_LIMIT,
  EXTRACTING_CONCURRENCY,
  buildExtractWorkQueue,
  canStartExtractingDocument,
  documentsNeedingExtraction,
  documentPagesFullyExtracted,
  extractPlannerTimeoutMs,
  extractedDocumentIds,
  runExtractingWorkerPool,
  savedRangeKeysByDocument,
  type ExtractOneRangeResult,
  type ExtractWorkItem,
} from "./v5-pipeline-stages";
import { missingExtractWorkItems, pageRangeStorageKey } from "@/server/pipeline/extract-runner";

const throughput = defaultPipelineThroughput("extract");

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
          return {
            data: {
              snapshotCurrent: true,
              pages: Array.from({ length: 25 }, (_, index) => ({
                sourceDocumentId: DOC_1,
                pageNumber: index + 1,
                pageText: dense,
              })),
            },
            error: null,
          };
        }
        throw new Error(fn);
      }),
    };
    const items = await buildExtractWorkQueue({
      client,
      runId: RUN_ID,
      snapshot: { documents: [documentWithPages], excluded: [], coverageComplete: true },
      extractedIds: new Set(),
      savedRangeKeysByDocument: saved,
      correlationId: "corr",
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
            calls: [],
            metric: null,
            error: createHiveError({
              errorCode: "MODEL_TIMEOUT",
              category: "DEPENDENCY",
              stage: "ANALYZE",
              retryable: true,
              safeMessage: "timeout",
              correlationId: "corr",
            }),
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

  it(`records a single-page timeout as a gap instead of failing the pool`, async () => {
    const error = createHiveError({
      errorCode: "MODEL_TIMEOUT",
      category: "DEPENDENCY",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "timeout",
      correlationId: "corr",
    }) as HiveError;
    const extract = vi.fn(async (): Promise<ExtractOneRangeResult> => ({
      ok: false,
      calls: [],
      metric: null,
      error,
    }));
    const gapDeps = {
      client: {
        rpc: vi.fn(async (fn: string) => {
          if (fn === "record_extracting_document_success") return { data: { saved: true }, error: null };
          if (fn === "get_pipeline_throughput") return { data: { sampleCount: 0 }, error: null };
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
    expect(extract).toHaveBeenCalledTimes(EXTRACTING_ATTEMPT_LIMIT);
  });

  it(`fails the pool after ${EXTRACTING_ATTEMPT_LIMIT} retryable failures on a multi-page range`, async () => {
    const error = createHiveError({
      errorCode: "MODEL_TIMEOUT",
      category: "DEPENDENCY",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "timeout",
      correlationId: "corr",
    }) as HiveError;
    const extract = vi.fn(async (): Promise<ExtractOneRangeResult> => ({
      ok: false,
      calls: [],
      metric: null,
      error,
    }));
    await expect(
      runExtractingWorkerPool(
        poolInput({
          workItems: [{ document: snapshotDocument(DOC_1, "A.pdf"), pageRange: "1-4" }],
          clock: () => Date.now(),
          invocationStartedAt: Date.now(),
          extract,
        }),
      ),
    ).rejects.toMatchObject({ error: { errorCode: "MODEL_TIMEOUT" } });
    expect(extract).toHaveBeenCalledTimes(EXTRACTING_ATTEMPT_LIMIT);
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
