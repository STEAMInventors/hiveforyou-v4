// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Hive } from "@hiveforyou/contracts";
import { hiveAttention } from "@hiveforyou/contracts";

import { ClientsHomeProvider } from "@/lib/hives/clients-home-context";

import { MyHivesPanel } from "./MyHivesPanel";

const replace = vi.fn();
const push = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/hives-client", () => ({
  fetchMyHives: vi.fn(),
  deleteHive: vi.fn(),
  setHiveKind: vi.fn(),
  HiveClientError: class extends Error {},
}));

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const SECOND_ID = "660e8400-e29b-41d4-a716-446655440001";
const REQ_ID = "11111111-1111-4111-8111-111111111111";
const FIRM_ID = "33333333-3333-4333-8333-333333333333";

function hive(overrides: Partial<Hive> = {}): Hive {
  return {
    id: HIVE_ID,
    hiveId: HIVE_ID,
    name: "Alex Carter",
    description: "Benefits application",
    kind: "client",
    clientRequestId: REQ_ID,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-14T00:00:00.000Z",
    ...overrides,
  };
}

function second(overrides: Partial<Hive> = {}): Hive {
  return hive({
    id: SECOND_ID,
    hiveId: SECOND_ID,
    name: "Jordan Lee",
    description: "Tax return",
    clientRequestId: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  });
}

const summary = (
  attention: ReturnType<typeof hiveAttention>,
  intake: { total: number; received: number } = { total: 2, received: 2 },
) => ({
  documentCount: intake.total,
  intake,
  attention,
  study: null,
});

const readyAttention = hiveAttention({
  documentCount: 2,
  unreadableDocumentCount: 0,
  documentsNotReadCount: 0,
  activeReadCount: 0,
  processingRunFailed: false,
  processingRunActive: false,
  documentsNotInStudyCount: 0,
  openConflicts: 0,
  openNeeds: 0,
  openChanged: 0,
  openMissing: 0,
  openChecked: 2,
  hasStudy: true,
  hasReport: true,
});

const needsAttention = hiveAttention({
  documentCount: 1,
  unreadableDocumentCount: 0,
  documentsNotReadCount: 0,
  activeReadCount: 0,
  processingRunFailed: false,
  processingRunActive: false,
  documentsNotInStudyCount: 0,
  openConflicts: 0,
  openNeeds: 1,
  openChanged: 0,
  openMissing: 2,
  openChecked: 0,
  hasStudy: true,
  hasReport: false,
});

const readingAttention = { ...readyAttention, reason: "reading" as const };
const waitingAttention = { ...readyAttention, reason: "no_documents" as const };

function renderPanel(
  props: Partial<React.ComponentProps<typeof MyHivesPanel>> & { initialQuery?: string },
) {
  const { initialQuery = "", ...panelProps } = props;
  return render(
    <ClientsHomeProvider enabled initialQuery={initialQuery}>
      <MyHivesPanel initialHives={[]} startingView="clients" {...panelProps} />
    </ClientsHomeProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  searchParams = new URLSearchParams();
  replace.mockClear();
  push.mockClear();
  vi.unstubAllGlobals();
});

