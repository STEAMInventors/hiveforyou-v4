// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
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
  it("has Sign in, Get started, and exactly one filled button", async () => {
    const ui = await LandingPage();
    render(ui);
    const filled = screen
      .getAllByRole("link")
      .filter((link) => link.className.includes("bg-blue-deep"));
    expect(filled).toHaveLength(1);
    expect(filled[0]!.textContent).toBe("Get started");
    expect(filled[0]!.getAttribute("href")).toBe("/sign-in?new=1");
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in");
    expect(screen.getByTestId("landing-start")).toBeTruthy();
  });

  it("orders main content: logo, question, start, then explainers", async () => {
    const ui = await LandingPage();
    const { container } = render(ui);
    const main = container.querySelector("main");
    expect(main).toBeTruthy();
    const children = Array.from(main!.children).map((node) => node.tagName.toLowerCase());
    expect(children).toEqual(["section", "section"]);
    const hero = main!.children[0]!;
    expect(within(hero as HTMLElement).getByRole("img", { name: "HiveForYou" })).toBeTruthy();
    expect(hero.textContent).toContain("What are you working on?");
    expect(within(hero as HTMLElement).getByTestId("landing-start")).toBeTruthy();
    const explainer = main!.children[1]!;
    const headings = within(explainer as HTMLElement).getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "Upload whatever you have",
      "Every point opens its page",
      "See what is missing",
    ]);
  });
});