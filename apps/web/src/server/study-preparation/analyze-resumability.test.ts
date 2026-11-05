import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HIVE_ID, INTENT_A, INTENT_B, snapshotDocument } from "@/server/study-preparation/study-preparation.fixtures";

const nextServer = vi.hoisted(() => ({ after: vi.fn((fn: () => void | Promise<void>) => fn()) }));
const auth = vi.hoisted(() => ({ requireApiSupabaseClient: vi.fn() }));
const planner = vi.hoisted(() => ({ loadPlannerServiceConfig: vi.fn() }));
const workflow = vi.hoisted(() => ({ processAnalysisRunSafely: vi.fn(async () => undefined) }));
const reportWorkflow = vi.hoisted(() => ({ processReportRunSafely: vi.fn(async () => undefined) }));
const worker = vi.hoisted(() => ({
  createWorkerDeps: vi.fn(() => ({ kind: "worker-deps" })),
  requireWorkerDispatch: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: nextServer.after,
}));
vi.mock("@/server/supabase/server-client", () => auth);
vi.mock("@/server/study-preparation/planner-client", () => planner);
vi.mock("@/server/workflow/analysis-workflow", () => workflow);
vi.mock("@/server/workflow/report-generation", () => reportWorkflow);
vi.mock("@/server/workflow/worker", () => worker);

import { POST as postReports, GET as getReports } from "@/app/api/v1/hives/[hiveId]/reports/route";
import { POST as postAnalyze } from "@/app/api/v1/hives/[hiveId]/study-preparation/route";

const OWNER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const OWNER_B = "aaaaaaaa-0000-4000-8000-000000000002";
const OTHER_HIVE_ID = "99999999-9999-4999-8999-999999999999";
const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const CANONICAL_STUDY_ID = "ffffffff-0000-4000-8000-000000000001";

const SNAPSHOT_DIGEST_1 = `sha256:${"1".repeat(64)}`;
const SNAPSHOT_DIGEST_2 = `sha256:${"2".repeat(64)}`;
const INTENT_DIGEST_1 = `sha256:${"3".repeat(64)}`;
const INTENT_DIGEST_2 = `sha256:${"4".repeat(64)}`;
const COVERAGE_DIGEST_1 = `sha256:${"5".repeat(64)}`;

type Audience = "CUSTOMER" | "PRO";

type StoredProcessingRun = {
  id: string;
  hiveId: string;
  ownerUserId: string;
  requestId: string;
  attemptNumber: number;
  status: string;
  sourceSnapshotDigest: string | null;
  intentSnapshotDigest: string;
  coverageDigest: string | null;
  correlationId: string;
};

type StoredStudyRevision = {
  id: string;
  canonicalStudyId: string;
  hiveId: string;
  ownerUserId: string;
  revisionNumber: number;
  predecessorRevisionId: string | null;
  processingRunId: string;
  sourceSnapshotDigest: string;
  intentSnapshotDigest: string;
  coverageDigest: string;
  bindingFormat: string;
  createdAt: string;
};

type StoredReportRun = {
  id: string;
  hiveId: string;
  ownerUserId: string;
  studyRevisionId: string;
  audience: Audience;
  trigger: "STUDY_ACCEPTED" | "OWNER_GENERATE";
  requestId: string | null;
  status: "QUEUED" | "WRITING" | "VALIDATING" | "SAVING" | "SUCCEEDED" | "FAILED";
  attemptCount: number;
  maxAttempts: number;
  leaseExpiresAtMs: number | null;
  errorCode: string | null;
  errorMessageSafe: string | null;
  retryable: boolean | null;
  correlationId: string;
  createdAt: string;
  finishedAt: string | null;
};

type StoredReport = {
  id: string;
  reportRunId: string;
  hiveId: string;
  ownerUserId: string;
  studyRevisionId: string;
  revisionNumber: number;
  audience: Audience;
  title: string;
  createdAt: string;
};

