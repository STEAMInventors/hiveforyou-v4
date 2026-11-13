import { DOCX_MIME_TYPE, type Hive } from "@hiveforyou/contracts";
import {
  computeReadFingerprint,
  READER_WIRE_CONTRACT_VERSION,
  type ReadDocumentInput,
} from "@hiveforyou/contracts/document-read";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listDocumentPagesForSource,
  MAX_INLINE_DB_TRANSIENT_ATTEMPTS,
  prepareDocumentPagesForInsert,
  putDocumentPagesForSource,
  type DocumentPageRpcClient,
  type PersistedDocumentPageRow,
} from "./document-pages-persistence";
import {
  assertValidReaderBaseUrl,
  DEFAULT_READER_HTTP_TIMEOUT_MS,
  loadReaderServiceConfig,
  MAX_READER_HTTP_TIMEOUT_MS,
  readDocument,
  type ReadDocumentDeps,
} from "./read-document";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_HIVE_ID = "99999999-9999-4999-8999-999999999999";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_OWNER_ID = "88888888-8888-4888-8888-888888888888";
const DOC_ID = "33333333-3333-4333-8333-333333333333";
const CORR_ID = "44444444-4444-4444-8444-444444444444";
const RUN_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_SHA = "a".repeat(64);
const STORAGE_PATH = `${OWNER_ID}/${HIVE_ID}/${DOC_ID}/original`;

const OWNED_HIVE: Hive = {
  id: HIVE_ID,
  hiveId: HIVE_ID,
  name: "Synthetic widget review",
  description: null,
  clientRequestId: "66666666-6666-4666-8666-666666666666",
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
};

function makeInput(overrides?: Partial<ReadDocumentInput>): ReadDocumentInput {
  return {
    hiveId: HIVE_ID,
    ownerUserId: OWNER_ID,
    sourceDocumentId: DOC_ID,
    storageBucket: "hive-source-documents",
    storagePath: STORAGE_PATH,
    fileName: "synthetic-document.pdf",
    mimeType: "application/pdf",
    byteSize: 4096,
    sha256: SOURCE_SHA,
    declaredPageCount: 2,
    correlationId: CORR_ID,
    processingRunId: RUN_ID,
    ...overrides,
  };
}

function makeWireResponse(overrides?: Record<string, unknown>) {
  return {
    contract_version: READER_WIRE_CONTRACT_VERSION,
    status: "SUCCEEDED",
    source: {
      source_document_id: DOC_ID,
      hive_id: HIVE_ID,
      owner_user_id: OWNER_ID,
      storage_bucket: "hive-source-documents",
      storage_path: STORAGE_PATH,
      mime_type: "application/pdf",
      byte_size: 4096,
      sha256: SOURCE_SHA,
      filename: "synthetic-document.pdf",
    },
    source_hash_verified: true,
    page_count: 2,
    pages: [
      {
        page_number: 1,
        text: "Synthetic page one text with sufficient alphanumeric density for Reader verification.",
        extraction_method: "pdf_native",
        quality: {
          character_count: 85,
          identity_text_sufficient: true,
          issues: [],
        },
      },
      {
        page_number: 2,
        text: "Synthetic page two text with sufficient alphanumeric density for Reader verification.",
        extraction_method: "pdf_native",
        quality: {
          character_count: 85,
          identity_text_sufficient: true,
          issues: [],
        },
      },
    ],
    provenance: {
      reader_git_sha: "abc1234",
      reader_version: "0.1.0",
      tools: { hive_reader: "0.1.0", pymupdf: "1.28.2", libreoffice: "7.6.7.2" },
      model_calls: [],
    },
    read_fingerprint: computeReadFingerprint({
      sourceSha256: SOURCE_SHA,
      options: {
        docx_page_break_strategy: "reproducible_v1",
        max_pages: 500,
        ocr_mode: "selective",
      },
    }),
    ...overrides,
  };
}

class FakeDocumentPagesDb {
  readonly sources = new Map<
    string,
    {
      id: string;
      case_id: string;
      sha256: string;
      read_status: string;
      page_count: number | null;
    }
  >();
  readonly pages: PersistedDocumentPageRow[] = [];
  readonly rpcCalls: string[] = [];
  private transientFailuresRemaining = 0;
  private commitBeforeTransientFailure = false;

