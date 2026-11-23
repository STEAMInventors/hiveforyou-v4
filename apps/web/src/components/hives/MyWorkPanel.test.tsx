// @vitest-environment jsdom
import type { RequestHistoryEvent, RequestItem } from "@hiveforyou/contracts";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MyWorkPanel } from "./MyWorkPanel";

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const PRO = "00000000-0000-4000-8000-0000000000a1";
const REQ_WAITING = "11111111-1111-4111-8111-111111111111";
const REQ_REVIEW = "22222222-2222-4222-8222-222222222222";
const REQ_DONE = "33333333-3333-4333-8333-333333333333";

const client = { userId: CLIENT, displayName: "Casey Client", roleKind: "client", roleLabel: "Client" };
const pro = { userId: PRO, displayName: "Pat Pro", roleKind: "staff", roleLabel: "Paralegal" };

const event = (partial: Partial<RequestHistoryEvent>): RequestHistoryEvent => ({
  id: "ev",
  kind: "state",
  fromState: null,
  toState: "WAITING",
  response: null,
  note: null,
  actorKind: "person",
  actor: pro,
  messageId: null,
  createdAt: "2026-11-17T00:00:00.000Z",
  ...partial,
});

const item = (partial: Partial<RequestItem>): RequestItem => ({
  id: REQ_WAITING,
  hiveId: HIVE_ID,
  source: "staff",
  packRowKey: null,
  title: "Pay stubs",
  detail: "Last three months",
  position: 1,
  state: "WAITING",
  stateNote: null,
  acceptedBy: null,
  createdAt: "2026-11-17T00:00:00.000Z",
  updatedAt: "2026-11-17T00:00:00.000Z",
  documents: [],
  latestCheck: null,
  requestedBy: pro,
  history: [event({ id: "e1" })],
  messages: [],
  ...partial,
});

const REQUESTS: RequestItem[] = [
  item({}),
  item({
    id: REQ_REVIEW,
    title: "Tax return",
    state: "NEEDS_REVIEW",
    stateNote: "Never filed",
    history: [
      event({ id: "e2" }),
      event({
        id: "e3",
        kind: "response",
        fromState: "WAITING",
        toState: "NEEDS_REVIEW",
        response: "DONT_HAVE",
        note: "Never filed",
        actor: client,
        createdAt: "2026-11-19T00:00:00.000Z",
      }),
    ],
  }),
  item({
    id: REQ_DONE,
    title: "Lease",
    state: "CHECKED",
    documents: [
      {
        id: "doc-1",
        fileName: "lease.pdf",
        pageCount: 3,
        createdAt: "2026-11-18T00:00:00.000Z",
        uploadedByDisplayName: "Casey Client",
        uploadedByUserId: CLIENT,
        addedAt: "2026-11-18T00:00:00.000Z",
      },
    ],
    history: [
      event({ id: "e4" }),
      event({ id: "e5", fromState: "WAITING", toState: "RECEIVED", actor: client, createdAt: "2026-11-18T00:00:00.000Z" }),
      event({ id: "e6", fromState: "RECEIVED", toState: "CHECKED", createdAt: "2026-11-20T00:00:00.000Z" }),
    ],
  }),
];

