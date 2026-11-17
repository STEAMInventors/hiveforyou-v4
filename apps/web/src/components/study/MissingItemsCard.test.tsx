// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MissingItemsCard, type MissingItemRow } from "./MissingItemsCard";

const replace = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  usePathname: () => "/hives/abc/missing",
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace }),
}));

const items: MissingItemRow[] = [
  { id: "a", state: "needs", node: <p>Needs row</p> },
  { id: "b", state: "missing", node: <p>Missing row</p> },
  { id: "c", state: "missing", node: <p>Another missing</p> },
];

beforeEach(() => {
  search = "";
});

afterEach(() => {
  cleanup();
  replace.mockClear();
});

describe("MissingItemsCard", () => {
  it("renders segmented filters with aria-pressed and counts", () => {
    render(<MissingItemsCard items={items} />);
    expect(screen.getByRole("button", { name: /Missing 2/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /All 3/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Needs row")).toBeTruthy();
    expect(screen.getByText("Missing row")).toBeTruthy();
  });

  it("updates the URL when a filter is chosen", () => {
    render(<MissingItemsCard items={items} />);
    fireEvent.click(screen.getByRole("button", { name: /Missing 2/ }));
    expect(replace).toHaveBeenCalledWith("/hives/abc/missing?show=missing", { scroll: false });
  });

  it("shows empty copy when the active filter has no rows", () => {
    search = "show=changed";
    render(<MissingItemsCard items={items} />);
    expect(screen.getByTestId("missing-items-empty").textContent).toContain("Nothing in this view.");
  });
});