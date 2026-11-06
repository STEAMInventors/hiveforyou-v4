import { createHiveError, type HiveError, type StageMetric } from "@hiveforyou/contracts";
import { describe, expect, it, vi } from "vitest";

import { DOC_1, DOC_2, RUN_ID, runJson, snapshotDocument, sourceSnapshot } from "@/server/study-preparation/study-preparation.fixtures";
import { loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";
import { WRITE_CLIENT_TIMEOUT_MARGIN_MS } from "@/server/workflow/report-generation";

import type { AnalysisWorkflowDeps } from "./analysis-workflow";
import {
  EXTRACTING_ATTEMPT_LIMIT,
  EXTRACTING_CONCURRENCY,
  V5_CLIENT_TASK_TIMEOUT_MS,
  buildExtractWorkQueue,
  canStartExtractingDocument,
  documentsNeedingExtraction,
  documentPagesFullyExtracted,
  extractPlannerTimeoutMs,
  extractedDocumentIds,
  invocationRemainingMs,
  pageRangeStorageKey,
  runExtractingWorkerPool,
  savedRangeKeysByDocument,
  type ExtractOneRangeResult,
  type ExtractWorkItem,
} from "./v5-pipeline-stages";
import { missingExtractWorkItems, pageRangeStorageKey } from "@/server/pipeline/extract-runner";

describe("extract invocation budget", () => {
  it("requires remaining route time to cover the extract call budget plus margin", () => {
    const start = 1_000;
    expect(canStartExtractingDocument(() => start, start)).toBe(true);
    expect(extractPlannerTimeoutMs(() => start, start)).toBe(V5_CLIENT_TASK_TIMEOUT_MS);

    const late = () => start + 300_000 - WRITE_CLIENT_TIMEOUT_MARGIN_MS - 500;
    expect(canStartExtractingDocument(late, start)).toBe(false);
  });

  it("never assigns a planner timeout above the per-task cap", () => {
    const start = 0;
    const clock = () => 0;
    expect(extractPlannerTimeoutMs(clock, start)).toBeLessThanOrEqual(V5_CLIENT_TASK_TIMEOUT_MS);
    expect(invocationRemainingMs(clock, start)).toBe(300_000);
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
  it("skips page ranges already saved and resumes uncovered slices", () => {
    const document = snapshotDocument(DOC_1, "Long.pdf");
    const documentWithPages = { ...document, verifiedPageCount: 25 };
    const saved = savedRangeKeysByDocument({
      ranges: [{ sourceDocumentId: DOC_1, pageRange: "1-10" }],
    });
    const items = buildExtractWorkQueue({
      snapshot: { documents: [documentWithPages], excluded: [], coverageComplete: true },
      extractedIds: new Set(),
      savedRangeKeysByDocument: saved,
    });
    expect(items.map((item) => item.pageRange)).toEqual(["11-20", "21-25"]);
    expect(documentPagesFullyExtracted(25, new Set(["1-10"]))).toBe(false);
    expect(documentPagesFullyExtracted(25, new Set(["1-10", "11-20", "21-25"]))).toBe(true);
  });

  it("schedules adaptive sub-ranges after a split without redoing saved leaves", () => {
    const pages = Array.from({ length: 4 }, (_, index) => ({ pageNumber: index + 1, text: "x" }));
    const firstPass = missingExtractWorkItems(pages, new Set());
    expect(firstPass.map((item) => pageRangeStorageKey(item.pageRange))).toEqual(["1-4"]);
    const afterSplit = missingExtractWorkItems(pages, new Set(["1-2"]));
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

  it(`fails the pool after ${EXTRACTING_ATTEMPT_LIMIT} retryable failures on one range`, async () => {
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
          workItems: workItemsForDocuments([snapshotDocument(DOC_1, "A.pdf")]),
          clock: () => Date.now(),
          invocationStartedAt: Date.now(),
          extract,
        }),
      ),
    ).rejects.toMatchObject({ error: { errorCode: "MODEL_TIMEOUT" } });
    expect(extract).toHaveBeenCalledTimes(EXTRACTING_ATTEMPT_LIMIT);
  });

  it("defers when the route budget cannot fit another document start", async () => {
    let startsLeft = 2;
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
        clock: () => 0,
        invocationStartedAt: 0,
        extract,
        canStart: () => {
          if (startsLeft <= 0) return false;
          startsLeft -= 1;
          return true;
        },
      }),
    );
    expect(result.deferred).toBe(true);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("does not record success for documents that never saved an extraction", async () => {
    const record = vi.fn(async (fn: string) => {
      if (fn === "record_extracting_document_success") return { data: { saved: true }, error: null };
      throw new Error(`unexpected rpc ${fn}`);
    });
    const countingDeps = {
      client: { rpc: record },
    } as unknown as AnalysisWorkflowDeps;
    const extract = vi.fn(async (input): Promise<ExtractOneRangeResult> => {
      if (input.workItem.document.sourceDocumentId === DOC_1) {
        return { ...successOutcome(), documentMetric: metricFor() };
      }
      return {
        ok: false,
        calls: [],
        metric: null,
        error: createHiveError({
          errorCode: "MODEL_OUTPUT_INVALID",
          category: "MODEL",
          stage: "EXTRACT",
          retryable: false,
          safeMessage: "bad",
          correlationId: "corr",
          diagnosticReason: "model_output_truncated",
        }),
      };
    });
    await expect(
      runExtractingWorkerPool(
        poolInput({
          workItems: workItemsForDocuments([snapshotDocument(DOC_1, "A.pdf"), snapshotDocument(DOC_2, "B.pdf")]),
          clock: () => Date.now(),
          invocationStartedAt: Date.now(),
          extract,
          deps: countingDeps,
        }),
      ),
    ).rejects.toMatchObject({ error: { errorCode: "MODEL_OUTPUT_INVALID" } });
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("defers across invocations when each range consumes most of the route budget", async () => {
    let now = 0;
    const clock = () => now;
    let routeStartsLeft = 1;
    const extract = vi.fn(async (): Promise<ExtractOneRangeResult> => {
      now += 280_000;
      return successOutcome();
    });
    const workItems = workItemsForDocuments([snapshotDocument(DOC_1, "A.pdf"), snapshotDocument(DOC_2, "B.pdf")]);
    const first = await runExtractingWorkerPool(
      poolInput({
        workItems,
        clock,
        invocationStartedAt: 0,
        extract,
        canStart: (c, s) => {
          const ok = routeStartsLeft > 0 && canStartExtractingDocument(c, s);
          if (ok) routeStartsLeft -= 1;
          return ok;
        },
      }),
    );
    expect(first.deferred).toBe(true);
    expect(extract).toHaveBeenCalledTimes(1);

    const done = new Set(
      extract.mock.calls.map((call) =>
        `${call[0]!.workItem.document.sourceDocumentId.toLowerCase()}:${pageRangeStorageKey(call[0]!.workItem.pageRange)}`,
      ),
    );
    const remaining = workItems.filter(
      (item) => !done.has(`${item.document.sourceDocumentId.toLowerCase()}:${pageRangeStorageKey(item.pageRange)}`),
    );
    const second = await runExtractingWorkerPool(
      poolInput({ workItems: remaining, clock, invocationStartedAt: now, extract }),
    );
    expect(second.deferred).toBe(false);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("completes a long document across two invocations without redoing saved ranges", async () => {
    const document = { ...snapshotDocument(DOC_1, "Long.pdf"), verifiedPageCount: 25 };
    const saved = new Set<string>();
    const extract = vi.fn(async (input): Promise<ExtractOneRangeResult> => {
      saved.add(pageRangeStorageKey(input.workItem.pageRange));
      return { ...successOutcome(), documentMetric: null };
    });
    const fullQueue = buildExtractWorkQueue({
      snapshot: { documents: [document], excluded: [], coverageComplete: true },
      extractedIds: new Set(),
      savedRangeKeysByDocument: savedRangeKeysByDocument({ ranges: [] }),
    });
    expect(fullQueue.map((item) => item.pageRange)).toEqual(["1-10", "11-20", "21-25"]);

    let routeStartsLeft = 2;
    const first = await runExtractingWorkerPool(
      poolInput({
        workItems: fullQueue,
        clock: () => Date.now(),
        invocationStartedAt: Date.now(),
        extract,
        canStart: () => {
          if (routeStartsLeft <= 0) return false;
          routeStartsLeft -= 1;
          return true;
        },
      }),
    );
    expect(first.deferred).toBe(true);
    expect(saved).toEqual(new Set(["1-10", "11-20"]));

    const resumeQueue = buildExtractWorkQueue({
      snapshot: { documents: [document], excluded: [], coverageComplete: true },
      extractedIds: new Set(),
      savedRangeKeysByDocument: savedRangeKeysByDocument({
        ranges: [...saved].map((pageRange) => ({ sourceDocumentId: DOC_1, pageRange })),
      }),
    });
    expect(resumeQueue.map((item) => item.pageRange)).toEqual(["21-25"]);
    await runExtractingWorkerPool(
      poolInput({
        workItems: resumeQueue,
        clock: () => Date.now(),
        invocationStartedAt: Date.now(),
        extract,
      }),
    );
    expect(saved).toEqual(new Set(["1-10", "11-20", "21-25"]));
    expect(extract).toHaveBeenCalledTimes(3);
  });

  it("records document success once when concurrent finishers merge the same document", async () => {
    const record = vi.fn(async (fn: string) => {
      if (fn === "record_extracting_document_success") return { data: { saved: true }, error: null };
      throw new Error(`unexpected rpc ${fn}`);
    });
    const document = { ...snapshotDocument(DOC_1, "Long.pdf"), verifiedPageCount: 25 };
    const workItems = buildExtractWorkQueue({
      snapshot: { documents: [document], excluded: [], coverageComplete: true },
      extractedIds: new Set(),
      savedRangeKeysByDocument: new Map(),
    }).slice(0, 2);
    let mergeCalls = 0;
    const extract = vi.fn(async (input): Promise<ExtractOneRangeResult> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const mergedThisCall = input.workItem.pageRange === "11-20";
      if (mergedThisCall) mergeCalls += 1;
      return {
        ...successOutcome(),
        documentMetric: mergedThisCall ? metricFor() : null,
      };
    });
    await runExtractingWorkerPool(
      poolInput({
        workItems,
        clock: () => Date.now(),
        invocationStartedAt: Date.now(),
        extract,
        deps: { client: { rpc: record } } as unknown as AnalysisWorkflowDeps,
      }),
    );
    expect(mergeCalls).toBe(1);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
