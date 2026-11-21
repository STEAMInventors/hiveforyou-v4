// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/hives/HiveConversation", () => ({
  HiveConversation: () => <div data-testid="client-messages-mock" />,
}));

import { ChatSheet } from "@/components/hives/ChatSheet";
import {
  ChatWrap,
  CLIENT_ID,
  chatConfig,
  installChatFetch,
  loadOf,
} from "@/components/hives/ask-chat-fixtures";
import type { HiveChatConfig } from "@/lib/hive-chat-context";

import { ClientHome, type ClientHomeProps } from "./ClientHome";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

function clientChat(over: Partial<HiveChatConfig> = {}): HiveChatConfig {
  return chatConfig({
    audience: "client",
    currentUserId: CLIENT_ID,
    viewerFirstName: "Ruth",
    clientName: "Ruth Ortiz",
    staffFirstName: "Priya Shah",
    ...over,
  });
}

function props(over: Partial<ClientHomeProps> = {}): ClientHomeProps {
  return {
    hiveId: HIVE_ID,
    hiveTitle: "Ruth Ortiz",
    staffDisplayName: "Priya Shah",
    staffTitle: "Attorney",
    assistantName: "Rowan",
    checklist: [
      {
        gapId: "g1",
        title: "2023 bank statements",
        status: "not_in",
        statusText: "Not in yet.",
      },
    ],
    progress: { in: 2, total: 3 },
    openItems: [],
    initialDocuments: [],
    acceptedStudyRevisionId: "rev-1",
    initialPeople: { ok: true, page: { messages: [] } },
    currentUserId: "user",
    hiveFirmId: "22222222-2222-4222-8222-222222222222",
    loadError: null,
    view: null,
    sources: null,
    canonicalStudy: null,
    coverageGaps: [],
    topics: [],
    ...over,
  } as ClientHomeProps;
}

function renderHome(config: HiveChatConfig | null, over: Partial<ClientHomeProps> = {}) {
  return render(
    <ChatWrap config={config}>
      <ClientHome {...props(over)} />
      <ChatSheet />
    </ChatWrap>,
  );
}

beforeEach(() => {
  installChatFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClientHome", () => {
  it("renders the phone-first layout without staff tabs", () => {
    renderHome(clientChat());

    expect(screen.getByTestId("client-home")).toBeTruthy();
    expect(screen.getByText("Your file with")).toBeTruthy();
    expect(screen.getByText("Priya Shah")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Ruth Ortiz" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ask Rowan about your documents/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Your documents" }).getAttribute("href")).toBe(`/hives/${HIVE_ID}/documents`);
    expect(screen.getByTestId("progress-meter")).toBeTruthy();
    expect(screen.getByText("2 of 3 documents in")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /Still to send/ })).toBeTruthy();
    expect(screen.getByText("1 thing left to send. Everything else is in.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByText("Messages with Priya")).toBeTruthy();
    expect(screen.queryByTestId("hive-head")).toBeNull();
  });

  it("falls back to your team when staff name is missing", () => {
    renderHome(clientChat({ staffFirstName: null }), {
      staffDisplayName: null,
      staffTitle: null,
      checklist: [],
      progress: null,
      acceptedStudyRevisionId: null,
    });

    expect(screen.getByText("your team")).toBeTruthy();
    expect(screen.getByText("Everything we asked for is in. Your team will be in touch.")).toBeTruthy();
    expect(screen.getByText(/Only you and your team can see this file/)).toBeTruthy();
  });

  it("puts the Ask button under the meter and before Still to send", () => {
    renderHome(clientChat());
    const ask = screen.getByTestId("client-home-ask");
    const meter = screen.getByTestId("progress-meter");
    const still = screen.getByRole("heading", { level: 2, name: /Still to send/ });
    expect(meter.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ask.compareDocumentPosition(still) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the chat sheet from the Ask button, not the top box", async () => {
    renderHome(clientChat());
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("client-home-ask"));

    expect(screen.getByRole("dialog", { name: "Ask Rowan" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /Question for Rowan/ })));
  });

  it("offers data-driven chips that ask straight into the sheet", async () => {
    const { state } = installChatFetch();
    renderHome(clientChat());

    const chips = screen.getByTestId("client-home-chips");
    const chip = chips.querySelector("button")!;
    expect(chip.textContent).toBe("What do I still need to send?");
    expect(chips.querySelectorAll("button").length).toBeLessThanOrEqual(3);

    fireEvent.click(chip);

    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]).toMatchObject({ channel: "assistant", body: "What do I still need to send?" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("with the assistant off shows no Ask button and no chips", () => {
    renderHome(clientChat({ initialAssistant: loadOf([], { assistantRepliesOn: false }) }));
    expect(screen.queryByTestId("client-home-ask")).toBeNull();
    expect(screen.queryByTestId("client-home-chips")).toBeNull();
    expect(screen.queryByRole("button", { name: /Ask Rowan/ })).toBeNull();
  });

  it("shows the older-study notice and rebuild link", () => {
    renderHome(clientChat(), { studyAvailability: { kind: "older", revisionNumber: 4 } });
    expect(screen.getByTestId("client-home-older-study")).toBeTruthy();
    expect(screen.getByTestId("canonical-study-notice")).toBeTruthy();
  });
});
