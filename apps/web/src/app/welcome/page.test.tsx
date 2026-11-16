// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error(`REDIRECT:${url}`);
    Object.defineProperty(error, "digest", {
      value: `NEXT_REDIRECT;replace;${url}`,
    });
    throw error;
  }),
}));

const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}));

const fetchMyProfile = vi.fn();

vi.mock("@/lib/auth/profile", () => ({
  fetchMyProfile: (...args: unknown[]) => fetchMyProfile(...args),
}));

vi.mock("@/components/auth/WelcomeForm", () => ({
  WelcomeForm: () => <div data-testid="welcome-form" />,
}));

import WelcomePage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/welcome page", () => {
  it("renders the welcome flow when the user has no profile yet", async () => {
    getUser.mockResolvedValue({
      data: { user: { email: "maya.rivera@example.test" } },
    });
    fetchMyProfile.mockResolvedValue({ profile: null, error: false });

    const ui = await WelcomePage({
      searchParams: Promise.resolve({ next: "/hives" }),
    });
    render(ui);
    expect(screen.getByTestId("welcome-form")).toBeTruthy();
  });

  it("sends returning users with a profile straight to next", async () => {
    getUser.mockResolvedValue({
      data: { user: { email: "maya.rivera@example.test" } },
    });
    fetchMyProfile.mockResolvedValue({
      profile: {
        userId: "u1",
        startingView: "own",
        displayName: "Maya",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      error: false,
    });

    await expect(
      WelcomePage({
        searchParams: Promise.resolve({ next: "/hives/x" }),
      }),
    ).rejects.toThrow("REDIRECT:/hives/x");
  });
});