import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/server/hives/load-owned-hive", () => ({
  loadOwnedHiveOrNotFound: vi.fn(async () => ({
    id: "11111111-1111-4111-8111-111111111111",
    hiveId: "11111111-1111-4111-8111-111111111111",
    name: "Test hive",
    description: null,
    kind: "client",
    firmId: "33333333-3333-4333-8333-333333333333",
    clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  })),
}));

import HiveBoardPage from "./page";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

function redirected(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^REDIRECT:/, "");
}

describe("Hive board redirect", () => {
  it("sends the board to Home", async () => {
    await expect(
      HiveBoardPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(/REDIRECT:/);
    expect(redirected(redirectMock.mock.calls.at(-1)?.[0])).toBe(`/hives/${HIVE_ID}`);
  });

  it("turns view=ask into ask=1 and keeps other params so older email links still open", async () => {
    await expect(
      HiveBoardPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({ view: "ask", keep: "1" }),
      }),
    ).rejects.toThrow(/REDIRECT:/);
    const url = new URL(redirected(redirectMock.mock.calls.at(-1)?.[0]), "http://local");
    expect(url.pathname).toBe(`/hives/${HIVE_ID}`);
    expect(url.searchParams.get("ask")).toBe("1");
    expect(url.searchParams.get("keep")).toBe("1");
    expect(url.searchParams.has("view")).toBe(false);
  });
});
