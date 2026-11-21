// @vitest-environment jsdom
import type { Hive } from "@hiveforyou/contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { CORRELATION_HEADER_NAME } from "@/lib/hives-client";

import { HiveTeamNotesPanel } from "./HiveTeamNotesPanel";

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const NOTES_URL = `/api/v1/hives/${HIVE_ID}/team-notes`;

const hive: Hive = {
  id: HIVE_ID,
  hiveId: HIVE_ID,
  name: "Ruth",
  description: null,
  kind: "client",
  clientRequestId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HiveTeamNotesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows inline error on save failure and Try again uses retrySameKey", async () => {
    const keys: string[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { message: "No", correlationId: "abcd1234", errorCode: "X", retryable: true },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ teamNoteId: "n1" }) });
    vi.stubGlobal(
      "fetch",
      vi.fn((url, init) => {
        const headers = init?.headers as Record<string, string>;
        keys.push(headers["Idempotency-Key"]);
        return fetchMock(url, init);
      }),
    );

    render(<HiveTeamNotesPanel hive={hive} firmName="Rivera" clientName="Ruth" notes={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Please review stubs." } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    });

    expect((await screen.findByRole("alert")).textContent).toContain("No");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it("sends different idempotency keys for two separate saves", async () => {
    const keys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        const headers = init?.headers as Record<string, string>;
        keys.push(headers["Idempotency-Key"]);
        expect(headers[CORRELATION_HEADER_NAME]).toBeTruthy();
        return Promise.resolve({ ok: true, json: async () => ({ teamNoteId: "n" }) });
      }),
    );

    render(<HiveTeamNotesPanel hive={hive} firmName="Rivera" clientName="Ruth" notes={[]} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "First note" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Second note" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    });

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});