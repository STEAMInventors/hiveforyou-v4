// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/auth-actions", () => ({
  setStartingViewAction: vi.fn(),
}));

import { filledAuthButtons } from "./auth-test-helpers";
import { WelcomeForm } from "./WelcomeForm";

const practiceAreaOptions = [
  { packId: "pack-alpha", label: "Intake pack A", description: "Documents gathered before filing." },
];

afterEach(cleanup);

describe("WelcomeForm", () => {
  it("shows both starting choices with prototype copy", () => {
    render(
      <WelcomeForm
        nextPath="/hives"
        preselectClients={false}
        defaultFirstName="Dana"
        practiceAreaOptions={practiceAreaOptions}
      />,
    );
    expect(screen.getByLabelText("Your first name")).toBeTruthy();
    expect(screen.getByTestId("hive-mark")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Welcome to HiveForYou" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What brings you here?" })).toBeTruthy();
    expect(screen.getByText("This sets where you start. You can switch any time.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /My own paperwork/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hives for my clients/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(filledAuthButtons()).toHaveLength(1);
    expect(filledAuthButtons()[0]?.textContent).toBe("Continue");
  });

  it("includes the about aside with CSS hidden below 960px", () => {
    render(
      <WelcomeForm
        nextPath="/hives"
        preselectClients={false}
        defaultFirstName="Dana"
        practiceAreaOptions={practiceAreaOptions}
      />,
    );
    const aside = screen.getByRole("complementary", { name: "About HiveForYou", hidden: true });
    expect(aside.className).toMatch(/\bhidden\b/);
    expect(aside.className).toContain("min-[960px]:flex");
  });

  it("preselects client hives when start=clients", () => {
    render(
      <WelcomeForm nextPath="/hives" preselectClients defaultFirstName="" practiceAreaOptions={practiceAreaOptions} />,
    );
    expect(screen.getByRole("button", { name: /Hives for my clients/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("starts firm setup after Hives for my clients", () => {
    render(
      <WelcomeForm
        nextPath="/hives"
        preselectClients={false}
        defaultFirstName="Maria"
        practiceAreaOptions={practiceAreaOptions}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Hives for my clients/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Set up your practice" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("keeps a safe next destination in the continue form", () => {
    render(
      <WelcomeForm nextPath="/hives/x" preselectClients={false} defaultFirstName="" practiceAreaOptions={practiceAreaOptions} />,
    );
    const nextInput = screen.getByRole("button", { name: "Continue" }).closest("form")!
      .querySelector<HTMLInputElement>('input[name="next"]');
    expect(nextInput?.value).toBe("/hives/x");
  });
});