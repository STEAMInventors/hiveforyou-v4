// @vitest-environment jsdom
import type { Hive, ListFirmResponse } from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.fn();
const retrySameKeyMock = vi.fn();
const actionState = {
  pending: false,
  inlineError: null as null | { message: string; reference?: string; retryable?: boolean },
  run: runMock,
  retrySameKey: retrySameKeyMock,
};

vi.mock("@/components/workspace/useWorkspaceAction", () => ({
  useWorkspaceAction: () => actionState,
}));

import { HandOverDialog } from "./HandOverDialog";

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const MARIA = "11111111-1111-4111-8111-111111111111";
const ALEX = "22222222-2222-4222-8222-222222222222";

const hive: Hive = {
  id: HIVE_ID,
  hiveId: HIVE_ID,
  name: "Ruth",
  description: null,
  kind: "client",
  clientRequestId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  assigneeUserId: MARIA,
};

const firm: ListFirmResponse = {
  firm: { firmId: "33333333-3333-4333-8333-333333333333", name: "Rivera", assistantName: "Sam", callerRole: "owner" },
  members: [
    {
      userId: MARIA,
      email: "maria@example.com",
      role: "owner",
      title: "Attorney",
      state: "active",
      joined: true,
      displayName: "Maria Alvarez",
    },
    {
      userId: ALEX,
      email: "alex@example.com",
      role: "attorney",
      title: "Paralegal",
      state: "active",
      joined: true,
      displayName: "Alex Kim",
    },
  ],
  pendingInvitations: [],
};

function renderDialog(overrides: { open?: boolean; onClose?: () => void } = {}) {
  const returnFocusRef = { current: document.createElement("button") };
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <HandOverDialog
      open={overrides.open ?? true}
      hive={hive}
      firm={firm}
      currentUserId={ALEX}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
    />,
  );
  return { onClose, returnFocusRef };
}

afterEach(() => {
  cleanup();
  actionState.pending = false;
  actionState.inlineError = null;
  runMock.mockReset();
});

describe("HandOverDialog", () => {
  beforeEach(() => {
    runMock.mockResolvedValue(true);
  });

  it("lists members with titles and an Unassigned option", () => {
    renderDialog();
    const select = screen.getByRole("combobox", { name: /hand over to/i });
    const options = within(select).getAllByRole("option");
    const labels = options.map((o) => o.textContent);
    expect(labels).toContain("Unassigned");
    expect(labels.some((t) => t?.includes("Maria Alvarez"))).toBe(true);
    expect(labels.some((t) => t?.startsWith("Me ("))).toBe(true);
  });

  it("refuses handing to the current assignee", async () => {
    renderDialog();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: MARIA } });
    fireEvent.click(screen.getByRole("button", { name: "Hand over" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Maria Alvarez is already on it.");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("shows a character counter up to 1000", () => {
    renderDialog();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: ALEX } });
    const area = screen.getByRole("textbox");
    fireEvent.change(area, { target: { value: "a".repeat(42) } });
    expect(screen.getByText("42/1000")).toBeTruthy();
  });

  it("hides the note field when Unassigned is selected", () => {
    renderDialog();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("__unassigned__");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/unassigned hive keeps no handover note/i)).toBeTruthy();
  });

  it("closes on Escape when not pending", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("focuses the assignee select when opened", async () => {
    renderDialog();
    const select = screen.getByRole("combobox");
    await vi.waitFor(() => expect(document.activeElement).toBe(select));
  });
});