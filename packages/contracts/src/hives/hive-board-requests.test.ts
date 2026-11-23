import { describe, expect, it } from "vitest";

import { buildHiveBoardChecklistFromRequests, buildMyWorkModel, isProRequest } from "./hive-board-requests";
import { normalizeListRequestsResponse, type RequestHistoryEvent, type RequestItem } from "./hive-request-contracts";

const CLIENT = "00000000-0000-4000-8000-00000000000c";
const PRO = "00000000-0000-4000-8000-00000000000p";

const client = { userId: CLIENT, displayName: "Casey Client", roleKind: "client", roleLabel: "Client" };
const pro = { userId: PRO, displayName: "Pat Pro", roleKind: "staff", roleLabel: "Paralegal" };

const base = (partial: Partial<RequestItem>): RequestItem => ({
  id: "req-1",
  hiveId: "hive-1",
  source: "pack",
  packRowKey: "pay stubs",
  title: "Pay stubs",
  detail: null,
  position: 1,
  state: "WAITING",
  stateNote: null,
  acceptedBy: null,
  createdAt: "2026-11-17T00:00:00.000Z",
  updatedAt: "2026-11-17T00:00:00.000Z",
  documents: [],
  latestCheck: null,
  ...partial,
});

const event = (partial: Partial<RequestHistoryEvent>): RequestHistoryEvent => ({
  id: "ev-1",
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

describe("buildHiveBoardChecklistFromRequests", () => {
  it("shows waiting items from list_requests", () => {
    const built = buildHiveBoardChecklistFromRequests([base({})], "/hives/h/documents");
    expect(built.checklist[0]?.statusText).toBe("Waiting");
    expect(built.progress?.total).toBe(1);
  });
});

describe("buildMyWorkModel", () => {
  const requests: RequestItem[] = [
    base({ id: "waiting", requestedBy: pro, history: [event({ id: "a" })] }),
    base({
      id: "received",
      title: "Lease",
      state: "RECEIVED",
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
        event({ id: "b1" }),
        event({ id: "b2", fromState: "WAITING", toState: "RECEIVED", actor: client, createdAt: "2026-11-18T00:00:00.000Z" }),
      ],
    }),
    base({
      id: "responded",
      title: "Tax return",
      state: "NEEDS_REVIEW",
      stateNote: "Never filed",
      history: [
        event({ id: "c1" }),
        event({
          id: "c2",
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
    base({
      id: "done",
      title: "ID",
      state: "CHECKED",
      updatedAt: "2026-11-20T00:00:00.000Z",
      history: [
        event({ id: "d1" }),
        event({ id: "d2", fromState: "RECEIVED", toState: "CHECKED", createdAt: "2026-11-20T00:00:00.000Z" }),
      ],
    }),
    base({ id: "skipped", title: "Old bills", state: "NOT_NEEDED", history: [event({ id: "e1" })] }),
  ];

  it("groups a client's requests by stored state", () => {
    const model = buildMyWorkModel(requests, "client", CLIENT);
    const byKey = Object.fromEntries(model.groups.map((group) => [group.key, group.requests.map((row) => row.id)]));
    expect(model.groups.map((group) => group.label)).toEqual(["What I've done", "Waiting on me", "Waiting on Pro"]);
    expect(byKey.waiting_on_me).toEqual(["waiting"]);
    expect(byKey.waiting_on_other).toEqual(["received", "responded"]);
    expect(byKey.done).toEqual(["done", "skipped"]);
  });

  it("mirrors the groups for staff", () => {
    const model = buildMyWorkModel(requests, "staff", PRO);
    const byKey = Object.fromEntries(model.groups.map((group) => [group.key, group.requests.map((row) => row.id)]));
    expect(model.groups.map((group) => group.label)).toEqual(["Waiting on me", "Waiting on client", "Done"]);
    expect(byKey.waiting_on_me).toEqual(["received", "responded"]);
    expect(byKey.waiting_on_other).toEqual(["waiting"]);
  });

  it("offers upload, reply and respond only on the client's waiting items", () => {
    const model = buildMyWorkModel(requests, "client", CLIENT);
    const row = (id: string) => model.groups.flatMap((group) => group.requests).find((item) => item.id === id)!;
    expect(row("waiting").actions).toEqual(["upload", "reply", "respond"]);
    expect(row("responded").actions).toEqual(["reply"]);
    expect(row("done").actions).toEqual(["reply"]);
  });

  it("offers accept to staff only when a document is attached", () => {
    const model = buildMyWorkModel(requests, "staff", PRO);
    const row = (id: string) => model.groups.flatMap((group) => group.requests).find((item) => item.id === id)!;
    expect(row("received").actions).toContain("accept");
    expect(row("responded").actions).not.toContain("accept");
    expect(row("responded").actions).toContain("not_needed");
  });

  it("describes a client response from each side", () => {
    const asClient = buildMyWorkModel(requests, "client", CLIENT).groups.flatMap((g) => g.requests);
    const asStaff = buildMyWorkModel(requests, "staff", PRO).groups.flatMap((g) => g.requests);
    expect(asClient.find((row) => row.id === "responded")?.statusText).toBe("You said you don't have it");
    expect(asStaff.find((row) => row.id === "responded")?.statusText).toBe("Client says they don't have it");
  });

  it("keeps requester, completion date and history", () => {
    const model = buildMyWorkModel(requests, "client", CLIENT);
    const rows = model.groups.flatMap((group) => group.requests);
    const waiting = rows.find((row) => row.id === "waiting")!;
    expect(waiting.requesterName).toBe("Pat Pro");
    expect(waiting.history[0]).toMatchObject({ actorName: "Pat Pro", text: "requested this" });
    const done = rows.find((row) => row.id === "done")!;
    expect(done.completedAt).toBe("2026-11-20T00:00:00.000Z");
    expect(done.history.at(-1)).toMatchObject({ actorName: "Pat Pro", text: "accepted it" });
    expect(rows.find((row) => row.id === "received")!.history.at(-1)?.actorName).toBe("You");
  });

  it("lists the viewer's own uploads and responses as activity, newest first", () => {
    const model = buildMyWorkModel(requests, "client", CLIENT);
    expect(model.myActivity.map((line) => line.text)).toEqual([
      "You said you don't have it: Tax return",
      "You uploaded lease.pdf for Lease",
    ]);
    expect(buildMyWorkModel(requests, "staff", PRO).myActivity.some((line) => line.text.includes("uploaded"))).toBe(false);
  });

  it("shows a reply's message text in history", () => {
    const item = base({
      history: [event({ id: "r", kind: "reply", messageId: "m1", actor: client })],
      messages: [{ id: "m1", body: "Sending tonight", author: client, createdAt: "2026-11-17T00:00:00.000Z" }],
    });
    const [line] = buildMyWorkModel([item], "staff", PRO).groups.flatMap((g) => g.requests)[0]!.history;
    expect(line).toMatchObject({ actorName: "Casey Client", text: "replied", note: "Sending tonight" });
  });

  it("treats requests without history as plain stored state", () => {
    const model = buildMyWorkModel([base({ state: "READING" })], "client", CLIENT);
    expect(model.groups.find((group) => group.key === "waiting_on_other")?.requests).toHaveLength(1);
    expect(model.groups.flatMap((g) => g.requests)[0]?.requesterName).toBe("Starting checklist");
  });
});

describe("isProRequest", () => {
  it("treats only a person-created request as a Pro request", () => {
    expect(isProRequest(base({ source: "staff", packRowKey: null }))).toBe(true);
    expect(isProRequest(base({ source: "pack" }))).toBe(false);
  });
});

describe("normalizeListRequestsResponse history", () => {
  it("keeps valid history, messages and requester and drops malformed rows", () => {
    const parsed = normalizeListRequestsResponse({
      requests: [
        {
          id: "r1",
          hiveId: "h1",
          source: "staff",
          title: "Lease",
          position: 1,
          state: "NEEDS_REVIEW",
          requestedBy: pro,
          history: [
            { id: "e1", kind: "response", toState: "NEEDS_REVIEW", fromState: "WAITING", response: "DOESNT_APPLY", actorKind: "person", actor: client, createdAt: "2026-11-17T00:00:00Z" },
            { id: "e2", toState: "BOGUS", createdAt: "2026-11-17T00:00:00Z" },
          ],
          messages: [{ id: "m1", body: "hi", author: null, createdAt: "2026-11-17T00:00:00Z" }, { id: 3 }],
        },
      ],
    });
    const item = parsed!.requests[0]!;
    expect(item.requestedBy?.displayName).toBe("Pat Pro");
    expect(item.history).toHaveLength(1);
    expect(item.history?.[0]?.response).toBe("DOESNT_APPLY");
    expect(item.messages).toHaveLength(1);
  });
});
