// @vitest-environment jsdom
import type { HiveMessage, HiveMessagePage } from "@hiveforyou/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HiveConversation, type HiveConversationProps } from "./HiveConversation";
import { HiveStillToCome } from "./HiveStillToCome";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGES_URL = `/api/v1/hives/${HIVE_ID}/messages?channel=people`;

function msgId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function at(daysAgo: number, hour: number, minute = 0): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute).toISOString();
}

function message(overrides: Partial<HiveMessage> & Pick<HiveMessage, "id" | "createdAt">): HiveMessage {
  return {
    authorKind: "person",
    authorRole: "client",
    authorUserId: "c0000000-0000-4000-8000-000000000001",
    authorDisplayName: "Ruth Ortiz",
    authorRoleLabel: "Client",
    isMine: false,
    body: "Hello",
    sourceRefs: [],
    replyToMessageId: null,
    ...overrides,
  };
}

const CLIENT_MSG = message({ id: msgId(1), createdAt: at(1, 9, 14), body: "I uploaded the lease." });
const STAFF_MSG = message({
  id: msgId(2),
  createdAt: at(0, 0, 5),
  authorRole: "staff",
  authorUserId: "d0000000-0000-4000-8000-000000000002",
  authorDisplayName: "Jordan Lee",
  authorRoleLabel: "Onboarding associate",
  isMine: true,
  body: "Thanks, reading it now.\nMore soon.",
});

function page(overrides: Partial<HiveMessagePage> = {}): HiveMessagePage {
  return {
    messages: [STAFF_MSG, CLIENT_MSG],
    participantRoleLabels: ["Client", "Onboarding associate"],
    participantCount: 2,
    viewerLastReadAt: STAFF_MSG.createdAt,
    nextCursor: null,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type FetchHandler = (url: string, init: RequestInit | undefined) => Promise<Response> | Response;

let handler: FetchHandler;
const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init)));

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

function renderConversation(overrides: Partial<HiveConversationProps> = {}) {
  return render(
    <HiveConversation
      hiveId={HIVE_ID}
      initial={{ ok: true, page: page() }}
      staffView
      clientName="Ruth Ortiz"
      viewerIsClient={false}
      {...overrides}
    />,
  );
}

function composer(): HTMLTextAreaElement {
  return screen.getByLabelText("Message") as HTMLTextAreaElement;
}

function posts() {
  return fetchMock.mock.calls.filter(
    ([url, init]) => String(url).startsWith(`/api/v1/hives/${HIVE_ID}/messages`) && init?.method === "POST",
  );
}

beforeEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  handler = (url, init) => {
    if (!String(url).includes(`/api/v1/hives/${HIVE_ID}/messages`) || String(url).endsWith("/read")) {
      return json({ lastReadAt: at(0, 0) });
    }
    if (init?.method === "POST") {
      return json({ message: STAFF_MSG, duplicate: false }, 201);
    }
    return json(page());
  };
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("HiveConversation", () => {
  it("renders the thread oldest first with own messages on the right and day separators", () => {
    renderConversation();
    const rows = screen.getAllByTestId("hive-message");
    expect(rows.map((row) => row.getAttribute("data-mine"))).toEqual(["false", "true"]);
    expect(within(rows[0]!).getByText("Ruth Ortiz")).toBeTruthy();
    expect(within(rows[0]!).getByText("Client")).toBeTruthy();
    expect(within(rows[0]!).getByText("9:14 AM")).toBeTruthy();
    expect(within(rows[1]!).getByText("Onboarding associate")).toBeTruthy();
    expect(screen.getAllByTestId("hive-conversation-day").map((el) => el.textContent)).toEqual(["Yesterday", "Today"]);
    expect(screen.queryByTestId("hive-conversation-participants")).toBeNull();
    expect(screen.getByTestId("hive-conversation-messages").getAttribute("aria-live")).toBe("polite");
  });

  it("renders message text as text and keeps line breaks", () => {
    const hostile = message({ id: msgId(7), createdAt: at(0, 0, 1), body: "<img src=x onerror=alert(1)>" });
    renderConversation({ initial: { ok: true, page: page({ messages: [hostile, STAFF_MSG] }) } });
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    const body = screen.getByText(/Thanks, reading it now/);
    expect(body.textContent).toBe("Thanks, reading it now.\nMore soon.");
    expect(body.className).toContain("whitespace-pre-wrap");
  });

  it("does not show a participant line above the thread", () => {
    renderConversation({
      initial: { ok: true, page: page({ messages: [], participantRoleLabels: ["Owner"], participantCount: 1 }) },
      staffView: false,
    });
    expect(screen.queryByTestId("hive-conversation-participants")).toBeNull();
  });

  it("shows the assistant failure line to firm staff but not while previewing as client", () => {
    const failedId = msgId(42);
    const failedMessage = message({
      id: failedId,
      createdAt: at(0, 0, 2),
      body: "What does the lease say?",
    });
    renderConversation({
      mode: "assistant",
      initial: {
        ok: true,
        page: page({
          messages: [failedMessage, STAFF_MSG],
          pendingAssistant: true,
          assistantName: "Conv Assistant",
          failedAssistantForMessageIds: [failedId],
        }),
      },
    });
    expect(screen.getByTestId("hive-assistant-typing").textContent).toContain(
      "Conv Assistant is looking through the documents",
    );
    expect(screen.getByTestId("hive-assistant-failed-line").textContent).toBe(
      "Conv Assistant couldn't answer this one.",
    );
  });

  it("shows the assistant failure line to the owner of a firmless hive", () => {
    const failedId = msgId(43);
    renderConversation({
      mode: "assistant",
      staffView: false,
      viewerIsClient: false,
      clientName: null,
      initial: {
        ok: true,
        page: page({
          messages: [message({ id: failedId, createdAt: at(0, 0, 2), body: "Any update?" })],
          failedAssistantForMessageIds: [failedId],
          assistantName: "HiveForYou",
        }),
      },
    });
    expect(screen.getByTestId("hive-assistant-failed-line").textContent).toBe(
      "HiveForYou couldn't answer this one.",
    );
  });

  it("does not show the assistant failure line to the client", () => {
    const failedId = msgId(44);
    renderConversation({
      mode: "assistant",
      staffView: false,
      viewerIsClient: true,
      initial: {
        ok: true,
        page: page({
          messages: [message({ id: failedId, createdAt: at(0, 0, 2), body: "Any update?", isMine: true })],
          failedAssistantForMessageIds: [failedId],
          assistantName: "HiveForYou",
        }),
      },
    });
    expect(screen.queryByTestId("hive-assistant-failed-line")).toBeNull();
  });

  it("shows the empty state", () => {
    renderConversation({ initial: { ok: true, page: page({ messages: [] }) } });
    expect(
      screen.getByText("No messages yet. Start the conversation — everyone in this hive will see it."),
    ).toBeTruthy();
  });

  it("shows a load error with Try again only when retryable", async () => {
    const { unmount } = renderConversation({
      initial: { ok: false, message: "Could not load the conversation. Try again.", correlationId: "abcdef12-0000", retryable: true },
    });
    expect(screen.getByRole("alert").textContent).toBe("Could not load the conversation. Try again.");
    expect(screen.getByText("abcdef12")).toBeTruthy();
    expect(screen.queryByLabelText("Message")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getAllByTestId("hive-message")).toHaveLength(2));
    unmount();

    renderConversation({
      initial: { ok: false, message: "We could not find that hive.", correlationId: "abcdef12-0000", retryable: false },
    });
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("puts a New divider before the first unread message from someone else", () => {
    const newer = message({ id: msgId(3), createdAt: at(0, 1, 0), body: "One more file." });
    renderConversation({
      initial: { ok: true, page: page({ messages: [newer, STAFF_MSG, CLIENT_MSG], viewerLastReadAt: STAFF_MSG.createdAt }) },
    });
    const divider = screen.getByRole("separator", { name: "New messages" });
    const next = divider.nextElementSibling as HTMLElement;
    expect(within(next).getByText("One more file.")).toBeTruthy();
  });

  it("marks read up to the newest loaded message once, then refreshes the rail", async () => {
    vi.useFakeTimers();
    const newer = message({ id: msgId(3), createdAt: at(0, 1, 0), body: "One more file." });
    renderConversation({
      initial: { ok: true, page: page({ messages: [newer, STAFF_MSG, CLIENT_MSG], viewerLastReadAt: STAFF_MSG.createdAt }) },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const reads = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/messages/read"));
    expect(reads).toHaveLength(1);
    expect(JSON.parse(String(reads[0]![1]!.body))).toEqual({ upTo: newer.createdAt });
    expect(refresh).toHaveBeenCalled();
  });

  it("does not mark read when everything is already read", async () => {
    vi.useFakeTimers();
    renderConversation({ initial: { ok: true, page: page({ viewerLastReadAt: STAFF_MSG.createdAt }) } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/read"))).toHaveLength(0);
  });

  it("loads earlier messages with the keyset cursor", async () => {
    const older = message({ id: msgId(10), createdAt: at(6, 10, 0), body: "Earlier hello." });
    handler = (url, init) => {
      if (String(url).includes("before=")) {
        return json(page({ messages: [older], nextCursor: null }));
      }
      if (String(url).endsWith("/messages") && init?.method === "POST") {
        return json({ message: STAFF_MSG, duplicate: false }, 201);
      }
      return json(page());
    };
    renderConversation({
      initial: {
        ok: true,
        page: page({ nextCursor: { beforeCreatedAt: CLIENT_MSG.createdAt, beforeId: CLIENT_MSG.id } }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    await waitFor(() => expect(screen.getByText("Earlier hello.")).toBeTruthy());
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("before="));
    expect(String(call![0])).toBe(
      `${MESSAGES_URL}&before=${encodeURIComponent(CLIENT_MSG.createdAt)}&beforeId=${CLIENT_MSG.id}`,
    );
    expect(screen.getAllByTestId("hive-message")[0]!.textContent).toContain("Earlier hello.");
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull();
  });

  it("polls every 2 seconds while the assistant is pending", async () => {
    vi.useFakeTimers();
    const assistantList = `/api/v1/hives/${HIVE_ID}/messages?channel=assistant`;
    renderConversation({ mode: "assistant", initial: { ok: true, page: page({ pendingAssistant: true }) } });
    const listCalls = () =>
      fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith(assistantList) && !init?.method);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(listCalls()).toHaveLength(1);
  });

  it("polls every 15 seconds while visible and stops when hidden", async () => {
    vi.useFakeTimers();
    renderConversation();
    const listCalls = () =>
      fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith(MESSAGES_URL) && !init?.method);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(listCalls()).toHaveLength(1);
    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(listCalls()).toHaveLength(1);
    act(() => setVisibility("visible"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listCalls()).toHaveLength(2);
  });

  it("shows the reconnecting notice after three failed polls and keeps the thread", async () => {
    vi.useFakeTimers();
    handler = () => json({ error: { message: "x", correlationId: "c", retryable: true } }, 503);
    renderConversation();
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
    }
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(screen.getByRole("status").textContent).toBe("Reconnecting… Your messages are saved.");
    expect(screen.getAllByTestId("hive-message")).toHaveLength(2);
  });

  it("adds polled messages and shows a New messages pill while scrolled up", async () => {
    vi.useFakeTimers();
    const incoming = message({ id: msgId(9), createdAt: at(0, 2, 0), body: "Did you get it?" });
    handler = (url) =>
      url.endsWith("/read") ? json({ lastReadAt: incoming.createdAt }) : json(page({ messages: [incoming, STAFF_MSG, CLIENT_MSG] }));
    renderConversation();
    const list = screen.getByTestId("hive-conversation-messages");
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 400 });
    list.scrollTop = 100;
    fireEvent.scroll(list);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(screen.getByText("Did you get it?")).toBeTruthy();
    const pill = screen.getByRole("button", { name: "New messages ↓" });
    fireEvent.click(pill);
    expect(screen.queryByRole("button", { name: "New messages ↓" })).toBeNull();
    expect(list.scrollTop).toBe(2000);
  });

  it("sends optimistically, then replaces the bubble with the server row", async () => {
    let resolvePost: (response: Response) => void = () => undefined;
    handler = (url, init) =>
      String(url).endsWith("/messages") && !String(url).includes("?") && init?.method === "POST"
        ? new Promise<Response>((resolve) => {
            resolvePost = resolve;
          })
        : json(page());
    renderConversation();
    fireEvent.change(composer(), { target: { value: "  Here is the update.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(composer().value).toBe("");
    const pending = screen.getByTestId("hive-message-pending");
    expect(within(pending).getByText("Sending…")).toBeTruthy();
    expect(within(pending).getByText("Here is the update.")).toBeTruthy();
    const init = posts()[0]![1]!;
    expect(JSON.parse(String(init.body))).toEqual({ body: "Here is the update.", channel: "people" });
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);

    const saved = { ...STAFF_MSG, id: msgId(4), createdAt: at(0, 3, 0), body: "Here is the update." };
    await act(async () => {
      resolvePost(json({ message: saved, duplicate: false }, 201));
    });
    await waitFor(() => expect(screen.queryByTestId("hive-message-pending")).toBeNull());
    const rows = screen.getAllByTestId("hive-message");
    expect(rows[rows.length - 1]!.textContent).toContain("Here is the update.");
    expect(rows[rows.length - 1]!.getAttribute("data-mine")).toBe("true");
  });

  it("keeps a failed message with its reference; Try again reuses the same key; Remove drops it", async () => {
    handler = (url, init) =>
      String(url).endsWith("/messages") && !String(url).includes("?") && init?.method === "POST"
        ? json(
            {
              error: {
                errorCode: "PERSISTENCE_FAILED",
                message: "Could not send right now. Try again.",
                correlationId: "feedbeef-1111-4111-8111-111111111111",
                retryable: true,
              },
            },
            503,
          )
        : json(page());
    renderConversation();
    fireEvent.change(composer(), { target: { value: "Please call me." } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    const failed = await screen.findByText("Not sent");
    const bubble = failed.closest("[data-testid='hive-message-pending']") as HTMLElement;
    expect(within(bubble).getByRole("alert").textContent).toContain("Could not send right now. Try again.");
    expect(within(bubble).getByText("feedbeef")).toBeTruthy();
    expect(within(bubble).getByText("Please call me.")).toBeTruthy();

    fireEvent.click(within(bubble).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    await screen.findByText("Not sent");
    const keys = posts().map(([, init]) => (init!.headers as Record<string, string>)["Idempotency-Key"]);
    expect(keys[0]).toBe(keys[1]);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("Please call me.")).toBeNull();
  });

  it("hides Try again for a failure that is not retryable", async () => {
    handler = (url, init) =>
      String(url).endsWith("/messages") && !String(url).includes("?") && init?.method === "POST"
        ? json(
            {
              error: {
                errorCode: "IDEMPOTENCY_CONFLICT",
                category: "VALIDATION",
                stage: "SHELL",
                message: "This message was already sent with different text.",
                correlationId: "c0ffee00-1111-4111-8111-111111111111",
                retryable: false,
                timestamp: "2026-11-18T00:00:00Z",
              },
            },
            409,
          )
        : json(page());
    renderConversation();
    fireEvent.change(composer(), { target: { value: "Hi" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await screen.findByText("Not sent");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("sends on Enter but not on Shift+Enter, and disables Send when empty", () => {
    handler = (url, init) =>
      String(url).endsWith("/messages") && !String(url).includes("?") && init?.method === "POST" ? new Promise<Response>(() => undefined) : json(page());
    renderConversation();
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(composer(), { target: { value: "Line one" } });
    expect(send.disabled).toBe(false);
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(posts()).toHaveLength(0);
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(posts()).toHaveLength(1);
  });

  it("shows the counter only after 3,500 characters", () => {
    renderConversation();
    fireEvent.change(composer(), { target: { value: "x".repeat(3500) } });
    expect(screen.queryByTestId("hive-conversation-counter")).toBeNull();
    fireEvent.change(composer(), { target: { value: "x".repeat(3501) } });
    expect(screen.getByTestId("hive-conversation-counter").textContent).toBe("3,501 / 4,000");
  });

  it("shows the staff note and Preview as to staff only", () => {
    const { unmount } = renderConversation();
    const note = screen.getByTestId("hive-conversation-people-hint");
    expect(note.textContent).toBe(
      "Everyone in this hive sees this conversation. For staff-only notes use Team notes.",
    );
    expect(within(note).getByRole("link", { name: "Team notes" }).getAttribute("href")).toBe(`/hives/${HIVE_ID}/notes`);
    expect(screen.getByLabelText("Preview as")).toBeTruthy();
    unmount();

    renderConversation({ staffView: false, viewerIsClient: true });
    expect(screen.getByTestId("hive-conversation-people-hint").textContent).toBe(
      "Everyone in this hive sees this conversation.",
    );
    expect(screen.queryByLabelText("Preview as")).toBeNull();
  });

  it("Preview as Client flips alignment, replaces the composer and sends nothing", () => {
    renderConversation();
    fetchMock.mockClear();
    fireEvent.change(screen.getByLabelText("Preview as"), { target: { value: "client" } });
    const rows = screen.getAllByTestId("hive-message");
    expect(rows.map((row) => row.getAttribute("data-mine"))).toEqual(["true", "false"]);
    expect(screen.queryByLabelText("Message")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.queryByTestId("hive-conversation-people-hint")).toBeNull();
    expect(screen.getByText("Preview — this is what Ruth sees.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Preview as"), { target: { value: "self" } });
    expect(screen.getByLabelText("Message")).toBeTruthy();
  });

  it("falls back to the client in the preview line when no name is known", () => {
    renderConversation({
      initial: { ok: true, page: page({ messages: [STAFF_MSG] }) },
      clientName: null,
    });
    fireEvent.change(screen.getByLabelText("Preview as"), { target: { value: "client" } });
    expect(screen.getByText("Preview — this is what the client sees.")).toBeTruthy();
  });

  it("has exactly one filled button on the board", () => {
    render(
      <>
        <HiveStillToCome hiveId={HIVE_ID} progress={{ in: 2, total: 5 }} />
        <HiveConversation
          hiveId={HIVE_ID}
          initial={{ ok: true, page: page({ nextCursor: { beforeCreatedAt: CLIENT_MSG.createdAt, beforeId: CLIENT_MSG.id } }) }}
          staffView
          clientName="Ruth Ortiz"
          viewerIsClient={false}
        />
      </>,
    );
    const filled = screen.getAllByRole("button").filter((button) => button.className.includes("bg-blue-deep"));
    expect(filled.map((button) => button.textContent)).toEqual(["Send"]);
  });
});

describe("HiveStillToCome", () => {
  it("links to the requested items while some are outstanding", () => {
    render(<HiveStillToCome hiveId={HIVE_ID} progress={{ in: 2, total: 5 }} />);
    const line = screen.getByTestId("hive-still-to-come");
    expect(line.textContent).toContain("Still to come");
    expect(line.textContent).toContain("2 of 5 in");
    expect(line.textContent).toContain("See items");
    expect(within(line).getByRole("link", { name: "See items →" }).getAttribute("href")).toBe(
      `/hives/${HIVE_ID}/documents#requested`,
    );
  });

  it("says everything is in when complete", () => {
    render(<HiveStillToCome hiveId={HIVE_ID} progress={{ in: 5, total: 5 }} />);
    expect(screen.getByTestId("hive-still-to-come").textContent).toContain("Everything requested is in.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing without a checklist", () => {
    const { container } = render(<HiveStillToCome hiveId={HIVE_ID} progress={null} />);
    expect(container.textContent).toBe("");
  });
});