describe("MyHivesPanel list", () => {
  it("shows the head, the state sentence and one filled New hive", () => {
    renderPanel({
      initialHives: [hive(), second()],
      summaries: { [HIVE_ID]: summary(needsAttention), [SECOND_ID]: summary(readyAttention) },
    });
    expect(screen.getByRole("heading", { level: 1, name: "Your hives" })).toBeTruthy();
    expect(screen.getByText("1 hive has things to review.")).toBeTruthy();
    const newHive = screen.getByRole("link", { name: /New hive/ });
    expect(newHive.getAttribute("href")).toBe("/hives/new-client");
    const filled = [...screen.getAllByRole("link"), ...screen.getAllByRole("button")].filter((el) =>
      el.className.includes("bg-blue-deep"),
    );
    expect(filled).toEqual([newHive]);
    expect(screen.queryByText(/Welcome|Good (morning|afternoon|evening)/)).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Clients" })).toBeNull();
  });

  it("groups hives under To review, Being read, Waiting on documents and Up to date, with counts", () => {
    const third = hive({ id: "770e8400-e29b-41d4-a716-446655440002", hiveId: "770e8400-e29b-41d4-a716-446655440002", name: "Sam Ortiz", clientRequestId: "33333333-3333-4333-8333-333333333334" });
    const fourth = hive({ id: "880e8400-e29b-41d4-a716-446655440003", hiveId: "880e8400-e29b-41d4-a716-446655440003", name: "Pat Kim", clientRequestId: "44444444-4444-4444-8444-444444444445" });
    renderPanel({
      initialHives: [hive(), second(), third, fourth],
      summaries: {
        [HIVE_ID]: summary(needsAttention),
        [SECOND_ID]: summary(readyAttention),
        [third.id]: summary(readingAttention),
        [fourth.id]: summary(waitingAttention, { total: 0, received: 0 }),
      },
    });
    const titles = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(titles).toEqual(["To review", "Being read", "Waiting on documents", "Up to date"]);
    const review = screen.getByRole("heading", { level: 2, name: "To review" }).closest("section")!;
    expect(within(review).getByText("1")).toBeTruthy();
    expect(within(review).getByText("Alex Carter")).toBeTruthy();
    expect(screen.getByText("1 hive has things to review. 1 is waiting on documents. 1 is being read.")).toBeTruthy();
  });

  it("omits the state sentence when no hive has a summary", () => {
    renderPanel({ initialHives: [hive()] });
    expect(screen.queryByText(/Everything is up to date|things to review/)).toBeNull();
    expect(screen.getByText("Alex Carter")).toBeTruthy();
  });

  it("makes each row one link to the hive, with its purpose, intake and updated time", () => {
    renderPanel({
      initialHives: [hive()],
      summaries: { [HIVE_ID]: summary(needsAttention, { total: 4, received: 2 }) },
    });
    const row = screen.getByTestId("clients-home-row");
    const link = within(row).getByRole("link");
    expect(link.getAttribute("href")).toBe(`/hives/${HIVE_ID}`);
    expect(link.textContent).toContain("Alex Carter");
    expect(link.textContent).toContain("Benefits application");
    expect(link.textContent).toContain("2 of 4 documents in");
    expect(link.textContent).toMatch(/Updated /);
    expect(within(row).getByRole("button", { name: "Options for Alex Carter" })).toBeTruthy();
  });

  it("shows no meter for a hive that asked for no documents", () => {
    renderPanel({
      initialHives: [hive()],
      summaries: { [HIVE_ID]: summary(readyAttention, { total: 0, received: 0 }) },
    });
    expect(screen.queryByTestId("row-meter")).toBeNull();
  });
});

