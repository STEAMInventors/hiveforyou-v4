// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Hive } from "@hiveforyou/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111/board",
}));

import { HiveSidebar } from "./HiveSidebar";

const hive: Hive = {
  id: "11111111-1111-4111-8111-111111111111",
  hiveId: "11111111-1111-4111-8111-111111111111",
  name: "Client hive",
  kind: "client",
  firmId: "33333333-3333-4333-8333-333333333333",
  clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
});

describe("HiveSidebar", () => {
  it("shows Team notes only for firm client hives", () => {
    render(
      <HiveSidebar
        hive={hive}
        startingView="clients"
        active="board"
        counts={{ boardNeedsYou: 2, documents: 3, reports: 1, teamNotes: 4 }}
        firm={{ firm: { id: hive.firmId!, name: "Firm", assistantName: "Assistant" }, members: [], invites: [] }}
        currentUserId="user"
        assigneeLabel="You"
        assigneeTitle="Attorney"
        assistantName="Assistant"
      />,
    );
    expect(screen.getByRole("link", { name: /Team notes/ })).toBeTruthy();
  });

  it("hides Team notes for individual client hives", () => {
    render(
      <HiveSidebar
        hive={{ ...hive, firmId: undefined }}
        startingView="own"
        active="board"
        counts={{ boardNeedsYou: 1, documents: 1, reports: null, teamNotes: null }}
        firm={null}
        currentUserId="user"
        assigneeLabel={null}
        assigneeTitle={null}
        assistantName="HiveForYou"
      />,
    );
    expect(screen.queryByRole("link", { name: /Team notes/ })).toBeNull();
  });

  it("marks the active section with aria-current and hides zero counts", () => {
    render(
      <HiveSidebar
        hive={hive}
        startingView="clients"
        active="facts"
        counts={{ boardNeedsYou: 0, documents: 0, reports: null, teamNotes: null }}
        firm={null}
        currentUserId="user"
        assigneeLabel={null}
        assigneeTitle={null}
        assistantName="HiveForYou"
      />,
    );
    const facts = screen.getByRole("link", { name: /Facts/ });
    expect(facts.getAttribute("aria-current")).toBe("page");
    expect(within(facts).queryByText("0")).toBeNull();
  });
});