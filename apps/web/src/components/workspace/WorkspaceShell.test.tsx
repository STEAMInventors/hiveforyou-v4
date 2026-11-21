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

vi.mock("./HiveHead", () => ({
  HiveHead: () => <header data-testid="hive-head">Hive head</header>,
}));

import type { ConversationLoad } from "@/components/hives/useHiveConversation";

import { WorkspaceShell } from "./WorkspaceShell";

const EMPTY_ASSISTANT_LOAD: ConversationLoad = {
  ok: true,
  page: {
    messages: [],
    participantRoleLabels: [],
    participantCount: 0,
    viewerLastReadAt: null,
    nextCursor: null,
  },
};

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
  it("renders the hive head and no rail", () => {
    render(
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
        initialAssistant={EMPTY_ASSISTANT_LOAD}
      >
        <p>Workspace body</p>
      </WorkspaceShell>,
    );

    expect(screen.getByTestId("hive-head")).toBeTruthy();
    expect(screen.getByText("Workspace body")).toBeTruthy();
    expect(screen.queryByTestId("hive-sidebar-desktop")).toBeNull();
    expect(screen.queryByTestId("hive-sidebar-compact")).toBeNull();
  });

  it("hides the hive head for a firm client on client home", () => {
    render(
      <WorkspaceShell
        hive={{ ...hive, firmId: "22222222-2222-4222-8222-222222222222", membershipRole: "client" }}
        startingView="own"
        counts={{ toReviewCount: 0, documents: 0, reports: null, teamNotes: null, unreadMessages: null }}
        firm={null}
        currentUserId="user"
        assigneeLabel={null}
        assigneeTitle={null}
        assistantName="HiveForYou"
        initialAssistant={EMPTY_ASSISTANT_LOAD}
      >
        <p>Client body</p>
      </WorkspaceShell>,
    );

    expect(screen.queryByTestId("hive-head")).toBeNull();
    expect(screen.getByText("Client body")).toBeTruthy();
  });
});