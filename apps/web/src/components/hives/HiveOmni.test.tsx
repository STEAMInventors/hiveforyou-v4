// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import { OmniCatalogProvider } from "@/components/ui/omni-catalog";
import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111",
  useSearchParams: () => new URLSearchParams(),
}));

import { HiveOmni, questionsFrom } from "./HiveOmni";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function wrap(ui: React.ReactNode) {
  return (
    <OmniCatalogProvider>
      <EvidenceViewerProvider hiveId={HIVE_ID} labels={new Map()} citationContexts={new Map()}>
        {ui}
      </EvidenceViewerProvider>
    </OmniCatalogProvider>
  );
}

const priorQ = "What is the monthly premium?";
const priorA = "The premium is $142.";
const MSG1 = "c0a80101-0000-4000-8000-000000000001";
const MSG2 = "c0a80101-0000-4000-8000-000000000002";
const ASST1 = "c0a80101-0000-4000-8000-000000000003";

function assistantLoad(): ConversationLoad {
  return {
    ok: true,
    page: {
      messages: [
        {
          id: MSG1,
          body: priorQ,
          authorKind: "person",
          authorRole: "staff",
          authorUserId: USER_ID,
          authorDisplayName: "Staff",
          authorRoleLabel: "Staff",
          createdAt: "2026-11-18T14:05:00.123456+00:00",
          isMine: true,
          sourceRefs: [],
          replyToMessageId: null,
        },
        {
          id: ASST1,
          body: priorA,
          authorKind: "assistant",
          authorRole: "assistant",
          authorUserId: null,
          authorDisplayName: "Dana",
          authorRoleLabel: "AI assistant",
          triggerMessageId: MSG1,
          createdAt: "2026-11-18T14:05:05.123456+00:00",
          isMine: false,
          sourceRefs: [],
          replyToMessageId: null,
          handoffFromMessageId: null,
        },
      ],
      participantRoleLabels: [],
      participantCount: 1,
      viewerLastReadAt: null,
      nextCursor: null,
      pendingAssistant: false,
      assistantAvailable: true,
      assistantRepliesOn: true,
    },
  };
}

function validPersonMessage(id: string, body: string) {
  return {
    id,
    body,
    authorKind: "person" as const,
    authorRole: "staff" as const,
    authorUserId: USER_ID,
    authorDisplayName: "Staff",
    authorRoleLabel: "Staff",
    createdAt: "2026-11-18T14:06:00.123456+00:00",
    isMine: true,
    sourceRefs: [] as const,
    replyToMessageId: null,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      messages: [],
      participantRoleLabels: [],
      participantCount: 0,
      viewerLastReadAt: null,
      nextCursor: null,
    }),
    headers: { get: () => null },
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HiveOmni", () => {
  it("shows Your questions from the server-loaded assistant thread on first open", async () => {
    const initial = assistantLoad();
    render(
      wrap(
        <HiveOmni
          hiveId={HIVE_ID}
          assistantName="Dana"
          audience="staff"
          staffFirstName="Priya"
          clientName="Client"
          currentUserId={USER_ID}
          firmless={false}
          firmId="33333333-3333-4333-8333-333333333333"
          initialAssistant={initial}
        />,
      ),
    );

    const input = screen.getByPlaceholderText(/find anything/i);
    fireEvent.focus(input);

    expect(screen.getByText("Your questions")).toBeTruthy();
    expect(screen.getByText(priorQ)).toBeTruthy();
    expect(questionsFrom(initial.ok ? initial.page.messages : []).map((q) => q.question)).toContain(priorQ);
  });

  it("does not poll the assistant channel while the box is closed and idle", async () => {
    vi.useFakeTimers();
    const initial: ConversationLoad = {
      ok: true,
      page: {
        messages: [],
        participantRoleLabels: [],
        participantCount: 0,
        viewerLastReadAt: null,
        nextCursor: null,
      },
    };
    render(
      wrap(
        <HiveOmni
          hiveId={HIVE_ID}
          assistantName="Dana"
          audience="staff"
          staffFirstName="Priya"
          clientName="Client"
          currentUserId={USER_ID}
          firmless={false}
          firmId="33333333-3333-4333-8333-333333333333"
          initialAssistant={initial}
        />,
      ),
    );

    const assistantFetches = () =>
      fetchMock.mock.calls.filter((call) => String(call[0]).includes("channel=assistant"));

    expect(assistantFetches().length).toBe(0);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(assistantFetches().length).toBe(0);
  });

  it("shows typing for a duplicate question instead of the earlier answer", async () => {
    const initial = assistantLoad();
    fetchMock.mockImplementation(async (url: RequestInfo, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/messages") && init?.method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: validPersonMessage(MSG2, priorQ),
            duplicate: false,
          }),
          headers: { get: () => null },
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messages: [...(initial.ok ? initial.page.messages : []), validPersonMessage(MSG2, priorQ)],
          participantRoleLabels: [],
          participantCount: 1,
          viewerLastReadAt: null,
          nextCursor: null,
          pendingAssistant: true,
        }),
        headers: { get: () => null },
      };
    });

    render(
      wrap(
        <HiveOmni
          hiveId={HIVE_ID}
          assistantName="Dana"
          audience="staff"
          staffFirstName="Priya"
          clientName="Client"
          currentUserId={USER_ID}
          firmless={false}
          firmId="33333333-3333-4333-8333-333333333333"
          initialAssistant={initial}
        />,
      ),
    );

    const input = screen.getByPlaceholderText(/find anything/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: priorQ } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("omni-typing")).toBeTruthy();
    });
    expect(screen.queryByText(priorA)).toBeNull();
  });

  it("shows client questions load error in the client group", async () => {
    render(
      wrap(
        <HiveOmni
          hiveId={HIVE_ID}
          assistantName="Dana"
          audience="staff"
          staffFirstName="Priya"
          clientName="Dana Ellis"
          currentUserId={USER_ID}
          firmless={false}
          firmId="33333333-3333-4333-8333-333333333333"
          initialAssistant={{ ok: true, page: { messages: [], participantRoleLabels: [], participantCount: 0, viewerLastReadAt: null, nextCursor: null } }}
          initialClientAssistant={{ ok: false, message: "fail", correlationId: "abcd1234-5678-90ab-cdef-1234567890ab", retryable: true }}
        />,
      ),
    );

    fireEvent.focus(screen.getByPlaceholderText(/find anything/i));
    expect(screen.getByTestId("omni-client-questions-error")).toBeTruthy();
    expect(screen.getByText(/Couldn't load Dana's questions/i)).toBeTruthy();
    expect(screen.getByText(/abcd1234/)).toBeTruthy();
  });
});