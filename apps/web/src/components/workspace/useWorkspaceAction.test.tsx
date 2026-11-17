// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceAction } from "./useWorkspaceAction";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("reuses idempotency key on retrySameKey", async () => {
    const headers: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        const raw = init?.headers;
        const key =
          raw && typeof raw === "object" && "Idempotency-Key" in raw
            ? String((raw as Record<string, string>)["Idempotency-Key"])
            : "";
        headers.push(key);
        return Promise.resolve({ ok: false, json: async () => ({ error: { message: "No", correlationId: "abcd1234-1111", errorCode: "X", retryable: false } }) });
      }),
    );

    const { result } = renderHook(() => useWorkspaceAction());
    await act(async () => {
      await result.current.run({ url: "/api/test", body: { a: 1 } });
      await result.current.retrySameKey({ url: "/api/test", body: { a: 1 } });
    });
    expect(headers[0]).toBeTruthy();
    expect(headers[0]).toBe(headers[1]);
  });
});