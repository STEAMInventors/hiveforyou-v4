import type { DocumentReadStatus } from "@hiveforyou/contracts";
import {
  computePageSetDigest,
  computeReadFingerprint,
  computeSha256Digest,
  READER_WIRE_CONTRACT_VERSION,
} from "@hiveforyou/contracts/document-read";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listDocumentReads,
  processDocumentRead,
  processDocumentReads,
  startDocumentReads,
  type DocumentReadRpcClient,
} from "./document-reads";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_HIVE_ID = "99999999-9999-4999-8999-999999999999";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const DOC_ID = "33333333-3333-4333-8333-333333333333";
const CORRELATION_ID = "44444444-4444-4444-8444-444444444444";
const READ_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const SOURCE_SHA = "a".repeat(64);
const STORAGE_PATH = `${OWNER_ID}/${HIVE_ID}/${DOC_ID}/original`;
const PAGE_ONE = "Synthetic page one text with sufficient alphanumeric density for Reader verification.";
const PAGE_TWO = "Synthetic page two text with sufficient alphanumeric density for Reader verification.";

const ACTIVE = ["QUEUED", "READING", "SAVING", "VERIFYING"];
const ALLOWED: Record<string, string[]> = {
  QUEUED: ["READING", "FAILED"],
  READING: ["SAVING", "UNREADABLE", "FAILED"],
  SAVING: ["VERIFYING", "FAILED"],
  VERIFYING: ["SUCCEEDED", "PARTIAL", "UNREADABLE", "FAILED"],
};

type ReadRow = {
  id: string;
  hive_id: string;
  source_document_id: string;
  status: string;
  attempt_number: number;
  correlation_id: string;
  details: Record<string, unknown>;
};

type PageRow = {
  id: string;
  hive_id: string;
  source_document_id: string;
  source_sha256: string;
  read_fingerprint: string;
  page_set_digest: string;
  page_count: number;
  page_number: number;
  page_text: string;
  page_text_sha256: string;
  page_byte_length: number;
  extraction_method: string;
  extraction_status: "SUCCEEDED";
  provenance_json: unknown;
  created_at: string;
};

/** In-memory stand-in for the transition / put / list RPCs, enforcing the migration's rules. */
class FakeReadDb implements DocumentReadRpcClient {
  readonly reads = new Map<string, ReadRow>();
  readonly pages: PageRow[] = [];
  readonly history: string[] = [];
  sourceReadStatus = "PENDING";
  sourceHiveId = HIVE_ID;
  failPutOnce: string | null = null;
  tamperReadback = false;
  calls: string[] = [];

  constructor() {
    this.reads.set(READ_ID, {
      id: READ_ID,
      hive_id: HIVE_ID,
      source_document_id: DOC_ID,
      status: "QUEUED",
      attempt_number: 1,
      correlation_id: CORRELATION_ID,
      details: {},
    });
  }

  addRead(id: string, status = "QUEUED") {
    this.reads.set(id, { ...this.reads.get(READ_ID)!, id, status });
  }

  private readJson(row: ReadRow) {
    return {
      id: row.id,
      hiveId: row.hive_id,
      sourceDocumentId: row.source_document_id,
      requestId: REQUEST_ID,
      attemptNumber: row.attempt_number,
      status: row.status,
      totalPhysicalPages: row.details.total_physical_pages ?? null,
      verifiedPageCount: row.details.verified_page_count ?? null,
      unreadablePageCount: row.details.unreadable_page_count ?? null,
      errorCode: row.details.error_code ?? null,
      errorMessageSafe: row.details.error_message_safe ?? null,
      retryable: row.details.retryable ?? null,
      correlationId: row.correlation_id,
      createdAt: "2026-11-01T22:00:00.000Z",
      startedAt: null,
      updatedAt: "2026-11-01T22:00:01.000Z",
      finishedAt: ACTIVE.includes(row.status) ? null : "2026-11-01T22:00:02.000Z",
    };
  }

