// @vitest-environment jsdom
import type { CoverageGap, SourceDocument } from "@hiveforyou/contracts";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DOCUMENT_READ_POLL_INTERVAL_MS } from "./document-read-progress";
import { DocumentsPanel } from "./DocumentsPanel";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const STUDY_URL = `/api/v1/hives/${HIVE_ID}/study-preparation`;
const ACKNOWLEDGE_URL = `${STUDY_URL}/acknowledge`;
const DOCUMENTS_URL = `/api/v1/hives/${HIVE_ID}/source-documents`;
const RUN_ID = "88888888-8888-4888-8888-888888888888";
const REVISION_ID = "dddddddd-0000-4000-8000-000000000001";
const ELIGIBILITY_DIGEST = `sha256:${"e".repeat(64)}`;
const RUN_DIGEST = `sha256:${"f".repeat(64)}`;

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

function pagesNotRead(index: number, acknowledged = false): CoverageGap {
  return {
    key: `PAGES_NOT_READ:${docId(index)}:${"a".repeat(64)}`,
    sourceDocumentId: docId(index),
    fileName: `synthetic-${index}.pdf`,
    reason: "PAGES_NOT_READ",
    pageNumbers: [3],
    material: true,
    acknowledged,
  };
}

type FakeServer = {
  documents: SourceDocument[];
  analysisRunStatus: string | null;
  analysisPosts: Record<string, unknown>[];
  acknowledgePosts: Record<string, unknown>[];
  readDocuments: number;
  unreadDocuments: number;
  eligibilityGaps: CoverageGap[];
  runGaps: CoverageGap[];
  reportStatuses: { CUSTOMER: string; PRO: string } | null;
};

let server: FakeServer;

function analysisRun(status: string) {
  const frozen = status !== "READING_DOCUMENTS" && status !== "QUEUED";
  const material = server.runGaps.some((gap) => gap.material);
  return {
    id: RUN_ID,
    hiveId: HIVE_ID,
    kind: "STUDY_PREPARATION",
    requestId: "99999999-9999-4999-8999-999999999999",
    attemptNumber: 1,
    status,
    authorizedSourceDocumentIds: [docId(0)],
    intentRequestIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    coverageComplete: server.runGaps.length === 0,
    coverageAcknowledged: false,
    coverageDigest: frozen ? RUN_DIGEST : null,
    coverageStatus: frozen ? (material ? "MATERIAL_GAPS" : "COMPLETE") : null,
    coverageGaps: frozen ? server.runGaps : [],
    coverageAcknowledgement: frozen
      ? status === "AWAITING_ACKNOWLEDGEMENT"
        ? "PENDING"
        : material
          ? "OWNER"
          : "NOT_REQUIRED"
      : null,
    coverageAcknowledgedAt: frozen && material && status !== "AWAITING_ACKNOWLEDGEMENT" ? "2026-11-01T22:01:00.000Z" : null,
    snapshotFrozen: frozen,
    stageAttempt: 1,
    stageMetrics: [],
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    createdAt: "2026-11-01T22:00:00.000Z",
    startedAt: null,
    updatedAt: "2026-11-01T22:00:00.000Z",
    finishedAt: null,
  };
}

function reportRun(audience: "CUSTOMER" | "PRO", status: string) {
  return {
    id: audience === "CUSTOMER" ? "cccccccc-0000-4000-8000-000000000001" : "cccccccc-0000-4000-8000-000000000002",
    hiveId: HIVE_ID,
    studyRevisionId: REVISION_ID,
    audience,
    trigger: "STUDY_ACCEPTED",
    status,
    attemptCount: 1,
    maxAttempts: 3,
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    reportId: status === "SUCCEEDED" ? "eeeeeeee-0000-4000-8000-000000000001" : null,
    createdAt: "2026-11-01T22:00:00.000Z",
    finishedAt: null,
  };
}

