// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: vi.fn().mockResolvedValue({ ok: false }),
}));

vi.mock("@/components/LandingStart", () => ({
  LandingStart: () => <div data-testid="landing-start" />,
}));

import LandingPage from "./page";

afterEach(cleanup);

describe("signed-out landing", () => {
  it("has one filled Sign in control and no other filled buttons", async () => {
    const ui = await LandingPage();
    render(ui);
    const filled = screen
      .getAllByRole("link")
      .filter((link) => link.className.includes("bg-cell-blue-deep"));
    expect(filled).toHaveLength(1);
    expect(filled[0]!.textContent).toBe("Sign in");
    expect(filled[0]!.getAttribute("href")).toBe("/sign-in");
    expect(screen.getByTestId("landing-start")).toBeTruthy();
  });
});