  async rpc(fn: string, args: Record<string, unknown> = {}) {
    this.calls.push(fn);
    try {
      return { data: this.handle(fn, args), error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  }

  private handle(fn: string, args: Record<string, unknown>): unknown {
    if (fn === "transition_document_read") {
      return this.transition(args);
    }
    if (fn === "put_document_pages") {
      return this.putPages(args);
    }
    if (fn === "list_document_pages") {
      return this.listPages(args);
    }
    throw new Error(`unexpected rpc ${fn}`);
  }

  private transition(args: Record<string, unknown>) {
    const row = this.reads.get(args.p_read_id as string);
    if (!row) {
      throw new Error("document_read_not_found");
    }
    if (row.status !== args.p_from_status) {
      return { applied: false, documentRead: this.readJson(row) };
    }
    const to = args.p_to_status as string;
    if (!ALLOWED[row.status]?.includes(to)) {
      throw new Error("document_read_transition_invalid");
    }
    const details = args.p_details as Record<string, unknown>;
    if (["SUCCEEDED", "PARTIAL"].includes(to) || (to === "UNREADABLE" && row.status === "VERIFYING")) {
      const saved = this.pages.filter((p) => p.page_set_digest === details.page_set_digest).length;
      if (!details.verified_page_count || saved !== details.verified_page_count) {
        throw new Error("page_generation_incomplete");
      }
    }
    row.status = to;
    row.details = { ...row.details, ...details };
    this.history.push(to);
    if (!ACTIVE.includes(to)) {
      this.sourceReadStatus = to;
    }
    return {
      applied: true,
      documentRead: this.readJson(row),
      ...(to === "READING"
        ? {
            source: {
              source_document_id: DOC_ID,
              hive_id: this.sourceHiveId,
              owner_user_id: OWNER_ID,
              file_name: "synthetic-document.pdf",
              mime_type: "application/pdf",
              byte_size: 4096,
              sha256: SOURCE_SHA,
              storage_bucket: "hive-source-documents",
              storage_path: STORAGE_PATH,
              page_count: 2,
            },
          }
        : {}),
    };
  }

  private putPages(args: Record<string, unknown>) {
    if (this.failPutOnce) {
      const message = this.failPutOnce;
      this.failPutOnce = null;
      throw new Error(message);
    }
    const pages = args.p_pages as Array<Record<string, unknown>>;
    let inserted = 0;
    for (const page of pages) {
      const exists = this.pages.some(
        (p) => p.page_set_digest === args.p_page_set_digest && p.page_number === page.page_number,
      );
      if (!exists) {
        inserted += 1;
        this.pages.push({
          id: `page-${this.pages.length + 1}`,
          hive_id: args.p_hive_id as string,
          source_document_id: args.p_source_document_id as string,
          source_sha256: args.p_source_sha256 as string,
          read_fingerprint: args.p_read_fingerprint as string,
          page_set_digest: args.p_page_set_digest as string,
          page_count: args.p_page_count as number,
          page_number: page.page_number as number,
          page_text: page.page_text as string,
          page_text_sha256: page.page_text_sha256 as string,
          page_byte_length: page.page_byte_length as number,
          extraction_method: page.extraction_method as string,
          extraction_status: "SUCCEEDED",
          provenance_json: page.provenance_json,
          created_at: "2026-11-01T22:00:03.000Z",
        });
      }
    }
    return {
      hive_id: args.p_hive_id,
      inserted_count: inserted,
      replayed_count: pages.length - inserted,
    };
  }

  private listPages(args: Record<string, unknown>) {
    let pages = this.pages
      .filter((p) => p.page_set_digest === args.p_page_set_digest)
      .sort((a, b) => a.page_number - b.page_number);
    if (this.tamperReadback) {
      pages = pages.map((p) =>
        p.page_number === 2
          ? { ...p, page_text: "Different text.", page_text_sha256: computeSha256Digest("Different text."), page_byte_length: 15 }
          : p,
      );
    }
    return {
      found: pages.length > 0,
      source_document_id: args.p_source_document_id,
      hive_id: args.p_hive_id,
      source_sha256: SOURCE_SHA,
      read_fingerprint: args.p_read_fingerprint,
      page_set_digest: args.p_page_set_digest,
      read_status: this.sourceReadStatus,
      total_physical_pages: 2,
      pages,
    };
  }
}

function wirePage(pageNumber: number, text: string, readable = true) {
  return {
    page_number: pageNumber,
    text,
    extraction_method: "pdf_native",
    quality: { character_count: text.length, identity_text_sufficient: readable, issues: [] },
  };
}

function wireResponse(pages = [wirePage(1, PAGE_ONE), wirePage(2, PAGE_TWO)]) {
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
    page_count: pages.length,
    pages,
    provenance: { reader_git_sha: "abc1234", reader_version: "0.1.0", tools: { hive_reader: "0.1.0" }, model_calls: [] },
    read_fingerprint: computeReadFingerprint({
      sourceSha256: SOURCE_SHA,
      options: { docx_page_break_strategy: "reproducible_v1", max_pages: 500, ocr_mode: "selective" },
    }),
  };
}

function readerReturning(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function deps(db: FakeReadDb, fetchFn: typeof fetch) {
  return {
    client: db,
    reader: { fetchFn, getReaderConfig: () => ({ baseUrl: "https://reader.test", serviceToken: "synthetic" }) },
  };
}

describe("processDocumentRead", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("records each stage and marks success only after the saved pages read back", async () => {
    const db = new FakeReadDb();
    const fetchFn = readerReturning(200, wireResponse());

    const status = await processDocumentRead(deps(db, fetchFn as unknown as typeof fetch), READ_ID);

    expect(status).toBe("SUCCEEDED");
    expect(db.history).toEqual(["READING", "SAVING", "VERIFYING", "SUCCEEDED"]);
    expect(db.calls.indexOf("list_document_pages")).toBeGreaterThan(db.calls.indexOf("put_document_pages"));
    expect(db.sourceReadStatus).toBe("SUCCEEDED");
    expect(db.reads.get(READ_ID)!.details).toMatchObject({ verified_page_count: 2, total_physical_pages: 2 });

    const stored = db.pages.sort((a, b) => a.page_number - b.page_number);
    expect(stored.map((p) => p.page_text)).toEqual([PAGE_ONE, PAGE_TWO]);
    expect(stored.map((p) => p.page_text_sha256)).toEqual([
      computeSha256Digest(PAGE_ONE),
      computeSha256Digest(PAGE_TWO),
    ]);
    expect(stored[0]!.page_set_digest).toBe(
      computePageSetDigest({ sourceSha256: SOURCE_SHA, pageCount: 2, pages: stored }),
    );
    expect(stored[0]!.provenance_json).toMatchObject({ quality: { identityTextSufficient: true } });
  });

  it("never writes page text to logs", async () => {
    const db = new FakeReadDb();
    await processDocumentRead(deps(db, readerReturning(200, wireResponse()) as unknown as typeof fetch), READ_ID);
    const lines = logSpy.mock.calls.map((call) => String(call[0]));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => line.includes("Synthetic page"))).toBe(false);
  });

