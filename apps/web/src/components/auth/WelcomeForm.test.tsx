// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/auth-actions", () => ({
  setStartingViewAction: vi.fn(),
}));

import { WelcomeForm } from "./WelcomeForm";

afterEach(() => cleanup());

describe("WelcomeForm", () => {
  it("shows both starting choices with prototype copy", () => {
    render(<WelcomeForm nextPath="/hives" preselectClients={false} />);
    expect(screen.getByRole("heading", { name: "What brings you here?" })).toBeTruthy();
    expect(screen.getByText("This sets where you start. You can switch any time.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /My own paperwork/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hives for my clients/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("preselects client hives when start=clients", () => {
    render(<WelcomeForm nextPath="/hives" preselectClients />);
    expect(screen.getByRole("button", { name: /Hives for my clients/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("keeps a safe next destination in the continue form", () => {
    render(<WelcomeForm nextPath="/hives/x" preselectClients={false} />);
    const nextInput = screen.getByRole("button", { name: "Continue" }).closest("form")!
      .querySelector<HTMLInputElement>('input[name="next"]');
    expect(nextInput?.value).toBe("/hives/x");
  });
});