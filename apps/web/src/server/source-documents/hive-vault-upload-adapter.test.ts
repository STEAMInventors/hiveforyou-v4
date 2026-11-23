import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CorrelationId } from "@hives/contracts";
import { DEFAULT_HIVE_SOURCE_BUCKET } from "@hives/persistence/storage/buckets";
import { InMemoryEvidenceObjectStore } from "@hives/persistence/storage/memory";
import { InMemoryVaultRepositories } from "@hives/persistence/vault/memory";
import { buildSourceObjectPath } from "@hives/persistence/vault/path";
import { structuredPdf, pngBytes } from "@hives/security";
import { createHiveError, FREE_UPLOADS_PER_UTC_MONTH, type Hive } from "@hiveforyou/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  completeHiveSourceDocumentUpload,
  createIntentRequestForOwnedHive,
  createLiveHiveVaultUploadAdapterDeps,
  getUploadQuotaWithV3Vault,
  InMemoryClientRequestRegistry,
  listHiveSourceDocumentsWithV3Vault,
  openSourceDocumentPageWithV3Vault,
  prepareHiveSourceDocumentUpload,
  ScanError,
  uploadHiveSourceDocumentWithV3Vault,
  type HashScanner,
  type HiveVaultUploadAdapterDeps,
} from "./hive-vault-upload-adapter";
import { VaultAdminConfigError } from "./v3-vault/persistence/vault-admin-config-error";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HIVE_A = "11111111-1111-4111-8111-111111111111";
const CORR_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

const PDF_BYTES = structuredPdf(2);
const PNG_BYTES = pngBytes();
const DOCX_BYTES = new Uint8Array([
  0x50,
  0x4b,
  0x03,
  0x04,
  ...new TextEncoder().encode("word/document.xml"),
]);

function createTestHarness(scanHash: HashScanner = async () => "UNKNOWN_TO_SCANNER") {
  const vault = new InMemoryVaultRepositories(CORR_ID as CorrelationId);
  const store = new InMemoryEvidenceObjectStore(CORR_ID as CorrelationId);
  const clientRequests = new InMemoryClientRequestRegistry();
  const ownedHives = new Map<string, Hive>([
    [
      `${USER_A}:${HIVE_A}`,
      {
        id: HIVE_A,
        hiveId: HIVE_A,
        name: "March Records",
        description: null,
        clientRequestId: "44444444-4444-4444-8444-444444444444",
        createdAt: "2026-10-30T15:00:00.000Z",
        updatedAt: "2026-10-30T15:00:00.000Z",
      },
    ],
  ]);

  const deps: HiveVaultUploadAdapterDeps = {
    vault,
    store,
    sourceBucket: DEFAULT_HIVE_SOURCE_BUCKET,
    scanHash,
    clientRequests,
    loadOwnedHive: async (userId, hiveId, correlationId) => {
      const found = ownedHives.get(`${userId}:${hiveId}`);
      if (!found) {
        throw createHiveError({
          errorCode: "NOT_FOUND",
          category: "SECURITY",
          stage: "SHELL",
          retryable: false,
          safeMessage: "We could not find that Hive.",
          correlationId,
          diagnosticReason: "not_found",
        });
      }
      return found;
    },
  };

  return { vault, store, clientRequests, deps };
}