function okJson(body: unknown) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MyWorkPanel", () => {
  it("shows the client what is waiting on them, on the Pro, and what they've done", () => {
    render(
      <MyWorkPanel hiveId={HIVE_ID} viewer="client" currentUserId={CLIENT} initialRequests={REQUESTS} otherFirstName="Pat" />,
    );
    expect(screen.getByTestId("my-work-summary").textContent).toBe("1 waiting on you · 1 waiting on Pat · 1 done");
    const mine = screen.getByTestId("my-work-waiting_on_me");
    expect(within(mine).getByText("Pay stubs")).toBeTruthy();
    expect(within(mine).getByText(/Requested by Pat Pro/)).toBeTruthy();
    expect(within(mine).getByRole("button", { name: /Upload/ })).toBeTruthy();
    expect(within(mine).getByRole("button", { name: "I can't send this" })).toBeTruthy();
    expect(within(screen.getByTestId("my-work-waiting_on_other")).getByText("You said you don't have it")).toBeTruthy();
    expect(within(screen.getByTestId("my-work-activity")).getByText("You uploaded lease.pdf for Lease")).toBeTruthy();
  });

  it("renders nothing for a client with no requests", () => {
    const { container } = render(
      <MyWorkPanel hiveId={HIVE_ID} viewer="client" currentUserId={CLIENT} initialRequests={[]} otherFirstName="Pat" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("sends a client response and shows the refreshed status", async () => {
    const updated = REQUESTS.map((request) =>
      request.id === REQ_WAITING ? { ...request, state: "NEEDS_REVIEW" as const, stateNote: "Not employed then" } : request,
    );
    const fetchMock = vi.fn(async () => okJson({ requests: updated, countsByState: {}, duplicate: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MyWorkPanel hiveId={HIVE_ID} viewer="client" currentUserId={CLIENT} initialRequests={REQUESTS} otherFirstName="Pat" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "I can't send this" }));
    fireEvent.click(screen.getByLabelText("It doesn't apply to me"));
    fireEvent.change(screen.getByLabelText("Note for your Pro"), { target: { value: "Not employed then" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/v1/hives/${HIVE_ID}/requests/${REQ_WAITING}`);
    expect(JSON.parse(String(init.body))).toEqual({ action: "respond", response: "DOESNT_APPLY", note: "Not employed then" });
    expect(screen.getByTestId("my-work-summary").textContent).toBe("0 waiting on you · 2 waiting on Pat · 1 done");
  });

  it("sends a reply with an idempotency key", async () => {
    const fetchMock = vi.fn(async () => okJson({ requests: REQUESTS, countsByState: {}, duplicate: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MyWorkPanel hiveId={HIVE_ID} viewer="client" currentUserId={CLIENT} initialRequests={REQUESTS} otherFirstName="Pat" />,
    );
    const mine = screen.getByTestId("my-work-waiting_on_me");
    fireEvent.click(within(mine).getByRole("button", { name: "Reply" }));
    fireEvent.change(within(mine).getByLabelText("Reply to Pat about this request"), { target: { value: "Uploading tonight" } });
    await act(async () => {
      fireEvent.click(within(mine).getByRole("button", { name: "Send reply" }));
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toEqual({ action: "reply", body: "Uploading tonight" });
  });

  it("shows the staff mirror and an inline error with a reference when an action fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        headers: new Headers(),
        json: async () => ({
          error: {
            message: "This request has changed. Refresh and try again.",
            errorCode: "INVALID_REQUEST",
            retryable: false,
            correlationId: "abcd1234-0000-4000-8000-000000000000",
          },
        }),
      })),
    );
    render(
      <MyWorkPanel hiveId={HIVE_ID} viewer="staff" currentUserId={PRO} initialRequests={REQUESTS} otherFirstName="Casey" />,
    );
    expect(screen.getByTestId("my-work-summary").textContent).toBe("1 waiting on you · 1 waiting on Casey · 1 done");
    const mine = screen.getByTestId("my-work-waiting_on_me");
    expect(within(mine).getByText("Client says they don't have it")).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(mine).getByRole("button", { name: "Not needed" }));
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This request has changed");
    expect(alert.textContent).toContain("Reference abcd1234");
    expect(screen.getByRole("button", { name: "Add a request" })).toBeTruthy();
  });

  it("expands a request to show its history", () => {
    render(
      <MyWorkPanel hiveId={HIVE_ID} viewer="client" currentUserId={CLIENT} initialRequests={REQUESTS} otherFirstName="Pat" />,
    );
    const mine = screen.getByTestId("my-work-waiting_on_me");
    fireEvent.click(within(mine).getByRole("button", { name: "History" }));
    expect(within(screen.getByTestId("my-work-history")).getByText(/Pat Pro requested this/)).toBeTruthy();
  });
});