function studyPreparationBody() {
  const reports = server.reportStatuses;
  return {
    processingRun: server.analysisRunStatus ? analysisRun(server.analysisRunStatus) : null,
    preview: null,
    previewSummary: null,
    staleness: null,
    eligibility: {
      documents: Array.from({ length: server.readDocuments }, (_, index) => ({
        sourceDocumentId: docId(index),
        fileName: `synthetic-${index}.pdf`,
        readStatus: "SUCCEEDED",
        missingPageNumbers: [],
        emptyPageNumbers: [],
      })),
      excluded: Array.from({ length: server.unreadDocuments }, (_, index) => ({
        sourceDocumentId: docId(server.readDocuments + index),
        fileName: `synthetic-${server.readDocuments + index}.pdf`,
        reason: "NOT_READ",
      })),
      coverageComplete: server.unreadDocuments === 0 && server.eligibilityGaps.length === 0,
      activeReadCount: 0,
      coverageDigest: ELIGIBILITY_DIGEST,
      gaps: server.eligibilityGaps,
    },
    studyRevision: reports
      ? {
          id: REVISION_ID,
          canonicalStudyId: "ffffffff-0000-4000-8000-000000000001",
          revisionNumber: 1,
          predecessorRevisionId: null,
          processingRunId: RUN_ID,
          coverageComplete: true,
          coverageStatus: "COMPLETE",
          coverageGaps: [],
          coverageAcknowledgement: "NOT_REQUIRED",
          createdAt: "2026-11-01T22:00:00.000Z",
        }
      : null,
    reportRuns: reports ? [reportRun("CUSTOMER", reports.CUSTOMER), reportRun("PRO", reports.PRO)] : [],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function poll(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(DOCUMENT_READ_POLL_INTERVAL_MS);
  });
}

function renderPanel(): void {
  render(<DocumentsPanel hiveId={HIVE_ID} initialDocuments={server.documents} />);
}

const READY_HINT = "Ready to analyze. Documents not read yet are read first.";

