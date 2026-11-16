// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Hive } from "@hiveforyou/contracts";
import { hiveAttention } from "@hiveforyou/contracts";

import { ClientsHomeProvider } from "@/lib/hives/clients-home-context";

import { MyHivesPanel } from "./MyHivesPanel";

const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/hives-client", () => ({
  fetchMyHives: vi.fn(),
  deleteHive: vi.fn(),
  setHiveKind: vi.fn(),
  HiveClientError: class extends Error {},
}));

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const REQ_ID = "11111111-1111-4111-8111-111111111111";

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

afterEach(() => {
  cleanup();
  searchParams = new URLSearchParams();
  replace.mockClear();
});

describe("MyHivesPanel", () => {
  it("renders the clients workspace with one filled New client button and rail counts", () => {
    render(
      <ClientsHomeProvider enabled>
        <MyHivesPanel
          initialHives={[hive(), hive({ id: "660e8400-e29b-41d4-a716-446655440001", name: "Jordan Lee", clientRequestId: "22222222-2222-4222-8222-222222222222" })]}
          startingView="clients"
          greetingFirstName="Sam"
          summaries={{
            [HIVE_ID]: summary(needsAttention),
            "660e8400-e29b-41d4-a716-446655440001": summary(readyAttention),
          }}
        />
      </ClientsHomeProvider>,
    );
    expect(screen.getByRole("link", { name: /New client/ })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Find a client")).toBeNull();
    expect(screen.getByRole("heading", { name: "All clients" })).toBeTruthy();
    const needsButton = screen.getByRole("button", { name: /Needs you/ });
    expect(within(needsButton).getByText("1")).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Clients" })).getByRole("button", { name: /Ready/ }).textContent).toMatch(/1/);
  });

  it("keeps the selected rail view in the URL", () => {
    render(
      <ClientsHomeProvider enabled>
        <MyHivesPanel
          initialHives={[hive()]}
          startingView="clients"
          greetingFirstName="Sam"
          summaries={{ [HIVE_ID]: summary(readyAttention) }}
        />
      </ClientsHomeProvider>,
    );
    fireEvent.click(within(screen.getByRole("navigation", { name: "Clients" })).getByRole("button", { name: /^Ready/ }));
    expect(replace).toHaveBeenCalledWith("/hives?view=ready", { scroll: false });
  });

  it("opens the matching view from glance tiles", () => {
    render(
      <ClientsHomeProvider enabled>
        <MyHivesPanel
          initialHives={[hive()]}
          startingView="clients"
          greetingFirstName="Sam"
          summaries={{ [HIVE_ID]: summary(needsAttention) }}
        />
      </ClientsHomeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "1 Need you" }));
    expect(replace).toHaveBeenCalledWith("/hives?view=needs", { scroll: false });
  });

  it("filters rows by rail view and shows intake from summary counts", () => {
    const readyHive = hive({
      id: "660e8400-e29b-41d4-a716-446655440001",
      name: "Jordan Lee",
      clientRequestId: "22222222-2222-4222-8222-222222222222",
    });
    searchParams = new URLSearchParams("view=ready");
    render(
      <ClientsHomeProvider enabled>
        <MyHivesPanel
          initialHives={[hive(), readyHive]}
          startingView="clients"
          greetingFirstName="Sam"
          summaries={{
            [HIVE_ID]: summary(needsAttention, { total: 4, received: 2 }),
            [readyHive.id]: summary(readyAttention, { total: 3, received: 3 }),
          }}
        />
      </ClientsHomeProvider>,
    );
    const row = screen.getByTestId("hive-list-row");
    expect(within(row).getByText("3 of 3 in")).toBeTruthy();
    expect(screen.queryByText("Alex Carter")).toBeNull();
  });

  it("shows Your own matter for own hives in the own rail", () => {
    searchParams = new URLSearchParams("view=own");
    render(
      <ClientsHomeProvider enabled>
        <MyHivesPanel
          initialHives={[hive({ kind: "own", name: "Home renovation", description: "Kitchen" })]}
          startingView="clients"
          greetingFirstName="Sam"
          summaries={{
            [HIVE_ID]: summary(readyAttention),
          }}
        />
      </ClientsHomeProvider>,
    );
    expect(screen.getByText("Your own matter")).toBeTruthy();
    expect(screen.queryByText("Client hive")).toBeNull();
  });

  it("greeting uses display name and falls back without it", () => {
    render(
      <ClientsHomeProvider enabled>
        <MyHivesPanel
          initialHives={[hive()]}
          startingView="clients"
          greetingFirstName="Dana"
          summaries={{ [HIVE_ID]: summary(readyAttention) }}
        />
      </ClientsHomeProvider>,
    );
    expect(screen.getByTestId("hives-greeting").textContent).toMatch(/Dana/);

    cleanup();
    render(
      <ClientsHomeProvider enabled>
        <MyHivesPanel
          initialHives={[hive()]}
          startingView="clients"
          greetingFirstName={null}
          summaries={{ [HIVE_ID]: summary(readyAttention) }}
        />
      </ClientsHomeProvider>,
    );
    expect(screen.getByTestId("hives-greeting").textContent).not.toContain(",");
  });

  it("puts Mine and Unassigned above Needs you when the viewer has a firm", () => {
    const viewer = "11111111-1111-4111-8111-111111111111";
    const mine = hive({
      firmId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: viewer,
      stage: "open",
      homeKicker: "Benefits · you on it",
    });
    const open = hive({
      id: "660e8400-e29b-41d4-a716-446655440001",
      name: "Ruth Ortiz",
      clientRequestId: "22222222-2222-4222-8222-222222222222",
      firmId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: null,
      stage: "open",
      homeKicker: "Benefits · unassigned",
    });
    const closed = hive({
      id: "770e8400-e29b-41d4-a716-446655440002",
      name: "Closed matter",
      clientRequestId: "33333333-3333-4333-8333-333333333333",
      firmId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: viewer,
      stage: "closed",
      homeKicker: "Benefits · closed",
    });
    render(
      <ClientsHomeProvider enabled>
        <MyHivesPanel
          initialHives={[mine, open, closed]}
          startingView="clients"
          greetingFirstName="Maria"
          showFirmRail
          viewerUserId={viewer}
          summaries={{
            [mine.id]: summary(needsAttention),
            [open.id]: summary(readyAttention),
            [closed.id]: summary(readyAttention),
          }}
        />
      </ClientsHomeProvider>,
    );
    const nav = screen.getByRole("navigation", { name: "Clients" });
    const labels = within(nav).getAllByRole("button").map((button) => button.textContent ?? "");
    const mineAt = labels.findIndex((label) => label.startsWith("Mine"));
    const unassignedAt = labels.findIndex((label) => label.startsWith("Unassigned"));
    const needsAt = labels.findIndex((label) => label.startsWith("Needs you"));
    expect(mineAt).toBeGreaterThanOrEqual(0);
    expect(unassignedAt).toBeGreaterThan(mineAt);
    expect(needsAt).toBeGreaterThan(unassignedAt);
    expect(within(nav).getByRole("button", { name: /^Mine/ }).textContent).toMatch(/1/);
    expect(within(nav).getByRole("button", { name: /^Unassigned/ }).textContent).toMatch(/1/);
    expect(screen.getByText("Benefits · you on it")).toBeTruthy();
    expect(screen.getByText("Benefits · unassigned")).toBeTruthy();
    expect(screen.getByText("Benefits · closed")).toBeTruthy();
  });

  it("shows the own view without header search layout", () => {
    render(
      <ClientsHomeProvider enabled={false}>
        <MyHivesPanel
          initialHives={[]}
          startingView="own"
          greetingFirstName="Sam"
        />
      </ClientsHomeProvider>,
    );
    expect(screen.getByLabelText("Start a Hive")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /New client/ })).toBeNull();
  });
});