// @vitest-environment jsdom
import type { CoverageGap, SourceDocument } from "@hiveforyou/contracts";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import { bankruptcyC13Fixture } from "@/components/study/fixtures/bankruptcy-c13";
import { studyDocumentMeta } from "@/components/study/study-summary";

import { DOCUMENT_READ_POLL_INTERVAL_MS } from "./document-read-progress";
import { DocumentsPanel } from "./DocumentsPanel";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const STUDY_URL = `/api/v1/hives/${HIVE_ID}/study-preparation`;
const REBUILD_URL = `${STUDY_URL}/rebuild`;
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
  rebuildPosts: Record<string, unknown>[];
  preparationMode: "ANALYZE" | "REBUILD";
  revisionNumber: number;
  sourceCount: number;
  documentFindingCount: number;
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
    preparationMode: server.preparationMode,
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
    extractedDocumentCount: 0,
    extractingPageCompleted: null,
    extractingPageTotal: null,
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
          revisionNumber: server.revisionNumber,
          sourceCount: server.sourceCount,
          documentFindingCount: server.documentFindingCount,
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
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    sessionStorage.clear();
    server = {
      documents: [makeDocument(0, "SUCCEEDED")],
      analysisRunStatus: null,
      analysisPosts: [],
      rebuildPosts: [],
      preparationMode: "ANALYZE",
      revisionNumber: 1,
      sourceCount: 0,
      documentFindingCount: 0,
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
        if (url === REBUILD_URL && init?.method === "POST") {
          server.rebuildPosts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          server.preparationMode = "REBUILD";
          server.analysisRunStatus = "SUCCEEDED";
          server.revisionNumber = 7;
          server.sourceCount = 3;
          server.documentFindingCount = 5;
          return json(
            {
              processingRun: analysisRun("SUCCEEDED"),
              created: true,
              reusedStudy: false,
              reportsReady: false,
              studyRevision: studyPreparationBody().studyRevision,
              reportRuns: [],
            },
            200,
          );
        }
        if (url === STUDY_URL && init?.method === "POST") {
          server.analysisPosts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          if (server.analysisRunStatus === "SUCCEEDED" && server.reportStatuses) {
            const customerReady = server.reportStatuses.CUSTOMER === "SUCCEEDED";
            const proReady = server.reportStatuses.PRO === "SUCCEEDED";
            if (!customerReady && server.reportStatuses.CUSTOMER === "FAILED") {
              server.reportStatuses.CUSTOMER = "QUEUED";
            }
            if (!proReady && server.reportStatuses.PRO === "FAILED") {
              server.reportStatuses.PRO = "QUEUED";
            }
            const reportsReady = customerReady && proReady;
            return json(
              {
                processingRun: analysisRun("SUCCEEDED"),
                created: false,
                reusedStudy: true,
                reportsReady,
                studyRevision: studyPreparationBody().studyRevision,
                reportRuns: [
                  reportRun("CUSTOMER", server.reportStatuses.CUSTOMER),
                  reportRun("PRO", server.reportStatuses.PRO),
                ],
              },
              reportsReady ? 200 : 202,
            );
          }
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

  it("shows short document labels from study metadata, not numbered placeholders", async () => {
    const study = bankruptcyC13Fixture("PRO");
    const meta = studyDocumentMeta(study.view);
    const docRows = study.view.blocks.find((block) => block.name === "documents")!.rows;
    server.documents = docRows.map((row, index) => ({
      ...makeDocument(index, "SUCCEEDED"),
      id: row.id,
      sourceDocumentId: row.id,
    }));
    server.readDocuments = server.documents.length;
    render(<DocumentsPanel hiveId={HIVE_ID} initialDocuments={server.documents} documentMeta={meta} />);
    const rows = await screen.findAllByTestId("document-row");
    for (const row of rows) {
      const label = row.querySelector(".font-brand")?.textContent ?? "";
      expect(label).not.toMatch(/^Document \d+$/);
      expect(label.length).toBeGreaterThan(0);
    }
    expect(rows.some((row) => (row.textContent ?? "").includes("Trustee's objection"))).toBe(true);
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

  it("navigates directly to the report page without opening the progress modal when both reports exist for the compatible Study", async () => {
    server.analysisRunStatus = "SUCCEEDED";
    server.reportStatuses = { CUSTOMER: "SUCCEEDED", PRO: "SUCCEEDED" };
    renderPanel();
    await screen.findByText(READY_HINT);

    await act(async () => {
      fireEvent.click(screen.getByTestId("analyze-button"));
    });

    expect(routerMock.push).toHaveBeenCalledWith(`/hives/${HIVE_ID}/reports`);
    expect(screen.queryByTestId("analyze-modal")).toBeNull();
    expect(server.analysisPosts).toHaveLength(1);
  });

  it("reuses the compatible Study, preserves the existing report, and polls only the missing Writer run when one report failed", async () => {
    server.analysisRunStatus = "SUCCEEDED";
    server.reportStatuses = { CUSTOMER: "SUCCEEDED", PRO: "FAILED" };
    renderPanel();
    await screen.findByText(READY_HINT);

    fireEvent.click(screen.getByTestId("analyze-button"));
    const dialog = await screen.findByTestId("analyze-modal");
    await within(dialog).findByRole("heading", { name: "Your study is complete" });
    expect(routerMock.push).not.toHaveBeenCalled();

    const rows = within(dialog).getAllByRole("listitem");
    const reportItems = within(within(dialog).getByTestId("analyze-reports")).getAllByRole("listitem");
    expect(reportItems.map((row) => row.dataset.state)).toEqual(["ready", "retrying"]);
    expect(rows.length).toBeGreaterThan(0);

    server.reportStatuses = { CUSTOMER: "SUCCEEDED", PRO: "SUCCEEDED" };
    await poll();
    const updatedReportItems = within(within(screen.getByTestId("analyze-modal")).getByTestId("analyze-reports")).getAllByRole(
      "listitem",
    );
    expect(updatedReportItems.map((row) => row.dataset.state)).toEqual(["ready", "ready"]);
  });

  it("ignores repeated clicks while starting so duplicate POST requests are never sent", async () => {
    renderPanel();
    await screen.findByText(READY_HINT);
    const button = screen.getByTestId("analyze-button");

    fireEvent.click(button);
    fireEvent.click(button);
    await within(await screen.findByTestId("analyze-modal")).findByRole("heading", { name: "Getting ready…" });

    expect(server.analysisPosts).toHaveLength(1);
  });

  it("rebuilds from the pages already read and links the new revision without starting Analyze", async () => {
    server.reportStatuses = { CUSTOMER: "SUCCEEDED", PRO: "SUCCEEDED" };
    renderPanel();
    const button = await screen.findByTestId("rebuild-study-button");
    expect((button as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(button);
    });

    expect(server.rebuildPosts).toHaveLength(1);
    expect(server.analysisPosts).toHaveLength(0);
    const status = await screen.findByTestId("rebuild-study-status");
    expect(status.textContent).toContain("Study revision 7 accepted.");
    expect(status.textContent).toContain("3 sources");
    expect(status.textContent).toContain("5 atomic document findings");
    expect(status.textContent).toContain("does not mean every fact was extracted");
    expect(screen.getByTestId("rebuild-study-link").getAttribute("href")).toBe(`/hives/${HIVE_ID}/study`);
  });

  it("does not offer rebuild until a study exists and the documents are already read", async () => {
    renderPanel();
    await screen.findByText(READY_HINT);
    expect(screen.queryByTestId("rebuild-study-button")).toBeNull();
    cleanup();

    server.reportStatuses = { CUSTOMER: "SUCCEEDED", PRO: "SUCCEEDED" };
    server.unreadDocuments = 1;
    server.documents = [makeDocument(0, "SUCCEEDED"), makeDocument(1, "PENDING")];
    renderPanel();
    const button = await screen.findByTestId("rebuild-study-button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
