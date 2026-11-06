import { defaultPipelineThroughput } from "@hiveforyou/contracts";
import { describe, expect, it, vi } from "vitest";

import { buildProcessingRunProgressFingerprint } from "@/server/pipeline/progress-estimate-anchor";
import {
  materializeProcessingRunProgressEstimate,
  persistProcessingRunProgressEstimate,
} from "@/server/pipeline/progress-estimate-persistence";
type DbRow = {
  estimatedCompletionAt: string | null;
  estimateFingerprint: string | null;
};

function createDbMock(initial: DbRow) {
  const row = { ...initial };
  return {
    row,
    client: {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        if (fn === "persist_processing_run_estimate") {
          row.estimatedCompletionAt = (args.p_estimated_completion_at as string | null) ?? null;
          row.estimateFingerprint = (args.p_estimate_fingerprint as string | null) ?? null;
          return { data: true, error: null };
        }
        if (fn === "backfill_processing_run_estimate") {
          if (row.estimatedCompletionAt === null) {
            row.estimatedCompletionAt = args.p_estimated_completion_at as string;
            row.estimateFingerprint = args.p_estimate_fingerprint as string;
          }
          return { data: true, error: null };
        }
        if (fn === "get_pipeline_throughput") {
          return { data: { sampleCount: 0 }, error: null };
        }
        return { data: null, error: null };
      }),
    },
  };
}

const throughputs = {
  extract: defaultPipelineThroughput("extract"),
  canonicalize: defaultPipelineThroughput("canonicalize"),
  write: defaultPipelineThroughput("write"),
};

const baseRun = {
  id: "aaaaaaaa-0000-4000-8000-000000000099",
  hiveId: "bbbbbbbb-0000-4000-8000-000000000001",
  kind: "STUDY_PREPARATION" as const,
  requestId: "cccccccc-0000-4000-8000-000000000002",
  attemptNumber: 1,
  status: "EXTRACTING" as const,
  authorizedSourceDocumentIds: [],
  intentRequestIds: [],
  coverageComplete: true,
  coverageAcknowledged: false,
  coverageDigest: null,
  coverageStatus: null,
  coverageGaps: [],
  coverageAcknowledgement: null,
  coverageAcknowledgedAt: null,
  snapshotFrozen: true,
  stageAttempt: 1,
  stageMetrics: [],
  extractedDocumentCount: 0,
  extractingPageCompleted: null,
  extractingPageTotal: null,
  errorCode: null,
  errorMessageSafe: null,
  retryable: null,
  correlationId: "dddddddd-0000-4000-8000-000000000003",
  createdAt: "2026-11-05T00:00:00.000Z",
  startedAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
  finishedAt: null,
  preparationMode: "ANALYZE" as const,
};

const snapshotState = {
  pagesByDocument: new Map([
    ["aaaaaaaa-0000-4000-8000-000000000001", [{ pageNumber: 1, text: "x".repeat(8000) }]],
  ]),
  savedRangeKeysByDocument: new Map<string, ReadonlySet<string>>(),
  extractedDocumentIds: new Set<string>(),
};