  it("ends PARTIAL when some pages have no readable text", async () => {
    const db = new FakeReadDb();
    const fetchFn = readerReturning(200, wireResponse([wirePage(1, PAGE_ONE), wirePage(2, "", false)]));
    expect(await processDocumentRead(deps(db, fetchFn as unknown as typeof fetch), READ_ID)).toBe("PARTIAL");
    expect(db.reads.get(READ_ID)!.details).toMatchObject({ unreadable_page_count: 1, verified_page_count: 2 });
  });

  it("ends UNREADABLE with saved pages when no page has readable text", async () => {
    const db = new FakeReadDb();
    const fetchFn = readerReturning(200, wireResponse([wirePage(1, "", false), wirePage(2, "", false)]));
    expect(await processDocumentRead(deps(db, fetchFn as unknown as typeof fetch), READ_ID)).toBe("UNREADABLE");
    expect(db.history).toEqual(["READING", "SAVING", "VERIFYING", "UNREADABLE"]);
    expect(db.reads.get(READ_ID)!.details).toMatchObject({ error_code: "DOCUMENT_UNREADABLE", retryable: false });
  });

  it("ends UNREADABLE without pages when the Reader rejects the file", async () => {
    const db = new FakeReadDb();
    const fetchFn = readerReturning(422, { error_code: "EXTRACTION_FAILED", retryable: false });
    expect(await processDocumentRead(deps(db, fetchFn as unknown as typeof fetch), READ_ID)).toBe("UNREADABLE");
    expect(db.history).toEqual(["READING", "UNREADABLE"]);
    expect(db.pages).toHaveLength(0);
  });

