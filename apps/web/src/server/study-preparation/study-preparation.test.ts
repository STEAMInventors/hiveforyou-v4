import { describe, expect, it, vi } from "vitest";

import { CORRELATION_ID, HIVE_ID, REQUEST_ID, RUN_ID, runJson } from "./study-preparation.fixtures";
import { acknowledgeStudyCoverage, startStudyPreparation } from "./study-preparation";

const DIGEST = `sha256:${"e".repeat(64)}`;

function client(result: { data?: unknown; error?: { message: string } | null }) {
  return { rpc: vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null })) };
}

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