describe("MyHivesPanel tabs", () => {
  it("shows no tabs when there is nothing to switch between", () => {
    renderPanel({ initialHives: [hive()], summaries: { [HIVE_ID]: summary(readyAttention) } });
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("shows All, Mine, Unassigned and Your own for a firm that has own hives, in that order", () => {
    const viewer = "11111111-1111-4111-8111-111111111111";
    const mine = hive({ firmId: FIRM_ID, assigneeUserId: viewer, stage: "open", assigneeDisplayName: "Maria Lopez" });
    const open = second({ firmId: FIRM_ID, assigneeUserId: null, stage: "open" });
    const own = hive({
      id: "990e8400-e29b-41d4-a716-446655440009",
      hiveId: "990e8400-e29b-41d4-a716-446655440009",
      kind: "own",
      name: "Home renovation",
      description: "Kitchen",
      clientRequestId: "55555555-5555-4555-8555-555555555556",
    });
    renderPanel({
      initialHives: [mine, open, own],
      showFirmRail: true,
      viewerUserId: viewer,
      summaries: { [mine.id]: summary(needsAttention), [open.id]: summary(readyAttention) },
    });
    const tabs = within(screen.getByRole("tablist", { name: "Which hives" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["All2", "Mine1", "Unassigned1", "Your own1"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("Home renovation")).toBeNull();

    fireEvent.click(tabs[3]!);
    expect(replace).toHaveBeenCalledWith("/hives?queue=own", { scroll: false });
  });

  it("keeps the selected tab in the URL and goes back to a clean URL for All", () => {
    const viewer = "11111111-1111-4111-8111-111111111111";
    searchParams = new URLSearchParams("queue=mine");
    renderPanel({
      initialHives: [
        hive({ firmId: FIRM_ID, assigneeUserId: viewer, stage: "open" }),
        second({ firmId: FIRM_ID, assigneeUserId: null, stage: "open" }),
      ],
      showFirmRail: true,
      viewerUserId: viewer,
      summaries: { [HIVE_ID]: summary(readyAttention), [SECOND_ID]: summary(readyAttention) },
    });
    expect(screen.getByRole("tab", { name: /Mine/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Alex Carter")).toBeTruthy();
    expect(screen.queryByText("Jordan Lee")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /All/ }));
    expect(replace).toHaveBeenCalledWith("/hives", { scroll: false });
  });

  it("treats the retired needs and ready queues as All", () => {
    searchParams = new URLSearchParams("queue=ready");
    renderPanel({
      initialHives: [hive(), second()],
      summaries: { [HIVE_ID]: summary(needsAttention), [SECOND_ID]: summary(readyAttention) },
    });
    expect(screen.getByText("Alex Carter")).toBeTruthy();
    expect(screen.getByText("Jordan Lee")).toBeTruthy();
  });

  it("lists own hives under All for a person who has no client hives, and shows New hive as a button", () => {
    renderPanel({
      startingView: "own",
      initialHives: [hive({ kind: "own", name: "Home renovation", description: "Kitchen" })],
      summaries: { [HIVE_ID]: summary(readyAttention) },
    });
    expect(screen.getByText("Home renovation")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: /New hive/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /New hive/ })).toBeNull();
  });
});

describe("MyHivesPanel find", () => {
  it("filters rows by the client's name, across every tab", () => {
    renderPanel({
      initialQuery: "jordan",
      initialHives: [hive(), second()],
      summaries: { [HIVE_ID]: summary(needsAttention), [SECOND_ID]: summary(readyAttention) },
    });
    expect(screen.getByText("Jordan Lee")).toBeTruthy();
    expect(screen.queryByText("Alex Carter")).toBeNull();
  });

  it("finds a hive by its title", () => {
    renderPanel({
      initialQuery: "benefits",
      initialHives: [hive(), second()],
      summaries: { [HIVE_ID]: summary(needsAttention), [SECOND_ID]: summary(readyAttention) },
    });
    expect(screen.getByText("Alex Carter")).toBeTruthy();
    expect(screen.queryByText("Jordan Lee")).toBeNull();
  });

  it("says nothing matched and offers a new client by that name", () => {
    renderPanel({
      initialQuery: "Zed Quill",
      initialHives: [hive()],
      summaries: { [HIVE_ID]: summary(readyAttention) },
    });
    expect(screen.getByText("No hive matches “Zed Quill”. Try a client's first or last name.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New client named Zed Quill" }));
    expect(push).toHaveBeenCalledWith("/hives/new-client?name=Zed%20Quill");
  });

  it("does not offer a new client to someone without a firm", () => {
    renderPanel({
      startingView: "own",
      initialQuery: "nothing",
      initialHives: [hive({ kind: "own" })],
      summaries: { [HIVE_ID]: summary(readyAttention) },
    });
    expect(screen.getByText(/No hive matches/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New client named/ })).toBeNull();
  });
});

describe("MyHivesPanel first visit and own start", () => {
  it("shows the first visit inline to a professional with no hives", () => {
    const { container } = renderPanel({ initialHives: [] });
    expect(screen.getByTestId("hives-first-visit")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Your hives" })).toBeTruthy();
    expect(screen.getByText(/Start with one client/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /New hive/ }).getAttribute("href")).toBe("/hives/new-client");
    expect(screen.getByRole("button", { name: "Or start one for your own documents" })).toBeTruthy();
    for (const label of ["You set it up", "They upload", "You review"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByRole("tablist")).toBeNull();
    const filled = Array.from(container.querySelectorAll("a, button")).filter((el) => el.className.includes("bg-blue-deep"));
    expect(filled).toHaveLength(1);
  });

  it("keeps the composer for an individual with no hives, without a greeting", () => {
    renderPanel({ startingView: "own", initialHives: [] });
    expect(screen.getByLabelText("Describe your situation")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /New hive|New client/ })).toBeNull();
    expect(screen.queryByTestId("hives-first-visit")).toBeNull();
    expect(screen.queryByText(/Welcome|Good (morning|afternoon|evening)/)).toBeNull();
  });
});

describe("MyHivesPanel error", () => {
  it("shows the message, a short reference that is not monospaced, and Try again", () => {
    renderPanel({
      initialHives: [],
      initialError: { message: "Could not load your hives.", correlationId: "abcdef1234567890" },
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Could not load your hives.");
    expect(alert.textContent).toContain("Reference abcdef12");
    expect(alert.textContent).not.toContain("abcdef1234");
    expect(alert.querySelector(".font-mono")).toBeNull();
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByTestId("hives-first-visit")).toBeNull();
    expect(screen.queryByText("Nothing here right now.")).toBeNull();
  });
});
