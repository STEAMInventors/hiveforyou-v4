// @vitest-environment jsdom
/**
 * Board polling behavior for HiveBoardThreePane: visibility gating, version refresh,
 * failure banner, 404 unavailable copy, and preserved invite draft text.
 */
import type { Hive, HiveBoardModel, ListFirmResponse } from "@hiveforyou/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boardPollIntervalMs } from "./hive-board-poll";
import { HiveBoardThreePane } from "./HiveBoardThreePane";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("@/components/hives/useStudyPreparation", () => ({
  useStudyPreparation: () => ({
    rebuildAvailability: { canRebuild: false, reason: "NO_ACCEPTED_STUDY" },
    starting: false,
    active: false,
    rebuild: vi.fn(),
    state: null,
    pollState: "ok",
  }),
}));

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER = "11111111-1111-4111-8111-111111111111";

const board: HiveBoardModel = {
  kicker: "Intake",
  headline: "1 item for your review",
  progress: { in: 1, total: 1, segments: ["in"] },
  needs: [],
  next: null,
  checklist: [],
  activity: [],
  readiness: [],
  checklistNote: "",
};

const firm: ListFirmResponse = {
  firm: { firmId: "33333333-3333-4333-8333-333333333333", name: "Rivera", assistantName: "Sam", callerRole: "owner" },
  members: [],
  pendingInvitations: [],
};

function hive(): Hive {
  return {
    id: HIVE_ID,
    hiveId: HIVE_ID,
    name: "Ruth",
    description: null,
    kind: "client",
    clientRequestId: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    firmId: firm.firm?.firmId,
    stage: "open",
    membershipRole: "firm",
  };
}

function renderBoard(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(
    <HiveBoardThreePane
      hive={hive()}
      currentUserId={USER}
      board={board}
      firm={firm}
      uploads={[]}
      documentLabels={{}}
      initialPollVersion="v1"
      initialFastPoll={false}
    />,
  );
}

async function tickPolls(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(boardPollIntervalMs(false));
      await Promise.resolve();
    });
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  refreshMock.mockClear();
  delete (window as { matchMedia?: unknown }).matchMedia;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
});

describe("HiveBoardThreePane polling", () => {
  it("does not poll while the document is hidden", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: "v1", fastPoll: false }),
    });
    renderBoard(fetchMock);
    await tickPolls(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips router.refresh when poll version is unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: "v1", fastPoll: false }),
    });
    renderBoard(fetchMock);
    await tickPolls(1);
    expect(fetchMock).toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("calls router.refresh when version changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: "v2", fastPoll: false }),
    });
    renderBoard(fetchMock);
    await tickPolls(1);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("shows reconnecting after three poll failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    renderBoard(fetchMock);
    await tickPolls(3);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Reconnecting"));
  });

  it("shows unavailable message on 404 poll response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    renderBoard(fetchMock);
    await tickPolls(1);
    await waitFor(() =>
      expect(screen.getByText("This hive is no longer available to you.")).toBeTruthy(),
    );
  });

  it("redirects to sign-in when poll returns 401", async () => {
    let navigated = "";
    const locationMock = {
      pathname: `/hives/${HIVE_ID}/board`,
      search: "",
      href: "",
    };
    Object.defineProperty(locationMock, "href", {
      configurable: true,
      get: () => navigated,
      set: (value: string) => {
        navigated = value;
      },
    });
    vi.stubGlobal("location", locationMock);

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    renderBoard(fetchMock);
    await tickPolls(1);
    await waitFor(() => expect(navigated).toContain("/sign-in?next="));
  });

  it("preserves invite email draft after a failed poll", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: "v1", fastPoll: false }) });
    renderBoard(fetchMock);
    fireEvent.click(screen.getByRole("button", { name: "Invite Ruth" }));
    const email = screen.getByLabelText("Email");
    fireEvent.change(email, { target: { value: "ruth@example.com" } });
    await tickPolls(1);
    expect((email as HTMLInputElement).value).toBe("ruth@example.com");
  });
});