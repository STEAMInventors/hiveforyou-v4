// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CORRELATION_HEADER_NAME } from "@/lib/hives-client";

import { useWorkspaceAction } from "./useWorkspaceAction";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
  vi.restoreAllMocks();
});

describe("useWorkspaceAction", () => {
  it("ignores a second click while pending", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 50)),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkspaceAction());
    await act(async () => {
      void result.current.run({ url: "/api/test", body: {} });
      void result.current.run({ url: "/api/test", body: {} });
    });
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a fresh idempotency key for each new action", async () => {
    const keys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        const raw = init?.headers as Record<string, string>;
        keys.push(raw["Idempotency-Key"]);
        return Promise.resolve({ ok: true, json: async () => ({ saved: true }) });
      }),
    );

    const { result } = renderHook(() => useWorkspaceAction());
    await act(async () => {
      await result.current.run({ url: "/api/a", body: { n: 1 } });
      await result.current.run({ url: "/api/b", body: { n: 2 } });
    });
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("reuses idempotency key on retrySameKey but sends a new correlation id", async () => {
    const keys: string[] = [];
    const correlations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        const raw = init?.headers as Record<string, string>;
        keys.push(raw["Idempotency-Key"]);
        correlations.push(raw[CORRELATION_HEADER_NAME]);
        return Promise.resolve({
          ok: false,
          json: async () => ({
            error: { message: "No", correlationId: "abcd1234-1111", errorCode: "X", retryable: true },
          }),
        });
      }),
    );

    const { result } = renderHook(() => useWorkspaceAction());
    await act(async () => {
      await result.current.run({ url: "/api/test", body: { a: 1 } });
      await result.current.retrySameKey({ url: "/api/test", body: { a: 1 } });
    });
    expect(keys[0]).toBe(keys[1]);
    expect(correlations[0]).toBeTruthy();
    expect(correlations[1]).toBeTruthy();
    expect(correlations[0]).not.toBe(correlations[1]);
  });

  it("shows network message without reference and refreshes after failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { result } = renderHook(() => useWorkspaceAction());
    await act(async () => {
      await result.current.run({ url: "/api/test", body: {} });
    });
    expect(result.current.inlineError?.message).toMatch(/Couldn't reach HiveForYou/);
    expect(result.current.inlineError?.reference).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it("redirects to sign-in with pathname and query on 401", async () => {
    const locationAssign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/hives/x/board", search: "?tab=items", href: "", assign: locationAssign },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => null, headers: new Headers() }),
    );
    const { result } = renderHook(() => useWorkspaceAction());
    await act(async () => {
      await result.current.run({ url: "/api/test", body: {} });
    });
    expect(locationAssign).not.toHaveBeenCalled();
    expect(window.location.href).toContain("/sign-in?next=");
    expect(decodeURIComponent(window.location.href)).toContain("/hives/x/board?tab=items");
  });

  it("returns parsed body on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ teamNoteId: "n1" }), headers: new Headers() }),
    );
    const { result } = renderHook(() => useWorkspaceAction());
    let body: unknown;
    await act(async () => {
      body = await result.current.run({ url: "/api/test", body: { x: 1 } });
    });
    expect(body).toEqual({ teamNoteId: "n1" });
  });
});