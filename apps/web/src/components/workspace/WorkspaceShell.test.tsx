// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Hive } from "@hiveforyou/contracts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111/board",
}));

vi.mock("@/components/app-header", () => ({
  useHiveHeaderWorkspace: () => ({ setWorkspace: vi.fn() }),
}));

vi.mock("@/lib/use-left-menu-wide", () => ({
  useLeftMenuWide: () => true,
}));

vi.mock("./HiveSidebar", () => ({
  HiveSidebar: () => <div data-testid="hive-left-menu" />,
}));

vi.mock("./HiveWorkspaceHead", () => ({
  HiveWorkspaceHead: () => <div data-testid="hive-workspace-head" />,
}));

import { WorkspaceShell } from "./WorkspaceShell";

const hive: Hive = {
  id: "11111111-1111-4111-8111-111111111111",
  hiveId: "11111111-1111-4111-8111-111111111111",
  name: "Client hive",
  kind: "client",
  clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkspaceShell", () => {
  it("uses a 232px left column from 1100px", () => {
    const { container } = render(
      <WorkspaceShell
        hive={hive}
        startingView="clients"
        counts={{
          toReviewCount: 1,
          documents: 2,
          reports: null,
          teamNotes: null,
          unreadMessages: null,
        }}
        firm={null}
        currentUserId="user"
        assigneeLabel={null}
        assigneeTitle={null}
        assistantName="HiveForYou"
      >
        <p>Workspace body</p>
      </WorkspaceShell>,
    );

    expect(container.firstElementChild?.className).toContain("min-[1100px]:grid");
    expect(container.firstElementChild?.className).toContain("min-[1100px]:grid-cols-[232px_minmax(0,1fr)]");
    expect(screen.getByTestId("hive-left-menu")).toBeTruthy();
    expect(screen.getByTestId("hive-workspace-head")).toBeTruthy();
  });
});