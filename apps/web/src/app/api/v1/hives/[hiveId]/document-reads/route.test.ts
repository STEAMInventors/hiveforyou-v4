import { createHiveError } from "@hiveforyou/contracts";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextServer = vi.hoisted(() => ({ after: vi.fn() }));
const auth = vi.hoisted(() => ({ requireApiSupabaseClient: vi.fn() }));
const reads = vi.hoisted(() => ({
  listDocumentReads: vi.fn(),
  startDocumentReads: vi.fn(),
  processDocumentReads: vi.fn(async () => undefined),
}));
const reader = vi.hoisted(() => ({ loadReaderServiceConfig: vi.fn() }));
const admin = vi.hoisted(() => ({
  loadSupabaseAdminEnv: vi.fn(() => ({ SUPABASE_URL: "https://db.test", SUPABASE_SECRET_KEY: "synthetic" })),
  createSupabaseAdminClient: vi.fn(() => ({ kind: "service" })),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: nextServer.after,
}));
vi.mock("@/server/supabase/server-client", () => auth);
vi.mock("@/server/source-documents/document-reads", () => reads);
vi.mock("@/server/source-documents/read-document", () => reader);
vi.mock("@hives/persistence/env", () => ({ loadSupabaseAdminEnv: admin.loadSupabaseAdminEnv }));
vi.mock("@hives/persistence/storage/supabase-client", () => ({
  createSupabaseAdminClient: admin.createSupabaseAdminClient,
}));

import { GET, POST } from "./route";

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const READ_ID = "55555555-5555-4555-8555-555555555555";
const URL = `http://localhost/api/v1/hives/${HIVE_ID}/document-reads`;
const params = { params: Promise.resolve({ hiveId: HIVE_ID }) };
const userClient = { kind: "user" };

function post(body: unknown): NextRequest {
  return new NextRequest(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
    body: JSON.stringify(body),
  });
}

function get(): NextRequest {
  return new NextRequest(URL, { headers: { "x-correlation-id": CORRELATION_ID } });
}

function hiveError(errorCode: "UNAUTHENTICATED" | "NOT_FOUND" | "INVALID_REQUEST" | "PAGE_READ_FAILED") {
  return createHiveError({
    errorCode,
    category: errorCode === "PAGE_READ_FAILED" ? "DEPENDENCY" : "SECURITY",
    stage: "READ",
    retryable: errorCode === "PAGE_READ_FAILED",
    safeMessage: "Synthetic failure.",
    correlationId: CORRELATION_ID,
  });
}

describe("/api/v1/hives/[hiveId]/document-reads", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    auth.requireApiSupabaseClient.mockResolvedValue(userClient);
    reader.loadReaderServiceConfig.mockReturnValue({ baseUrl: "https://reader.test", serviceToken: "synthetic" });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("GET returns 401 when signed out", async () => {
    auth.requireApiSupabaseClient.mockRejectedValue(hiveError("UNAUTHENTICATED"));
    const res = await GET(get(), params);
    expect(res.status).toBe(401);
    expect(reads.listDocumentReads).not.toHaveBeenCalled();
  });

  it("GET returns the owner's reads", async () => {
    reads.listDocumentReads.mockResolvedValue({ documentReads: [{ id: READ_ID }] });
    const res = await GET(get(), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
    expect(await res.json()).toEqual({ documentReads: [{ id: READ_ID }] });
    expect(reads.listDocumentReads).toHaveBeenCalledWith(userClient, { hiveId: HIVE_ID, correlationId: CORRELATION_ID });
  });

  it("GET returns 404 for another owner's Hive", async () => {
    reads.listDocumentReads.mockRejectedValue(hiveError("NOT_FOUND"));
    const res = await GET(get(), params);
    expect(res.status).toBe(404);
  });

  it("POST returns 401 and queues nothing when signed out", async () => {
    auth.requireApiSupabaseClient.mockRejectedValue(hiveError("UNAUTHENTICATED"));
    const res = await POST(post({ clientRequestId: REQUEST_ID }), params);
    expect(res.status).toBe(401);
    expect(reads.startDocumentReads).not.toHaveBeenCalled();
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it("POST returns 422 for an invalid body", async () => {
    reads.startDocumentReads.mockRejectedValue(hiveError("INVALID_REQUEST"));
    const res = await POST(post({ clientRequestId: "x" }), params);
    expect(res.status).toBe(422);
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it("POST fails before queueing when the Reader is not configured", async () => {
    reader.loadReaderServiceConfig.mockImplementation(() => {
      throw hiveError("PAGE_READ_FAILED");
    });
    const res = await POST(post({ clientRequestId: REQUEST_ID }), params);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatchObject({ errorCode: "PAGE_READ_FAILED", retryable: true });
    expect(reads.startDocumentReads).not.toHaveBeenCalled();
  });

  it("POST returns 202 and processes newly queued reads after the response", async () => {
    reads.startDocumentReads.mockResolvedValue({
      response: { documentReads: [{ id: READ_ID, status: "QUEUED" }], created: 1 },
      queuedReadIds: [READ_ID],
    });
    const res = await POST(post({ clientRequestId: REQUEST_ID }), params);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ documentReads: [{ id: READ_ID, status: "QUEUED" }], created: 1 });
    expect(reads.startDocumentReads).toHaveBeenCalledWith(userClient, {
      hiveId: HIVE_ID,
      rawBody: { clientRequestId: REQUEST_ID },
      correlationId: CORRELATION_ID,
    });
    expect(reads.processDocumentReads).not.toHaveBeenCalled();
    expect(nextServer.after).toHaveBeenCalledTimes(1);

    await nextServer.after.mock.calls[0]![0]();
    expect(reads.processDocumentReads).toHaveBeenCalledWith(
      expect.objectContaining({ client: { kind: "service" } }),
      [READ_ID],
    );
  });

  it("POST schedules no work when nothing new was queued", async () => {
    reads.startDocumentReads.mockResolvedValue({
      response: { documentReads: [{ id: READ_ID, status: "READING" }], created: 0 },
      queuedReadIds: [],
    });
    const res = await POST(post({ clientRequestId: REQUEST_ID }), params);
    expect(res.status).toBe(202);
    expect(nextServer.after).not.toHaveBeenCalled();
  });
});
