// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadOwnedHiveOrNotFoundMock = vi.fn();
const loadHiveOverviewMock = vi.fn();
const emitMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/hives/550e8400-e29b-41d4-a716-446655440000/findings",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock("@/server/hives/load-owned-hive", () => ({
  loadOwnedHiveOrNotFound: (...args: unknown[]) => loadOwnedHiveOrNotFoundMock(...args),
}));

vi.mock("@/server/supabase/server-client", () => ({
  createServerSupabaseClient: vi.fn(async () => ({})),
}));

vi.mock("@/server/auth/action-support", () => ({
  requestCorrelationId: vi.fn(async () => "2eb8421a-b784-4bf8-ac2b-540299b61d13"),
}));

vi.mock("@/server/observability/logger", () => ({
  emitStructuredEvent: (...args: unknown[]) => emitMock(...args),
}));

vi.mock("@/server/hives/hive-summary", () => ({
  loadHiveOverview: (...args: unknown[]) => loadHiveOverviewMock(...args),
  documentPageCounts: (preparation: {
    eligibility: { documents: { sourceDocumentId: string; totalPhysicalPages: number }[] };
  }) =>
    Object.fromEntries(
      preparation.eligibility.documents.map((document) => [document.sourceDocumentId, document.totalPhysicalPages]),
    ),
}));

vi.mock("@/components/study/StudyView", () => ({
  StudyView: ({ workspaceSurface }: { workspaceSurface?: string }) => (
    <div data-testid="study-surface">{workspaceSurface}</div>
  ),
}));

vi.mock("@/components/pane-error-boundary", () => ({
  PaneErrorBoundary: ({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) => (
    <div data-testid="pane-boundary" data-has-fallback={fallback == null ? "no" : "yes"}>
      {children}
    </div>
  ),
}));

import FindingsPage from "./page";

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";

const hive = {
  id: HIVE_ID,
  hiveId: HIVE_ID,
  name: "Client hive",
  kind: "client",
  clientRequestId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

function loadedOverview() {
  return {
    preparation: {
      studyRevision: { format: "canonical-study-1", revisionNumber: 4, coverageGaps: [] },
      eligibility: {
        documents: [
          { sourceDocumentId: "a", totalPhysicalPages: 2 },
          { sourceDocumentId: "b", totalPhysicalPages: 1 },
        ],
        excluded: [{ sourceDocumentId: "c" }],
      },
    },
    studyTab: {
      view: { blocks: [{ rows: [{ id: "1" }, { id: "2" }] }, { rows: [{ id: "3" }] }] },
      sources: null,
    },
    summary: { study: { counts: { needs: 2, changed: 1, missing: 0, checked: 3 } } },
  };
}

beforeEach(() => {
  loadOwnedHiveOrNotFoundMock.mockReset();
  loadHiveOverviewMock.mockReset();
  emitMock.mockReset();
  loadOwnedHiveOrNotFoundMock.mockResolvedValue(hive);
});

afterEach(() => {
  cleanup();
});

async function renderPage(tab?: string) {
  const element = await FindingsPage({
    params: Promise.resolve({ hiveId: HIVE_ID }),
    searchParams: Promise.resolve(tab === undefined ? {} : { tab }),
  });
  return render(element);
}

describe("Findings page", () => {
  it("shows an error with the correlation id when loading fails", async () => {
    loadHiveOverviewMock.mockRejectedValue({
      safeMessage: "Safe failure.",
      retryable: true,
      errorCode: "INTERNAL_ERROR",
    });
    await renderPage();
    expect(screen.getByRole("alert").textContent).toContain("Safe failure.");
    expect(screen.getByText("2eb8421a")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(emitMock).toHaveBeenCalledWith(expect.objectContaining({ correlationId: "2eb8421a-b784-4bf8-ac2b-540299b61d13" }));
    expect(screen.queryByTestId("study-surface")).toBeNull();
  });

  it("hides Try again when the failure is not retryable", async () => {
    loadHiveOverviewMock.mockRejectedValue({
      safeMessage: "Safe failure.",
      retryable: false,
      errorCode: "INTERNAL_ERROR",
    });
    await renderPage();
    expect(screen.getByRole("alert").textContent).toContain("Safe failure.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("shows the empty study card when nothing has been accepted", async () => {
    loadHiveOverviewMock.mockResolvedValue({
      preparation: { studyRevision: null, eligibility: { documents: [], excluded: [] } },
      studyTab: null,
      summary: { study: null },
    });
    await renderPage();
    expect(screen.getByText("Your Study builds once documents are read")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Documents" }).getAttribute("href")).toBe(`/hives/${HIVE_ID}/documents`);
    expect(screen.queryByTestId("findings-summary")).toBeNull();
    expect(screen.queryByTestId("study-surface")).toBeNull();
  });

  it("shows the summary and the known surface when a study view loaded", async () => {
    loadHiveOverviewMock.mockResolvedValue(loadedOverview());
    await renderPage();
    expect(screen.getByTestId("findings-documents-read").textContent).toContain("2 of 3");
    expect(screen.getByTestId("findings-item-count").textContent).toContain("3");
    expect(screen.getByTestId("findings-to-review").textContent).toContain("3");
    expect(screen.getByTestId("findings-to-review").querySelector("[data-state='changed']")).toBeTruthy();
    expect(screen.getByTestId("study-surface").textContent).toBe("facts");
    const known = screen.getByRole("link", { name: "What we know" });
    expect(known.getAttribute("aria-current")).toBe("page");
    expect(known.getAttribute("href")).toBe(`/hives/${HIVE_ID}/findings`);
    expect(screen.getByRole("link", { name: "Gaps and conflicts" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByTestId("pane-boundary").getAttribute("data-has-fallback")).toBe("yes");
    expect(loadOwnedHiveOrNotFoundMock).toHaveBeenCalledWith(HIVE_ID, `/hives/${HIVE_ID}/findings`);
  });

  it.each([
    ["gaps", "missing"],
    ["timeline", "timeline"],
    ["review", "review"],
  ] as const)("renders the %s tab on the %s surface", async (tab, surface) => {
    loadHiveOverviewMock.mockResolvedValue(loadedOverview());
    await renderPage(tab);
    expect(screen.getByTestId("study-surface").textContent).toBe(surface);
    const labels = { gaps: "Gaps and conflicts", timeline: "Timeline", review: "To review" } as const;
    const active = screen.getByRole("link", { name: labels[tab] });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.getAttribute("href")).toBe(`/hives/${HIVE_ID}/findings?tab=${tab}`);
    expect(loadOwnedHiveOrNotFoundMock).toHaveBeenCalledWith(HIVE_ID, `/hives/${HIVE_ID}/findings?tab=${tab}`);
  });

  it("treats an unknown tab as What we know", async () => {
    loadHiveOverviewMock.mockResolvedValue(loadedOverview());
    await renderPage("nope");
    expect(screen.getByTestId("study-surface").textContent).toBe("facts");
    expect(screen.getByRole("link", { name: "What we know" }).getAttribute("aria-current")).toBe("page");
    expect(loadOwnedHiveOrNotFoundMock).toHaveBeenCalledWith(HIVE_ID, `/hives/${HIVE_ID}/findings`);
  });
});