function makeUuid(seq: number): string {
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

/**
 * Deterministic in-memory simulation of the database state machine for `start_study_preparation`,
 * `generate_hive_report` and `get_hive_reports` (V4-004E).
 */
function createStatefulStore() {
  let seq = 100;
  let currentUserId = OWNER_A;
  let sourceSnapshotDigest = SNAPSHOT_DIGEST_1;
  let intentSnapshotDigest = INTENT_DIGEST_1;
  const coverageDigest = COVERAGE_DIGEST_1;
  let needsReadCount = 0;

  const processingRuns: StoredProcessingRun[] = [];
  const studyRevisions: StoredStudyRevision[] = [];
  const reportRuns: StoredReportRun[] = [];
  const reports: StoredReport[] = [];

  function runToJson(run: StoredProcessingRun) {
    const terminal = run.status === "SUCCEEDED" || run.status === "FAILED" || run.status === "NEEDS_CLARIFICATION";
    return {
      id: run.id,
      hiveId: run.hiveId,
      kind: "STUDY_PREPARATION",
      requestId: run.requestId,
      attemptNumber: run.attemptNumber,
      status: run.status,
      authorizedSourceDocumentIds: [snapshotDocument("33333333-3333-4333-8333-333333333333", "Doc.pdf").sourceDocumentId],
      intentRequestIds: [INTENT_A, INTENT_B],
      coverageComplete: true,
      coverageAcknowledged: false,
      coverageDigest: run.coverageDigest,
      coverageStatus: run.coverageDigest ? "COMPLETE" : null,
      coverageGaps: [],
      coverageAcknowledgement: run.coverageDigest ? "NOT_REQUIRED" : null,
      coverageAcknowledgedAt: null,
      snapshotFrozen: run.sourceSnapshotDigest !== null,
      stageAttempt: 1,
      stageMetrics: [],
      extractedDocumentCount: 0,
      errorCode: run.status === "FAILED" ? "SOURCE_CHANGED" : null,
      errorMessageSafe: run.status === "FAILED" ? "Your documents or request changed while analyzing." : null,
      retryable: run.status === "FAILED" ? true : null,
      correlationId: run.correlationId,
      createdAt: "2026-11-03T10:00:00.000Z",
      startedAt: "2026-11-03T10:00:01.000Z",
      updatedAt: "2026-11-03T10:00:02.000Z",
      finishedAt: terminal ? "2026-11-03T10:05:00.000Z" : null,
    };
  }

  function revisionToJson(rev: StoredStudyRevision) {
    return {
      id: rev.id,
      canonicalStudyId: rev.canonicalStudyId,
      revisionNumber: rev.revisionNumber,
      predecessorRevisionId: rev.predecessorRevisionId,
      processingRunId: rev.processingRunId,
      coverageComplete: true,
      coverageStatus: "COMPLETE",
      coverageGaps: [],
      coverageAcknowledgement: "NOT_REQUIRED",
      createdAt: rev.createdAt,
    };
  }

  function reportRunToJson(rr: StoredReportRun) {
    const saved = reports.find((r) => r.reportRunId === rr.id);
    return {
      id: rr.id,
      hiveId: rr.hiveId,
      studyRevisionId: rr.studyRevisionId,
      audience: rr.audience,
      trigger: rr.trigger,
      status: rr.status,
      attemptCount: rr.attemptCount,
      maxAttempts: rr.maxAttempts,
      errorCode: rr.errorCode,
      errorMessageSafe: rr.errorMessageSafe,
      retryable: rr.retryable,
      correlationId: rr.correlationId,
      reportId: saved?.id ?? null,
      createdAt: rr.createdAt,
      finishedAt: rr.finishedAt,
    };
  }

  function reportToJson(rep: StoredReport) {
    return {
      id: rep.id,
      reportRunId: rep.reportRunId,
      studyRevisionId: rep.studyRevisionId,
      revisionNumber: rep.revisionNumber,
      audience: rep.audience,
      title: rep.title,
      createdAt: rep.createdAt,
      modelAlias: "harvester",
      scenarioAnalysis: { schema: "hive.scenario-analysis/1", scenarios: [] },
      view: {
        schema: "hive-application-view/1",
        audience: rep.audience,
        title: rep.title,
        summary: [],
        components: [],
      },
    };
  }

  function latestReportRunsForRevision(revisionId: string) {
    return (["CUSTOMER", "PRO"] as const).flatMap((audience) => {
      const matching = reportRuns.filter((r) => r.studyRevisionId === revisionId && r.audience === audience);
      const latest = matching.at(-1);
      return latest ? [reportRunToJson(latest)] : [];
    });
  }

  function seedAcceptedStudy(options?: {
    sourceDigest?: string;
    intentDigest?: string;
    covDigest?: string;
    bindingFormat?: string;
    customerStatus?: StoredReportRun["status"] | "MISSING";
    proStatus?: StoredReportRun["status"] | "MISSING";
    customerLeased?: boolean;
    proLeased?: boolean;
  }) {
    seq += 1;
    const runId = makeUuid(seq);
    const run: StoredProcessingRun = {
      id: runId,
      hiveId: HIVE_ID,
      ownerUserId: OWNER_A,
      requestId: makeUuid(++seq),
      attemptNumber: processingRuns.length + 1,
      status: "SUCCEEDED",
      sourceSnapshotDigest: options?.sourceDigest ?? sourceSnapshotDigest,
      intentSnapshotDigest: options?.intentDigest ?? intentSnapshotDigest,
      coverageDigest: options?.covDigest ?? coverageDigest,
      correlationId: CORRELATION_ID,
    };
    processingRuns.push(run);

    const revId = makeUuid(++seq);
    const rev: StoredStudyRevision = {
      id: revId,
      canonicalStudyId: CANONICAL_STUDY_ID,
      hiveId: HIVE_ID,
      ownerUserId: OWNER_A,
      revisionNumber: studyRevisions.length + 1,
      predecessorRevisionId: studyRevisions.at(-1)?.id ?? null,
      processingRunId: runId,
      sourceSnapshotDigest: run.sourceSnapshotDigest!,
      intentSnapshotDigest: run.intentSnapshotDigest,
      coverageDigest: run.coverageDigest!,
      bindingFormat: options?.bindingFormat ?? "hive.source-page-index/1",
      createdAt: `2026-11-03T10:0${studyRevisions.length}:00.000Z`,
    };
    studyRevisions.push(rev);

    const addReportState = (audience: Audience, status: StoredReportRun["status"] | "MISSING", leased = false) => {
      if (status === "MISSING") return;
      const rrId = makeUuid(++seq);
      const terminal = status === "SUCCEEDED" || status === "FAILED";
      const rr: StoredReportRun = {
        id: rrId,
        hiveId: HIVE_ID,
        ownerUserId: OWNER_A,
        studyRevisionId: revId,
        audience,
        trigger: "STUDY_ACCEPTED",
        requestId: null,
        status,
        attemptCount: status === "QUEUED" && !leased ? 0 : 1,
        maxAttempts: 3,
        leaseExpiresAtMs: leased ? Date.now() + 300_000 : null,
        errorCode: status === "FAILED" ? "MODEL_OUTPUT_INVALID" : null,
        errorMessageSafe: status === "FAILED" ? "The report draft didn't pass our checks." : null,
        retryable: status === "FAILED" ? false : null,
        correlationId: CORRELATION_ID,
        createdAt: `2026-11-03T10:1${reportRuns.length}:00.000Z`,
        finishedAt: terminal ? `2026-11-03T10:1${reportRuns.length}:30.000Z` : null,
      };
      reportRuns.push(rr);
      if (status === "SUCCEEDED") {
        reports.push({
          id: makeUuid(++seq),
          reportRunId: rrId,
          hiveId: HIVE_ID,
          ownerUserId: OWNER_A,
          studyRevisionId: revId,
          revisionNumber: rev.revisionNumber,
          audience,
          title: `${audience} report v${reports.filter((r) => r.audience === audience).length + 1}`,
          createdAt: rr.finishedAt!,
        });
      }
    };

    addReportState("CUSTOMER", options?.customerStatus ?? "SUCCEEDED", options?.customerLeased);
    addReportState("PRO", options?.proStatus ?? "SUCCEEDED", options?.proLeased);

    return { run, revision: rev };
  }

  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    const hiveId = String(args.p_hive_id ?? "").toLowerCase();
    if (hiveId !== HIVE_ID || currentUserId !== OWNER_A) {
      return { data: null, error: { message: "hive_not_found" } };
    }

    if (fn === "start_study_preparation") {
      const requestId = String(args.p_request_id).toLowerCase();
      const correlationId = String(args.p_correlation_id).toLowerCase();

      // 1. Replay by processing_runs.request_id
      const existingRunByReq = processingRuns.find((r) => r.ownerUserId === currentUserId && r.requestId === requestId);
      if (existingRunByReq) {
        if (existingRunByReq.hiveId !== hiveId) return { data: null, error: { message: "idempotency_conflict" } };
        return {
          data: {
            processingRun: runToJson(existingRunByReq),
            created: false,
            queuedReadIds: [],
            queuedReportRunIds: [],
          },
          error: null,
        };
      }

      // 2. Replay by report_runs.request_id
      const existingReportByReq = reportRuns.find((r) => r.ownerUserId === currentUserId && r.requestId === requestId);
      if (existingReportByReq) {
        if (existingReportByReq.hiveId !== hiveId) return { data: null, error: { message: "idempotency_conflict" } };
        const rev = studyRevisions.find((s) => s.id === existingReportByReq.studyRevisionId)!;
        const run = processingRuns.find((r) => r.id === rev.processingRunId)!;
        const custReady = reports.some((rep) => rep.studyRevisionId === rev.id && rep.audience === "CUSTOMER");
        const proReady = reports.some((rep) => rep.studyRevisionId === rev.id && rep.audience === "PRO");
        return {
          data: {
            processingRun: runToJson(run),
            created: false,
            reusedStudy: true,
            reportsReady: custReady && proReady,
            studyRevision: revisionToJson(rev),
            reportRuns: latestReportRunsForRevision(rev.id),
            queuedReadIds: [],
            queuedReportRunIds: [],
          },
          error: null,
        };
      }

      // 3. Fail stale active processing runs whose snapshot/intent changed
      for (const active of processingRuns) {
        if (
          active.hiveId === hiveId &&
          active.status !== "SUCCEEDED" &&
          active.status !== "FAILED" &&
          active.status !== "NEEDS_CLARIFICATION"
        ) {
          const snapshotMatches =
            active.sourceSnapshotDigest === null || active.sourceSnapshotDigest === sourceSnapshotDigest;
          const intentMatches = active.intentSnapshotDigest === intentSnapshotDigest;
          if (!snapshotMatches || !intentMatches) {
            active.status = "FAILED";
          }
        }
      }

      // 4. Reattach to active compatible processing run
      const activeRun = processingRuns.find(
        (r) =>
          r.hiveId === hiveId &&
          r.status !== "SUCCEEDED" &&
          r.status !== "FAILED" &&
          r.status !== "NEEDS_CLARIFICATION",
      );
      if (activeRun) {
        return {
          data: {
            processingRun: runToJson(activeRun),
            created: false,
            queuedReadIds: [],
            queuedReportRunIds: [],
          },
          error: null,
        };
      }

      // 5. Find latest compatible accepted Study revision when no reads are needed
      if (needsReadCount === 0) {
        const compatibleRevision = [...studyRevisions]
          .reverse()
          .find((rev) => {
            const run = processingRuns.find((r) => r.id === rev.processingRunId);
            return (
              run?.status === "SUCCEEDED" &&
              rev.sourceSnapshotDigest === sourceSnapshotDigest &&
              rev.intentSnapshotDigest === intentSnapshotDigest &&
              rev.coverageDigest === coverageDigest &&
              rev.bindingFormat === "hive.source-page-index/1"
            );
          });

        if (compatibleRevision) {
          const run = processingRuns.find((r) => r.id === compatibleRevision.processingRunId)!;
          let customerReady = false;
          let proReady = false;
          const queuedReportRunIds: string[] = [];

          for (const audience of ["CUSTOMER", "PRO"] as const) {
            const validReport = reports.find((rep) => {
              const rr = reportRuns.find((r) => r.id === rep.reportRunId);
              return rep.studyRevisionId === compatibleRevision.id && rep.audience === audience && rr?.status === "SUCCEEDED";
            });
            if (validReport) {
              if (audience === "CUSTOMER") customerReady = true;
              else proReady = true;
              continue;
            }
            const activeWriter = [...reportRuns]
              .reverse()
              .find(
                (rr) =>
                  rr.studyRevisionId === compatibleRevision.id &&
                  rr.audience === audience &&
                  rr.status !== "SUCCEEDED" &&
                  rr.status !== "FAILED",
              );
            if (!activeWriter) {
              const newRr: StoredReportRun = {
                id: makeUuid(++seq),
                hiveId,
                ownerUserId: currentUserId,
                studyRevisionId: compatibleRevision.id,
                audience,
                trigger: "OWNER_GENERATE",
                requestId,
                status: "QUEUED",
                attemptCount: 0,
                maxAttempts: 3,
                leaseExpiresAtMs: null,
                errorCode: null,
                errorMessageSafe: null,
                retryable: null,
                correlationId,
                createdAt: `2026-11-03T10:2${reportRuns.length}:00.000Z`,
                finishedAt: null,
              };
              reportRuns.push(newRr);
              queuedReportRunIds.push(newRr.id);
            } else if (activeWriter.status === "QUEUED" && activeWriter.attemptCount === 0 && activeWriter.leaseExpiresAtMs === null) {
              queuedReportRunIds.push(activeWriter.id);
            }
          }

          return {
            data: {
              processingRun: runToJson(run),
              created: false,
              reusedStudy: true,
              reportsReady: customerReady && proReady,
              studyRevision: revisionToJson(compatibleRevision),
              reportRuns: latestReportRunsForRevision(compatibleRevision.id),
              queuedReadIds: [],
              queuedReportRunIds,
            },
            error: null,
          };
        }
      }

      // 6. Start a new full Study workflow run
      const newRun: StoredProcessingRun = {
        id: makeUuid(++seq),
        hiveId,
        ownerUserId: currentUserId,
        requestId,
        attemptNumber: processingRuns.length + 1,
        status: needsReadCount > 0 ? "READING_DOCUMENTS" : "QUEUED",
        sourceSnapshotDigest: needsReadCount > 0 ? null : sourceSnapshotDigest,
        intentSnapshotDigest,
        coverageDigest: needsReadCount > 0 ? null : coverageDigest,
        correlationId,
      };
      processingRuns.push(newRun);
      return {
        data: {
          processingRun: runToJson(newRun),
          created: true,
          reusedStudy: false,
          reportsReady: false,
          queuedReadIds: [],
          queuedReportRunIds: [],
        },
        error: null,
      };
    }

    if (fn === "generate_hive_report") {
      const studyRevisionId = String(args.p_study_revision_id).toLowerCase();
      const audience = String(args.p_audience).toUpperCase() as Audience;
      const requestId = String(args.p_request_id).toLowerCase();
      const correlationId = String(args.p_correlation_id).toLowerCase();

      const rev = studyRevisions.find((s) => s.id === studyRevisionId && s.hiveId === hiveId);
      if (!rev) return { data: null, error: { message: "study_revision_not_found" } };

      const replay = reportRuns.find((r) => r.ownerUserId === currentUserId && r.requestId === requestId && r.audience === audience);
      if (replay) {
        if (replay.studyRevisionId !== studyRevisionId) return { data: null, error: { message: "idempotency_conflict" } };
        return { data: { reportRun: reportRunToJson(replay), created: false }, error: null };
      }

      const active = reportRuns.find(
        (r) => r.studyRevisionId === studyRevisionId && r.audience === audience && r.status !== "SUCCEEDED" && r.status !== "FAILED",
      );
      if (active) {
        return { data: { reportRun: reportRunToJson(active), created: false }, error: null };
      }

      const newRr: StoredReportRun = {
        id: makeUuid(++seq),
        hiveId,
        ownerUserId: currentUserId,
        studyRevisionId,
        audience,
        trigger: "OWNER_GENERATE",
        requestId,
        status: "QUEUED",
        attemptCount: 0,
        maxAttempts: 3,
        leaseExpiresAtMs: null,
        errorCode: null,
        errorMessageSafe: null,
        retryable: null,
        correlationId,
        createdAt: `2026-11-03T10:3${reportRuns.length}:00.000Z`,
        finishedAt: null,
      };
      reportRuns.push(newRr);
      // Simulate saving the regenerated report without overwriting earlier reports
      reports.push({
        id: makeUuid(++seq),
        reportRunId: newRr.id,
        hiveId,
        ownerUserId: currentUserId,
        studyRevisionId,
        revisionNumber: rev.revisionNumber,
        audience,
        title: `${audience} report v${reports.filter((r) => r.audience === audience).length + 1}`,
        createdAt: `2026-11-03T10:3${reportRuns.length}:30.000Z`,
      });
      return { data: { reportRun: reportRunToJson(newRr), created: true }, error: null };
    }

    if (fn === "get_hive_reports") {
      const currentRev = studyRevisions.at(-1) ?? null;
      const latest = currentRev
        ? (["CUSTOMER", "PRO"] as const).flatMap((aud) => {
            const matching = reports.filter((r) => r.studyRevisionId === currentRev.id && r.audience === aud);
            const newest = matching.at(-1);
            return newest ? [reportToJson(newest)] : [];
          })
        : [];
      const history = [...reports].reverse().map((rep) => ({
        id: rep.id,
        reportRunId: rep.reportRunId,
        studyRevisionId: rep.studyRevisionId,
        revisionNumber: rep.revisionNumber,
        audience: rep.audience,
        title: rep.title,
        createdAt: rep.createdAt,
      }));
      return {
        data: {
          studyRevision: currentRev ? revisionToJson(currentRev) : null,
          reportRuns: currentRev ? latestReportRunsForRevision(currentRev.id) : [],
          latest,
          history,
        },
        error: null,
      };
    }

    throw new Error(`unexpected rpc ${fn}`);
  });

  return {
    client: { rpc },
    processingRuns,
    studyRevisions,
    reportRuns,
    reports,
    seedAcceptedStudy,
    setUser: (userId: string) => {
      currentUserId = userId;
    },
    setSnapshotDigest: (digest: string) => {
      sourceSnapshotDigest = digest;
    },
    setIntentDigest: (digest: string) => {
      intentSnapshotDigest = digest;
    },
    setNeedsReadCount: (count: number) => {
      needsReadCount = count;
    },
  };
}

