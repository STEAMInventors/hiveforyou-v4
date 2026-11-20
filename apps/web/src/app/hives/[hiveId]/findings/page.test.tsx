// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadOwnedHiveOrNotFoundMock = vi.fn();
const loadHiveOverviewMock = vi.fn();
const emitMock = vi.fn();
const loadPackByIdMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/hives/550e8400-e29b-41d4-a716-446655440000/findings",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  permanentRedirect: (url: string) => {
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
  documentPageCounts: () => ({}),
}));

vi.mock("@/server/pipeline/pack-loader", () => ({
  loadPackById: (...args: unknown[]) => loadPackByIdMock(...args),
}));

vi.mock("@/components/findings/FindingsPageView", () => ({
  FindingsPageView: () => <div data-testid="findings-page-view" />,
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
      eligibility: { documents: [], excluded: [] },
    },
    studyTab: {
      view: { blocks: [{ name: "spine_table", rows: [] }], spineSource: null },
      sources: null,
    },
    canonicalStudy: {
      schema: "hive.canonical-study/1",
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [],
      domainLabel: "test",
      spineSource: null,
    },
    summary: { study: { counts: { needs: 2, changed: 1, missing: 0, checked: 3 }, toReviewCount: 3 } },
  };
}

beforeEach(() => {
  loadOwnedHiveOrNotFoundMock.mockReset();
  loadHiveOverviewMock.mockReset();
  emitMock.mockReset();
  loadPackByIdMock.mockReturnValue(null);
  loadOwnedHiveOrNotFoundMock.mockResolvedValue(hive);
});

afterEach(() => {
  cleanup();
});

async function renderPage(searchParams: Record<string, string> = {}) {
  const element = await FindingsPage({
    params: Promise.resolve({ hiveId: HIVE_ID }),
    searchParams: Promise.resolve(searchParams),
  });
  return render(element);
}

describe("Findings page", () => {
  it("redirects legacy tab query strings to anchors", async () => {
    await expect(
      FindingsPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({ tab: "timeline", keep: "1" }),
      }),
    ).rejects.toThrow(/REDIRECT:.*#timeline/);
  });

  it("shows an error with the correlation id when loading fails", async () => {
    loadHiveOverviewMock.mockRejectedValue({
      safeMessage: "Safe failure.",
      retryable: true,
      errorCode: "INTERNAL_ERROR",
    });
    await renderPage();
    expect(screen.getByRole("alert").textContent).toContain("Safe failure.");
    expect(screen.getByText("2eb8421a")).toBeTruthy();
    expect(screen.queryByTestId("findings-page-view")).toBeNull();
  });

  it("shows the empty study card when nothing has been accepted", async () => {
    loadHiveOverviewMock.mockResolvedValue({
      preparation: { studyRevision: null, eligibility: { documents: [], excluded: [] } },
      studyTab: null,
      summary: { study: null },
      canonicalStudy: null,
    });
    await renderPage();
    expect(screen.getByText("Your Study builds once documents are read")).toBeTruthy();
    expect(screen.queryByTestId("findings-page-view")).toBeNull();
  });

  it("renders the single-page findings view when a study is available", async () => {
    loadHiveOverviewMock.mockResolvedValue(loadedOverview());
    await renderPage();
    expect(screen.getByTestId("findings-page-view")).toBeTruthy();
    expect(screen.getByText("Explore what the documents show, the timeline, and items to review.")).toBeTruthy();
  });
});