describe("DocumentsPanel — Analyze", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    sessionStorage.clear();
    server = {
      documents: [makeDocument(0, "SUCCEEDED")],
      analysisRunStatus: null,
      analysisPosts: [],
      acknowledgePosts: [],
      readDocuments: 1,
      unreadDocuments: 0,
      eligibilityGaps: [],
      runGaps: [],
      reportStatuses: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === STUDY_URL && init?.method === "POST") {
          server.analysisPosts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          server.analysisRunStatus = server.unreadDocuments > 0 ? "READING_DOCUMENTS" : "QUEUED";
          return json({ processingRun: analysisRun(server.analysisRunStatus), created: true }, 202);
        }
        if (url === ACKNOWLEDGE_URL && init?.method === "POST") {
          server.acknowledgePosts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          server.analysisRunStatus = "UNDERSTANDING_REQUEST";
          return json({ processingRun: analysisRun(server.analysisRunStatus), resumed: true }, 202);
        }
        if (url === STUDY_URL) return json(studyPreparationBody());
        if (url === DOCUMENTS_URL) return json({ sourceDocuments: server.documents });
        return json({ error: { errorCode: "NOT_FOUND", message: "Not found" } }, 404);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("offers Analyze as the only way to process documents", async () => {
    renderPanel();
    await screen.findByText(READY_HINT);
    expect(screen.queryByRole("button", { name: "Read Documents" })).toBeNull();
    expect((screen.getByTestId("analyze-button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("is unavailable until a document is uploaded", async () => {
    server.documents = [makeDocument(0)];
    server.readDocuments = 0;
    renderPanel();
    await screen.findByText("Upload a document, then analyze.");
    expect((screen.getByTestId("analyze-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("reads unread documents without blanket consent, pauses on newly found material gaps, and continues the same run on acknowledgement", async () => {
    server.documents = [makeDocument(0)];
    server.readDocuments = 0;
    server.unreadDocuments = 1;
    renderPanel();
    await screen.findByText("1 document isn't read yet. Analyze reads it first.");

    fireEvent.click(screen.getByTestId("analyze-button"));
    await within(await screen.findByTestId("analyze-modal")).findByRole("heading", { name: "Reading your documents…" });
    expect(server.analysisPosts).toEqual([{ clientRequestId: expect.any(String) }]);

    server.readDocuments = 1;
    server.unreadDocuments = 0;
    server.runGaps = [pagesNotRead(0)];
    server.analysisRunStatus = "AWAITING_ACKNOWLEDGEMENT";
    await poll();
    const dialog = screen.getByTestId("analyze-modal");
    await within(dialog).findByRole("heading", { name: "Some content couldn't be read" });
    expect(within(dialog).getByRole("list", { name: "Missing content" }).textContent).toContain("Some pages weren't read: 3.");

    fireEvent.click(within(dialog).getByTestId("analyze-acknowledge"));
    await within(screen.getByTestId("analyze-modal")).findByRole("heading", { name: "Understanding your request…" });
    expect(server.acknowledgePosts).toEqual([{ processingRunId: RUN_ID, coverageDigest: RUN_DIGEST }]);
    expect(server.analysisPosts).toHaveLength(1);
  });

  it("asks for acknowledgement of known material gaps before starting, and sends the reviewed digest", async () => {
    server.eligibilityGaps = [pagesNotRead(0)];
    renderPanel();
    await screen.findByText("Ready to analyze. Some content is missing; you'll review it first.");

    fireEvent.click(screen.getByTestId("analyze-button"));
    const dialog = await screen.findByTestId("analyze-modal");
    within(dialog).getByRole("heading", { name: "Some content is missing" });
    expect(server.analysisPosts).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Analyze what was read" }));
    await within(screen.getByTestId("analyze-modal")).findByRole("heading", { name: "Getting ready…" });
    expect(server.analysisPosts).toEqual([
      { clientRequestId: expect.any(String), coverageAcknowledgementDigest: ELIGIBILITY_DIGEST },
    ]);
  });

  it("reuses a previously acknowledged gap and starts directly", async () => {
    server.eligibilityGaps = [pagesNotRead(0, true)];
    renderPanel();
    await screen.findByText(READY_HINT);
    fireEvent.click(screen.getByTestId("analyze-button"));
    await within(await screen.findByTestId("analyze-modal")).findByRole("heading", { name: "Getting ready…" });
    expect(server.analysisPosts).toEqual([{ clientRequestId: expect.any(String) }]);
  });

  it("follows the recorded stages through the Study to both reports", async () => {
    renderPanel();
    await screen.findByText(READY_HINT);
    fireEvent.click(screen.getByTestId("analyze-button"));
    const dialog = await screen.findByTestId("analyze-modal");
    await within(dialog).findByRole("heading", { name: "Getting ready…" });
    expect(server.analysisPosts).toHaveLength(1);
    expect(server.analysisPosts[0]).not.toHaveProperty("coverageAcknowledgementDigest");

    server.analysisRunStatus = "INVESTIGATING";
    await poll();
    await within(screen.getByTestId("analyze-modal")).findByRole("heading", { name: "Investigating your documents…" });

    server.analysisRunStatus = "SUCCEEDED";
    server.reportStatuses = { CUSTOMER: "WRITING", PRO: "QUEUED" };
    await poll();
    await within(screen.getByTestId("analyze-modal")).findByRole("heading", { name: "Your study is complete" });
    expect(screen.queryByTestId("analyze-open-reports")).toBeNull();

    server.reportStatuses = { CUSTOMER: "SUCCEEDED", PRO: "FAILED" };
    await poll();
    const link = await screen.findByTestId("analyze-open-reports");
    expect(link.getAttribute("href")).toBe(`/hives/${HIVE_ID}/reports`);
    const rows = within(screen.getByTestId("analyze-reports")).getAllByRole("listitem");
    expect(rows.map((row) => row.dataset.state)).toEqual(["ready", "failed"]);
  });

  it("reopens progress for an analysis that is still running after a refresh", async () => {
    server.analysisRunStatus = "BUILDING_PROMPT";
    renderPanel();
    const dialog = await screen.findByTestId("analyze-modal");
    await within(dialog).findByRole("heading", { name: "Constructing your study prompt…" });
    expect(screen.queryByTestId("analyze-button")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Run in background" }));
    expect(screen.queryByTestId("analyze-modal")).toBeNull();
    screen.getByRole("button", { name: "Show analysis progress" });
  });

  it("reopens the coverage review for a paused analysis after a refresh", async () => {
    server.runGaps = [pagesNotRead(0)];
    server.analysisRunStatus = "AWAITING_ACKNOWLEDGEMENT";
    renderPanel();
    const dialog = await screen.findByTestId("analyze-modal");
    await within(dialog).findByRole("heading", { name: "Some content couldn't be read" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("analyze-modal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review missing content" }));
    await screen.findByTestId("analyze-acknowledge");
  });
});