describe("V4-003 V3 Vault Uploader Adapter", () => {
  it("creates 1:1 Case (caseId === hiveId), registers PDF and DOCX via V3 registerSourceDocument, and replays idempotently", async () => {
    const { vault, store, deps } = createTestHarness();
    const pdfReqId = crypto.randomUUID();
    const docxReqId = crypto.randomUUID();

    const first = await uploadHiveSourceDocumentWithV3Vault(deps, {
      ownerUserId: USER_A,
      hiveId: HIVE_A,
      clientRequestId: pdfReqId,
      fileName: "Medical bill March.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      correlationId: CORR_ID,
    });

    expect(first.created).toBe(true);
    expect(first.sourceDocument.status).toBe("REGISTERED");
    expect(first.sourceDocument.hiveId).toBe(HIVE_A);
    expect(first.uploadOperation?.status).toBe("REGISTERED");
    expect(first.uploadOperation?.caseId).toBe(HIVE_A);

    const caseRow = await vault.cases.getById(HIVE_A as never);
    expect(caseRow?.id).toBe(HIVE_A);
    expect(caseRow?.ownerUserId).toBe(USER_A);

    const storedDoc = await vault.sourceDocuments.getById(first.sourceDocument.id as never);
    expect(storedDoc?.pageCount).toBe(2);
    expect(storedDoc?.storagePath).toBe(
      buildSourceObjectPath(USER_A as never, HIVE_A as never, first.sourceDocument.id as never),
    );
    expect(
      await store.exists({
        bucket: DEFAULT_HIVE_SOURCE_BUCKET,
        path: storedDoc!.storagePath,
      }),
    ).toBe(true);

    // DOCX support in @hives/security + V3 registerSourceDocument
    const docx = await uploadHiveSourceDocumentWithV3Vault(deps, {
      ownerUserId: USER_A,
      hiveId: HIVE_A,
      clientRequestId: docxReqId,
      fileName: "IEP_notes.docx",
      bytes: DOCX_BYTES,
      correlationId: CORR_ID,
    });
    expect(docx.sourceDocument.status).toBe("REGISTERED");
    expect(docx.sourceDocument.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    // Idempotent replay of the same clientRequestId reconciles without duplicating
    const replay = await uploadHiveSourceDocumentWithV3Vault(deps, {
      ownerUserId: USER_A,
      hiveId: HIVE_A,
      clientRequestId: pdfReqId,
      fileName: "Medical bill March.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      correlationId: CORR_ID,
    });
    expect(replay.created).toBe(false);
    expect(replay.sourceDocument.id).toBe(first.sourceDocument.id);

    const listed = await listHiveSourceDocumentsWithV3Vault(deps, {
      ownerUserId: USER_A,
      hiveId: HIVE_A,
      correlationId: CORR_ID,
    });
    expect(listed.sourceDocuments).toHaveLength(2);

    const quota = await getUploadQuotaWithV3Vault(deps, USER_A, CORR_ID);
    expect(quota.quota.used).toBe(2);
    expect(quota.quota.remaining).toBe(FREE_UPLOADS_PER_UTC_MONTH - 2);
  });

  it("persists canonicalGapId when completing a missing-document slot upload", async () => {
    const { vault, store, deps } = createTestHarness();
    const clientRequestId = crypto.randomUUID();
    const sha256 = createHash("sha256").update(PDF_BYTES).digest("hex");
    await prepareHiveSourceDocumentUpload(deps, {
      ownerUserId: USER_A,
      hiveId: HIVE_A,
      clientRequestId,
      fileName: "Pay stub March.pdf",
      mimeType: "application/pdf",
      byteSize: PDF_BYTES.byteLength,
      sha256,
      correlationId: CORR_ID,
      canonicalGapId: "X3",
      canonicalGapStudyRevisionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      canonicalGapTitle: "Pay stubs (March–April 2026)",
    });
    const operation = await vault.uploadOperations.getByClientRequestId(
      USER_A as never,
      HIVE_A as never,
      clientRequestId,
    );
    expect(operation).toBeDefined();
    await store.putCreateOnly({
      bucket: DEFAULT_HIVE_SOURCE_BUCKET,
      path: operation!.storagePath,
      bytes: PDF_BYTES,
      contentType: "application/pdf",
      correlationId: CORR_ID as CorrelationId,
    });
    const completed = await completeHiveSourceDocumentUpload(deps, {
      ownerUserId: USER_A,
      hiveId: HIVE_A,
      clientRequestId,
      correlationId: CORR_ID,
    });
    expect(completed.sourceDocument.canonicalGapId).toBe("X3");
    expect(completed.sourceDocument.canonicalGapTitle).toBe("Pay stubs (March–April 2026)");
    const stored = await vault.sourceDocuments.getById(completed.sourceDocument.id as never);
    expect(stored?.canonicalGapId).toBe("X3");
    expect(stored?.canonicalGapTitle).toBe("Pay stubs (March–April 2026)");
  });

  it("isolates owners: another user cannot list or upload to someone else's Hive", async () => {
    const { store, deps } = createTestHarness();

    await expect(
      listHiveSourceDocumentsWithV3Vault(deps, {
        ownerUserId: USER_B,
        hiveId: HIVE_A,
        correlationId: CORR_ID,
      }),
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND" });

    await expect(
      uploadHiveSourceDocumentWithV3Vault(deps, {
        ownerUserId: USER_B,
        hiveId: HIVE_A,
        clientRequestId: crypto.randomUUID(),
        fileName: "Receipt.pdf",
        bytes: PDF_BYTES,
        correlationId: CORR_ID,
      }),
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND" });

    expect(store.putCreateOnlyCalls).toBe(0);
  });

  it("rejects magic-byte mismatch and malware before writing to Storage", async () => {
    const { store, deps } = createTestHarness();
    const mismatch = await uploadHiveSourceDocumentWithV3Vault(deps, {
      ownerUserId: USER_A,
      hiveId: HIVE_A,
      clientRequestId: crypto.randomUUID(),
      fileName: "fake.pdf",
      mimeType: "application/pdf",
      bytes: PNG_BYTES,
      correlationId: CORR_ID,
    });
    expect(mismatch.sourceDocument.status).toBe("REJECTED");
    expect(mismatch.sourceDocument.failureReason).toBe("TYPE_MISMATCH");
    expect(store.putCreateOnlyCalls).toBe(0);

    const maliciousHarness = createTestHarness(async () => "MALICIOUS");
    const malicious = await uploadHiveSourceDocumentWithV3Vault(maliciousHarness.deps, {
      ownerUserId: USER_A,
      hiveId: HIVE_A,
      clientRequestId: crypto.randomUUID(),
      fileName: "clean-looking.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      correlationId: CORR_ID,
    });
    expect(malicious.sourceDocument.status).toBe("REJECTED");
    expect(malicious.sourceDocument.failureReason).toBe("MALWARE_DETECTED");
    expect(maliciousHarness.store.putCreateOnlyCalls).toBe(0);

    const downHarness = createTestHarness(async () => {
      throw new ScanError("scan_rate_limited");
    });
    await expect(
      uploadHiveSourceDocumentWithV3Vault(downHarness.deps, {
        ownerUserId: USER_A,
        hiveId: HIVE_A,
        clientRequestId: crypto.randomUUID(),
        fileName: "retry.pdf",
        mimeType: "application/pdf",
        bytes: PDF_BYTES,
        correlationId: CORR_ID,
      }),
    ).rejects.toMatchObject({ errorCode: "PERSISTENCE_FAILED", retryable: true });
    expect(downHarness.store.putCreateOnlyCalls).toBe(0);
  });

  it("enforces the Free quota when the monthly allowance is exhausted", async () => {
    const { deps } = createTestHarness();
    const periodStart = new Date(Date.UTC(2026, 10, 1)).toISOString();
    const periodEnd = new Date(Date.UTC(2026, 11, 1)).toISOString();
    deps.getQuota = async () => ({
      limit: FREE_UPLOADS_PER_UTC_MONTH,
      used: FREE_UPLOADS_PER_UTC_MONTH,
      remaining: 0,
      periodStart,
      periodEnd,
    });

    await expect(
      uploadHiveSourceDocumentWithV3Vault(deps, {
        ownerUserId: USER_A,
        hiveId: HIVE_A,
        clientRequestId: crypto.randomUUID(),
        fileName: "over-quota.pdf",
        bytes: PDF_BYTES,
        correlationId: CORR_ID,
      }),
    ).rejects.toMatchObject({ errorCode: "QUOTA_EXCEEDED" });
  });

  it("reports the configured monthly upload limit from computeVaultUploadQuota", async () => {
    const { deps } = createTestHarness();
    const quota = await getUploadQuotaWithV3Vault(deps, USER_A, CORR_ID);
    expect(quota.quota.limit).toBe(FREE_UPLOADS_PER_UTC_MONTH);
  });

  it("validates and records intent requests idempotently", async () => {
    const intents = new Map<string, { id: string; hiveId: string; text: string }>();
    const client = {
      auth: { getSession: async () => ({ data: { session: null }, error: null }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
      rpc: async (fn: string, args: Record<string, unknown> = {}) => {
        if (fn !== "create_intent_request") {
          return { data: null, error: { message: "unknown_rpc" } };
        }
        const key = String(args.p_client_request_id);
        const existing = intents.get(key);
        if (existing) {
          return {
            data: {
              intentRequest: {
                id: existing.id,
                intentRequestId: existing.id,
                hiveId: existing.hiveId,
                clientRequestId: key,
                createdAt: "2026-10-30T15:00:00.000Z",
              },
              created: false,
            },
            error: null,
          };
        }
        const id = crypto.randomUUID();
        intents.set(key, {
          id,
          hiveId: String(args.p_hive_id),
          text: String(args.p_intent_text),
        });
        return {
          data: {
            intentRequest: {
              id,
              intentRequestId: id,
              hiveId: args.p_hive_id,
              clientRequestId: key,
              createdAt: "2026-10-30T15:00:00.000Z",
            },
            created: true,
          },
          error: null,
        };
      },
    };

    const body = { intentText: "Compare this year's bills", clientRequestId: crypto.randomUUID() };
    const first = await createIntentRequestForOwnedHive(client as never, HIVE_A, body, CORR_ID);
    const second = await createIntentRequestForOwnedHive(client as never, HIVE_A, body, CORR_ID);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.intentRequest.id).toBe(first.intentRequest.id);
  });

  it("passes the audience to the intent RPC only when one is given", async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      rpc: async (_fn: string, args: Record<string, unknown> = {}) => {
        calls.push(args);
        const id = crypto.randomUUID();
        return {
          data: {
            intentRequest: {
              id,
              intentRequestId: id,
              hiveId: HIVE_A,
              clientRequestId: args.p_client_request_id,
              createdAt: "2026-11-02T10:00:00.000Z",
            },
            created: true,
          },
          error: null,
        };
      },
    };
    await createIntentRequestForOwnedHive(
      client as never,
      HIVE_A,
      { intentText: "Prepare for the meeting", clientRequestId: crypto.randomUUID(), audience: "The school team" },
      CORR_ID,
    );
    await createIntentRequestForOwnedHive(
      client as never,
      HIVE_A,
      { intentText: "Prepare for the meeting", clientRequestId: crypto.randomUUID() },
      CORR_ID,
    );
    expect(calls[0]).toMatchObject({ p_audience: "The school team" });
    expect(calls[1]).not.toHaveProperty("p_audience");
  });

  it("rejects listing for a hive the caller does not own before any vault fallback", async () => {
    const { deps } = createTestHarness();
    await expect(
      listHiveSourceDocumentsWithV3Vault(deps, {
        ownerUserId: USER_B,
        hiveId: HIVE_A,
        correlationId: CORR_ID,
      }),
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND" });
  });

  it("lists documents through list_hive_source_documents without opening the vault admin path", async () => {
    const hive: Hive = {
      id: HIVE_A,
      hiveId: HIVE_A,
      name: "March Records",
      description: null,
      clientRequestId: "44444444-4444-4444-8444-444444444444",
      createdAt: "2026-10-30T15:00:00.000Z",
      updatedAt: "2026-10-30T15:00:00.000Z",
    };
  const listed = await listHiveSourceDocumentsWithV3Vault(
      {
        get vault() {
          throw new Error("vault must not load when RPC list succeeds");
        },
        get store() {
          throw new Error("store must not load when RPC list succeeds");
        },
        userClient: {
          rpc: async (fn: string) =>
            fn === "list_hive_source_documents"
              ? { data: { sourceDocuments: [] }, error: null }
              : { data: null, error: null },
        },
        loadOwnedHive: async () => hive,
      },
      { ownerUserId: USER_A, hiveId: HIVE_A, correlationId: CORR_ID },
    );
    expect(listed.sourceDocuments).toEqual([]);
  });

  it("defers vault admin env until a signed read is requested", () => {
    const priorUrl = process.env.SUPABASE_URL;
    const priorSecret = process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const deps = createLiveHiveVaultUploadAdapterDeps(
        { rpc: async () => ({ data: null, error: null }) },
        CORR_ID,
      );
      expect(() => deps.vault).toThrow(VaultAdminConfigError);
      expect(() => deps.store).toThrow(VaultAdminConfigError);
    } finally {
      if (priorUrl !== undefined) process.env.SUPABASE_URL = priorUrl;
      else delete process.env.SUPABASE_URL;
      if (priorSecret !== undefined) process.env.SUPABASE_SECRET_KEY = priorSecret;
      else delete process.env.SUPABASE_SECRET_KEY;
    }
  });

  it("opens a source page for the owner as a 60-second signed link to the original file at that page", async () => {
    const { deps } = createTestHarness();
    const uploaded = await uploadHiveSourceDocumentWithV3Vault(deps, {
      ownerUserId: USER_A,
      hiveId: HIVE_A,
      clientRequestId: crypto.randomUUID(),
      fileName: "Notice.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      correlationId: CORR_ID,
    });
    const open = (overrides: Partial<Parameters<typeof openSourceDocumentPageWithV3Vault>[1]> = {}) =>
      openSourceDocumentPageWithV3Vault(deps, {
        ownerUserId: USER_A,
        hiveId: HIVE_A,
        sourceDocumentId: uploaded.sourceDocument.id,
        pageNumber: "2",
        correlationId: CORR_ID,
        ...overrides,
      });

    await expect(open()).resolves.toEqual({
      signedUrl: `memory://${DEFAULT_HIVE_SOURCE_BUCKET}/${buildSourceObjectPath(USER_A as never, HIVE_A as never, uploaded.sourceDocument.id as never)}?exp=60#page=2`,
      mimeType: "application/pdf",
    });
    await expect(open({ ownerUserId: USER_B })).rejects.toMatchObject({ errorCode: "NOT_FOUND" });
    await expect(open({ sourceDocumentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })).rejects.toMatchObject({
      errorCode: "NOT_FOUND",
    });
    for (const pageNumber of ["0", "-1", "1.5", "abc", "123456"]) {
      await expect(open({ pageNumber })).rejects.toMatchObject({ errorCode: "INVALID_REQUEST" });
    }
    await expect(open({ sourceDocumentId: "not-a-uuid" })).rejects.toMatchObject({ errorCode: "INVALID_REQUEST" });
  });

  it("opens an authorized legacy or canonical PDF page via userClient RLS without requiring admin credentials", async () => {
    const legacyDocId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const storagePath = buildSourceObjectPath(USER_A as never, HIVE_A as never, legacyDocId as never);
    const hive: Hive = {
      id: HIVE_A,
      hiveId: HIVE_A,
      name: "Maya Original Hive",
      description: null,
      clientRequestId: "44444444-4444-4444-8444-444444444444",
      createdAt: "2026-10-30T15:00:00.000Z",
      updatedAt: "2026-10-30T15:00:00.000Z",
    };

    const createSignedUrl = vi.fn(async (path: string, expiresIn: number) => ({
      data: { signedUrl: `https://project.supabase.co/storage/v1/object/sign/hive-source-documents/${path}?token=abc&exp=${expiresIn}` },
      error: null,
    }));
    const fromStorage = vi.fn(() => ({ createSignedUrl }));

    const result = await openSourceDocumentPageWithV3Vault(
      {
        get vault() {
          throw new VaultAdminConfigError("vault_admin_secret_missing");
        },
        get store() {
          throw new VaultAdminConfigError("vault_admin_secret_missing");
        },
        userClient: {
          schema: () => ({
            from: () => ({
              select: () => ({
                eq: (_col1: string, idVal: string) => ({
                  eq: (_col2: string, caseVal: string) => ({
                    maybeSingle: async () => ({
                      data:
                        idVal === legacyDocId && caseVal === HIVE_A
                          ? {
                              id: legacyDocId,
                              case_id: HIVE_A,
                              owner_user_id: USER_A,
                              mime_type: "application/pdf",
                              storage_bucket: DEFAULT_HIVE_SOURCE_BUCKET,
                              storage_path: storagePath,
                              upload_status: "UPLOADED",
                              lifecycle_status: "ACTIVE",
                              deleted_at: null,
                            }
                          : null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
          storage: { from: fromStorage },
        },
        loadOwnedHive: async () => ({ ...hive, isOwner: true }),
      },
      {
        ownerUserId: USER_A,
        hiveId: HIVE_A,
        sourceDocumentId: legacyDocId,
        pageNumber: "4",
        correlationId: CORR_ID,
      },
    );

    expect(fromStorage).toHaveBeenCalledWith(DEFAULT_HIVE_SOURCE_BUCKET);
    expect(createSignedUrl).toHaveBeenCalledWith(storagePath, 60);
    expect(result).toEqual({
      signedUrl: `https://project.supabase.co/storage/v1/object/sign/hive-source-documents/${storagePath}?token=abc&exp=60#page=4`,
      mimeType: "application/pdf",
    });

    // Active shared-Hive member can also sign a valid historical file under Storage RLS without admin credentials.
    const sharedMemberResult = await openSourceDocumentPageWithV3Vault(
      {
        get vault() {
          throw new VaultAdminConfigError("vault_admin_secret_missing");
        },
        get store() {
          throw new VaultAdminConfigError("vault_admin_secret_missing");
        },
        userClient: {
          schema: () => ({
            from: () => ({
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: legacyDocId,
                        case_id: HIVE_A,
                        owner_user_id: USER_A,
                        mime_type: "application/pdf",
                        storage_bucket: DEFAULT_HIVE_SOURCE_BUCKET,
                        storage_path: storagePath,
                        upload_status: "UPLOADED",
                        lifecycle_status: "ACTIVE",
                        deleted_at: null,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
          storage: { from: fromStorage },
        },
        loadOwnedHive: async () => ({ ...hive, isOwner: false, membershipRole: "client" }),
      },
      {
        ownerUserId: USER_B,
        hiveId: HIVE_A,
        sourceDocumentId: legacyDocId,
        pageNumber: "2",
        correlationId: CORR_ID,
      },
    );

    expect(sharedMemberResult.signedUrl).toBe(
      `https://project.supabase.co/storage/v1/object/sign/hive-source-documents/${storagePath}?token=abc&exp=60#page=2`,
    );
  });

  it("fails closed on missing, cross-Hive, soft-deleted, and unauthorized documents without falling back to admin", async () => {
    const docId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const otherHiveId = "99999999-9999-4999-8999-999999999999";
    const hive: Hive = {
      id: HIVE_A,
      hiveId: HIVE_A,
      name: "March Records",
      description: null,
      clientRequestId: "44444444-4444-4444-8444-444444444444",
      createdAt: "2026-10-30T15:00:00.000Z",
      updatedAt: "2026-10-30T15:00:00.000Z",
    };
    const vaultSpy = vi.fn();
    const storeSpy = vi.fn();

    const makeDeps = (row: Record<string, unknown> | null, allowHive = true) => ({
      get vault() {
        vaultSpy();
        throw new Error("vault must not be called when userClient fails closed");
      },
      get store() {
        storeSpy();
        throw new Error("store must not be called when document is unauthorized");
      },
      userClient: {
        schema: () => ({
          from: () => ({
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: row, error: null }),
                }),
              }),
            }),
          }),
        }),
        storage: {
          from: () => ({
            createSignedUrl: async () => ({ data: { signedUrl: "https://never.example/signed" }, error: null }),
          }),
        },
      },
      loadOwnedHive: async () => {
        if (!allowHive) {
          throw createHiveError({
            errorCode: "NOT_FOUND",
            category: "SECURITY",
            stage: "SHELL",
            retryable: false,
            safeMessage: "We could not find that Hive.",
            correlationId: CORR_ID,
            diagnosticReason: "hive_not_found",
          });
        }
        return hive;
      },
    });

    // Missing document
    await expect(
      openSourceDocumentPageWithV3Vault(makeDeps(null), {
        ownerUserId: USER_A,
        hiveId: HIVE_A,
        sourceDocumentId: docId,
        pageNumber: "1",
        correlationId: CORR_ID,
      }),
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND", diagnosticReason: "not_found" });

    // Cross-Hive document (case_id mismatch)
    await expect(
      openSourceDocumentPageWithV3Vault(
        makeDeps({
          id: docId,
          case_id: otherHiveId,
          owner_user_id: USER_A,
          mime_type: "application/pdf",
          storage_bucket: DEFAULT_HIVE_SOURCE_BUCKET,
          storage_path: `${USER_A}/${otherHiveId}/${docId}/original`,
          upload_status: "UPLOADED",
          lifecycle_status: "ACTIVE",
          deleted_at: null,
        }),
        {
          ownerUserId: USER_A,
          hiveId: HIVE_A,
          sourceDocumentId: docId,
          pageNumber: "1",
          correlationId: CORR_ID,
        },
      ),
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND", diagnosticReason: "not_found" });

    // Soft-deleted document
    await expect(
      openSourceDocumentPageWithV3Vault(
        makeDeps({
          id: docId,
          case_id: HIVE_A,
          owner_user_id: USER_A,
          mime_type: "application/pdf",
          storage_bucket: DEFAULT_HIVE_SOURCE_BUCKET,
          storage_path: `${USER_A}/${HIVE_A}/${docId}/original`,
          upload_status: "UPLOADED",
          lifecycle_status: "SOFT_DELETED",
          deleted_at: "2026-11-01T00:00:00.000Z",
        }),
        {
          ownerUserId: USER_A,
          hiveId: HIVE_A,
          sourceDocumentId: docId,
          pageNumber: "1",
          correlationId: CORR_ID,
        },
      ),
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND", diagnosticReason: "not_found" });

    // Unauthorized caller for Hive
    await expect(
      openSourceDocumentPageWithV3Vault(makeDeps(null, false), {
        ownerUserId: USER_B,
        hiveId: HIVE_A,
        sourceDocumentId: docId,
        pageNumber: "1",
        correlationId: CORR_ID,
      }),
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND" });

    expect(vaultSpy).not.toHaveBeenCalled();
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it("never falls back to admin signing on unauthorized storage signing, unexpected permission errors, or missing objects", async () => {
    const docId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const validPath = `${USER_A}/${HIVE_A}/${docId}/original`;
    const hive: Hive = {
      id: HIVE_A,
      hiveId: HIVE_A,
      name: "Maya Original Hive",
      description: null,
      clientRequestId: "44444444-4444-4444-8444-444444444444",
      createdAt: "2026-10-30T15:00:00.000Z",
      updatedAt: "2026-10-30T15:00:00.000Z",
      isOwner: true,
    };
    const adminStore = {
      createSignedReadUrl: vi.fn(async () => "https://admin-must-never-be-called.example/signed"),
    };

    const makeSigningDeps = (
      signImpl: () => Promise<{ data: { signedUrl: string } | null; error: unknown }>,
    ) => ({
      get vault() {
        throw new Error("vault must not be called when userClient is present");
      },
      store: adminStore as never,
      userClient: {
        schema: () => ({
          from: () => ({
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: docId,
                      case_id: HIVE_A,
                      owner_user_id: USER_A,
                      mime_type: "application/pdf",
                      storage_bucket: DEFAULT_HIVE_SOURCE_BUCKET,
                      storage_path: validPath,
                      upload_status: "UPLOADED",
                      lifecycle_status: "ACTIVE",
                      deleted_at: null,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
        storage: {
          from: () => ({
            createSignedUrl: signImpl,
          }),
        },
      },
      loadOwnedHive: async () => hive,
    });

    // 1. Storage RLS 403 denial must fail closed (never fall back to admin signing)
    await expect(
      openSourceDocumentPageWithV3Vault(
        makeSigningDeps(async () => ({
          data: null,
          error: { statusCode: "403", message: "new row violates row-level security policy" },
        })),
        {
          ownerUserId: USER_A,
          hiveId: HIVE_A,
          sourceDocumentId: docId,
          pageNumber: "2",
          correlationId: CORR_ID,
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "SOURCE_ACCESS_DENIED",
      category: "SECURITY",
      retryable: false,
      diagnosticReason: "access_denied",
      correlationId: CORR_ID,
    });

    // 2. Unexpected permission errors (401 / permission denied / Postgres 42501 / thrown 403) must fail closed
    for (const permissionErr of [
      { statusCode: "401", message: "Unauthorized" },
      { code: "42501", message: "permission denied for table objects" },
      { message: "Access denied for bucket" },
    ]) {
      await expect(
        openSourceDocumentPageWithV3Vault(
          makeSigningDeps(async () => ({ data: null, error: permissionErr })),
          {
            ownerUserId: USER_A,
            hiveId: HIVE_A,
            sourceDocumentId: docId,
            pageNumber: "1",
            correlationId: CORR_ID,
          },
        ),
      ).rejects.toMatchObject({
        errorCode: "SOURCE_ACCESS_DENIED",
        category: "SECURITY",
        retryable: false,
        diagnosticReason: "access_denied",
      });
    }

    await expect(
      openSourceDocumentPageWithV3Vault(
        makeSigningDeps(async () => {
          throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
        }),
        {
          ownerUserId: USER_A,
          hiveId: HIVE_A,
          sourceDocumentId: docId,
          pageNumber: "1",
          correlationId: CORR_ID,
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "SOURCE_ACCESS_DENIED",
      category: "SECURITY",
      retryable: false,
      diagnosticReason: "access_denied",
    });

    // 3. Unexpected non-permission storage failure (500 or empty signedUrl) must fail closed without admin fallback
    await expect(
      openSourceDocumentPageWithV3Vault(
        makeSigningDeps(async () => ({
          data: null,
          error: { statusCode: "500", message: "storage gateway error" },
        })),
        {
          ownerUserId: USER_A,
          hiveId: HIVE_A,
          sourceDocumentId: docId,
          pageNumber: "1",
          correlationId: CORR_ID,
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "INTERNAL_ERROR",
      retryable: true,
      diagnosticReason: "storage_failed",
    });

    await expect(
      openSourceDocumentPageWithV3Vault(
        makeSigningDeps(async () => ({ data: { signedUrl: "" }, error: null })),
        {
          ownerUserId: USER_A,
          hiveId: HIVE_A,
          sourceDocumentId: docId,
          pageNumber: "1",
          correlationId: CORR_ID,
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "INTERNAL_ERROR",
      retryable: true,
      diagnosticReason: "storage_failed",
    });

    // 4. Missing storage client on userClient must NOT fall through to admin store
    await expect(
      openSourceDocumentPageWithV3Vault(
        {
          get vault() {
            throw new Error("vault must not be called when userClient is present");
          },
          store: adminStore as never,
          userClient: {
            schema: makeSigningDeps(async () => ({ data: null, error: null })).userClient.schema,
          },
          loadOwnedHive: async () => hive,
        },
        {
          ownerUserId: USER_A,
          hiveId: HIVE_A,
          sourceDocumentId: docId,
          pageNumber: "1",
          correlationId: CORR_ID,
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "INTERNAL_ERROR",
      diagnosticReason: "storage_failed",
    });

    // 5. Missing object in storage fails closed with truthful NOT_FOUND
    await expect(
      openSourceDocumentPageWithV3Vault(
        makeSigningDeps(async () => ({
          data: null,
          error: { statusCode: "404", message: "Object not found" },
        })),
        {
          ownerUserId: USER_A,
          hiveId: HIVE_A,
          sourceDocumentId: docId,
          pageNumber: "1",
          correlationId: CORR_ID,
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "NOT_FOUND",
      diagnosticReason: "source_object_missing",
      correlationId: CORR_ID,
    });

    expect(adminStore.createSignedReadUrl).not.toHaveBeenCalled();
  });

  it("rejects wrong bucket, cross-Hive paths, cross-document paths, unbound legacy paths, and traversal before signing", async () => {
    const docId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const otherHiveId = "99999999-9999-4999-8999-999999999999";
    const otherDocId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const hive: Hive = {
      id: HIVE_A,
      hiveId: HIVE_A,
      name: "Maya Original Hive",
      description: null,
      clientRequestId: "44444444-4444-4444-8444-444444444444",
      createdAt: "2026-10-30T15:00:00.000Z",
      updatedAt: "2026-10-30T15:00:00.000Z",
      isOwner: true,
    };
    const userStorageFromSpy = vi.fn();
    const adminStoreSpy = vi.fn();

    const runWithLocation = (bucket: string, storagePath: string) =>
      openSourceDocumentPageWithV3Vault(
        {
          get vault() {
            throw new Error("vault must not be called");
          },
          store: {
            createSignedReadUrl: adminStoreSpy,
          } as never,
          userClient: {
            schema: () => ({
              from: () => ({
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({
                        data: {
                          id: docId,
                          case_id: HIVE_A,
                          owner_user_id: USER_A,
                          mime_type: "application/pdf",
                          storage_bucket: bucket,
                          storage_path: storagePath,
                          upload_status: "UPLOADED",
                          lifecycle_status: "ACTIVE",
                          deleted_at: null,
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
            storage: {
              from: (calledBucket: string) => {
                userStorageFromSpy(calledBucket);
                return {
                  createSignedUrl: async () => ({
                    data: { signedUrl: "https://must-not-sign.example/signed" },
                    error: null,
                  }),
                };
              },
            },
          },
          loadOwnedHive: async () => hive,
        },
        {
          ownerUserId: USER_A,
          hiveId: HIVE_A,
          sourceDocumentId: docId,
          pageNumber: "1",
          correlationId: CORR_ID,
        },
      );

    const invalidCases: readonly [string, string][] = [
      // Wrong buckets
      ["hive-derived-artifacts", `${USER_A}/${HIVE_A}/${docId}/original`],
      ["public", `${USER_A}/${HIVE_A}/${docId}/original`],
      ["other-bucket", `${USER_A}/${HIVE_A}/${docId}/original`],
      // Cross-Hive path
      [DEFAULT_HIVE_SOURCE_BUCKET, `${USER_A}/${otherHiveId}/${docId}/original`],
      // Cross-document path
      [DEFAULT_HIVE_SOURCE_BUCKET, `${USER_A}/${HIVE_A}/${otherDocId}/original`],
      // Wrong owner prefix
      [DEFAULT_HIVE_SOURCE_BUCKET, `${USER_B}/${HIVE_A}/${docId}/original`],
      // Unbound legacy prefix
      [DEFAULT_HIVE_SOURCE_BUCKET, `legacy-prefix/${docId}/original.pdf`],
      // Path traversal / malformed paths
      [DEFAULT_HIVE_SOURCE_BUCKET, `${USER_A}/${HIVE_A}/${docId}/../${otherDocId}/original`],
      [DEFAULT_HIVE_SOURCE_BUCKET, `${USER_A}/${HIVE_A}/${docId}/%2e%2e/original`],
      [DEFAULT_HIVE_SOURCE_BUCKET, `/${USER_A}/${HIVE_A}/${docId}/original`],
      [DEFAULT_HIVE_SOURCE_BUCKET, `${USER_A}/${HIVE_A}/${docId}\\original`],
    ];

    for (const [bucket, storagePath] of invalidCases) {
      await expect(runWithLocation(bucket, storagePath)).rejects.toMatchObject({
        errorCode: "SOURCE_ACCESS_DENIED",
        category: "SECURITY",
        retryable: false,
        diagnosticReason: "source_path_forbidden",
        correlationId: CORR_ID,
      });
    }

    expect(userStorageFromSpy).not.toHaveBeenCalled();
    expect(adminStoreSpy).not.toHaveBeenCalled();
  });

  it("migration defines 1:1 Hive-to-Case FK, V3 Vault tables, RLS, and private bucket hive-source-documents", async () => {
    const repoRoot = path.resolve(process.cwd(), "../..");
    const sql = await readFile(
      path.join(repoRoot, "supabase/migrations/20261030150000_create_source_documents.sql"),
      "utf8",
    );

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS hive.cases");
    expect(sql).toContain(
      "FOREIGN KEY (id, owner_user_id) REFERENCES hive.hives (id, owner_user_id) ON DELETE CASCADE",
    );
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS hive.source_documents");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS hive.upload_operations");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS hive.audit_events");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS hive.storage_orphans");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION hive.apply_vault_transaction(payload jsonb)");
    expect(sql).toContain("'hive-source-documents'");
    expect(sql).toContain("ALTER TABLE hive.source_documents FORCE ROW LEVEL SECURITY;");
    expect(sql).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*TO\s+authenticated/i);
  });
});