  it("ends FAILED and retryable when the Reader is unavailable", async () => {
    const db = new FakeReadDb();
    const fetchFn = readerReturning(503, { error_code: "DEPENDENCY_UNAVAILABLE", retryable: true });
    expect(await processDocumentRead(deps(db, fetchFn as unknown as typeof fetch), READ_ID)).toBe("FAILED");
    expect(db.history).toEqual(["READING", "FAILED"]);
    expect(db.sourceReadStatus).toBe("FAILED");
    expect(db.reads.get(READ_ID)!.details).toMatchObject({ error_code: "PAGE_READ_FAILED", retryable: true });
  });

  it("ends FAILED with a timeout message when the Reader times out", async () => {
    const db = new FakeReadDb();
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const fetchFn = vi.fn(async () => {
      throw timeout;
    });
    expect(await processDocumentRead(deps(db, fetchFn as unknown as typeof fetch), READ_ID)).toBe("FAILED");
    expect(db.reads.get(READ_ID)!.details.error_message_safe).toMatch(/timed out/);
  });

  it("ends FAILED, never SUCCEEDED, when the pages read back differ from what was read", async () => {
    const db = new FakeReadDb();
    db.tamperReadback = true;
    const fetchFn = readerReturning(200, wireResponse());
    expect(await processDocumentRead(deps(db, fetchFn as unknown as typeof fetch), READ_ID)).toBe("FAILED");
    expect(db.history).toEqual(["READING", "SAVING", "VERIFYING", "FAILED"]);
    expect(db.history).not.toContain("SUCCEEDED");
    expect(db.sourceReadStatus).toBe("FAILED");
    expect(db.reads.get(READ_ID)!.details).toMatchObject({ error_code: "PERSISTENCE_FAILED", retryable: true });
  });

  it("recovers from a transient save failure without duplicating pages", async () => {
    const db = new FakeReadDb();
    db.failPutOnce = "fetch failed";
    const fetchFn = readerReturning(200, wireResponse());
    expect(await processDocumentRead(deps(db, fetchFn as unknown as typeof fetch), READ_ID)).toBe("SUCCEEDED");
    expect(db.pages).toHaveLength(2);
  });

  it("does nothing when another worker already claimed the read", async () => {
    const db = new FakeReadDb();
    db.reads.get(READ_ID)!.status = "READING";
    const fetchFn = readerReturning(200, wireResponse());
    expect(await processDocumentRead(deps(db, fetchFn as unknown as typeof fetch), READ_ID)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(db.history).toEqual([]);
  });

  it("refuses a claimed source that belongs to another Hive", async () => {
    const db = new FakeReadDb();
    db.sourceHiveId = OTHER_HIVE_ID;
    const fetchFn = readerReturning(200, wireResponse());
    expect(await processDocumentRead(deps(db, fetchFn as unknown as typeof fetch), READ_ID)).toBe("FAILED");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(db.reads.get(READ_ID)!.details).toMatchObject({ error_code: "SOURCE_ACCESS_DENIED", retryable: false });
  });
});

