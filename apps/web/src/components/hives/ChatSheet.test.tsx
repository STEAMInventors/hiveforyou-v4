// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111",
  useSearchParams: () => new URLSearchParams(),
}));

import { useHiveChat, type HiveChatOpenInput } from "@/lib/hive-chat-context";

import { ChatSheet } from "./ChatSheet";
import { HiveOmni } from "./HiveOmni";
import { ChatWrap, chatConfig, installChatFetch, loadOf } from "./ask-chat-fixtures";

function Opener({ input, label = "Open chat" }: { input?: HiveChatOpenInput; label?: string }) {
  const chat = useHiveChat();
  return (
    <button type="button" onClick={() => chat?.openChat(input)}>
      {label}
    </button>
  );
}

const composer = () => screen.getByRole("textbox", { name: /Question for Rowan/ });

beforeEach(() => {
  installChatFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatSheet", () => {
  it("is not on screen until something opens it", () => {
    render(
      <ChatWrap config={chatConfig()}>
        <Opener />
        <ChatSheet />
      </ChatWrap>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens as a modal dialog with one composer, and focus moves into it", async () => {
    render(
      <ChatWrap config={chatConfig()}>
        <Opener />
        <ChatSheet />
      </ChatWrap>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));

    const dialog = screen.getByRole("dialog", { name: "Ask Rowan" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(composer()));
  });

  it("closes with Escape and gives focus back to the opener", async () => {
    render(
      <ChatWrap config={chatConfig()}>
        <Opener />
        <ChatSheet />
      </ChatWrap>,
    );
    const opener = screen.getByRole("button", { name: "Open chat" });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(document.activeElement).toBe(composer()));

    fireEvent.keyDown(composer(), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes from the scrim and from the close button", () => {
    render(
      <ChatWrap config={chatConfig()}>
        <Opener />
        <ChatSheet />
      </ChatWrap>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    fireEvent.click(screen.getByTestId("chat-sheet-scrim"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps focus inside while open", async () => {
    render(
      <ChatWrap config={chatConfig()}>
        <Opener />
        <ChatSheet />
      </ChatWrap>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await waitFor(() => expect(document.activeElement).toBe(composer()));
    const close = screen.getByRole("button", { name: "Close" });

    // The send button is disabled while the composer is empty, so the composer is the last stop.
    fireEvent.keyDown(composer(), { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(composer());
  });

  it("fills the composer when opened with a prefill", async () => {
    render(
      <ChatWrap config={chatConfig()}>
        <Opener input={{ prefill: "About the Bank statement page 3: " }} />
        <ChatSheet />
      </ChatWrap>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await waitFor(() => expect((composer() as HTMLTextAreaElement).value).toBe("About the Bank statement page 3: "));
    await waitFor(() => expect(document.activeElement).toBe(composer()));
  });

  it("posts into the thread when opened with a question", async () => {
    const { state } = installChatFetch();
    render(
      <ChatWrap config={chatConfig()}>
        <Opener input={{ send: "What is still to come?" }} />
        <ChatSheet />
      </ChatWrap>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]).toMatchObject({ channel: "assistant", body: "What is still to come?" });
  });

  it("keeps the conversation when it is closed and opened again", async () => {
    const { state } = installChatFetch();
    render(
      <ChatWrap config={chatConfig()}>
        <Opener input={{ send: "First question" }} label="Ask it" />
        <Opener label="Reopen" />
        <ChatSheet />
      </ChatWrap>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask it" }));
    await waitFor(() => expect(state.posts).toHaveLength(1));
    await waitFor(() => expect(screen.getByText("First question")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByText("First question")).toHaveLength(1);
    expect(state.posts).toHaveLength(1);
  });

  it("does nothing when the assistant is off for the hive", () => {
    render(
      <ChatWrap config={chatConfig({ initialAssistant: loadOf([], { assistantRepliesOn: false }) })}>
        <Opener />
        <ChatSheet />
      </ChatWrap>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("Escape order: sheet, then the box, then the evidence view", () => {
    const evidenceClose = vi.fn();
    const onDocumentKey = (event: KeyboardEvent) => {
      // This is the evidence view's own rule: it closes on Escape unless something earlier handled the key.
      if (event.key === "Escape" && !event.defaultPrevented) evidenceClose();
    };

    beforeEach(() => {
      evidenceClose.mockClear();
      document.addEventListener("keydown", onDocumentKey);
    });
    afterEach(() => document.removeEventListener("keydown", onDocumentKey));

    function renderAll() {
      render(
        <ChatWrap config={chatConfig()}>
          <HiveOmni assistantName="Rowan" audience="staff" />
          <Opener />
          <ChatSheet />
        </ChatWrap>,
      );
    }

    it("closes the sheet first and leaves the evidence view alone", async () => {
      renderAll();
      fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
      await waitFor(() => expect(document.activeElement).toBe(composer()));

      fireEvent.keyDown(composer(), { key: "Escape" });

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(evidenceClose).not.toHaveBeenCalled();
    });

    it("closes the box next, without reopening it, and leaves the evidence view alone", () => {
      renderAll();
      const input = screen.getByRole("combobox");
      fireEvent.focus(input);
      input.focus();
      expect(screen.getByTestId("omni-pop")).toBeTruthy();

      fireEvent.keyDown(input, { key: "Escape" });

      expect(screen.queryByTestId("omni-pop")).toBeNull();
      expect(document.activeElement).not.toBe(input);
      expect(evidenceClose).not.toHaveBeenCalled();
    });

    it("lets the evidence view close last", () => {
      renderAll();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(evidenceClose).toHaveBeenCalledTimes(1);
    });
  });
});
