import { describe, expect, it } from "vitest";

import { CORRELATION_ID, HIVE_ID, REQUEST_ID, RUN_ID, runJson } from "./study-preparation.fixtures";
import { rebuildStudy, startStudyPreparation } from "./study-preparation";

const OTHER_HIVE = "12121212-1212-4212-8212-121212121212";
const REV6 = "d6d6d6d6-0000-4000-8000-000000000006";
const REV7 = "d7d7d7d7-0000-4000-8000-000000000007";
const CUSTOMER_REPORT = "c6c6c6c6-0000-4000-8000-000000000001";
const PRO_REPORT = "c6c6c6c6-0000-4000-8000-000000000002";

type Mode = "ANALYZE" | "REBUILD";
type Run = {
  id: string;
  hiveId: string;
  requestId: string;
  status: string;
  mode: Mode;
  attempt: number;
};
type Revision = {
  id: string;
  number: number;
  hiveId: string;
  processingRunId: string;
  reports: { id: string; audience: "CUSTOMER" | "PRO" }[];
};

/**
 * In-memory stand-in for `start_study_preparation` reuse and `rebuild_study`.
 * Rebuild never inserts document reads or Writer runs. Prior revisions stay.
 */
function database() {
  let reads = 2;
  const runs: Run[] = [];
  const revisions: Revision[] = [
    {
      id: REV6,
      number: 6,
      hiveId: HIVE_ID,
      processingRunId: "a6a6a6a6-0000-4000-8000-000000000006",
      reports: [
        { id: CUSTOMER_REPORT, audience: "CUSTOMER" },
        { id: PRO_REPORT, audience: "PRO" },
      ],
    },
  ];
  let session: "owner" | "other" | null = "owner";
  let documentsRead = true;
  let intent = true;
  let acceptedStudy = true;
  let seq = 1;

  function summary(revision: Revision) {
    return {
      id: revision.id,
      canonicalStudyId: HIVE_ID,
      revisionNumber: revision.number,
      predecessorRevisionId: revision.number === 6 ? null : REV6,
      processingRunId: revision.processingRunId,
      coverageComplete: true,
      coverageStatus: "COMPLETE",
      coverageGaps: [],
      coverageAcknowledgement: "NOT_REQUIRED",
      sourceCount: revision.number === 6 ? 0 : 2,
      documentFindingCount: revision.number === 6 ? 0 : 4,
      createdAt: "2026-11-04T12:00:00.000Z",
    };
  }

  function runPayload(run: Run, created: boolean) {
    const revision = revisions.find((item) => item.processingRunId === run.id) ?? null;
    return {
      processingRun: runJson(run.status, {
        id: run.id,
        hiveId: run.hiveId,
        requestId: run.requestId,
        attemptNumber: run.attempt,
        preparationMode: run.mode,
        finishedAt: run.status === "SUCCEEDED" ? "2026-11-04T12:05:00.000Z" : null,
      }),
      created,
      reusedStudy: false,
      reportsReady: false,
      ...(revision ? { studyRevision: summary(revision) } : {}),
      reportRuns: [],
      queuedReadIds: [],
      queuedReportRunIds: [],
    };
  }

  function active(hiveId: string): Run | undefined {
    return runs.find((run) => run.hiveId === hiveId && !["SUCCEEDED", "FAILED", "NEEDS_CLARIFICATION"].includes(run.status));
  }

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const hiveId = String(args.p_hive_id);
    const requestId = String(args.p_request_id);
    if (session === null) return { data: null, error: { message: "auth_required" } };
    if (session === "other" || hiveId === OTHER_HIVE && session !== "owner") {
      return { data: null, error: { message: "hive_not_found" } };
    }
    if (hiveId !== HIVE_ID) return { data: null, error: { message: "hive_not_found" } };

    if (fn === "start_study_preparation") {
      const same = runs.find((run) => run.requestId === requestId);
      if (same) return { data: runPayload(same, false), error: null };
      if (documentsRead && acceptedStudy && !active(hiveId)) {
        const latest = [...revisions].sort((a, b) => b.number - a.number)[0]!;
        return {
          data: {
            processingRun: runJson("SUCCEEDED", { preparationMode: "ANALYZE", finishedAt: "2026-11-04T12:05:00.000Z" }),
            created: false,
            reusedStudy: true,
            reportsReady: latest.reports.length === 2,
            studyRevision: summary(latest),
            reportRuns: [],
            queuedReadIds: [],
            queuedReportRunIds: [],
          },
          error: null,
        };
      }
      const run: Run = { id: RUN_ID, hiveId, requestId, status: documentsRead ? "QUEUED" : "READING_DOCUMENTS", mode: "ANALYZE", attempt: ++seq };
      if (!documentsRead) reads += 1;
      runs.push(run);
      return { data: runPayload(run, true), error: null };
    }

    if (fn === "rebuild_study") {
      const same = runs.find((run) => run.requestId === requestId);
      if (same) {
        if (same.mode !== "REBUILD") return { data: null, error: { message: "idempotency_conflict" } };
        return { data: runPayload(same, false), error: null };
      }
      const current = active(hiveId);
      if (current) {
        if (current.mode !== "REBUILD") return { data: null, error: { message: "analysis_active" } };
        return { data: runPayload(current, false), error: null };
      }
      if (!acceptedStudy) return { data: null, error: { message: "study_not_accepted" } };
      if (!intent) return { data: null, error: { message: "intent_missing" } };
      if (!documentsRead) return { data: null, error: { message: "documents_not_read" } };
      const run: Run = {
        id: `bbbbbbbb-0000-4000-8000-${String(seq).padStart(12, "0")}`,
        hiveId,
        requestId,
        status: "QUEUED",
        mode: "REBUILD",
        attempt: ++seq,
      };
      runs.push(run);
      return { data: runPayload(run, true), error: null };
    }

    throw new Error(`unexpected rpc ${fn}`);
  };

  return {
    client: { rpc },
    get reads() {
      return reads;
    },
    revisions,
    runs,
    set documentsRead(value: boolean) {
      documentsRead = value;
    },
    set session(value: "owner" | "other" | null) {
      session = value;
    },
    set acceptedStudy(value: boolean) {
      acceptedStudy = value;
    },
    acceptRebuild(runId: string, withFindings: boolean) {
      const run = runs.find((item) => item.id === runId);
      if (!run || run.mode !== "REBUILD") throw new Error("not a rebuild");
      if (!withFindings) {
        run.status = "FAILED";
        return;
      }
      run.status = "SUCCEEDED";
      revisions.push({
        id: REV7,
        number: 7,
        hiveId: run.hiveId,
        processingRunId: run.id,
        reports: [],
      });
    },
  };
}

