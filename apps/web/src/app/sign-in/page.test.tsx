// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
  })),
}));

import SignInPage from "./page";

afterEach(() => cleanup());

describe("/sign-in page", () => {
  it("shows the otp_expired banner in role=alert", async () => {
    const ui = await SignInPage({
      searchParams: Promise.resolve({ error: "otp_expired", next: "/hives" }),
    });
    render(ui);
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("already been used");
  });

  it("sanitizes unsafe next before rendering the flow", async () => {
    const ui = await SignInPage({
      searchParams: Promise.resolve({ next: "https://evil.example" }),
    });
    render(ui);
    const nextInput = screen.getByRole("button", { name: "Next" }).closest("form")!
      .querySelector<HTMLInputElement>('input[name="next"]');
    expect(nextInput?.value).toBe("/hives");
  });
});