describe("processDocumentReads", () => {
  it("processes each queued read once with bounded concurrency", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = new FakeReadDb();
    const ids = [
      "aaaaaaaa-0000-4000-8000-000000000001",
      "aaaaaaaa-0000-4000-8000-000000000002",
      "aaaaaaaa-0000-4000-8000-000000000003",
    ];
    ids.forEach((id) => db.addRead(id));
    db.reads.delete(READ_ID);
    let inFlight = 0;
    let peak = 0;
    const fetchFn = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return new Response(JSON.stringify(wireResponse()), { status: 200 });
    });

    await processDocumentReads(
      { ...deps(db, fetchFn as unknown as typeof fetch), concurrency: 2 },
      [...ids, ids[0]!],
    );

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(peak).toBeLessThanOrEqual(2);
    expect([...db.reads.values()].map((r) => r.status as DocumentReadStatus)).toEqual([
      "SUCCEEDED",
      "SUCCEEDED",
      "SUCCEEDED",
    ]);
    logSpy.mockRestore();
  });
});

describe("startDocumentReads / listDocumentReads", () => {
  const sampleRead = {
    id: READ_ID,
    hiveId: HIVE_ID,
    sourceDocumentId: DOC_ID,
    requestId: REQUEST_ID,
    attemptNumber: 1,
    status: "QUEUED",
    totalPhysicalPages: null,
    verifiedPageCount: null,
    unreadablePageCount: null,
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: CORRELATION_ID,
    createdAt: "2026-11-01T22:00:00.000Z",
    startedAt: null,
    updatedAt: "2026-11-01T22:00:00.000Z",
    finishedAt: null,
  };

  function userClient(result: { data: unknown; error: { message: string } | null }) {
    return { rpc: vi.fn(async () => result) };
  }

  it("rejects an invalid body before calling the database", async () => {
    const client = userClient({ data: null, error: null });
    await expect(
      startDocumentReads(client, { hiveId: HIVE_ID, rawBody: { clientRequestId: "x" }, correlationId: CORRELATION_ID }),
    ).rejects.toMatchObject({ errorCode: "INVALID_REQUEST" });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("passes the request ID and returns only well-formed queued IDs", async () => {
    const client = userClient({
      data: { documentReads: [sampleRead, { id: "bad" }], queuedReadIds: [READ_ID, "bad"], created: 1 },
      error: null,
    });
    const result = await startDocumentReads(client, {
      hiveId: HIVE_ID,
      rawBody: { clientRequestId: REQUEST_ID },
      correlationId: CORRELATION_ID,
    });
    expect(client.rpc).toHaveBeenCalledWith("start_document_reads", {
      p_hive_id: HIVE_ID,
      p_request_id: REQUEST_ID,
      p_correlation_id: CORRELATION_ID,
      p_source_document_ids: null,
    });
    expect(result.queuedReadIds).toEqual([READ_ID]);
    expect(result.response.documentReads).toHaveLength(1);
    expect(result.response.created).toBe(1);
  });

  it("maps another owner's Hive to NOT_FOUND", async () => {
    const client = userClient({ data: null, error: { message: "hive_not_found" } });
    await expect(listDocumentReads(client, { hiveId: HIVE_ID, correlationId: CORRELATION_ID })).rejects.toMatchObject({
      errorCode: "NOT_FOUND",
    });
  });

  it("maps database outages to a retryable error", async () => {
    const client = userClient({ data: null, error: { message: "connection refused" } });
    await expect(
      startDocumentReads(client, { hiveId: HIVE_ID, rawBody: { clientRequestId: REQUEST_ID }, correlationId: CORRELATION_ID }),
    ).rejects.toMatchObject({ errorCode: "PERSISTENCE_FAILED", retryable: true });
  });
});
