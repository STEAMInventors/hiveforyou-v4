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

vi.mock("./HiveSidebar", () => ({
  HiveSidebar: ({ compact }: { compact?: boolean }) => (
    <div data-testid={compact ? "hive-sidebar-compact" : "hive-sidebar-desktop"} />
  ),
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
  it("uses the desktop grid from 900px and hides compact nav at that breakpoint", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    const { container } = render(
      <WorkspaceShell
        hive={hive}
        startingView="clients"
        counts={{
          boardNeedsYou: 1,
          documents: 2,
          reports: null,
          teamNotes: null,
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

    expect(container.firstElementChild?.className).toContain("min-[900px]:grid");
    expect(container.firstElementChild?.className).toContain("min-[900px]:grid-cols-[236px_minmax(0,1fr)]");
    expect(screen.getByTestId("hive-sidebar-desktop")).toBeTruthy();
    expect(screen.queryByTestId("hive-sidebar-compact")).toBeNull();
  });

  it("renders compact nav below 900px", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    render(
      <WorkspaceShell
        hive={hive}
        startingView="clients"
        counts={{ boardNeedsYou: 0, documents: 0, reports: null, teamNotes: null }}
        firm={null}
        currentUserId="user"
        assigneeLabel={null}
        assigneeTitle={null}
        assistantName="HiveForYou"
      >
        <p>Workspace body</p>
      </WorkspaceShell>,
    );

    expect(screen.getByTestId("hive-sidebar-compact")).toBeTruthy();
    expect(screen.queryByTestId("hive-sidebar-desktop")).toBeNull();
  });
});