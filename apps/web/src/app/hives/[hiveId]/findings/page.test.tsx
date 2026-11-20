import { describe, expect, it, vi } from "vitest";

const permanentRedirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => permanentRedirectMock(url),
}));

import FindingsPage from "./page";

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";

function redirected(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^REDIRECT:/, "");
}

describe("Findings redirect", () => {
  it("sends findings, including a legacy tab, to Home#show", async () => {
    await expect(
      FindingsPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({ tab: "gaps", keep: "1" }),
      }),
    ).rejects.toThrow(/REDIRECT:/);
    const url = new URL(redirected(permanentRedirectMock.mock.calls.at(-1)?.[0]), "http://local");
    expect(url.pathname).toBe(`/hives/${HIVE_ID}`);
    expect(url.hash).toBe("#show");
    expect(url.searchParams.get("keep")).toBe("1");
    expect(url.searchParams.has("tab")).toBe(false);
  });
});
