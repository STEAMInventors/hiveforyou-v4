// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: vi.fn().mockResolvedValue({ ok: false }),
}));

const loadPracticeAreaSetupOptions = vi.fn();
vi.mock("@/server/firm/practice-area-options", () => ({
  loadPracticeAreaSetupOptions: () => loadPracticeAreaSetupOptions(),
}));

vi.mock("@/lib/guest-draft", () => ({
  saveGuestDraft: vi.fn(),
}));

import LandingPage from "./page";

afterEach(() => {
  cleanup();
  loadPracticeAreaSetupOptions.mockReset();
});

function withAreas(labels: string[] = ["Example intake review", "Example records review"]) {
  loadPracticeAreaSetupOptions.mockReturnValue(labels.map((label) => ({ id: label, label })));
}

describe("signed-out front page", () => {
  it("has a quiet Sign in link, no Get started, and exactly one filled button", async () => {
    withAreas();
    render(await LandingPage());
    expect(screen.queryByText("Get started")).toBeNull();
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe("/sign-in");
    expect(signIn.className).not.toContain("bg-blue-deep");
    expect(signIn.className).toContain("text-ink-2");
    const filled = [...screen.getAllByRole("button"), ...screen.getAllByRole("link")].filter((el) =>
      el.className.includes("bg-blue-deep"),
    );
    expect(filled).toHaveLength(1);
    expect(filled[0]!.textContent).toBe("Start");
  });

  it("orders the page: hero with the one input, example, how it works, who sees what, closing", async () => {
    withAreas();
    const { container } = render(await LandingPage());
    const main = container.querySelector("main")!;
    const headings = within(main).getAllByRole("heading").map((h) => `${h.tagName}:${h.textContent}`);
    expect(headings.filter((h) => h.startsWith("H1") || h.startsWith("H2"))).toEqual([
      "H1:What are you working on?",
      "H2:What you get back",
      "H2:How it works",
      "H2:Who sees what",
      "H2:What it covers",
    ]);
    const hero = main.children[0] as HTMLElement;
    expect(within(hero).getByRole("form", { name: "For my clients" })).toBeTruthy();
    expect(within(main).getByTestId("front-example")).toBeTruthy();
  });

  it("builds What it covers from the packs that exist, and omits it when there are none", async () => {
    withAreas(["Example intake review", "Example records review"]);
    const first = render(await LandingPage());
    expect(first.container.textContent).toContain(
      "Built for Example intake review and Example records review.",
    );
    first.unmount();

    withAreas([]);
    render(await LandingPage());
    expect(screen.queryByRole("heading", { name: "What it covers" })).toBeNull();
  });

  it("closes with the slogan, a quiet Start a hive button and the disclaimer", async () => {
    withAreas();
    render(await LandingPage());
    const start = screen.getByRole("button", { name: "Start a hive" });
    expect(start.className).not.toContain("bg-blue-deep");
    expect(screen.getByText("The complicated, made simple.")).toBeTruthy();
    expect(screen.getByText("Not legal, financial or medical advice.")).toBeTruthy();
  });
});
