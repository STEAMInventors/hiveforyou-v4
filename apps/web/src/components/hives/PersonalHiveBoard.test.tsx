// @vitest-environment jsdom
import type { RequestItem } from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonalHiveBoard } from "./PersonalHiveBoard";
import { EMPTY_PERSONAL_ROSTER } from "./personal-hive-roster";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => `/hives/${HIVE_ID}`,
  useSearchParams: () => nav.params,
}));

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" }, version: "5.0.0" },
  Document: () => null,
  Page: () => null,
}));

const emptyThread = {
  ok: true as const,
  page: {
    messages: [],
    participantRoleLabels: [],
    participantCount: 1,
    viewerLastReadAt: null,
    nextCursor: null,
  },
};

const hive = {
  id: HIVE_ID,
  hiveId: HIVE_ID,
  name: "Maya",
  description: "Personal file",
  kind: "own" as const,
  clientRequestId: "550e8400-e29b-41d4-a716-446655440000",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  isOwner: true,
  membershipRole: "owner" as const,
};

const packRequest = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  hiveId: HIVE_ID,
  source: "pack",
  packRowKey: "suggested",
  title: "Study suggestion",
  detail: null,
  position: 1,
  state: "WAITING",
  stateNote: null,
  acceptedBy: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  documents: [],
  latestCheck: null,
} satisfies RequestItem;

function renderBoard(search = "") {
  nav.params = new URLSearchParams(search);
  return render(
    <PersonalHiveBoard
      hive={hive}
      assistantName="HiveForYou"
      summary={{
        hasStudy: true,
        documentsIn: 2,
        checklistSize: 3,
        toReview: 1,
        stillToCome: 1,
        study: { revisionNumber: 4, acceptedLabel: "Nov 2" },
      }}
      requests={[packRequest]}
      uploadedDocuments={[{ id: "doc-1", fileName: "maya-lease.pdf", createdAt: "2026-11-02T00:00:00.000Z" }]}
      initialPeople={emptyThread}
      initialAsk={emptyThread}
      currentUserId={OWNER}
      roster={{ ...EMPTY_PERSONAL_ROSTER, ownerName: "Maya", pendingEmail: "pro@example.test" }}
      loadError={null}
      studyLoadError={null}
      view={null}
      sources={null}
      canonicalStudy={null}
      coverageGaps={[]}
    />,
  );
}

afterEach(() => {
  cleanup();
  nav.replace.mockReset();
  vi.unstubAllGlobals();
});