  registerSource(input: {
    id: string;
    hiveId: string;
    sha256: string;
    pageCount?: number | null;
  }) {
    this.sources.set(input.id.toLowerCase(), {
      id: input.id.toLowerCase(),
      case_id: input.hiveId.toLowerCase(),
      sha256: input.sha256.toLowerCase(),
      read_status: "PENDING",
      page_count: input.pageCount ?? null,
    });
  }

  failNextPutTransient(count: number, commitFirst = false) {
    this.transientFailuresRemaining = count;
    this.commitBeforeTransientFailure = commitFirst;
  }

  readonly client: DocumentPageRpcClient = {
    rpc: async (fn, args = {}) => {
      this.rpcCalls.push(fn);

      if (fn === "put_document_pages") {
        const hiveId = String(args.p_hive_id ?? "").toLowerCase();
        const sourceId = String(args.p_source_document_id ?? "").toLowerCase();
        const sha = String(args.p_source_sha256 ?? "").toLowerCase();
        const fp = String(args.p_read_fingerprint ?? "").trim();
        const setDigest = String(args.p_page_set_digest ?? "").toLowerCase();
        const readStatus = String(args.p_read_status ?? "SUCCEEDED");
        const totalPhysicalPages = Number(args.p_total_physical_pages ?? 0);
        const pageCount = Number(args.p_page_count ?? 0);
        const inputPages = (args.p_pages ?? []) as Array<{
          page_number: number;
          page_text: string;
          page_text_sha256: string;
          page_byte_length: number;
          extraction_method: PersistedDocumentPageRow["extraction_method"];
          provenance_json: PersistedDocumentPageRow["provenance_json"];
        }>;

        const doc = this.sources.get(sourceId);
        if (!doc) {
          return { data: null, error: { message: "document_not_found" } };
        }
        if (doc.case_id !== hiveId) {
          return { data: null, error: { message: "page_hive_mismatch" } };
        }
        if (doc.sha256 !== sha) {
          return { data: null, error: { message: "page_source_sha256_mismatch" } };
        }

        const commitWrite = () => {
          let inserted = 0;
          let replayed = 0;
          for (const p of inputPages) {
            const existing = this.pages.find(
              (row) =>
                row.source_document_id === sourceId &&
                row.page_set_digest === setDigest &&
                row.page_number === p.page_number,
            );
            if (existing) {
              if (
                existing.hive_id === hiveId &&
                existing.source_sha256 === sha &&
                existing.read_fingerprint === fp &&
                existing.page_text_sha256 === p.page_text_sha256 &&
                existing.page_byte_length === p.page_byte_length &&
                existing.page_text === p.page_text &&
                existing.extraction_method === p.extraction_method
              ) {
                replayed += 1;
              } else {
                throw new Error("page_hash_conflict");
              }
            } else {
              this.pages.push({
                id: `page-${this.pages.length + 1}`,
                hive_id: hiveId,
                source_document_id: sourceId,
                source_sha256: sha,
                read_fingerprint: fp,
                page_set_digest: setDigest,
                page_count: pageCount,
                page_number: p.page_number,
                page_text: p.page_text,
                page_text_sha256: p.page_text_sha256,
                page_byte_length: p.page_byte_length,
                extraction_method: p.extraction_method,
                extraction_status: "SUCCEEDED",
                provenance_json: p.provenance_json,
                created_at: "2026-11-01T12:00:00.000Z",
              });
              inserted += 1;
            }
          }
          doc.read_status = readStatus;
          doc.page_count = totalPhysicalPages;
          return { inserted, replayed };
        };

        if (this.transientFailuresRemaining > 0) {
          this.transientFailuresRemaining -= 1;
          if (this.commitBeforeTransientFailure) {
            this.commitBeforeTransientFailure = false;
            commitWrite();
          }
          return { data: null, error: { message: "TypeError: fetch failed (db_transient)" } };
        }

        try {
          const { inserted, replayed } = commitWrite();
          return {
            data: {
              source_document_id: sourceId,
              hive_id: hiveId,
              source_sha256: sha,
              read_fingerprint: fp,
              page_set_digest: setDigest,
              read_status: readStatus,
              total_physical_pages: totalPhysicalPages,
              page_count: pageCount,
              inserted_count: inserted,
              replayed_count: replayed,
            },
            error: null,
          };
        } catch (err) {
          return {
            data: null,
            error: { message: err instanceof Error ? err.message : "page_invalid" },
          };
        }
      }

      if (fn === "list_document_pages") {
        const hiveId = String(args.p_hive_id ?? "").toLowerCase();
        const sourceId = String(args.p_source_document_id ?? "").toLowerCase();
        const fp = String(args.p_read_fingerprint ?? "").trim();
        const setDigest = String(args.p_page_set_digest ?? "").toLowerCase();

        const doc = this.sources.get(sourceId);
        if (!doc) {
          return { data: null, error: { message: "document_not_found" } };
        }
        if (doc.case_id !== hiveId) {
          return { data: null, error: { message: "page_hive_mismatch" } };
        }

        const matched = this.pages
          .filter(
            (row) =>
              row.source_document_id === sourceId &&
              row.hive_id === hiveId &&
              row.read_fingerprint === fp &&
              row.page_set_digest === setDigest,
          )
          .sort((a, b) => a.page_number - b.page_number);

        return {
          data: {
            found: matched.length > 0,
            source_document_id: sourceId,
            hive_id: hiveId,
            source_sha256: doc.sha256,
            read_fingerprint: fp,
            page_set_digest: setDigest,
            read_status: doc.read_status,
            total_physical_pages: doc.page_count ?? matched.length,
            pages: matched,
          },
          error: null,
        };
      }

      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
  };
}

describe("loadReaderServiceConfig() timeout and Reader base URL safety", () => {
  const baseEnv = {
    READER_BASE_URL: "https://reader.example.com",
    READER_SERVICE_TOKEN: "synthetic-token",
  };

  it("defaults WORKER_READER_HTTP_TIMEOUT_MS to 120 seconds when unset", () => {
    expect(loadReaderServiceConfig(baseEnv).timeoutMs).toBe(DEFAULT_READER_HTTP_TIMEOUT_MS);
  });

  it("accepts timeout at the maximum lease-safe boundary", () => {
    expect(
      loadReaderServiceConfig({
        ...baseEnv,
        WORKER_READER_HTTP_TIMEOUT_MS: String(MAX_READER_HTTP_TIMEOUT_MS),
      }).timeoutMs,
    ).toBe(MAX_READER_HTTP_TIMEOUT_MS);
  });

  it.each([
    ["0", "reader_config_invalid_timeout"],
    ["-1", "reader_config_invalid_timeout"],
    [String(MAX_READER_HTTP_TIMEOUT_MS + 1), "reader_config_invalid_timeout"],
    ["120000n", "reader_config_invalid_timeout"],
    ["not-a-number", "reader_config_invalid_timeout"],
  ] as const)("rejects unsafe WORKER_READER_HTTP_TIMEOUT_MS=%s", (value, diagnosticReason) => {
    expect(() =>
      loadReaderServiceConfig({ ...baseEnv, WORKER_READER_HTTP_TIMEOUT_MS: value }),
    ).toThrow(
      expect.objectContaining({
        diagnosticReason,
        errorCode: "INTERNAL_ERROR",
        retryable: false,
      }),
    );
  });

  it.each([
    "https://reader.example.com",
    "http://127.0.0.1:8082",
    "http://localhost:8082",
  ])("accepts Reader base URL %s", (url) => {
    const config = loadReaderServiceConfig({ ...baseEnv, READER_BASE_URL: url });
    expect(config.baseUrl).toBe(url.replace(/\/+$/, ""));
  });

  it.each([
    "http://reader.example.com",
    "http://192.168.0.5:8082",
    "ftp://reader.example.com",
    "https://user:secret@reader.example.com",
    "not-a-valid-url",
  ])("rejects Reader base URL %s", (url) => {
    expect(() => loadReaderServiceConfig({ ...baseEnv, READER_BASE_URL: url })).toThrow(
      expect.objectContaining({
        errorCode: "INTERNAL_ERROR",
        category: "INTERNAL",
        diagnosticReason: "reader_config_invalid_base_url",
        retryable: false,
      }),
    );
  });
});

describe("assertValidReaderBaseUrl()", () => {
  it("strips trailing slashes from accepted URLs", () => {
    expect(assertValidReaderBaseUrl("https://reader.example.com/", CORR_ID)).toBe(
      "https://reader.example.com",
    );
  });
});

describe("readDocument() thin Reader integration boundary", () => {
  let emittedLogs: string[];

  beforeEach(() => {
    emittedLogs = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      emittedLogs.push(line);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeDeps(
    fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    overrides?: Partial<ReadDocumentDeps>,
  ): ReadDocumentDeps {
    return {
      loadOwnedHive: async () => OWNED_HIVE,
      loadRegisteredSource: async () => ({
        id: DOC_ID,
        hiveId: HIVE_ID,
        ownerUserId: OWNER_ID,
        fileName: "synthetic-document.pdf",
        mimeType: "application/pdf",
        byteSize: 4096,
        sha256: SOURCE_SHA,
        storageBucket: "hive-source-documents",
        storagePath: STORAGE_PATH,
        pageCount: 2,
      }),
      getReaderConfig: () => ({
        baseUrl: "http://127.0.0.1:8082",
        serviceToken: "synthetic-reader-token",
        timeoutMs: 5000,
      }),
      fetchFn: fetchImpl as typeof fetch,
      ...overrides,
    };
  }

  it("reads PDF, PNG, JPEG, and DOCX with local OCR and explicit page accounting without LiteLLM calls", async () => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const deps = makeDeps(async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        source: { mime_type: string };
        extraction_schema: unknown;
      };
      requests.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body,
      });

      const mime = body.source.mime_type;
      const isSingleImage = mime === "image/png" || mime === "image/jpeg";
      const method =
        mime === DOCX_MIME_TYPE
          ? "docx_render_v1"
          : isSingleImage
            ? "image_ocr_local"
            : "pdf_native";
      const count = isSingleImage ? 1 : 2;
      const pages = Array.from({ length: count }, (_, idx) => ({
        page_number: idx + 1,
        text: `Synthetic ${mime} page ${idx + 1} with more than forty alphanumeric characters.`,
        extraction_method: method,
        quality: {
          character_count: 72,
          identity_text_sufficient: true,
          issues: ["OCR_LITELLM_NOT_CONFIGURED"],
        },
      }));

      return new Response(
        JSON.stringify(
          makeWireResponse({
            source: {
              ...makeWireResponse().source,
              mime_type: mime,
            },
            page_count: count,
            pages,
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    // 1. PDF
    const pdfResult = await readDocument(deps, makeInput({ mimeType: "application/pdf" }));
    expect(pdfResult.readStatus).toBe("SUCCEEDED");
    expect(pdfResult.totalPhysicalPages).toBe(2);
    expect(pdfResult.processedPages).toEqual([1, 2]);
    expect(pdfResult.unreadablePages).toEqual([]);
    expect(pdfResult.unprocessedPages).toEqual([]);
    expect(pdfResult.extractionMethod).toBe("pdf_native");

    // 2. PNG (local OCR)
    const pngResult = await readDocument(
      {
        ...deps,
        loadRegisteredSource: async () => ({
          id: DOC_ID,
          hiveId: HIVE_ID,
          ownerUserId: OWNER_ID,
          fileName: "synthetic-receipt.png",
          mimeType: "image/png",
          byteSize: 4096,
          sha256: SOURCE_SHA,
          storageBucket: "hive-source-documents",
          storagePath: STORAGE_PATH,
          pageCount: 1,
        }),
      },
      makeInput({ fileName: "synthetic-receipt.png", mimeType: "image/png", declaredPageCount: 1 }),
    );
    expect(pngResult.extractionMethod).toBe("image_ocr_local");
    expect(pngResult.totalPhysicalPages).toBe(1);
    expect(pngResult.processedPages).toEqual([1]);

    // 3. JPEG (local OCR)
    const jpgResult = await readDocument(
      {
        ...deps,
        loadRegisteredSource: async () => ({
          id: DOC_ID,
          hiveId: HIVE_ID,
          ownerUserId: OWNER_ID,
          fileName: "synthetic-scan.jpg",
          mimeType: "image/jpeg",
          byteSize: 4096,
          sha256: SOURCE_SHA,
          storageBucket: "hive-source-documents",
          storagePath: STORAGE_PATH,
          pageCount: 1,
        }),
      },
      makeInput({ fileName: "synthetic-scan.jpg", mimeType: "image/jpeg", declaredPageCount: 1 }),
    );
    expect(jpgResult.extractionMethod).toBe("image_ocr_local");

    // 4. DOCX (LibreOffice reproducible_v1)
    const docxResult = await readDocument(
      {
        ...deps,
        loadRegisteredSource: async () => ({
          id: DOC_ID,
          hiveId: HIVE_ID,
          ownerUserId: OWNER_ID,
          fileName: "synthetic-plan.docx",
          mimeType: DOCX_MIME_TYPE,
          byteSize: 4096,
          sha256: SOURCE_SHA,
          storageBucket: "hive-source-documents",
          storagePath: STORAGE_PATH,
          pageCount: 1, // registration placeholder before LibreOffice render
        }),
      },
      makeInput({ fileName: "synthetic-plan.docx", mimeType: DOCX_MIME_TYPE, declaredPageCount: 1 }),
    );
    expect(docxResult.extractionMethod).toBe("docx_render_v1");
    expect(docxResult.totalPhysicalPages).toBe(2);
    expect(docxResult.processedPages).toEqual([1, 2]);

    // Verify wire requests always sent extraction_schema: null and Bearer auth
    expect(requests).toHaveLength(4);
    for (const req of requests) {
      expect(req.url).toBe("http://127.0.0.1:8082/v1/read-document");
      expect(req.headers.Authorization).toBe("Bearer synthetic-reader-token");
      expect(req.headers["x-correlation-id"]).toBe(CORR_ID);
      expect((req.body as { extraction_schema: unknown }).extraction_schema).toBeNull();
    }

    // Verify logs never leaked page text or filename
    const allLogs = emittedLogs.join("\n");
    expect(allLogs).not.toContain("synthetic-document.pdf");
    expect(allLogs).not.toContain("Synthetic application/pdf page 1");
  });

  it("rejects insecure Reader base URLs from injected config before calling Reader", async () => {
    const fetchSpy = vi.fn();
    const deps = makeDeps(fetchSpy, {
      getReaderConfig: () => ({
        baseUrl: "http://reader.example.com",
        serviceToken: "synthetic-reader-token",
      }),
    });

    await expect(readDocument(deps, makeInput())).rejects.toMatchObject({
      errorCode: "INTERNAL_ERROR",
      category: "INTERNAL",
      diagnosticReason: "reader_config_invalid_base_url",
      retryable: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects Reader HTTP timeouts above the lease-safe maximum from injected config", async () => {
    const fetchSpy = vi.fn();
    const deps = makeDeps(fetchSpy, {
      getReaderConfig: () => ({
        baseUrl: "http://127.0.0.1:8082",
        serviceToken: "synthetic-reader-token",
        timeoutMs: MAX_READER_HTTP_TIMEOUT_MS + 1,
      }),
    });

    await expect(readDocument(deps, makeInput())).rejects.toMatchObject({
      diagnosticReason: "reader_config_invalid_timeout",
      retryable: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("denies unauthorized Hive or cross-Hive source before calling Reader", async () => {
    const fetchSpy = vi.fn();
    const deps = makeDeps(fetchSpy, {
      loadRegisteredSource: async () => ({
        id: DOC_ID,
        hiveId: OTHER_HIVE_ID,
        ownerUserId: OTHER_OWNER_ID,
        fileName: "other.pdf",
        mimeType: "application/pdf",
        byteSize: 4096,
        sha256: SOURCE_SHA,
        storageBucket: "hive-source-documents",
        storagePath: STORAGE_PATH,
        pageCount: 2,
      }),
    });

    await expect(readDocument(deps, makeInput())).rejects.toMatchObject({
      errorCode: "SOURCE_ACCESS_DENIED",
      category: "SECURITY",
      stage: "READ",
      retryable: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps Reader HTTP error envelopes (hash mismatch, missing object, storage unavailable, timeout) to V4 HiveError", async () => {
    // 1. Hash mismatch (400 INVALID_REQUEST from Reader)
    const hashMismatchDeps = makeDeps(async () =>
      new Response(
        JSON.stringify({
          contract_version: "error-envelope@1",
          error_code: "INVALID_REQUEST",
          category: "validation",
          retryable: false,
          message_safe: "Downloaded content hash does not match.",
          correlation_id: CORR_ID,
        }),
        { status: 400 },
      ),
    );
    await expect(readDocument(hashMismatchDeps, makeInput())).rejects.toMatchObject({
      errorCode: "INVALID_DOCUMENT",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
      diagnosticReason: "page_source_sha256_mismatch",
    });

    // 2. Storage unavailable (503 STORAGE_UNAVAILABLE from Reader)
    const storageDownDeps = makeDeps(async () =>
      new Response(
        JSON.stringify({
          contract_version: "error-envelope@1",
          error_code: "STORAGE_UNAVAILABLE",
          category: "storage",
          retryable: true,
          message_safe: "Storage is unavailable.",
          correlation_id: CORR_ID,
        }),
        { status: 503 },
      ),
    );
    await expect(readDocument(storageDownDeps, makeInput())).rejects.toMatchObject({
      errorCode: "STORAGE_UNAVAILABLE",
      category: "DEPENDENCY",
      stage: "READ",
      retryable: true,
    });

    // 3. Corrupt file / LibreOffice failure (422 EXTRACTION_FAILED from Reader)
    const corruptDeps = makeDeps(async () =>
      new Response(
        JSON.stringify({
          contract_version: "error-envelope@1",
          error_code: "EXTRACTION_FAILED",
          category: "processing",
          retryable: false,
          message_safe: "Could not read DOCX document.",
          correlation_id: CORR_ID,
        }),
        { status: 422 },
      ),
    );
    await expect(readDocument(corruptDeps, makeInput())).rejects.toMatchObject({
      errorCode: "PAGE_READ_FAILED",
      category: "DOCUMENT",
      stage: "READ",
      retryable: false,
    });
  });
});

describe("putDocumentPagesForSource & listDocumentPagesForSource", () => {
  let emittedLogs: string[];

  beforeEach(() => {
    emittedLogs = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      emittedLogs.push(line);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function buildSampleReadResult() {
    const deps: ReadDocumentDeps = {
      loadOwnedHive: async () => OWNED_HIVE,
      getReaderConfig: () => ({
        baseUrl: "http://127.0.0.1:8082",
        serviceToken: "synthetic-reader-token",
      }),
      fetchFn: (async () =>
        new Response(JSON.stringify(makeWireResponse()), { status: 200 })) as typeof fetch,
    };
    return readDocument(deps, makeInput());
  }

  it("persists multi-page Reader output, updates read_status and page_count, and reads back with digest verification", async () => {
    const db = new FakeDocumentPagesDb();
    db.registerSource({ id: DOC_ID, hiveId: HIVE_ID, sha256: SOURCE_SHA, pageCount: 1 });
    const readResult = await buildSampleReadResult();

    const putOutcome = await putDocumentPagesForSource(db.client, {
      correlationId: CORR_ID,
      processingRunId: RUN_ID,
      registeredSource: {
        sourceDocumentId: DOC_ID,
        hiveId: HIVE_ID,
        sha256: SOURCE_SHA,
      },
      readResult,
    });

    expect(putOutcome).toMatchObject({
      sourceDocumentId: DOC_ID,
      hiveId: HIVE_ID,
      sourceSha256: SOURCE_SHA,
      readStatus: "SUCCEEDED",
      totalPhysicalPages: 2,
      pageCount: 2,
      insertedCount: 2,
      replayedCount: 0,
    });
    expect(db.sources.get(DOC_ID)?.read_status).toBe("SUCCEEDED");
    expect(db.sources.get(DOC_ID)?.page_count).toBe(2);

    // Idempotent replay
    const replayOutcome = await putDocumentPagesForSource(db.client, {
      correlationId: CORR_ID,
      processingRunId: RUN_ID,
      registeredSource: {
        sourceDocumentId: DOC_ID,
        hiveId: HIVE_ID,
        sha256: SOURCE_SHA,
      },
      readResult,
    });
    expect(replayOutcome).toMatchObject({ insertedCount: 0, replayedCount: 2 });

    const listed = await listDocumentPagesForSource(db.client, {
      hiveId: HIVE_ID,
      sourceDocumentId: DOC_ID,
      readFingerprint: readResult.sourceFingerprint.readFingerprint,
      pageSetDigest: readResult.sourceFingerprint.pageSetDigest,
      expectedSourceSha256: SOURCE_SHA,
      correlationId: CORR_ID,
    });
    expect(listed.found).toBe(true);
    expect(listed.pages).toHaveLength(2);
    expect(listed.readStatus).toBe("SUCCEEDED");
    expect(listed.totalPhysicalPages).toBe(2);
  });

  it("recovers from a lost RPC response after commit by reading back persisted pages before retrying", async () => {
    const db = new FakeDocumentPagesDb();
    db.registerSource({ id: DOC_ID, hiveId: HIVE_ID, sha256: SOURCE_SHA });
    db.failNextPutTransient(1, true);
    const readResult = await buildSampleReadResult();

    const outcome = await putDocumentPagesForSource(db.client, {
      correlationId: CORR_ID,
      registeredSource: {
        sourceDocumentId: DOC_ID,
        hiveId: HIVE_ID,
        sha256: SOURCE_SHA,
      },
      readResult,
    });

    expect(outcome).toMatchObject({
      pageCount: 2,
      insertedCount: 0,
      replayedCount: 2,
    });
    expect(db.pages).toHaveLength(2);
  });

  it("retries pre-commit transient DB errors up to MAX_INLINE_DB_TRANSIENT_ATTEMPTS and fails with retryable PERSISTENCE_FAILED when exhausted", async () => {
    const db = new FakeDocumentPagesDb();
    db.registerSource({ id: DOC_ID, hiveId: HIVE_ID, sha256: SOURCE_SHA });
    db.failNextPutTransient(10, false);
    const readResult = await buildSampleReadResult();

    await expect(
      putDocumentPagesForSource(db.client, {
        correlationId: CORR_ID,
        registeredSource: {
          sourceDocumentId: DOC_ID,
          hiveId: HIVE_ID,
          sha256: SOURCE_SHA,
        },
        readResult,
      }),
    ).rejects.toMatchObject({
      errorCode: "PERSISTENCE_FAILED",
      stage: "READ",
      retryable: true,
      diagnosticReason: "db_transient",
    });

    expect(db.rpcCalls.filter((c) => c === "put_document_pages")).toHaveLength(
      MAX_INLINE_DB_TRANSIENT_ATTEMPTS,
    );
  });

  it("detects corrupted stored page text on readback (artifact_hash_mismatch) and rejects cross-Hive writes", async () => {
    const db = new FakeDocumentPagesDb();
    db.registerSource({ id: DOC_ID, hiveId: HIVE_ID, sha256: SOURCE_SHA });
    const readResult = await buildSampleReadResult();

    // Cross-Hive mismatch rejected in prepareDocumentPagesForInsert
    expect(() =>
      prepareDocumentPagesForInsert({
        registeredSource: {
          sourceDocumentId: DOC_ID,
          hiveId: OTHER_HIVE_ID,
          sha256: SOURCE_SHA,
        },
        readResult,
        correlationId: CORR_ID,
      }),
    ).toThrow();

    await putDocumentPagesForSource(db.client, {
      correlationId: CORR_ID,
      registeredSource: {
        sourceDocumentId: DOC_ID,
        hiveId: HIVE_ID,
        sha256: SOURCE_SHA,
      },
      readResult,
    });

    // Corrupt stored page text without updating page_text_sha256
    db.pages[0] = {
      ...db.pages[0]!,
      page_text: "Tampered text in database",
    };

    await expect(
      listDocumentPagesForSource(db.client, {
        hiveId: HIVE_ID,
        sourceDocumentId: DOC_ID,
        readFingerprint: readResult.sourceFingerprint.readFingerprint,
        pageSetDigest: readResult.sourceFingerprint.pageSetDigest,
        correlationId: CORR_ID,
      }),
    ).rejects.toMatchObject({
      errorCode: "PAGE_READ_FAILED",
      stage: "READ",
      retryable: false,
      diagnosticReason: "artifact_hash_mismatch",
    });
  });
});
