// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
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
  searchParams = new URLSearchParams();
});

function filledButtons(root: HTMLElement) {
  return within(root)
    .queryAllByRole("button")
    .filter((button) => button.className.includes("bg-blue-deep"));
}

describe("LandingStart", () => {
  it("opens on For my clients with an email field and one filled Start", () => {
    const { container } = render(<LandingStart />);
    const group = screen.getByRole("group", { name: "Who is this for" });
    expect(within(group).getByRole("button", { name: "For my clients", pressed: true })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "For myself", pressed: false })).toBeTruthy();
    const email = screen.getByLabelText("Your work email") as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.autocomplete).toBe("email");
    const filled = filledButtons(container);
    expect(filled).toHaveLength(1);
    expect(filled[0]!.textContent).toBe("Start");
    expect(screen.getByText(/Set up your practice, then invite your first client/)).toBeTruthy();
    expect(screen.getByText(/Invited by your lawyer or advocate/)).toBeTruthy();
  });

  it("sends a typed email to sign-in as a prefill, and starts clients sign-up without one", () => {
    render(<LandingStart />);
    const email = screen.getByLabelText("Your work email");
    fireEvent.change(email, { target: { value: "dana@firm.example" } });
    fireEvent.submit(screen.getByRole("form", { name: "For my clients" }));
    expect(push).toHaveBeenLastCalledWith(
      "/sign-in?start=clients&new=1&next=%2Fhives&prefill=dana%40firm.example",
    );

    fireEvent.change(email, { target: { value: "" } });
    fireEvent.submit(screen.getByRole("form", { name: "For my clients" }));
    expect(push).toHaveBeenLastCalledWith("/sign-in?start=clients&new=1&next=%2Fhives");
  });

  it("puts the audience in the URL when it changes", () => {
    render(<LandingStart />);
    fireEvent.click(screen.getByRole("button", { name: "For myself" }));
    expect(push).toHaveBeenCalledWith("/?for=self", { scroll: false });
  });

  it("shows the composer for For myself, and keeps the guest draft flow on Enter", async () => {
    searchParams = new URLSearchParams("for=self");
    const { container } = render(<LandingStart />);
    expect(screen.getByRole("button", { name: "For myself", pressed: true })).toBeTruthy();
    expect(screen.queryByLabelText("Your work email")).toBeNull();
    expect(screen.getByText(/You get your own hive/)).toBeTruthy();

    const input = screen.getByLabelText("Describe your situation");
    const file = new File(["%PDF"], "notice.pdf", { type: "application/pdf" });
    const landingPicker = document.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    fireEvent.change(landingPicker, { target: { files: [file] } });
    fireEvent.change(input, { target: { value: "Reconcile vendor statements for Q3" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => expect(saveGuestDraft).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith(CREATE_HIVE_AFTER_SIGN_UP_PATH);
    expect(filledButtons(container)).toHaveLength(1);
  });

  it("exposes keyboard order for For myself: audience, input, Start, Add documents", () => {
    searchParams = new URLSearchParams("for=self");
    render(<LandingStart />);
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>(
        'input:not([type="file"]):not([aria-hidden="true"]), button:not(:disabled), a[href]',
      ),
    ).filter((el) => !el.closest(".sr-only") && el.tabIndex !== -1);
    const at = (el: HTMLElement) => focusable.indexOf(el);
    const input = screen.getByLabelText("Describe your situation");
    const start = screen.getByRole("button", { name: "Start" });
    const add = screen.getAllByRole("button", { name: "Add documents" }).at(-1)!;
    expect(at(screen.getByRole("button", { name: "For my clients" }))).toBeLessThan(at(input));
    expect(at(input)).toBeLessThan(at(start));
    expect(at(start)).toBeLessThan(at(add));
  });
});
