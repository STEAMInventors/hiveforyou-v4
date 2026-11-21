// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Hive } from "@hiveforyou/contracts";

vi.mock("@/lib/use-left-menu-wide", () => ({
  useLeftMenuWide: vi.fn(),
}));

import { useLeftMenuWide } from "@/lib/use-left-menu-wide";

import { HiveWorkspaceHead } from "./HiveWorkspaceHead";

const hive: Hive = {
  id: "11111111-1111-4111-8111-111111111111",
  hiveId: "11111111-1111-4111-8111-111111111111",
  name: "Family benefits application",
  description: "Five-year financial review",
  kind: "client",
  firmId: "33333333-3333-4333-8333-333333333333",
  clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.mocked(useLeftMenuWide).mockReset();
});

describe("HiveWorkspaceHead", () => {
  it("hides tabs and people at ≥1100px", () => {
    vi.mocked(useLeftMenuWide).mockReturnValue(true);
    render(
      <HiveWorkspaceHead
        hive={hive}
        active="board"
        counts={{ toReviewCount: null, documents: 3, reports: null, teamNotes: null, unreadMessages: null }}
        assigneeLabel="Priya"
        assistantName="Sarah"
      />,
    );
    expect(screen.queryByTestId("hive-tabs")).toBeNull();
    expect(screen.queryByTestId("hive-people-line")).toBeNull();
  });

  it("shows tabs and people below 1100px", () => {
    vi.mocked(useLeftMenuWide).mockReturnValue(false);
    render(
      <HiveWorkspaceHead
        hive={hive}
        active="board"
        counts={{ toReviewCount: null, documents: 3, reports: null, teamNotes: null, unreadMessages: null }}
        assigneeLabel="Priya"
        assistantName="Sarah"
      />,
    );
    expect(screen.getByTestId("hive-tabs")).toBeTruthy();
    expect(screen.getByTestId("hive-people-line")).toBeTruthy();
  });
});