describe("PersonalHiveBoard", () => {
  it("replaces the study home with a summary, My Work, and both channels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ people: [], pendingInvitations: [] })),
    );
    renderBoard();
    expect(screen.getByTestId("personal-case-summary").textContent).toMatch(/Study v4/);
    expect(screen.getByRole("link", { name: "Open the study" }).getAttribute("href")).toBe(`/hives/${HIVE_ID}/findings`);
    expect(screen.queryByText("What the documents show")).toBeNull();
    expect(screen.queryByText("Study suggestion")).toBeNull();
    expect(screen.getByText("maya-lease.pdf")).toBeTruthy();
    expect(screen.getByText("No requests from a Pro yet.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Ask AI (private)" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Pro Conversation (shared)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share with a professional" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Pro Conversation (shared)" }));
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("view=conversation"), { scroll: false });
  });

  it("puts the invitation in the shared empty state and reports a document load failure", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ people: [], pendingInvitations: [] })));
    nav.params = new URLSearchParams("view=conversation");
    render(
      <PersonalHiveBoard
        hive={hive}
        assistantName="HiveForYou"
        summary={{ hasStudy: false, documentsIn: 0, checklistSize: null, toReview: 0, stillToCome: 0, study: null }}
        requests={[]}
        uploadedDocuments={[]}
        documentsLoadError={{ message: "Could not load your documents.", correlationId: "corr-9", retryable: true }}
        initialPeople={emptyThread}
        initialAsk={emptyThread}
        currentUserId={OWNER}
        roster={EMPTY_PERSONAL_ROSTER}
        loadError={null}
        studyLoadError={null}
        view={null}
        sources={null}
        canonicalStudy={null}
        coverageGaps={[]}
      />,
    );
    const shared = screen.getByTestId("personal-pro-panel");
    expect(shared.textContent).toMatch(/A shared place for you and your Pro/);
    expect(shared.textContent).toMatch(/Invite a professional/);
    expect(shared.querySelector("button")?.textContent).toBe("Share with a professional");
    expect(screen.getByTestId("my-work-documents-error").textContent).toMatch(/Could not load your documents/);
    expect(screen.queryByText("No documents uploaded yet.")).toBeNull();
  });

  it("keeps the shared composer closed until a professional joins", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ people: [], pendingInvitations: [] })));
    renderBoard("view=conversation");
    expect(screen.getByTestId("hive-pro-conversation-closed").textContent).toMatch(/pro@example.test is invited/);
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  });

  it("lets an accepted professional add a request and write in the shared channel", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          people: [
            { userId: OWNER, role: "owner", displayName: "Maya", state: "active", joined: true },
            { role: "professional", displayName: "Pat Pro", state: "active", joined: true },
          ],
          pendingInvitations: [],
        }),
      ),
    );
    nav.params = new URLSearchParams("view=conversation");
    render(
      <PersonalHiveBoard
        hive={{ ...hive, isOwner: false, membershipRole: "professional" }}
        assistantName="HiveForYou"
        summary={{ hasStudy: true, documentsIn: 1, checklistSize: null, toReview: 0, stillToCome: 0, study: { revisionNumber: 4, acceptedLabel: "Nov 2" } }}
        requests={[]}
        uploadedDocuments={[]}
        initialPeople={emptyThread}
        initialAsk={emptyThread}
        currentUserId="33333333-3333-4333-8333-333333333333"
        roster={{
          professionalJoined: true,
          professionalName: "Pat Pro",
          ownerName: "Maya",
          pendingEmail: null,
          viewerRole: "professional",
          viewerJoined: true,
        }}
        loadError={null}
        studyLoadError={null}
        view={null}
        sources={null}
        canonicalStudy={null}
        coverageGaps={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "Add a request" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Share with a professional" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
    expect(screen.getByTestId("personal-pro-panel").textContent).toMatch(/With Maya/);
    expect(screen.getByTestId("hive-conversation-people-hint").textContent).toMatch(/Shared with Maya/);
    expect(screen.queryByRole("heading", { name: "Client requests" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Requests" })).toBeTruthy();
  });

  it("treats the people-list owner as the owner when the hive card has no owner role", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          people: [
            { userId: OWNER, role: "owner", displayName: "Aryya", state: "active", joined: true },
            {
              userId: "33333333-3333-4333-8333-333333333333",
              role: "professional",
              displayName: "Aryya Pro",
              state: "active",
              joined: true,
            },
          ],
          pendingInvitations: [],
        }),
      ),
    );
    nav.params = new URLSearchParams();
    render(
      <PersonalHiveBoard
        hive={{ ...hive, isOwner: false, membershipRole: "firm" }}
        assistantName="HiveForYou"
        summary={{ hasStudy: false, documentsIn: 1, checklistSize: null, toReview: 0, stillToCome: 0, study: null }}
        requests={[]}
        uploadedDocuments={[]}
        initialPeople={emptyThread}
        initialAsk={emptyThread}
        currentUserId={OWNER}
        roster={{
          professionalJoined: true,
          professionalName: "Aryya Pro",
          ownerName: "Aryya",
          pendingEmail: null,
          viewerRole: "owner",
          viewerJoined: true,
        }}
        loadError={null}
        studyLoadError={null}
        view={null}
        sources={null}
        canonicalStudy={null}
        coverageGaps={[]}
      />,
    );
    expect(screen.getByRole("heading", { name: /My work and Pro requests/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a request" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Client requests" })).toBeNull();
    expect(screen.getByRole("button", { name: "Share with a professional" })).toBeTruthy();
    expect(screen.getByTestId("personal-pro-panel").textContent).toMatch(/With Aryya Pro/);
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
  });

  it("asks a pending professional to join instead of opening the shared composer", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ people: [], pendingInvitations: [] })));
    nav.params = new URLSearchParams("view=conversation");
    render(
      <PersonalHiveBoard
        hive={{ ...hive, isOwner: false, membershipRole: "professional", memberState: "pending" }}
        assistantName="HiveForYou"
        summary={{ hasStudy: true, documentsIn: 1, checklistSize: null, toReview: 0, stillToCome: 0, study: { revisionNumber: 4, acceptedLabel: "Nov 2" } }}
        requests={[]}
        uploadedDocuments={[]}
        initialPeople={emptyThread}
        initialAsk={emptyThread}
        currentUserId="33333333-3333-4333-8333-333333333333"
        roster={{
          professionalJoined: false,
          professionalName: "Pat Pro",
          ownerName: "Maya",
          pendingEmail: null,
          viewerRole: "professional",
          viewerJoined: false,
        }}
        loadError={null}
        studyLoadError={null}
        view={null}
        sources={null}
        canonicalStudy={null}
        coverageGaps={[]}
      />,
    );
    expect(screen.getByTestId("personal-hive-join")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Join this hive" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a request" })).toBeNull();
    expect(screen.getByTestId("hive-pro-conversation-closed").textContent).toMatch(/haven't joined/);
  });
});
