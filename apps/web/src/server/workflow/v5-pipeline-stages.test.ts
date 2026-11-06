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
  canStartExtractingDocument,
  documentsNeedingExtraction,
  extractPlannerTimeoutMs,
  extractedDocumentIds,
  invocationRemainingMs,
  runExtractingWorkerPool,
  type ExtractOneDocumentResult,
} from "./v5-pipeline-stages";

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

  const poolInput = (input: {
    documents: ReturnType<typeof snapshotDocument>[];
    clock: () => number;
    invocationStartedAt: number;
    extract?: typeof import("./v5-pipeline-stages").extractOneDocument;
    canStart?: (clock: () => number, invocationStartedAt: number) => boolean;
  }) => ({
    deps,
    run,
    catalog,
    correlationId: "corr",
    now: () => new Date("2026-11-05T00:00:00.000Z"),
    clock: input.clock,
    invocationStartedAt: input.invocationStartedAt,
    documents: input.documents,
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
    const extract = vi.fn(async (): Promise<ExtractOneDocumentResult> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true, metric: metricFor(), modelAlias: "harvester" };
    });
    await runExtractingWorkerPool(
      poolInput({ documents: pending, clock: () => Date.now(), invocationStartedAt: Date.now(), extract }),
    );
    expect(extract).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBeLessThanOrEqual(EXTRACTING_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("re-queues retryable failures without blocking other documents", async () => {
    const failures = new Map<string, number>();
    const extract = vi.fn(async (input): Promise<ExtractOneDocumentResult> => {
      const id = input.document.sourceDocumentId;
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
      return { ok: true, metric: metricFor(), modelAlias: "harvester" };
    });
    await runExtractingWorkerPool(
      poolInput({
        documents: [snapshotDocument(DOC_1, "A.pdf"), snapshotDocument(DOC_2, "B.pdf")],
        clock: () => Date.now(),
        invocationStartedAt: Date.now(),
        extract,
      }),
    );
    expect(extract.mock.calls.filter((call) => call[0]!.document.sourceDocumentId === DOC_1)).toHaveLength(2);
    expect(extract.mock.calls.filter((call) => call[0]!.document.sourceDocumentId === DOC_2)).toHaveLength(1);
  });

  it(`fails the pool after ${EXTRACTING_ATTEMPT_LIMIT} retryable failures on one document`, async () => {
    const error = createHiveError({
      errorCode: "MODEL_TIMEOUT",
      category: "DEPENDENCY",
      stage: "ANALYZE",
      retryable: true,
      safeMessage: "timeout",
      correlationId: "corr",
    }) as HiveError;
    const extract = vi.fn(async (): Promise<ExtractOneDocumentResult> => ({
      ok: false,
      calls: [],
      metric: null,
      error,
    }));
    await expect(
      runExtractingWorkerPool(
        poolInput({
          documents: [snapshotDocument(DOC_1, "A.pdf")],
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
    const extract = vi.fn(async (): Promise<ExtractOneDocumentResult> => ({
      ok: true,
      metric: metricFor(),
      modelAlias: "harvester",
    }));
    const docIds = [
      "aaaaaaaa-0000-4000-8000-000000000001",
      "bbbbbbbb-0000-4000-8000-000000000002",
      "cccccccc-0000-4000-8000-000000000003",
      "dddddddd-0000-4000-8000-000000000004",
      "eeeeeeee-0000-4000-8000-000000000005",
      "ffffffff-0000-4000-8000-000000000006",
    ];
    const documents = docIds.map((id, index) => snapshotDocument(id, `Doc ${index}.pdf`));
    const result = await runExtractingWorkerPool(
      poolInput({
        documents,
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

  it("defers across invocations when each document consumes most of the route budget", async () => {
    let now = 0;
    const clock = () => now;
    let routeStartsLeft = 1;
    const startChecks: boolean[] = [];
    const extract = vi.fn(async (): Promise<ExtractOneDocumentResult> => {
      now += 280_000;
      return { ok: true, metric: metricFor(), modelAlias: "harvester" };
    });
    const documents = [snapshotDocument(DOC_1, "A.pdf"), snapshotDocument(DOC_2, "B.pdf")];
    const first = await runExtractingWorkerPool(
      poolInput({
        documents,
        clock,
        invocationStartedAt: 0,
        extract,
        canStart: (c, s) => {
          const ok = routeStartsLeft > 0 && canStartExtractingDocument(c, s);
          startChecks.push(ok);
          if (ok) routeStartsLeft -= 1;
          return ok;
        },
      }),
    );
    expect(first.deferred).toBe(true);
    expect(extract).toHaveBeenCalledTimes(1);

    const done = new Set(extract.mock.calls.map((call) => call[0]!.document.sourceDocumentId.toLowerCase()));
    const remaining = documents.filter((document) => !done.has(document.sourceDocumentId.toLowerCase()));
    const second = await runExtractingWorkerPool(
      poolInput({ documents: remaining, clock, invocationStartedAt: now, extract }),
    );
    expect(second.deferred).toBe(false);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(startChecks.filter(Boolean)).toHaveLength(1);
  });
});
