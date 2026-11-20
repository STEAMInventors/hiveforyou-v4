// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadHiveBoardMock, conversationProps } = vi.hoisted(() => ({
  loadHiveBoardMock: vi.fn(),
  conversationProps: [] as Record<string, unknown>[],
}));

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
let hive: Record<string, unknown> = {};

vi.mock("@/server/hives/load-owned-hive", () => ({ loadOwnedHiveOrNotFound: async () => hive }));
vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: async () => ({
    ok: true,
    userId: "u",
    client: {
      schema: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { assistant_name: "Maya" } }),
            }),
          }),
        }),
      }),
    },
  }),
}));
vi.mock("@/server/auth/action-support", () => ({ requestCorrelationId: async () => "corr" }));
vi.mock("@/server/firm/load-firm-board", () => ({ loadLatestHandover: async () => null }));
vi.mock("@/server/hives/hive-board-loader", () => ({ loadHiveBoard: (...args: unknown[]) => loadHiveBoardMock(...args) }));
vi.mock("@/server/hives/hive-conversation", () => ({
  loadHiveConversation: async () => ({
    ok: true,
    page: { messages: [], participantRoleLabels: [], participantCount: 1, viewerLastReadAt: null, nextCursor: null },
  }),
}));
vi.mock("@/components/hives/HiveBoardMessaging", () => ({
  HiveBoardMessaging: (props: Record<string, unknown>) => {
    conversationProps.push(props);
    return <div data-testid="conversation-stub" />;
  },
}));

import HiveBoardPage from "./page";

const firmClientHive = {
  id: HIVE_ID,
  name: "Ruth Ortiz",
  kind: "client",
  firmId: "33333333-3333-4333-8333-333333333333",
  membershipRole: "firm",
};

afterEach(() => cleanup());

describe("Hive board page", () => {
  beforeEach(() => {
    conversationProps.length = 0;
    loadHiveBoardMock.mockReset();
    loadHiveBoardMock.mockResolvedValue({
      board: { progress: { in: 1, total: 3 }, checklist: [{ gapId: "g" }], headline: "Old headline", checklistNote: "" },
      overview: null,
    });
  });

  it("shows only the title, the Still to come line and the conversation", async () => {
    hive = firmClientHive;
    render(
      await HiveBoardPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.queryByTestId("hive-page-head")).toBeNull();
    expect(screen.getByText(/Your conversation with Ruth/, { hidden: true })).toBeTruthy();
    expect(screen.getByText(/Maya doesn't take part here/, { hidden: true })).toBeTruthy();
    const still = screen.getByTestId("hive-still-to-come");
    expect(still.textContent).toContain("Still to come");
    expect(still.textContent).toContain("1 of 3 in");
    expect(still.textContent).toContain("See items");
    expect(screen.getByTestId("conversation-stub")).toBeTruthy();
    expect(screen.queryByText("Old headline")).toBeNull();
    expect(screen.queryByText("To review")).toBeNull();
    expect(screen.queryByText("Items")).toBeNull();
    expect(screen.queryByTestId("hive-board-three-pane")).toBeNull();
    expect(conversationProps[0]).toMatchObject({ staffView: true, clientName: "Ruth Ortiz", viewerIsClient: false });
  });

  it("passes null teamMemberFirstName when the hive has no assignee", async () => {
    hive = { ...firmClientHive, assigneeDisplayName: null };
    render(
      await HiveBoardPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(conversationProps[0]).toMatchObject({ teamMemberFirstName: null });
  });

  it("gives clients and individual hives no staff view", async () => {
    hive = { ...firmClientHive, membershipRole: "client" };
    render(
      await HiveBoardPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(conversationProps[0]).toMatchObject({ staffView: false, viewerIsClient: true });
    cleanup();
    hive = { id: HIVE_ID, name: "My own hive", kind: "own", membershipRole: "owner" };
    render(
      await HiveBoardPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(conversationProps[1]).toMatchObject({ staffView: false, clientName: null, viewerIsClient: false });
  });

  it("hides the Still to come line without a checklist or when the board fails", async () => {
    hive = firmClientHive;
    loadHiveBoardMock.mockResolvedValue({ board: { progress: null, checklist: [] }, overview: null });
    render(
      await HiveBoardPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.queryByTestId("hive-still-to-come")).toBeNull();
    cleanup();
    loadHiveBoardMock.mockRejectedValue(new Error("down"));
    render(
      await HiveBoardPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.queryByTestId("hive-still-to-come")).toBeNull();
    expect(screen.getByTestId("conversation-stub")).toBeTruthy();
  });
});
