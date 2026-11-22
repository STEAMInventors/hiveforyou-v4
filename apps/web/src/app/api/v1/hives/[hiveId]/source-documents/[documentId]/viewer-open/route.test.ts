import { createHiveError } from "@hiveforyou/contracts";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VaultAdminConfigError } from "@/server/source-documents/v3-vault/persistence/vault-admin-config-error";

const auth = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
}));
const adapter = vi.hoisted(() => ({
  createLiveHiveVaultUploadAdapterDeps: vi.fn(() => ({})),
  openSourceDocumentPageWithV3Vault: vi.fn(),
}));

vi.mock("@/server/supabase/server-client", () => auth);
vi.mock("@/server/source-documents/hive-vault-upload-adapter", () => adapter);

import { POST as postViewerOpen } from "./route";

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const routeParams = { params: Promise.resolve({ hiveId: HIVE_ID, documentId: DOC_ID }) };

function postOpen(pageNumber: number) {
  return postViewerOpen(
    new NextRequest(`http://localhost/api/v1/hives/${HIVE_ID}/source-documents/${DOC_ID}/viewer-open`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
      body: JSON.stringify({ pageNumber }),
    }),
    routeParams,
  );
}

describe("POST viewer-open", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    auth.requireAuthenticatedUser.mockResolvedValue({ ok: true, userId: USER_ID, client: {} });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("returns 401 when signed out", async () => {
    auth.requireAuthenticatedUser.mockResolvedValue({ ok: false, diagnosticReason: "no_session" });
    const res = await postOpen(1);
    expect(res.status).toBe(401);
    expect(adapter.openSourceDocumentPageWithV3Vault).not.toHaveBeenCalled();
  });

  it("returns 422 for an invalid page number", async () => {
    const res = await postOpen(0);
    expect(res.status).toBe(422);
    expect(adapter.openSourceDocumentPageWithV3Vault).not.toHaveBeenCalled();
  });

  it("returns a signed URL for the owner", async () => {
    adapter.openSourceDocumentPageWithV3Vault.mockResolvedValue({
      signedUrl: "https://storage.example/signed#page=2",
      mimeType: "application/pdf",
    });
    const res = await postOpen(2);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
    expect(body).toEqual({ signedUrl: "https://storage.example/signed", mimeType: "application/pdf" });
    expect(adapter.openSourceDocumentPageWithV3Vault).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        ownerUserId: USER_ID,
        hiveId: HIVE_ID,
        sourceDocumentId: DOC_ID,
        pageNumber: "2",
        correlationId: CORRELATION_ID,
      }),
    );
  });

  it("maps vault admin misconfiguration to a safe internal error", async () => {
    adapter.openSourceDocumentPageWithV3Vault.mockRejectedValue(new VaultAdminConfigError("vault_admin_secret_missing"));
    const res = await postOpen(1);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toMatchObject({
      errorCode: "INTERNAL_ERROR",
      correlationId: CORRELATION_ID,
    });
    expect(body.error.message).toMatch(/not configured/i);
  });

  it("maps missing source documents to NOT_FOUND", async () => {
    adapter.openSourceDocumentPageWithV3Vault.mockRejectedValue(
      createHiveError({
        errorCode: "NOT_FOUND",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "We could not find that document.",
        correlationId: CORRELATION_ID,
        diagnosticReason: "not_found",
      }),
    );
    const res = await postOpen(1);
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toMatchObject({ errorCode: "NOT_FOUND" });
  });
});