describe("progress estimate persistence", () => {
  const snapshot = {
    documents: [
      {
        sourceDocumentId: "aaaaaaaa-0000-4000-8000-000000000001",
        fileName: "a.pdf",
        mimeType: "application/pdf",
        sha256: "sha256:" + "a".repeat(64),
        readId: "bbbbbbbb-0000-4000-8000-000000000002",
        readStatus: "SUCCEEDED" as const,
        readFingerprint: "fp",
        pageSetDigest: "sha256:" + "b".repeat(64),
        totalPhysicalPages: 1,
        verifiedPageCount: 1,
        missingPageNumbers: [],
        emptyPageNumbers: [],
        createdAt: "2026-11-05T00:00:00.000Z",
      },
    ],
    excluded: [],
    coverageComplete: true,
  };

  it("returns the same estimatedCompletionAt from two fresh module polls when progress is unchanged", async () => {
    const db = createDbMock({ estimatedCompletionAt: null, estimateFingerprint: null });
    const nowMs = 1_762_387_200_000;
    const fingerprint = buildProcessingRunProgressFingerprint({
      run: baseRun,
      extractedDocumentIds: snapshotState.extractedDocumentIds,
      savedRangeKeysByDocument: snapshotState.savedRangeKeysByDocument,
    });
    await persistProcessingRunProgressEstimate(db.client, {
      runId: baseRun.id,
      estimatedCompletionAtMs: nowMs + 600_000,
      estimateFingerprint: fingerprint,
    });

    const runWithStore = {
      ...baseRun,
      estimatedCompletionAt: db.row.estimatedCompletionAt,
      estimateFingerprint: db.row.estimateFingerprint,
    };

    const poll = async () => {
      const { materializeProcessingRunProgressEstimate: materialize } = await import(
        "@/server/pipeline/progress-estimate-persistence"
      );
      return materialize(db.client, {
        run: { ...runWithStore, estimatedCompletionAt: db.row.estimatedCompletionAt, estimateFingerprint: db.row.estimateFingerprint },
        snapshot,
        correlationId: baseRun.correlationId,
        nowMs: nowMs + 5_000,
        extractThroughput: throughputs.extract,
        canonicalizeThroughput: throughputs.canonicalize,
        writeThroughput: throughputs.write,
        snapshotState,
      });
    };

    const first = await poll();
    const second = await poll();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.estimatedCompletionAt).toBe(first!.estimatedCompletionAt);
    expect(db.client.rpc).not.toHaveBeenCalledWith(
      "backfill_processing_run_estimate",
      expect.anything(),
    );
  });

  it("changes estimatedCompletionAt when the worker persists a new fingerprint after a range finishes", async () => {
    const db = createDbMock({ estimatedCompletionAt: null, estimateFingerprint: null });
    const nowMs = 1_762_387_200_000;
    const fingerprintBefore = buildProcessingRunProgressFingerprint({
      run: baseRun,
      extractedDocumentIds: snapshotState.extractedDocumentIds,
      savedRangeKeysByDocument: snapshotState.savedRangeKeysByDocument,
    });
    await persistProcessingRunProgressEstimate(db.client, {
      runId: baseRun.id,
      estimatedCompletionAtMs: nowMs + 600_000,
      estimateFingerprint: fingerprintBefore,
    });
    const first = await materializeProcessingRunProgressEstimate(db.client, {
      run: { ...baseRun, estimatedCompletionAt: db.row.estimatedCompletionAt, estimateFingerprint: db.row.estimateFingerprint },
      snapshot,
      correlationId: baseRun.correlationId,
      nowMs,
      extractThroughput: throughputs.extract,
      canonicalizeThroughput: throughputs.canonicalize,
      writeThroughput: throughputs.write,
      snapshotState,
    });

    const saved = new Map<string, ReadonlySet<string>>([
      ["aaaaaaaa-0000-4000-8000-000000000001", new Set(["1"])],
    ]);
    const fingerprintAfter = buildProcessingRunProgressFingerprint({
      run: baseRun,
      extractedDocumentIds: snapshotState.extractedDocumentIds,
      savedRangeKeysByDocument: saved,
    });
    await persistProcessingRunProgressEstimate(db.client, {
      runId: baseRun.id,
      estimatedCompletionAtMs: nowMs + 300_000,
      estimateFingerprint: fingerprintAfter,
    });

    const second = await materializeProcessingRunProgressEstimate(db.client, {
      run: { ...baseRun, estimatedCompletionAt: db.row.estimatedCompletionAt, estimateFingerprint: db.row.estimateFingerprint },
      snapshot,
      correlationId: baseRun.correlationId,
      nowMs,
      extractThroughput: throughputs.extract,
      canonicalizeThroughput: throughputs.canonicalize,
      writeThroughput: throughputs.write,
      snapshotState: { ...snapshotState, savedRangeKeysByDocument: saved },
    });

    expect(first!.estimatedCompletionAt).not.toBe(second!.estimatedCompletionAt);
    expect(Date.parse(second!.estimatedCompletionAt)).toBeLessThan(Date.parse(first!.estimatedCompletionAt));
  });
});
