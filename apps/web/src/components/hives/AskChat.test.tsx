// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/hives/x",
  useSearchParams: () => new URLSearchParams(),
}));

import { AskChat, askGreeting } from "./AskChat";
import {
  CLIENT_ID,
  PUBLIC_ERROR,
  STAFF_ID,
  assistantMessage,
  chatConfig,
  installChatFetch,
  loadOf,
  personMessage,
} from "./ask-chat-fixtures";

beforeEach(() => {
  installChatFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const composer = () => screen.getByRole("textbox", { name: /Question for Rowan/ });

describe("askGreeting", () => {
  const base = {
    audience: "staff" as const,
    firmless: false,
    viewerFirstName: "Priya",
    clientName: "Dana Ellis",
    staffFirstName: "Priya Shah",
    documentCount: 4,
  };

  it("greets staff with the count and the client's first name", () => {
    expect(askGreeting(base)).toBe(
      "Hi Priya. I've read the 4 documents in Dana's hive. Ask me anything about them and I'll show you the page each answer comes from.",
    );
  });

  it("leaves the count out when the data is missing and says 'the document' for one", () => {
    expect(askGreeting({ ...base, documentCount: null })).toContain("I've read the documents in Dana's hive.");
    expect(askGreeting({ ...base, documentCount: 1 })).toContain("I've read the document in Dana's hive.");
  });

  it("speaks to an own hive in the second person", () => {
    expect(askGreeting({ ...base, firmless: true })).toContain("in your hive.");
  });

  it("greets a client and names the person it hands off to", () => {
    const text = askGreeting({ ...base, audience: "client", viewerFirstName: "Dana" });
    expect(text).toBe(
      "Hi Dana. I've read the documents you sent. Ask me anything about them and I'll show you the page each answer comes from. If I can't help, I'll pass your question to Priya.",
    );
  });
});

describe("AskChat", () => {
  it("opens with the greeting, the header and a log; chips only while the thread is empty", () => {
    render(<AskChat config={chatConfig()} variant="panel" suggestions={["What is still to come?", "Two", "Three", "Four"]} />);

    expect(screen.getByTestId("ask-greeting").textContent).toContain("Hi Priya.");
    expect(screen.getByText("AI assistant")).toBeTruthy();
    expect(screen.getByText("Answers only from the documents in this hive")).toBeTruthy();
    expect(screen.getByTestId("ask-ready-dot")).toBeTruthy();
    expect(screen.getByRole("log")).toBeTruthy();
    expect(within(screen.getByTestId("ask-chips")).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("shows no chips once the thread has a message", () => {
    const q = personMessage("What is the premium?");
    render(
      <AskChat
        config={chatConfig({ initialAssistant: loadOf([q, assistantMessage("It is $142.", q.id)]) })}
        variant="panel"
        suggestions={["What is still to come?"]}
      />,
    );
    expect(screen.queryByTestId("ask-chips")).toBeNull();
    expect(screen.getByTestId("ask-own-message").textContent).toBe("What is the premium?");
    expect(screen.getByTestId("ask-assistant-message").textContent).toContain("It is $142.");
  });

  it("posts a chip's question into the assistant thread", async () => {
    const { state } = installChatFetch();
    render(<AskChat config={chatConfig()} variant="panel" suggestions={["What is still to come?"]} />);

    fireEvent.click(screen.getByRole("button", { name: "What is still to come?" }));

    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]).toMatchObject({ channel: "assistant", body: "What is still to come?", handoffFrom: null });
  });

  it("sends on Enter, keeps Shift+Enter for a new line, and clears the composer", async () => {
    const { state } = installChatFetch();
    render(<AskChat config={chatConfig()} variant="panel" />);
    const area = composer();

    fireEvent.change(area, { target: { value: "Line one" } });
    fireEvent.keyDown(area, { key: "Enter", shiftKey: true });
    expect(state.posts).toHaveLength(0);

    fireEvent.keyDown(area, { key: "Enter" });
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]!.body).toBe("Line one");
    expect((composer() as HTMLTextAreaElement).value).toBe("");
  });

  it("has an icon send button named for the assistant, disabled while empty", () => {
    render(<AskChat config={chatConfig()} variant="panel" />);
    const send = screen.getByRole("button", { name: "Send to Rowan" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(composer(), { target: { value: "Hello" } });
    expect(send.disabled).toBe(false);
  });

  it("shows a typing bubble while a reply is pending", () => {
    render(
      <AskChat
        config={chatConfig({ initialAssistant: loadOf([personMessage("Q")], { pendingAssistant: true }) })}
        variant="panel"
      />,
    );
    expect(screen.getByTestId("ask-typing")).toBeTruthy();
  });

  it("shows an inline failure with Try again only when the failure is retryable", async () => {
    installChatFetch([], { failPostsWith: PUBLIC_ERROR(false) });
    const { unmount } = render(<AskChat config={chatConfig()} variant="panel" />);
    fireEvent.change(composer(), { target: { value: "One" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("ask-send-error")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    unmount();

    installChatFetch([], { failPostsWith: PUBLIC_ERROR(true) });
    render(<AskChat config={chatConfig()} variant="panel" />);
    fireEvent.change(composer(), { target: { value: "Two" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy());
    expect(screen.getByText(/abcd1234/)).toBeTruthy();
  });

  it("fills the composer from a prefill request, caret at the end, and reports it handled", async () => {
    const consumed = vi.fn();
    render(
      <AskChat
        config={chatConfig()}
        variant="sheet"
        request={{ nonce: 1, kind: "prefill", text: "About the Bank statement page 3: " }}
        onRequestConsumed={consumed}
      />,
    );
    await waitFor(() => expect((composer() as HTMLTextAreaElement).value).toBe("About the Bank statement page 3: "));
    await waitFor(() => expect(document.activeElement).toBe(composer()));
    expect((composer() as HTMLTextAreaElement).selectionStart).toBe("About the Bank statement page 3: ".length);
    expect(consumed).toHaveBeenCalledWith(1);
  });

  it("posts a send request once and ignores it while not on screen", async () => {
    const { state } = installChatFetch();
    const request = { nonce: 7, kind: "send" as const, text: "Where is page 2?" };
    const { rerender } = render(<AskChat config={chatConfig()} variant="sheet" active={false} request={request} />);
    expect(state.posts).toHaveLength(0);

    rerender(<AskChat config={chatConfig()} variant="sheet" active request={request} />);
    await waitFor(() => expect(state.posts).toHaveLength(1));
    rerender(<AskChat config={chatConfig()} variant="sheet" active request={request} />);
    expect(state.posts).toHaveLength(1);
  });

  describe("staff view of the client's questions", () => {
    const clientThreads = [
      { userId: STAFF_ID, displayName: "Priya Shah", roleLabel: "Staff", messageCount: 1, lastAt: null },
      { userId: CLIENT_ID, displayName: "Dana Ellis", roleLabel: "Client", messageCount: 3, lastAt: null },
    ];

    it("offers the client's thread read-only, with no composer while reading", () => {
      const clientQ = personMessage("Do I owe anything?", { authorRole: "client", authorUserId: CLIENT_ID, isMine: false });
      render(
        <AskChat
          config={chatConfig({
            initialAssistant: loadOf([], { assistantThreads: clientThreads }),
            initialClientAssistant: loadOf([clientQ, assistantMessage("Not that I can see.", clientQ.id)]),
          })}
          variant="panel"
        />,
      );

      expect(screen.getByTestId("ask-client-questions-row").textContent).toContain("Dana has asked Rowan 3 questions");
      expect(composer()).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Read them" }));

      expect(screen.getByTestId("ask-readonly-note").textContent).toBe("Dana asked these. Only your team can see them.");
      expect(screen.getByText("Do I owe anything?")).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("button", { name: /Send to/ })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Back to your chat" }));
      expect(composer()).toBeTruthy();
    });

    it("says so when the client's thread could not be loaded", () => {
      render(
        <AskChat
          config={chatConfig({
            initialAssistant: loadOf([], { assistantThreads: clientThreads }),
            initialClientAssistant: { ok: false, message: "fail", correlationId: "abcd1234-5678-90ab-cdef-1234567890ab", retryable: true },
          })}
          variant="panel"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Read them" }));
      expect(screen.getByText(/Couldn't load Dana's questions/)).toBeTruthy();
      expect(screen.getByText(/abcd1234/)).toBeTruthy();
    });

    it("leaves the row out on an own hive and when the client has asked nothing", () => {
      const { unmount } = render(
        <AskChat
          config={chatConfig({ firmless: true, initialAssistant: loadOf([], { assistantThreads: clientThreads }) })}
          variant="panel"
        />,
      );
      expect(screen.queryByTestId("ask-client-questions-row")).toBeNull();
      unmount();

      render(
        <AskChat
          config={chatConfig({
            initialAssistant: loadOf([], {
              assistantThreads: [{ ...clientThreads[1]!, messageCount: 0 }],
            }),
          })}
          variant="panel"
        />,
      );
      expect(screen.queryByTestId("ask-client-questions-row")).toBeNull();
    });
  });

  describe("client view", () => {
    const clientConfig = (initial = loadOf([])) =>
      chatConfig({
        audience: "client",
        currentUserId: CLIENT_ID,
        viewerFirstName: "Dana",
        initialAssistant: initial,
        // The staff member's thread is visible in the data a staff page loads; a client must never see it.
        initialClientAssistant: loadOf([personMessage("Staff-only question")]),
      });

    it("never shows staff's thread or a way to read it", () => {
      render(
        <AskChat
          config={clientConfig(
            loadOf([], {
              assistantThreads: [{ userId: STAFF_ID, displayName: "Priya Shah", roleLabel: "Staff", messageCount: 5, lastAt: null }],
            }),
          )}
          variant="sheet"
        />,
      );
      expect(screen.queryByTestId("ask-client-questions-row")).toBeNull();
      expect(screen.queryByRole("button", { name: "Read them" })).toBeNull();
      expect(screen.queryByText("Staff-only question")).toBeNull();
      expect(screen.getByTestId("ask-hint").textContent).toContain("Priya's team can see your questions.");
    });

    it("reads only the client's own thread", async () => {
      const { state } = installChatFetch();
      render(<AskChat config={clientConfig()} variant="sheet" refreshOnMount />);
      await waitFor(() => expect(state.gets.length).toBeGreaterThan(0));
      for (const href of state.gets) {
        expect(href).toContain("channel=assistant");
        expect(href).toContain(`threadOwner=${CLIENT_ID}`);
      }
    });

    it("hands off to the person exactly once and then says it was sent", async () => {
      const { state } = installChatFetch();
      const q = personMessage("Can I settle early?", { authorRole: "client", authorUserId: CLIENT_ID });
      const a = assistantMessage("I can't tell from the documents.", q.id, { assistantRunStatus: "routed" });
      const onHandedOff = vi.fn();
      const { rerender } = render(
        <AskChat config={clientConfig(loadOf([q, a]))} variant="sheet" handedOffIds={new Set()} onHandedOff={onHandedOff} />,
      );

      const button = screen.getByRole("button", { name: "Ask Priya" });
      fireEvent.click(button);
      fireEvent.click(button);

      await waitFor(() => expect(onHandedOff).toHaveBeenCalledTimes(1));
      expect(state.posts.filter((post) => post.channel === "people")).toEqual([
        expect.objectContaining({ body: "Can I settle early?", handoffFrom: a.id }),
      ]);

      rerender(
        <AskChat config={clientConfig(loadOf([q, a]))} variant="sheet" handedOffIds={new Set([a.id])} onHandedOff={onHandedOff} />,
      );
      expect(screen.getByTestId("ask-handoff-sent").textContent).toContain("Sent to Priya");
      expect(screen.queryByRole("button", { name: "Ask Priya" })).toBeNull();
    });

    it("offers no hand-off on a hive without a firm", () => {
      const q = personMessage("Q", { authorRole: "owner" });
      const a = assistantMessage("A", q.id, { assistantRunStatus: "routed" });
      render(<AskChat config={chatConfig({ firmless: true, initialAssistant: loadOf([q, a]) })} variant="sheet" />);
      expect(screen.queryByTestId("ask-handoff")).toBeNull();
    });
  });
});
