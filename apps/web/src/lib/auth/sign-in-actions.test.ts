import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, createServerSupabaseClient, fetchMyProfile } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  createServerSupabaseClient: vi.fn(),
  fetchMyProfile: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));

vi.mock("./action-support", () => ({
  logAuthFailure: vi.fn(),
  logAuthInfo: vi.fn(),
  requestAppOrigin: vi.fn().mockResolvedValue("https://app.example.test"),
  requestCorrelationId: vi.fn().mockResolvedValue("corr-test"),
}));

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient }));

vi.mock("./profile", () => ({
  fetchMyProfile,
}));

import {
  requestSignInCodeAction,
  switchStartingViewAction,
  verifySignInCodeAction,
} from "./sign-in-actions";
import { classifyAuthError } from "./map-auth-error";

describe("verifySignInCodeAction", () => {
  beforeEach(() => {
    redirect.mockClear();
    createServerSupabaseClient.mockReset();
  });

  it("returns code-field errors without clearing email or the code step", async () => {
    createServerSupabaseClient.mockResolvedValue({
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          error: { code: "invalid_otp", message: "Token has expired or is invalid" },
        }),
      },
    });
    const mapped = classifyAuthError({ code: "invalid_otp" }, "otp_verify");

    const form = new FormData();
    form.set("email", "user@example.test");
    form.set("token", "123456");
    form.set("next", "/hives/x");

    const state = await verifySignInCodeAction({ step: "code" }, form);
    expect(state).toEqual({
      error: mapped.message,
      field: "code",
      email: "user@example.test",
      step: "code",
      next: "/hives/x",
    });
  });
});

describe("requestSignInCodeAction", () => {
  beforeEach(() => {
    createServerSupabaseClient.mockReset();
  });

  it("advances to the code step and echoes next", async () => {
    createServerSupabaseClient.mockResolvedValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      },
    });
    const form = new FormData();
    form.set("email", "user@example.test");
    form.set("next", "/hives/x");
    const state = await requestSignInCodeAction({ step: "email" }, form);
    expect(state).toEqual({ step: "code", email: "user@example.test", next: "/hives/x" });
  });
});

describe("switchStartingViewAction", () => {
  beforeEach(() => {
    redirect.mockClear();
    createServerSupabaseClient.mockReset();
    fetchMyProfile.mockReset();
  });

  it("calls set_starting_view with the opposite view", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    createServerSupabaseClient.mockResolvedValue({ rpc });
    fetchMyProfile.mockResolvedValue({
      profile: {
        userId: "aaaaaaaa-0000-4000-8000-000000000001",
        startingView: "clients",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      error: false,
    });

    await expect(switchStartingViewAction()).rejects.toThrow("REDIRECT:/hives");
    expect(rpc).toHaveBeenCalledWith("set_starting_view", { p_view: "own" });
  });
});