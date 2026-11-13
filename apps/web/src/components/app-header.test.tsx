// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/hives";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/server/auth/auth-actions", () => ({ signOutAction: vi.fn() }));

import { accountInitials } from "@/lib/account-initials";

import { AppHeader } from "./app-header";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  pathname = "/hives";
});

const OVERFLOW = /(^|\s)overflow(-[a-z]+)+/;
const FIXED_HEIGHT = /(^|\s)(h-(\d|\[)|max-h-)/;

const classOf = (element: Element) => element.getAttribute("class") ?? "";

describe("AppHeader", () => {
  it("has no fixed height on the header and no overflow anywhere in it", () => {
    pathname = `/hives/${HIVE_ID}/study`;
    render(<AppHeader workspace={{ hiveId: HIVE_ID, hiveName: "Widget batch review" }} initials="MR" />);
    const header = screen.getByTestId("app-header");
    expect(header.tagName).toBe("HEADER");
    const row = header.firstElementChild!;
    expect(classOf(header)).not.toMatch(FIXED_HEIGHT);
    expect(classOf(row)).not.toMatch(FIXED_HEIGHT);
    const overflowing = [header, ...header.querySelectorAll("*")].map(classOf).filter((name) => OVERFLOW.test(name));
    expect(overflowing).toEqual([]);
  });

  it("shows the breadcrumb with the hive name as the current page", () => {
    pathname = `/hives/${HIVE_ID}/documents`;
    render(<AppHeader workspace={{ hiveId: HIVE_ID, hiveName: "Widget batch review" }} initials="MR" />);
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "My hives" }).getAttribute("href")).toBe("/hives");
    const current = crumbs.getByText("Widget batch review");
    expect(current.getAttribute("aria-current")).toBe("page");
  });

  it("marks My hives as the current page on the list", () => {
    render(<AppHeader workspace={null} initials={null} />);
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.queryByRole("link", { name: "My hives" })).toBeNull();
    expect(crumbs.getByText("My hives").getAttribute("aria-current")).toBe("page");
  });

  it("opens an accessible account menu from the keyboard and returns focus on Escape", () => {
    render(<AppHeader workspace={null} initials="MR" />);
    const button = screen.getByRole("button", { name: "Account" });
    expect(button.textContent).toBe("MR");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(button, { key: "ArrowDown" });
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(menu.id);
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Change password", "Log out"]);
    expect(items[0]!.getAttribute("href")).toBe("/account/password");
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes the menu on a click outside it", () => {
    render(<AppHeader workspace={null} initials={null} />);
    const button = screen.getByRole("button", { name: "Account" });
    expect(button.textContent).toBe("Account");
    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("accountInitials", () => {
  it("takes up to two initials from the email's local part", () => {
    expect(accountInitials("maya.rivera@example.test")).toBe("MR");
    expect(accountInitials("maya@example.test")).toBe("M");
    expect(accountInitials("a_b_c@example.test")).toBe("AB");
    expect(accountInitials("1234@example.test")).toBeNull();
    expect(accountInitials(undefined)).toBeNull();
  });
});
