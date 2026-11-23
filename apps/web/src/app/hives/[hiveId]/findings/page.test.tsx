// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const permanentRedirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const loadHive = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => permanentRedirectMock(url),
}));

vi.mock("@/server/hives/load-owned-hive", () => ({
  loadOwnedHiveOrNotFound: (...args: unknown[]) => loadHive(...args),
}));

vi.mock("./PersonalFindingsStudy", () => ({
  PersonalFindingsStudy: ({ hiveId }: { hiveId: string }) => <div data-testid="personal-accepted-study">{hiveId}</div>,
}));

import FindingsPage from "./page";

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";
const FIRM_ID = "33333333-3333-4333-8333-333333333333";

function redirected(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^REDIRECT:/, "");
}

afterEach(() => {
  cleanup();
  loadHive.mockReset();
  permanentRedirectMock.mockClear();
});

describe("Findings redirect", () => {
  it("sends a firm hive, including a legacy tab, to Home#show", async () => {
    loadHive.mockResolvedValue({ id: HIVE_ID, firmId: FIRM_ID });
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

  it("shows the accepted study for a personal hive instead of returning to the board", async () => {
    loadHive.mockResolvedValue({ id: HIVE_ID, firmId: null });
    const page = await FindingsPage({
      params: Promise.resolve({ hiveId: HIVE_ID }),
      searchParams: Promise.resolve({ keep: "1" }),
    });
    render(page);
    expect(screen.getByTestId("personal-accepted-study").textContent).toBe(HIVE_ID);
    expect(permanentRedirectMock).not.toHaveBeenCalled();
  });
});
