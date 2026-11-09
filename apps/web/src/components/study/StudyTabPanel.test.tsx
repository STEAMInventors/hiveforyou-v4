// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import { DOCUMENT_READ_POLL_INTERVAL_MS } from "@/components/hives/document-read-progress";
import { STUDY_TAB_REBUILD_HINT } from "@/components/hives/study-preparation-progress";
import { bankruptcyC13StudyOnlyFixture } from "./fixtures/bankruptcy-c13";
import { StudyTabPanel } from "./StudyTabPanel";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const STUDY_URL = `/api/v1/hives/${HIVE_ID}/study-preparation`;
const REBUILD_URL = `${STUDY_URL}/rebuild`;
const RUN_ID = "88888888-8888-4888-8888-888888888888";
const REVISION_ID = "dddddddd-0000-4000-8000-000000000001";

const fixture = bankruptcyC13StudyOnlyFixture();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Server = {
  runStatus: string | null;
  rebuildPosts: Record<string, unknown>[];
};

let server: Server;

function preparationBody() {
  return {
    processingRun: server.runStatus
      ? {
          id: RUN_ID,
          hiveId: HIVE_ID,
          kind: "STUDY_PREPARATION",
          requestId: "99999999-9999-4999-8999-999999999999",
          attemptNumber: 1,
          status: server.runStatus,
          preparationMode: "REBUILD",
          authorizedSourceDocumentIds: [],
          intentRequestIds: [],
          coverageComplete: true,
          coverageAcknowledged: false,
          coverageDigest: null,
          coverageStatus: "COMPLETE",
          coverageGaps: [],
          coverageAcknowledgement: "NOT_REQUIRED",
          coverageAcknowledgedAt: null,
          snapshotFrozen: true,
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
        }
      : null,
    preview: null,
    previewSummary: null,
    staleness: null,
    eligibility: {
      documents: [
        {
          sourceDocumentId: "40e10001-0000-4000-8000-000000000001",
          fileName: "01_plan.pdf",
          readStatus: "SUCCEEDED",
          missingPageNumbers: [],
          emptyPageNumbers: [],
        },
      ],
      excluded: [],
      coverageComplete: true,
      activeReadCount: 0,
      coverageDigest: `sha256:${"e".repeat(64)}`,
      gaps: [],
    },
    studyRevision: {
      id: REVISION_ID,
      canonicalStudyId: "ffffffff-0000-4000-8000-000000000001",
      revisionNumber: 3,
      format: "canonical-study-1",
      sourceCount: 6,
      documentFindingCount: 12,
      predecessorRevisionId: null,
      processingRunId: RUN_ID,
      coverageComplete: true,
      coverageStatus: "COMPLETE",
      coverageGaps: fixture.coverageGaps,
      coverageAcknowledgement: "NOT_REQUIRED",
      createdAt: "2026-11-01T22:00:00.000Z",
    },
    reportRuns: [],
  };
}

afterEach(cleanup);

describe("StudyTabPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    sessionStorage.clear();
    server = { runStatus: null, rebuildPosts: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === REBUILD_URL && init?.method === "POST") {
          server.rebuildPosts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          server.runStatus = "QUEUED";
          return json({ processingRun: preparationBody().processingRun, created: true }, 202);
        }
        if (url === STUDY_URL) return json(preparationBody());
        return json({ error: { errorCode: "NOT_FOUND", message: "Not found" } }, 404);
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows Rebuild study beside the revision line with the extraction hint", async () => {
    render(
      <StudyTabPanel
        hiveId={HIVE_ID}
        revisionFormat="canonical-study-1"
        view={fixture.view}
        sources={fixture.sources}
        revisionNumber={3}
        coverageGaps={fixture.coverageGaps}
        documentPages={fixture.documentPages}
      />,
    );
    await screen.findByTestId("study-tab-rebuild-button");
    expect(screen.getByText(STUDY_TAB_REBUILD_HINT)).toBeTruthy();
    expect(screen.getByTestId("report-header").textContent).toContain("From study revision 3");
  });

  it("starts rebuild and opens the progress modal", async () => {
    render(
      <StudyTabPanel
        hiveId={HIVE_ID}
        revisionFormat="canonical-study-1"
        view={fixture.view}
        sources={fixture.sources}
        revisionNumber={3}
        coverageGaps={fixture.coverageGaps}
        documentPages={fixture.documentPages}
      />,
    );
    const button = await screen.findByTestId("study-tab-rebuild-button");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(server.rebuildPosts).toHaveLength(1);
    const dialog = await screen.findByTestId("analyze-modal");
    expect(within(dialog).getByRole("heading", { name: "Getting ready…" })).toBeTruthy();
  });

  it("disables Rebuild study while a preparation run is active", async () => {
    server.runStatus = "INVESTIGATING";
    render(
      <StudyTabPanel
        hiveId={HIVE_ID}
        revisionFormat="canonical-study-1"
        view={fixture.view}
        sources={fixture.sources}
        revisionNumber={3}
        coverageGaps={fixture.coverageGaps}
        documentPages={fixture.documentPages}
      />,
    );
    const button = await screen.findByTestId("study-tab-rebuild-button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("refreshes the page while a run is active", async () => {
    server.runStatus = "INVESTIGATING";
    render(
      <StudyTabPanel
        hiveId={HIVE_ID}
        revisionFormat="canonical-study-1"
        view={fixture.view}
        sources={fixture.sources}
        revisionNumber={3}
        coverageGaps={fixture.coverageGaps}
        documentPages={fixture.documentPages}
      />,
    );
    await screen.findByTestId("study-tab-rebuild-button");
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(DOCUMENT_READ_POLL_INTERVAL_MS);
    });
    expect(routerMock.refresh).toHaveBeenCalled();
  });
});
