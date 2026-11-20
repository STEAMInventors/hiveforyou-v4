// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const saveGuestDraft = vi.fn();
vi.mock("@/lib/guest-draft", () => ({
  saveGuestDraft: (...args: unknown[]) => saveGuestDraft(...args),
}));

import { CREATE_HIVE_AFTER_SIGN_UP_PATH } from "@/lib/hive-routes";

import { LandingStart } from "./LandingStart";

afterEach(() => {
  cleanup();
  push.mockReset();
  saveGuestDraft.mockReset();
  saveGuestDraft.mockResolvedValue(undefined);
});

describe("LandingStart", () => {
  it("keeps guest draft flow on Enter and sends visitors to sign-in with create next", async () => {
    render(<LandingStart />);
    const input = screen.getByLabelText("Describe your situation");
    const file = new File(["%PDF"], "notice.pdf", { type: "application/pdf" });
    const attachButtons = screen.getAllByRole("button", { name: "Add documents" });
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const landingPicker = fileInputs[0] as HTMLInputElement;

    fireEvent.change(landingPicker, { target: { files: [file] } });
    fireEvent.change(input, { target: { value: "Reconcile vendor statements for Q3" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => expect(saveGuestDraft).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith(CREATE_HIVE_AFTER_SIGN_UP_PATH);
    expect(attachButtons[0]).toBeTruthy();
    expect(screen.getByRole("link", { name: "I work with clients" }).getAttribute("href")).toBe(
      "/sign-in?start=clients&next=%2Fhives&new=1",
    );
  });

  it("exposes keyboard order: input, attach, Add documents, I work with clients", () => {
    render(<LandingStart />);
    const input = screen.getByLabelText("Describe your situation");
    const attachButtons = screen.getAllByRole("button", { name: "Add documents" });
    const clientsLink = screen.getByRole("link", { name: "I work with clients" });
    const tabOrder = [input, attachButtons[0], attachButtons[1], clientsLink];
    for (let index = 0; index < tabOrder.length - 1; index += 1) {
      const current = tabOrder[index]!;
      const next = tabOrder[index + 1]!;
      const between = Array.from(
        document.querySelectorAll<HTMLElement>(
          'input:not([type="file"]):not([aria-hidden="true"]), button:not(:disabled), a[href]',
        ),
      ).filter((el) => !el.closest(".sr-only") && el.tabIndex !== -1);
      expect(between.indexOf(current)).toBeLessThan(between.indexOf(next));
    }
  });

  it("does not show a filled create button on the landing composer", () => {
    render(<LandingStart />);
    const form = screen.getByRole("form", { name: "Start a Hive" });
    const filled = within(form).queryAllByRole("button").filter((btn) => btn.className.includes("bg-cell-blue-deep"));
    expect(filled).toHaveLength(0);
  });
});