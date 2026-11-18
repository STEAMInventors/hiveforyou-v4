// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/auth-actions", () => ({
  signOutAction: vi.fn(),
  switchStartingViewAction: vi.fn(),
  setDisplayNameAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AccountMenu } from "./account-menu";

afterEach(() => cleanup());

describe("AccountMenu", () => {
  it("links the title and firm line to the firm page", () => {
    render(
      <AccountMenu
        initials="MA"
        displayName="Maria Alvarez"
        email="maria@example.com"
        startingView="clients"
        firmLine="Firm settings"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const link = screen.getByRole("menuitem", { name: "Firm settings" });
    expect(link.getAttribute("href")).toBe("/account/firm");
  });
});