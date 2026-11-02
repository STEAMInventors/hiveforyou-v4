// @vitest-environment jsdom
import type { DocumentRead, DocumentReadStatus, SourceDocument } from "@hiveforyou/contracts";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DOCUMENT_READ_POLL_INTERVAL_MS } from "./document-read-progress";
import { DocumentsPanel } from "./DocumentsPanel";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const READS_URL = `/api/v1/hives/${HIVE_ID}/document-reads`;
const DOCUMENTS_URL = `/api/v1/hives/${HIVE_ID}/source-documents`;
const TERMINAL = new Set<DocumentReadStatus>(["SUCCEEDED", "PARTIAL", "UNREADABLE", "FAILED"]);

function docId(index: number): string {
  return `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
}

function makeDocument(index: number, readStatus: SourceDocument["readStatus"] = "PENDING"): SourceDocument {
  return {
    id: docId(index),
    sourceDocumentId: docId(index),
    hiveId: HIVE_ID,
    clientRequestId: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    fileName: `synthetic-${index}.pdf`,
    mimeType: "application/pdf",
    byteSize: 2048,
    status: "REGISTERED",
    failureReason: null,
    scanStatus: "NOT_SCANNED",
    readStatus,
    registeredAt: "2026-11-01T21:00:00.000Z",
    createdAt: "2026-11-01T21:00:00.000Z",
    updatedAt: "2026-11-01T21:00:00.000Z",
  } as SourceDocument;
}

function makeRead(
  status: DocumentReadStatus,
  index: number,
  overrides: Partial<DocumentRead> = {},
): DocumentRead {
  const finished = TERMINAL.has(status);
  return {
    id: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
    hiveId: HIVE_ID,
    sourceDocumentId: docId(index),
    requestId: "66666666-6666-4666-8666-666666666666",
    attemptNumber: 1,
    status,
    totalPhysicalPages: finished ? 2 : null,
    verifiedPageCount: finished && status !== "FAILED" ? 2 : null,
    unreadablePageCount: null,
    errorCode: status === "FAILED" ? "PAGE_READ_FAILED" : null,
    errorMessageSafe: status === "FAILED" ? "Reading this document timed out. You can try again." : null,
    retryable: status === "FAILED" ? true : null,
    correlationId: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
    createdAt: "2026-11-01T22:00:00.000Z",
    startedAt: status === "QUEUED" ? null : "2026-11-01T22:00:01.000Z",
    updatedAt: new Date().toISOString(),
    finishedAt: finished ? "2026-11-01T22:00:05.000Z" : null,
    ...overrides,
  };
}

type FakeServer = {
  documents: SourceDocument[];
  reads: DocumentRead[];
  posts: Record<string, unknown>[];
  respondToStart: (body: Record<string, unknown>) => Response;
};

let server: FakeServer;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestsTo(url: string, method = "GET"): number {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([input, init]) => String(input) === url && (init?.method ?? "GET") === method).length;
}

async function poll(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(DOCUMENT_READ_POLL_INTERVAL_MS);
  });
}

function modal(): HTMLElement {
  return screen.getByTestId("read-documents-modal");
}

function renderPanel(): void {
  render(<DocumentsPanel hiveId={HIVE_ID} initialDocuments={server.documents} />);
}

describe("DocumentsPanel — Read Documents", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    sessionStorage.clear();
    server = {
      documents: [makeDocument(0), makeDocument(1)],
      reads: [],
      posts: [],
      respondToStart: () => json({ documentReads: server.reads, created: false }, 202),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === READS_URL && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          server.posts.push(body);
          return server.respondToStart(body);
        }
        if (url === READS_URL) {
          return json({ documentReads: server.reads });
        }
        if (url === DOCUMENTS_URL) {
          return json({ sourceDocuments: server.documents });
        }
        if (url === "/api/v1/upload-quota") {
          return json({
            quota: {
              limit: 50,
              used: 2,
              remaining: 48,
              periodStart: "2026-11-01T00:00:00.000Z",
              periodEnd: "2026-12-01T00:00:00.000Z",
            },
          });
        }
        return json({ error: { errorCode: "NOT_FOUND", message: "Not found" } }, 404);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts genuine reading once, follows recorded statuses and confirms success from the server", async () => {
    server.respondToStart = () => {
      server.reads = [makeRead("QUEUED", 0), makeRead("QUEUED", 1)];
      return json({ documentReads: server.reads, created: true }, 202);
    };
    renderPanel();
    const button = await screen.findByRole("button", { name: "Read Documents" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    screen.getByText("2 documents need reading.");

    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole("heading", { name: "Getting started" });
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]!.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(server.posts[0]).not.toHaveProperty("sourceDocumentIds");

    server.reads = [makeRead("SAVING", 0, { totalPhysicalPages: 2 }), makeRead("READING", 1)];
    await poll();
    await within(modal()).findByRole("heading", { name: "Reading your documents" });
    expect(
      within(modal())
        .getAllByTestId("read-document-row")
        .map((row) => row.getAttribute("data-status")),
    ).toEqual(["SAVING", "READING"]);
    expect(within(modal()).getByTestId("read-count").textContent).toBe("0");

    server.reads = [makeRead("VERIFYING", 0, { totalPhysicalPages: 2 }), makeRead("VERIFYING", 1)];
    await poll();
    await within(modal()).findAllByText("Checking the saved pages.");

    const documentLoadsBeforeSettle = requestsTo(DOCUMENTS_URL);
    server.reads = [makeRead("SUCCEEDED", 0), makeRead("SUCCEEDED", 1)];
    server.documents = [makeDocument(0, "SUCCEEDED"), makeDocument(1, "SUCCEEDED")];
    await poll();
    await within(modal()).findByRole("heading", { name: "All 2 documents are read" });
    expect(within(modal()).getByTestId("read-count").textContent).toBe("2");
    await vi.waitFor(() => expect(requestsTo(DOCUMENTS_URL)).toBe(documentLoadsBeforeSettle + 1));

    const pollsAfterSettle = requestsTo(READS_URL);
    await poll();
    await poll();
    expect(requestsTo(READS_URL)).toBe(pollsAfterSettle);

    fireEvent.click(within(modal()).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("read-documents-modal")).toBeNull();
    expect((screen.getByRole("button", { name: "Read Documents" }) as HTMLButtonElement).disabled).toBe(true);
    screen.getByText("Every added document has been read.");
    expect(screen.getAllByText("Read").length).toBe(2);
  });

  it("disables Read Documents when no registered document needs reading", async () => {
    server.documents = [makeDocument(0, "SUCCEEDED"), { ...makeDocument(1), status: "REJECTED" } as SourceDocument];
    renderPanel();
    const button = await screen.findByRole("button", { name: "Read Documents" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(server.posts).toHaveLength(0);
  });

  it("reattaches to reading that is still running after a page refresh", async () => {
    server.reads = [makeRead("READING", 0), makeRead("QUEUED", 1)];
    renderPanel();
    await screen.findByRole("heading", { name: "Reading your documents" });
    expect(screen.queryByRole("button", { name: "Read Documents" })).toBeNull();

    fireEvent.click(within(modal()).getByRole("button", { name: "Run in background" }));
    expect(screen.queryByTestId("read-documents-modal")).toBeNull();
    screen.getByText("Reading is in progress. You can leave this page; it keeps going.");

    cleanup();
    renderPanel();
    const showProgress = await screen.findByRole("button", { name: "Show reading progress" });
    expect(screen.queryByTestId("read-documents-modal")).toBeNull();

    server.reads = [makeRead("SAVING", 0, { totalPhysicalPages: 2 }), makeRead("READING", 1)];
    await poll();
    fireEvent.click(showProgress);
    await within(modal()).findByText("Saving 2 pages.");
  });

  it("explains a failed document and retries only that document", async () => {
    server.reads = [makeRead("READING", 0), makeRead("READING", 1)];
    renderPanel();
    await screen.findByRole("heading", { name: "Reading your documents" });

    server.reads = [makeRead("SUCCEEDED", 0), makeRead("FAILED", 1)];
    server.documents = [makeDocument(0, "SUCCEEDED"), makeDocument(1, "FAILED")];
    await poll();
    await within(modal()).findByRole("heading", { name: "Reading didn't finish" });
    within(modal()).getByText("Support reference: 77777777-7777-4777-8777-000000000001");

    server.respondToStart = () => {
      server.reads = [
        makeRead("SUCCEEDED", 0),
        makeRead("QUEUED", 1, { id: "55555555-5555-4555-8555-999999999999", attemptNumber: 2 }),
      ];
      return json({ documentReads: server.reads, created: true }, 202);
    };
    fireEvent.click(within(modal()).getByRole("button", { name: "Try again" }));
    await within(modal()).findByRole("heading", { name: "Reading your documents" });
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]!.sourceDocumentIds).toEqual([docId(1)]);
  });

  it("shows an actionable error with a support reference when reading cannot start", async () => {
    server.respondToStart = () =>
      json(
        {
          error: {
            errorCode: "PERSISTENCE_FAILED",
            message: "We couldn't start reading right now. Try again.",
            retryable: true,
            correlationId: "88888888-8888-4888-8888-888888888888",
          },
        },
        503,
      );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Read Documents" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("We couldn't start reading right now. Try again.");
    expect(alert.textContent).toContain("Support reference: 88888888-8888-4888-8888-888888888888");
    expect(screen.queryByTestId("read-documents-modal")).toBeNull();
    expect((screen.getByRole("button", { name: "Read Documents" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a reconnecting notice after repeated polling failures without losing progress", async () => {
    server.reads = [makeRead("READING", 0)];
    renderPanel();
    await screen.findByRole("heading", { name: "Reading your documents" });

    vi.mocked(fetch).mockImplementation(async () => {
      throw new TypeError("network down");
    });
    await poll();
    await poll();
    await poll();
    await within(modal()).findByText(/trouble reaching HiveForYou/);
    expect(within(modal()).getAllByTestId("read-document-row")[0]!.getAttribute("data-status")).toBe("READING");
  });
});
