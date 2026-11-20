// @vitest-environment jsdom
import type { Hive } from "@hiveforyou/contracts";
import type { ReactNode } from "react";
import { act, Suspense } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111/board",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/workspace/HiveHead", () => ({
  HiveHead: () => null,
}));

vi.mock("@/components/hives/HiveConversation", () => ({
  HiveConversation: () => <div data-testid="people-conversation-mock" />,
}));

vi.mock("@/components/account-menu", () => ({
  AccountMenu: () => <div data-testid="account-menu-mock" />,
}));

vi.mock("@/components/hives/ChatSheet", () => ({
  ChatSheet: () => null,
}));

vi.mock("@/components/hives/HiveOmni", () => ({
  HiveOmni: () => <div data-testid="omni-mock" />,
}));

vi.mock("@/components/hives/HivesFindBox", () => ({
  HivesFindBox: () => null,
}));

import { AppShell, type AppShellAccount } from "@/components/app-header";
import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import { buildHiveChatConfig } from "@/lib/build-hive-chat-config";
import { ClientHome } from "@/components/home/ClientHome";
import { HiveHome } from "@/components/home/HiveHome";
import { GALLERY_CLIENT_ID, GALLERY_HIVE, GALLERY_HIVE_ID, GALLERY_PEOPLE_PAGE } from "@/dev/gallery/fixtures/board-messages";
import { MEDICAID_FINDINGS } from "@/dev/gallery/fixtures/findings-gallery";
import { galleryStaffHome } from "@/dev/gallery/gallery-home-props";

import { WorkspaceShell } from "./WorkspaceShell";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

const hive: Hive = {
  id: HIVE_ID,
  hiveId: HIVE_ID,
  name: "Dana Ellis",
  kind: "client",
  clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
  firmId: "22222222-2222-4222-8222-222222222222",
  membershipRole: "client",
  isOwner: false,
};

const account: AppShellAccount = {
  initials: "DE",
  displayName: "Dana Ellis",
  email: "dana@example.com",
  startingView: "own",
};

const assistantLoad: ConversationLoad = {
  ok: true,
  page: {
    messages: [],
    participantRoleLabels: [],
    participantCount: 0,
    viewerLastReadAt: null,
    nextCursor: null,
    assistantRepliesOn: true,
  },
};

function clientHomeProps() {
  return {
    hiveId: GALLERY_HIVE_ID,
    hiveTitle: GALLERY_HIVE.name,
    staffDisplayName: "Priya Shah",
    staffTitle: "Onboarding associate",
    assistantName: "Rowan",
    checklist: [],
    progress: { in: 2, total: 3 },
    openItems: MEDICAID_FINDINGS.otherOpenItems,
    initialDocuments: [],
    acceptedStudyRevisionId: "rev-gallery",
    initialPeople: { ok: true, page: GALLERY_PEOPLE_PAGE },
    currentUserId: GALLERY_CLIENT_ID,
    hiveFirmId: GALLERY_HIVE.firmId ?? null,
    loadError: null,
    view: MEDICAID_FINDINGS.view,
    sources: MEDICAID_FINDINGS.sources,
    canonicalStudy: MEDICAID_FINDINGS.canonicalStudy,
    coverageGaps: MEDICAID_FINDINGS.coverageGaps,
    topics: MEDICAID_FINDINGS.topics,
    documentPages: MEDICAID_FINDINGS.documentPages,
  };
}

function hiveShell(children: ReactNode) {
  const staffView = false;
  const chatConfig = buildHiveChatConfig({
    hive,
    staffView,
    assigneeLabel: "Priya Shah",
    currentUserId: "staff-user",
    assistantName: "Rowan",
    initialAssistant: assistantLoad,
    initialClientAssistant: null,
    documentCount: 3,
    viewerDisplayName: account.displayName,
  });
  return (
    <AppShell account={account} chatConfig={chatConfig}>
      <WorkspaceShell
        hive={hive}
        startingView="own"
        counts={{ toReviewCount: 0, documents: 3, reports: null, teamNotes: null, unreadMessages: null }}
        firm={null}
        currentUserId="client-user"
        assigneeLabel="Priya Shah"
        assigneeTitle={null}
        assistantName="Rowan"
        initialAssistant={assistantLoad}
        chatConfig={chatConfig}
        viewerDisplayName={account.displayName}
      >
        <Suspense fallback={null}>{children}</Suspense>
      </WorkspaceShell>
    </AppShell>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("hive workspace hydration", () => {
  it("hydrates client home inside Suspense without mismatch", () => {
    const tree = hiveShell(<ClientHome {...clientHomeProps()} />);
    const html = renderToString(tree);
    const container = document.createElement("div");
    container.innerHTML = html;
    const errors: string[] = [];
    const warn = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
      warn(...args);
    };
    try {
      act(() => {
        hydrateRoot(container, tree);
        vi.runOnlyPendingTimers();
      });
    } finally {
      console.error = warn;
    }
    expect(errors.some((line) => /hydration|did not match/i.test(line))).toBe(false);
    expect(container.querySelector('[data-testid="client-home-ask-block"]')).toBeTruthy();
    container.remove();
  });

  it("hydrates hive home inside Suspense without mismatch", () => {
    const staffHive: Hive = { ...hive, membershipRole: "professional", isOwner: false };
    const staffView = true;
    const chatConfig = buildHiveChatConfig({
      hive: staffHive,
      staffView,
      assigneeLabel: "Priya Shah",
      currentUserId: "staff-user",
      assistantName: "Rowan",
      initialAssistant: assistantLoad,
      initialClientAssistant: null,
      documentCount: 9,
      viewerDisplayName: "Priya Shah",
    });
    const staffAccount: AppShellAccount = {
      initials: "PS",
      displayName: "Priya Shah",
      email: "priya@example.com",
      startingView: "clients",
    };
    const tree = (
      <AppShell account={staffAccount} chatConfig={chatConfig}>
        <WorkspaceShell
          hive={staffHive}
          startingView="clients"
          counts={{ toReviewCount: 2, documents: 9, reports: 2, teamNotes: 1, unreadMessages: 0 }}
          firm={null}
          currentUserId="staff-user"
          assigneeLabel="Priya Shah"
          assigneeTitle={null}
          assistantName="Rowan"
          initialAssistant={assistantLoad}
          chatConfig={chatConfig}
          viewerDisplayName={staffAccount.displayName}
        >
          <Suspense fallback={null}>
            <HiveHome {...galleryStaffHome()} />
          </Suspense>
        </WorkspaceShell>
      </AppShell>
    );
    const html = renderToString(tree);
    const container = document.createElement("div");
    container.innerHTML = html;
    const errors: string[] = [];
    const warn = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
      warn(...args);
    };
    try {
      act(() => {
        hydrateRoot(container, tree);
        vi.runOnlyPendingTimers();
      });
    } finally {
      console.error = warn;
    }
    expect(errors.some((line) => /hydration|did not match/i.test(line))).toBe(false);
    container.remove();
  });
});