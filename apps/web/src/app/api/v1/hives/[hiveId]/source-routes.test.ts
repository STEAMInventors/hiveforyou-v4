import { createHiveError } from "@hiveforyou/contracts";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  requireApiSupabaseClient: vi.fn(),
}));
const adapter = vi.hoisted(() => ({
  createIntentRequestForOwnedHive: vi.fn(),
  createLiveHiveVaultUploadAdapterDeps: vi.fn(() => ({})),
  listHiveSourceDocumentsWithV3Vault: vi.fn(),
  prepareHiveSourceDocumentFromApiBody: vi.fn(),
  completeHiveSourceDocumentFromApiBody: vi.fn(),
  getUploadQuotaWithV3Vault: vi.fn(),
}));

vi.mock("@/server/supabase/server-client", () => auth);
vi.mock("@/server/source-documents/hive-vault-upload-adapter", () => adapter);

import { POST as postIntent } from "./intent-requests/route";
import { GET as listDocuments, POST as postPrepare } from "./source-documents/route";
import { POST as postComplete } from "./source-documents/complete/route";
import { GET as getQuota } from "../../upload-quota/route";

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const SHA256 = "a".repeat(64);
const params = { params: Promise.resolve({ hiveId: HIVE_ID }) };

function unauthenticated() {
  return createHiveError({
    errorCode: "UNAUTHENTICATED",
    category: "SECURITY",
    stage: "SHELL",
    retryable: false,
    safeMessage: "Sign in to continue.",
    correlationId: CORRELATION_ID,
    diagnosticReason: "no_session",
  });
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
    body: JSON.stringify(body),
  });
}

describe("V4-003 source routes", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    auth.requireAuthenticatedUser.mockResolvedValue({ ok: true, userId: USER_ID, client: {} });
    auth.requireApiSupabaseClient.mockResolvedValue({});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe("POST /api/v1/hives/[hiveId]/intent-requests", () => {
    it("returns 401 JSON with the correlation ID when signed out", async () => {
      auth.requireApiSupabaseClient.mockRejectedValue(unauthenticated());
      const res = await postIntent(
        jsonRequest(`http://localhost/api/v1/hives/${HIVE_ID}/intent-requests`, {}),
        params,
      );
      const body = await res.json();
      expect(res.status).toBe(401);
      expect(res.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
      expect(body.error).toMatchObject({ errorCode: "UNAUTHENTICATED", correlationId: CORRELATION_ID });
      expect(adapter.createIntentRequestForOwnedHive).not.toHaveBeenCalled();
    });

    it("returns 201 for a new intent and 200 for an idempotent replay", async () => {
      const intentRequest = { id: REQUEST_ID, hiveId: HIVE_ID };
      adapter.createIntentRequestForOwnedHive
        .mockResolvedValueOnce({ intentRequest, created: true })
        .mockResolvedValueOnce({ intentRequest, created: false });
      const payload = { intentText: "Prepare for an IEP meeting", clientRequestId: REQUEST_ID };
      const url = `http://localhost/api/v1/hives/${HIVE_ID}/intent-requests`;

      const first = await postIntent(jsonRequest(url, payload), params);
      const second = await postIntent(jsonRequest(url, payload), params);

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(adapter.createIntentRequestForOwnedHive).toHaveBeenCalledWith(
        {},
        HIVE_ID,
        payload,
        CORRELATION_ID,
      );
    });
  });

  describe("/api/v1/hives/[hiveId]/source-documents", () => {
    it("denies signed-out list and prepare requests", async () => {
      auth.requireAuthenticatedUser.mockResolvedValue({ ok: false, diagnosticReason: "no_session" });
      const list = await listDocuments(
        new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/source-documents`),
        params,
      );
      const prepare = await postPrepare(
        jsonRequest(`http://localhost/api/v1/hives/${HIVE_ID}/source-documents`, {
          fileName: "a.pdf",
          mimeType: "application/pdf",
          byteSize: 10,
          sha256: SHA256,
          clientRequestId: REQUEST_ID,
        }),
        params,
      );

      expect(list.status).toBe(401);
      expect(prepare.status).toBe(401);
      expect(adapter.prepareHiveSourceDocumentFromApiBody).not.toHaveBeenCalled();
    });

    it("passes prepare metadata and clientRequestId to the adapter", async () => {
      adapter.prepareHiveSourceDocumentFromApiBody.mockResolvedValue({
        sourceDocument: { id: "doc", status: "PENDING" },
        upload: { path: "p", token: "t" },
        created: true,
      });
      const payload = {
        fileName: "a.pdf",
        mimeType: "application/pdf",
        byteSize: 10,
        sha256: SHA256,
        clientRequestId: REQUEST_ID,
      };

      const res = await postPrepare(
        jsonRequest(`http://localhost/api/v1/hives/${HIVE_ID}/source-documents`, payload),
        params,
      );

      expect(res.status).toBe(201);
      expect(adapter.prepareHiveSourceDocumentFromApiBody).toHaveBeenCalledWith(
        {},
        HIVE_ID,
        USER_ID,
        payload,
        CORRELATION_ID,
      );
    });

    it("replays prepare idempotently with 200", async () => {
      adapter.prepareHiveSourceDocumentFromApiBody.mockResolvedValue({
        sourceDocument: { id: "doc", status: "REGISTERED" },
        upload: null,
        created: false,
      });
      const res = await postPrepare(
        jsonRequest(`http://localhost/api/v1/hives/${HIVE_ID}/source-documents`, {
          fileName: "a.pdf",
          mimeType: "application/pdf",
          byteSize: 10,
          sha256: SHA256,
          clientRequestId: REQUEST_ID,
        }),
        params,
      );
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/v1/hives/[hiveId]/source-documents/complete", () => {
    it("completes registration without accepting multipart uploads", async () => {
      adapter.completeHiveSourceDocumentFromApiBody.mockResolvedValue({
        sourceDocument: { id: "doc", status: "REGISTERED" },
        created: true,
      });
      const res = await postComplete(
        jsonRequest(`http://localhost/api/v1/hives/${HIVE_ID}/source-documents/complete`, {
          clientRequestId: REQUEST_ID,
        }),
        params,
      );
      expect(res.status).toBe(201);
      expect(adapter.completeHiveSourceDocumentFromApiBody).toHaveBeenCalledWith(
        {},
        HIVE_ID,
        USER_ID,
        { clientRequestId: REQUEST_ID },
        CORRELATION_ID,
      );
    });

    it("returns 200 when complete is replayed for an already registered document", async () => {
      adapter.completeHiveSourceDocumentFromApiBody.mockResolvedValue({
        sourceDocument: { id: "doc", status: "REGISTERED" },
        created: false,
      });
      const res = await postComplete(
        jsonRequest(`http://localhost/api/v1/hives/${HIVE_ID}/source-documents/complete`, {
          clientRequestId: REQUEST_ID,
        }),
        params,
      );
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/v1/upload-quota", () => {
    it("returns the owner's quota", async () => {
      const quota = { limit: 2000, used: 1, remaining: 1999, periodStart: "a", periodEnd: "b" };
      adapter.getUploadQuotaWithV3Vault.mockResolvedValue({ quota });
      const res = await getQuota(new NextRequest("http://localhost/api/v1/upload-quota"));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ quota });
    });
  });
});
