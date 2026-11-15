// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Hive } from "@hiveforyou/contracts";
import { hiveAttention } from "@hiveforyou/contracts";

import { MyHivesPanel } from "./MyHivesPanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/hives-client", () => ({
  fetchMyHives: vi.fn(),
  deleteHive: vi.fn(),
  setHiveKind: vi.fn(),
  HiveClientError: class extends Error {},
}));

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const REQ_ID = "11111111-1111-4111-8111-111111111111";

function hive(overrides: Partial<Hive> = {}): Hive {
  return {
    id: HIVE_ID,
    hiveId: HIVE_ID,
    name: "Alex Carter",
    description: "Benefits application",
    kind: "client",
    clientRequestId: REQ_ID,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-14T00:00:00.000Z",
    ...overrides,
  };
}

const readyAttention = hiveAttention({
  documentCount: 2,
  unreadableDocumentCount: 0,
  documentsNotReadCount: 0,
  activeReadCount: 0,
  processingRunFailed: false,
  processingRunActive: false,
  documentsNotInStudyCount: 0,
  openConflicts: 0,
  openNeeds: 0,
  openChanged: 0,
  openMissing: 0,
  openChecked: 2,
  hasStudy: true,
  hasReport: true,
});

const needsAttention = hiveAttention({
  documentCount: 0,
  unreadableDocumentCount: 0,
  documentsNotReadCount: 0,
  activeReadCount: 0,
  processingRunFailed: false,
  processingRunActive: false,
  documentsNotInStudyCount: 0,
  openConflicts: 0,
  openNeeds: 0,
  openChanged: 0,
  openMissing: 0,
  openChecked: 0,
  hasStudy: false,
  hasReport: false,
});

afterEach(() => {
  cleanup();
});

describe("MyHivesPanel", () => {
  it("renders the clients view with one filled New client button", () => {
    render(
      <MyHivesPanel
        initialHives={[hive()]}
        startingView="clients"
        greetingFirstName="Sam"
        greetingEmail="sam@example.com"
        summaries={{
          [HIVE_ID]: {
            documentCount: 2,
            attention: readyAttention,
            study: null,
          },
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "New client" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Find a client")).toBeTruthy();
  });

  it("filters client hives by name and attention tab", () => {
    const second = hive({
      id: "660e8400-e29b-41d4-a716-446655440001",
      hiveId: "660e8400-e29b-41d4-a716-446655440001",
      name: "Jordan Lee",
      clientRequestId: "22222222-2222-4222-8222-222222222222",
    });
    render(
      <MyHivesPanel
        initialHives={[hive(), second]}
        startingView="clients"
        greetingFirstName="Sam"
        greetingEmail="sam@example.com"
        summaries={{
          [HIVE_ID]: { documentCount: 0, attention: needsAttention, study: null },
          [second.id]: { documentCount: 2, attention: readyAttention, study: null },
        }}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Find a client"), { target: { value: "Jordan" } });
    expect(screen.queryByRole("link", { name: "Alex Carter" })).toBeNull();
    expect(screen.getByRole("link", { name: "Jordan Lee" })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Find a client"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Ready/ }));
    expect(screen.getByRole("link", { name: "Jordan Lee" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Alex Carter" })).toBeNull();
  });

  it("shows the own view empty state with composer only", () => {
    render(
      <MyHivesPanel
        initialHives={[]}
        startingView="own"
        greetingFirstName="Sam"
        greetingEmail="sam@example.com"
      />,
    );
    expect(screen.getByLabelText("Start a Hive")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start a new hive" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New client" })).toBeNull();
  });

  it("still shows a hive name when no summary exists", () => {
    render(
      <MyHivesPanel
        initialHives={[hive({ kind: "own", name: "Untitled hive" })]}
        startingView="own"
        greetingFirstName="Sam"
        greetingEmail="sam@example.com"
      />,
    );
    expect(screen.getByRole("link", { name: "Untitled hive" })).toBeTruthy();
    expect(screen.getByText("No documents yet.")).toBeTruthy();
  });

  it("renders state line colours in brand order without zero counts", () => {
    render(
      <MyHivesPanel
        initialHives={[hive()]}
        startingView="clients"
        greetingFirstName="Sam"
        greetingEmail="sam@example.com"
        summaries={{
          [HIVE_ID]: {
            documentCount: 2,
            attention: {
              level: "ready",
              sentence: "Everything is read and checked.",
              counts: { needs: 1, missing: 2, checked: 3 },
            },
            study: null,
          },
        }}
      />,
    );
    const row = screen.getByTestId("hive-list-row");
    expect(within(row).getByText("1 need you")).toBeTruthy();
    expect(within(row).getByText("2 missing")).toBeTruthy();
    expect(within(row).getByText("3 checked")).toBeTruthy();
    expect(within(row).queryByText(/^0 /)).toBeNull();
  });
});