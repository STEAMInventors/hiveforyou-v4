// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace }),
  usePathname: () => "/hives/x",
  useSearchParams: () => new URLSearchParams(search),
}));

import { useHiveChat } from "@/lib/hive-chat-context";

import { AskBar } from "./AskBar";
import { ChatSheet } from "./ChatSheet";
import { HiveHomeSidePanel } from "./HiveHomeSidePanel";
import { ChatWrap, chatConfig, installChatFetch, loadOf, stubViewport } from "./ask-chat-fixtures";

const OTHER = { first: "Dana", full: "Dana Ellis", kind: "client" as const };
const PEOPLE = (
  <div data-testid="people-node">
    <label>
      Message
      <textarea />
    </label>
  </div>
);

function Opener({ prefill }: { prefill?: string }) {
  const chat = useHiveChat();
  return (
    <button type="button" onClick={() => chat?.openChat(prefill === undefined ? undefined : { prefill })}>
      Open chat
    </button>
  );
}

const askComposers = () => screen.queryAllByRole("textbox", { name: /Question for Rowan/ });

beforeEach(() => {
  search = "";
  replace.mockClear();
  installChatFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HiveHomeSidePanel", () => {
  it("at 1100px and wider shows the tabs with Ask <assistant> selected and the chat on screen", () => {
    stubViewport(1280);
    render(
      <ChatWrap config={chatConfig()}>
        <HiveHomeSidePanel people={PEOPLE} other={OTHER} />
      </ChatWrap>,
    );

    const ask = screen.getByRole("button", { name: /Ask Rowan/ });
    const people = screen.getByRole("button", { name: /Dana/ });
    expect(ask.getAttribute("aria-pressed")).toBe("true");
    expect(people.getAttribute("aria-pressed")).toBe("false");
    expect(askComposers()).toHaveLength(1);
    expect(screen.queryByTestId("people-node")).toBeNull();
    // One composer visible at a time: the people tab's is not on screen.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("switches to the people conversation and keeps the choice in the URL", () => {
    stubViewport(1280);
    render(
      <ChatWrap config={chatConfig()}>
        <HiveHomeSidePanel people={PEOPLE} other={OTHER} />
      </ChatWrap>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Dana/ }));

    expect(screen.getByTestId("people-node")).toBeTruthy();
    expect(askComposers()).toHaveLength(0);
    expect(replace).toHaveBeenLastCalledWith("/hives/x?side=people", { scroll: false });

    fireEvent.click(screen.getByRole("button", { name: /Ask Rowan/ }));
    expect(replace).toHaveBeenLastCalledWith("/hives/x", { scroll: false });
  });

  it("starts on the people tab when the URL says ?side=people", () => {
    stubViewport(1280);
    search = "side=people";
    render(
      <ChatWrap config={chatConfig()}>
        <HiveHomeSidePanel people={PEOPLE} other={OTHER} />
      </ChatWrap>,
    );
    expect(screen.getByRole("button", { name: /Dana/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("people-node")).toBeTruthy();
    expect(askComposers()).toHaveLength(0);
  });

  it("is just the chat on an own hive: no tabs", () => {
    stubViewport(1280);
    render(
      <ChatWrap config={chatConfig({ firmless: true, firmId: null })}>
        <HiveHomeSidePanel people={null} other={null} />
      </ChatWrap>,
    );
    expect(screen.queryByTestId("side-tabs")).toBeNull();
    expect(askComposers()).toHaveLength(1);
  });

  it("brings the chat forward when something asks for it while the people tab is showing", async () => {
    stubViewport(1280);
    search = "side=people";
    render(
      <ChatWrap config={chatConfig()}>
        <Opener prefill="About the page: " />
        <HiveHomeSidePanel people={PEOPLE} other={OTHER} />
      </ChatWrap>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Ask Rowan/ }).getAttribute("aria-pressed")).toBe("true"));
    await waitFor(() => expect((askComposers()[0] as HTMLTextAreaElement).value).toBe("About the page: "));
  });

  describe("width decides panel or sheet", () => {
    it("wide: opening the chat uses the panel and no sheet appears", async () => {
      stubViewport(1280);
      render(
        <ChatWrap config={chatConfig()}>
          <Opener prefill="Hello: " />
          <HiveHomeSidePanel people={PEOPLE} other={OTHER} />
          <ChatSheet />
        </ChatWrap>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Open chat" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() => expect((askComposers()[0] as HTMLTextAreaElement).value).toBe("Hello: "));
      expect(askComposers()).toHaveLength(1);
    });

    it("narrow: the panel is only the people conversation and opening the chat shows the sheet", async () => {
      stubViewport(900);
      render(
        <ChatWrap config={chatConfig()}>
          <Opener />
          <HiveHomeSidePanel people={PEOPLE} other={OTHER} />
          <AskBar />
          <ChatSheet />
        </ChatWrap>,
      );
      expect(screen.queryByTestId("side-tabs")).toBeNull();
      expect(screen.getByTestId("people-node")).toBeTruthy();
      expect(askComposers()).toHaveLength(0);

      fireEvent.click(screen.getByTestId("ask-bar"));

      expect(screen.getByRole("dialog", { name: "Ask Rowan" })).toBeTruthy();
      expect(askComposers()).toHaveLength(1);
    });
  });

  describe("Ask bar", () => {
    it("names the assistant and opens the sheet", () => {
      stubViewport(900);
      render(
        <ChatWrap config={chatConfig()}>
          <AskBar />
          <ChatSheet />
        </ChatWrap>,
      );
      expect(screen.getByTestId("ask-bar").textContent).toBe("Ask Rowan about these documents");
      fireEvent.click(screen.getByTestId("ask-bar"));
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });

  describe("assistant off for the hive", () => {
    const off = () => chatConfig({ initialAssistant: loadOf([], { assistantRepliesOn: false }) });

    it("wide: no Ask tab, no tabs at all, only the people conversation", () => {
      stubViewport(1280);
      render(
        <ChatWrap config={off()}>
          <HiveHomeSidePanel people={PEOPLE} other={OTHER} />
        </ChatWrap>,
      );
      expect(screen.queryByTestId("side-tabs")).toBeNull();
      expect(screen.queryByRole("button", { name: /Ask Rowan/ })).toBeNull();
      expect(screen.getByTestId("people-node")).toBeTruthy();
      expect(askComposers()).toHaveLength(0);
    });

    it("an own hive renders nothing in the panel, and there is no Ask bar and no sheet", () => {
      stubViewport(1280);
      const config = chatConfig({
        firmless: true,
        firmId: null,
        initialAssistant: loadOf([], { assistantRepliesOn: false }),
      });
      render(
        <ChatWrap config={config}>
          <Opener />
          <HiveHomeSidePanel people={null} other={null} />
          <AskBar />
          <ChatSheet />
        </ChatWrap>,
      );
      expect(screen.queryByTestId("hive-home-side-panel")).toBeNull();
      expect(screen.queryByTestId("ask-bar")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