function input(clientRequestId: string) {
  return { hiveId: HIVE_ID, rawBody: { clientRequestId }, correlationId: CORRELATION_ID };
}

describe("Rebuild Study", () => {
  it("keeps Analyze reuse and starts a rebuild from the same read pages without Writer or a new read", async () => {
    const db = database();
    const analyzed = await startStudyPreparation(db.client, input(REQUEST_ID));
    expect(analyzed.response.reusedStudy).toBe(true);
    expect(analyzed.response.reportsReady).toBe(true);
    expect(analyzed.response.studyRevision?.revisionNumber).toBe(6);
    expect(analyzed.process).toBe(false);
    expect(analyzed.queuedReportRunIds).toEqual([]);
    expect(db.runs).toHaveLength(0);
    expect(db.reads).toBe(2);

    const rebuilt = await rebuildStudy(db.client, input("abababab-0000-4000-8000-000000000001"));
    expect(rebuilt.process).toBe(true);
    expect(rebuilt.response.created).toBe(true);
    expect(rebuilt.response.reusedStudy).toBe(false);
    expect(rebuilt.response.reportsReady).toBe(false);
    expect(rebuilt.response.reportRuns).toEqual([]);
    expect(rebuilt.response.processingRun.preparationMode).toBe("REBUILD");
    expect(rebuilt.response.processingRun.status).toBe("QUEUED");
    expect(db.reads).toBe(2);
    expect(db.revisions.map((revision) => revision.number)).toEqual([6]);
    expect(db.revisions[0]!.reports).toHaveLength(2);
  });

  it("replays one rebuild request and does not start a second rebuild while the first is active", async () => {
    const db = database();
    const requestId = "abababab-0000-4000-8000-000000000002";
    const first = await rebuildStudy(db.client, input(requestId));
    const replay = await rebuildStudy(db.client, input(requestId));
    const other = await rebuildStudy(db.client, input("abababab-0000-4000-8000-000000000003"));
    expect(replay.process).toBe(false);
    expect(other.process).toBe(false);
    expect(replay.response.processingRun.id).toBe(first.response.processingRun.id);
    expect(other.response.processingRun.id).toBe(first.response.processingRun.id);
    expect(db.runs.filter((run) => run.mode === "REBUILD")).toHaveLength(1);
    expect(db.reads).toBe(2);
  });

  it("refuses another owner, a signed-out caller, unread documents, and a hive with no accepted study", async () => {
    const db = database();
    db.session = "other";
    await expect(rebuildStudy(db.client, input("abababab-0000-4000-8000-000000000004"))).rejects.toMatchObject({
      errorCode: "NOT_FOUND",
    });
    db.session = null;
    await expect(rebuildStudy(db.client, input("abababab-0000-4000-8000-000000000005"))).rejects.toMatchObject({
      errorCode: "UNAUTHENTICATED",
    });
    db.session = "owner";
    db.documentsRead = false;
    await expect(rebuildStudy(db.client, input("abababab-0000-4000-8000-000000000006"))).rejects.toMatchObject({
      errorCode: "COVERAGE_INCOMPLETE",
      diagnosticReason: "documents_not_read",
    });
    expect(db.reads).toBe(2);
    expect(db.runs).toHaveLength(0);
    db.documentsRead = true;
    db.acceptedStudy = false;
    await expect(rebuildStudy(db.client, input("abababab-0000-4000-8000-000000000007"))).rejects.toMatchObject({
      diagnosticReason: "study_not_accepted",
    });
    expect(db.revisions).toHaveLength(1);
  });

  it("accepts a new revision and keeps revision 6 and its reports when findings exist, and keeps them when acceptance fails", async () => {
    const db = database();
    const failed = await rebuildStudy(db.client, input("abababab-0000-4000-8000-000000000008"));
    db.acceptRebuild(failed.response.processingRun.id, false);
    expect(db.revisions.map((revision) => revision.number)).toEqual([6]);
    expect(db.revisions[0]!.reports.map((report) => report.id)).toEqual([CUSTOMER_REPORT, PRO_REPORT]);

    const rebuilt = await rebuildStudy(db.client, input("abababab-0000-4000-8000-000000000009"));
    db.acceptRebuild(rebuilt.response.processingRun.id, true);
    expect(db.revisions.map((revision) => revision.number)).toEqual([6, 7]);
    expect(db.revisions[1]!.reports).toEqual([]);
    expect(db.revisions[0]!.reports).toHaveLength(2);
    expect(db.reads).toBe(2);

    const analyzed = await startStudyPreparation(db.client, input("abababab-0000-4000-8000-00000000000a"));
    expect(analyzed.response.reusedStudy).toBe(true);
    expect(analyzed.response.studyRevision?.revisionNumber).toBe(7);
    expect(analyzed.response.studyRevision && "documentFindingCount" in analyzed.response.studyRevision).toBe(true);
    expect(db.revisions[0]!.number).toBe(6);
  });

  it("does not treat an Analyze request id as a rebuild", async () => {
    const db = database();
    db.documentsRead = false;
    await startStudyPreparation(db.client, input(REQUEST_ID));
    db.documentsRead = true;
    await expect(rebuildStudy(db.client, input(REQUEST_ID))).rejects.toMatchObject({
      errorCode: "IDEMPOTENCY_CONFLICT",
    });
  });
});