function analyzePost(body: unknown, hiveId = HIVE_ID): NextRequest {
  return new NextRequest(`http://localhost/api/v1/hives/${hiveId}/study-preparation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
    body: JSON.stringify(body),
  });
}

function reportPost(body: unknown, hiveId = HIVE_ID): NextRequest {
  return new NextRequest(`http://localhost/api/v1/hives/${hiveId}/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
    body: JSON.stringify(body),
  });
}

describe("Resumable Analyze and Report Reuse (V4-004E)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    planner.loadPlannerServiceConfig.mockReturnValue({ baseUrl: "https://reader.test/planner", serviceToken: "s", timeoutMs: 1 });
    worker.requireWorkerDispatch.mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("1. reuses compatible accepted Study and returns 200 with zero Study/Writer dispatches when both Customer and Pro reports exist", async () => {
    const store = createStatefulStore();
    auth.requireApiSupabaseClient.mockResolvedValue(store.client);
    const { revision } = store.seedAcceptedStudy({ customerStatus: "SUCCEEDED", proStatus: "SUCCEEDED" });

    const res = await postAnalyze(analyzePost({ clientRequestId: makeUuid(1) }), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      created: false,
      reusedStudy: true,
      reportsReady: true,
      studyRevision: { id: revision.id, revisionNumber: 1 },
    });
    expect(body.reportRuns).toHaveLength(2);
    expect(store.processingRuns).toHaveLength(1);
    expect(store.reportRuns).toHaveLength(2);
    expect(workflow.processAnalysisRunSafely).not.toHaveBeenCalled();
    expect(reportWorkflow.processReportRunSafely).not.toHaveBeenCalled();
  });

  it("2. preserves existing Customer report and starts only the missing/failed Pro Writer run", async () => {
    const store = createStatefulStore();
    auth.requireApiSupabaseClient.mockResolvedValue(store.client);
    const { revision } = store.seedAcceptedStudy({ customerStatus: "SUCCEEDED", proStatus: "FAILED" });
    const originalCustomerReportId = store.reports[0]!.id;

    const res = await postAnalyze(analyzePost({ clientRequestId: makeUuid(2) }), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toMatchObject({
      created: false,
      reusedStudy: true,
      reportsReady: false,
      studyRevision: { id: revision.id },
    });
    expect(store.processingRuns).toHaveLength(1);
    expect(workflow.processAnalysisRunSafely).not.toHaveBeenCalled();
    expect(reportWorkflow.processReportRunSafely).toHaveBeenCalledTimes(1);

    const newProRun = store.reportRuns.at(-1)!;
    expect(newProRun).toMatchObject({
      audience: "PRO",
      trigger: "OWNER_GENERATE",
      status: "QUEUED",
      studyRevisionId: revision.id,
    });
    expect(reportWorkflow.processReportRunSafely).toHaveBeenCalledWith({ kind: "worker-deps" }, newProRun.id);
    expect(store.reports.find((r) => r.audience === "CUSTOMER")?.id).toBe(originalCustomerReportId);
  });

  it("3. preserves existing Pro report and starts only the missing Customer Writer run", async () => {
    const store = createStatefulStore();
    auth.requireApiSupabaseClient.mockResolvedValue(store.client);
    store.seedAcceptedStudy({ customerStatus: "MISSING", proStatus: "SUCCEEDED" });

    const res = await postAnalyze(analyzePost({ clientRequestId: makeUuid(3) }), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.reusedStudy).toBe(true);
    expect(body.reportsReady).toBe(false);
    expect(workflow.processAnalysisRunSafely).not.toHaveBeenCalled();
    expect(reportWorkflow.processReportRunSafely).toHaveBeenCalledTimes(1);
    expect(store.reportRuns.at(-1)?.audience).toBe("CUSTOMER");
  });

  it("4. starts both Writer runs without rerunning Study when compatible Study exists but both reports failed", async () => {
    const store = createStatefulStore();
    auth.requireApiSupabaseClient.mockResolvedValue(store.client);
    store.seedAcceptedStudy({ customerStatus: "FAILED", proStatus: "FAILED" });

    const res = await postAnalyze(analyzePost({ clientRequestId: makeUuid(4) }), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.reusedStudy).toBe(true);
    expect(body.reportsReady).toBe(false);
    expect(store.processingRuns).toHaveLength(1);
    expect(workflow.processAnalysisRunSafely).not.toHaveBeenCalled();
    expect(reportWorkflow.processReportRunSafely).toHaveBeenCalledTimes(2);
    expect(store.reportRuns.slice(-2).map((r) => r.audience)).toEqual(["CUSTOMER", "PRO"]);
  });

  it("5. reattaches to an active leased Writer run without creating duplicate Writer runs or re-dispatching leased work", async () => {
    const store = createStatefulStore();
    auth.requireApiSupabaseClient.mockResolvedValue(store.client);
    store.seedAcceptedStudy({
      customerStatus: "SUCCEEDED",
      proStatus: "WRITING",
      proLeased: true,
    });
    const reportRunCountBefore = store.reportRuns.length;

    const res = await postAnalyze(analyzePost({ clientRequestId: makeUuid(5) }), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.reusedStudy).toBe(true);
    expect(body.reportsReady).toBe(false);
    expect(store.reportRuns).toHaveLength(reportRunCountBefore);
    expect(workflow.processAnalysisRunSafely).not.toHaveBeenCalled();
    expect(reportWorkflow.processReportRunSafely).not.toHaveBeenCalled();
  });

  it("6. handles repeated clicks and concurrent Analyze requests idempotently without creating duplicate runs", async () => {
    const store = createStatefulStore();
    auth.requireApiSupabaseClient.mockResolvedValue(store.client);
    store.seedAcceptedStudy({ customerStatus: "SUCCEEDED", proStatus: "FAILED" });

    const reqId1 = makeUuid(6);
    const reqId2 = makeUuid(7);

    // Concurrent requests with the same and different clientRequestIds
    const [res1, resReplay, resConcurrent] = await Promise.all([
      postAnalyze(analyzePost({ clientRequestId: reqId1 }), { params: Promise.resolve({ hiveId: HIVE_ID }) }),
      postAnalyze(analyzePost({ clientRequestId: reqId1 }), { params: Promise.resolve({ hiveId: HIVE_ID }) }),
      postAnalyze(analyzePost({ clientRequestId: reqId2 }), { params: Promise.resolve({ hiveId: HIVE_ID }) }),
    ]);

    expect(res1.status).toBe(202);
    expect(resReplay.status).toBe(202);
    expect(resConcurrent.status).toBe(202);

    // Only one new PRO report_run was created across all three requests
    const ownerGeneratedProRuns = store.reportRuns.filter((r) => r.audience === "PRO" && r.trigger === "OWNER_GENERATE");
    expect(ownerGeneratedProRuns).toHaveLength(1);
    expect(store.processingRuns).toHaveLength(1);
  });

  it("7. reattaches to an active compatible Study run, but fails a stale active Study run and starts a fresh workflow when sources or intents changed", async () => {
    const store = createStatefulStore();
    auth.requireApiSupabaseClient.mockResolvedValue(store.client);

    // Start first Study run
    const resStart = await postAnalyze(analyzePost({ clientRequestId: makeUuid(8) }), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    const firstBody = await resStart.json();
    expect(resStart.status).toBe(202);
    expect(firstBody.created).toBe(true);
    expect(workflow.processAnalysisRunSafely).toHaveBeenCalledTimes(1);

    // Second click while snapshot & intent still match -> reattaches to active run
    const resReattach = await postAnalyze(analyzePost({ clientRequestId: makeUuid(9) }), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    const reattachBody = await resReattach.json();
    expect(reattachBody.created).toBe(false);
    expect(reattachBody.processingRun.id).toBe(firstBody.processingRun.id);
    expect(workflow.processAnalysisRunSafely).toHaveBeenCalledTimes(1);

    // Now intent changes while the run is still active -> stale active run is failed as SOURCE_CHANGED and a new run starts
    store.setIntentDigest(INTENT_DIGEST_2);
    const resAfterChange = await postAnalyze(analyzePost({ clientRequestId: makeUuid(10) }), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    const newBody = await resAfterChange.json();
    expect(newBody.created).toBe(true);
    expect(newBody.processingRun.id).not.toBe(firstBody.processingRun.id);
    expect(store.processingRuns[0]!.status).toBe("FAILED");
    expect(workflow.processAnalysisRunSafely).toHaveBeenCalledTimes(2);
  });

  it("8. does not reuse a stale Study revision when source snapshot, intent configuration, or binding format no longer matches", async () => {
    const store = createStatefulStore();
    auth.requireApiSupabaseClient.mockResolvedValue(store.client);

    // Seed revision 1 with SNAPSHOT_DIGEST_1
    store.seedAcceptedStudy({
      sourceDigest: SNAPSHOT_DIGEST_1,
      intentDigest: INTENT_DIGEST_1,
      customerStatus: "SUCCEEDED",
      proStatus: "SUCCEEDED",
    });

    // Source snapshot changes to SNAPSHOT_DIGEST_2
    store.setSnapshotDigest(SNAPSHOT_DIGEST_2);

    const res = await postAnalyze(analyzePost({ clientRequestId: makeUuid(11) }), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.created).toBe(true);
    expect(body.reusedStudy).toBe(false);
    expect(workflow.processAnalysisRunSafely).toHaveBeenCalledTimes(1);
  });

  it("9. selects the latest compatible Study revision even when an older revision had different digests", async () => {
    const store = createStatefulStore();
    auth.requireApiSupabaseClient.mockResolvedValue(store.client);

    // Revision 1 (older, different snapshot)
    store.seedAcceptedStudy({
      sourceDigest: SNAPSHOT_DIGEST_1,
      intentDigest: INTENT_DIGEST_1,
      customerStatus: "SUCCEEDED",
      proStatus: "SUCCEEDED",
    });
    // Revision 2 (current snapshot & intent, PRO report failed)
    store.setSnapshotDigest(SNAPSHOT_DIGEST_2);
    const { revision: rev2 } = store.seedAcceptedStudy({
      sourceDigest: SNAPSHOT_DIGEST_2,
      intentDigest: INTENT_DIGEST_1,
      customerStatus: "SUCCEEDED",
      proStatus: "FAILED",
    });

    const res = await postAnalyze(analyzePost({ clientRequestId: makeUuid(12) }), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.reusedStudy).toBe(true);
    expect(body.studyRevision.id).toBe(rev2.id);
    expect(body.studyRevision.revisionNumber).toBe(2);
    expect(reportWorkflow.processReportRunSafely).toHaveBeenCalledTimes(1);
    expect(store.reportRuns.at(-1)?.studyRevisionId).toBe(rev2.id);
    expect(store.reportRuns.at(-1)?.audience).toBe("PRO");
  });

  it("10. keeps explicit user-requested regeneration ('Generate again') separate and preserves previously accepted reports in history", async () => {
    const store = createStatefulStore();
    auth.requireApiSupabaseClient.mockResolvedValue(store.client);
    const { revision } = store.seedAcceptedStudy({ customerStatus: "SUCCEEDED", proStatus: "SUCCEEDED" });
    const firstCustomerReport = store.reports.find((r) => r.audience === "CUSTOMER")!;

    // Explicit regeneration via POST /api/v1/hives/[hiveId]/reports
    const regenRes = await postReports(
      reportPost({
        clientRequestId: makeUuid(13),
        studyRevisionId: revision.id,
        audience: "CUSTOMER",
      }),
      { params: Promise.resolve({ hiveId: HIVE_ID }) },
    );
    expect(regenRes.status).toBe(202);
    expect(reportWorkflow.processReportRunSafely).toHaveBeenCalledTimes(1);

    // Fetch reports: both the new report (latest) and the earlier accepted report (history) exist
    const listRes = await getReports(new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/reports`), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    const listBody = await listRes.json();
    const customerHistory = listBody.history.filter((r: { audience: string }) => r.audience === "CUSTOMER");
    expect(customerHistory).toHaveLength(2);
    expect(customerHistory.map((r: { id: string }) => r.id)).toContain(firstCustomerReport.id);
    expect(listBody.latest.find((r: { audience: string }) => r.audience === "CUSTOMER").title).toBe("CUSTOMER report v2");
  });

  it("11. enforces tenant ownership isolation across Analyze and report reuse", async () => {
    const store = createStatefulStore();
    auth.requireApiSupabaseClient.mockResolvedValue(store.client);
    store.seedAcceptedStudy({ customerStatus: "SUCCEEDED", proStatus: "SUCCEEDED" });

    // Switch authenticated user to OWNER_B
    store.setUser(OWNER_B);
    const resOtherUser = await postAnalyze(analyzePost({ clientRequestId: makeUuid(14) }), {
      params: Promise.resolve({ hiveId: HIVE_ID }),
    });
    expect(resOtherUser.status).toBe(404);

    // Cross-Hive idempotency conflict check
    store.setUser(OWNER_A);
    const resCrossHive = await postAnalyze(analyzePost({ clientRequestId: makeUuid(15) }, OTHER_HIVE_ID), {
      params: Promise.resolve({ hiveId: OTHER_HIVE_ID }),
    });
    expect(resCrossHive.status).toBe(404);
  });
});
