import { describe, expect, it, vi } from "vitest";

const permanentRedirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const loadOwnedHiveOrNotFoundMock = vi.fn();

vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => permanentRedirectMock(url),
}));

vi.mock("@/server/hives/load-owned-hive", () => ({
  loadOwnedHiveOrNotFound: (...args: unknown[]) => loadOwnedHiveOrNotFoundMock(...args),
}));

import ActivityPage from "./[hiveId]/activity/page";
import FactsPage from "./[hiveId]/facts/page";
import MissingPage from "./[hiveId]/missing/page";
import TimelinePage from "./[hiveId]/timeline/page";

const HIVE_ID = "550e8400-e29b-41d4-a716-446655440000";

function redirectedPath(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^REDIRECT:/, "");
}

describe("legacy hive routes", () => {
  it("sends facts to findings and keeps other query params", async () => {
    await expect(
      FactsPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({ keep: "1", extra: ["a", "b"], tab: "old" }),
      }),
    ).rejects.toThrow(/REDIRECT:/);
    const url = new URL(redirectedPath(permanentRedirectMock.mock.calls.at(-1)?.[0]), "http://local");
    expect(url.pathname).toBe(`/hives/${HIVE_ID}/findings`);
    expect(url.searchParams.getAll("keep")).toEqual(["1"]);
    expect(url.searchParams.getAll("extra")).toEqual(["a", "b"]);
    expect(url.searchParams.has("tab")).toBe(false);
    expect(loadOwnedHiveOrNotFoundMock).not.toHaveBeenCalled();
  });

  it("sends missing to the gaps tab and keeps other query params", async () => {
    await expect(
      MissingPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({ keep: "1" }),
      }),
    ).rejects.toThrow(/REDIRECT:/);
    const url = new URL(redirectedPath(permanentRedirectMock.mock.calls.at(-1)?.[0]), "http://local");
    expect(url.pathname).toBe(`/hives/${HIVE_ID}/findings`);
    expect(url.searchParams.get("tab")).toBe("gaps");
    expect(url.searchParams.get("keep")).toBe("1");
  });

  it("sends timeline to the timeline tab and keeps other query params", async () => {
    await expect(
      TimelinePage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({ ref: "2" }),
      }),
    ).rejects.toThrow(/REDIRECT:/);
    const url = new URL(redirectedPath(permanentRedirectMock.mock.calls.at(-1)?.[0]), "http://local");
    expect(url.pathname).toBe(`/hives/${HIVE_ID}/findings`);
    expect(url.searchParams.get("tab")).toBe("timeline");
    expect(url.searchParams.get("ref")).toBe("2");
  });

  it("sends activity to the audit trail and keeps the query", async () => {
    await expect(
      ActivityPage({
        params: Promise.resolve({ hiveId: HIVE_ID }),
        searchParams: Promise.resolve({ ref: "9" }),
      }),
    ).rejects.toThrow(/REDIRECT:/);
    const url = new URL(redirectedPath(permanentRedirectMock.mock.calls.at(-1)?.[0]), "http://local");
    expect(url.pathname).toBe(`/hives/${HIVE_ID}/audit`);
    expect(url.searchParams.get("ref")).toBe("9");
    expect(loadOwnedHiveOrNotFoundMock).not.toHaveBeenCalled();
  });
});
