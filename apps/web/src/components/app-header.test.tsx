// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/hives";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/server/auth/auth-actions", () => ({
  signOutAction: vi.fn(),
  switchStartingViewAction: vi.fn(),
  setDisplayNameAction: vi.fn(),
}));
vi.mock("@/lib/source-documents-client", () => ({
  createIntentRequest: vi.fn().mockResolvedValue({}),
}));

import { switchStartingViewAction } from "@/server/auth/auth-actions";
import { accountInitials } from "@/lib/account-initials";

import { ClientsHomeProvider } from "@/lib/hives/clients-home-context";

import { AppHeader } from "./app-header";

const mockedSwitchStartingView = vi.mocked(switchStartingViewAction);

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

const account = {
  initials: "MR" as const,
  displayName: "Maya Rivera",
  email: "maya.rivera@example.test",
  startingView: "clients" as const,
};

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
    render(<AppHeader workspace={{ hiveId: HIVE_ID, hiveName: "Widget batch review" }} account={account} />);
    const header = screen.getByTestId("app-header");
    expect(header.tagName).toBe("HEADER");
    const row = header.firstElementChild!;
    expect(classOf(header)).not.toMatch(FIXED_HEIGHT);
    expect(classOf(row)).not.toMatch(FIXED_HEIGHT);
    const overflowing = [header, ...header.querySelectorAll("*")].map(classOf).filter((name) => OVERFLOW.test(name));
    expect(overflowing).toEqual([]);
  });

  it("does not render a breadcrumb", () => {
    pathname = `/hives/${HIVE_ID}/documents`;
    render(<AppHeader workspace={{ hiveId: HIVE_ID, hiveName: "Widget batch review" }} account={account} />);
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });

  it("keeps the header logo hidden on the hive list for the own view", () => {
    pathname = "/hives";
    render(
      <ClientsHomeProvider enabled={false}>
        <AppHeader workspace={null} account={{ ...account, startingView: "own" }} />
      </ClientsHomeProvider>,
    );
    const home = screen.getByRole("link", { name: "HiveForYou, my hives" });
    expect(home.className).toContain("invisible");
    expect(home.getAttribute("href")).toBe("/hives");
    expect(screen.queryByTestId("header-find-client")).toBeNull();
  });

  it("shows the header logo and Find a client on the clients hive list", () => {
    pathname = "/hives";
    render(
      <ClientsHomeProvider enabled>
        <AppHeader workspace={null} account={account} />
      </ClientsHomeProvider>,
    );
    const home = screen.getByRole("link", { name: "HiveForYou, my hives" });
    expect(home.className).not.toContain("invisible");
    expect(screen.getByTestId("header-find-client")).toBeTruthy();
    expect(screen.getByLabelText("Find a client")).toBeTruthy();
  });

  it("shows the workspace breadcrumb on desktop when a hive section is active", () => {
    pathname = `/hives/${HIVE_ID}/facts`;
    render(
      <AppHeader
        workspace={{
          hiveId: HIVE_ID,
          hiveName: "Widget batch review",
          section: "facts",
          startingView: "clients",
          hiveKind: "client",
        }}
        account={account}
      />,
    );
    const header = screen.getByTestId("app-header");
    const logoColumn = screen.getByTestId("header-logo-column");
    const breadcrumb = screen.getByTestId("workspace-breadcrumb");
    expect(logoColumn.contains(breadcrumb)).toBe(false);
    expect(header.firstElementChild?.contains(logoColumn)).toBe(true);
    expect(header.firstElementChild?.contains(breadcrumb)).toBe(true);
    expect(breadcrumb.className).toContain("min-[900px]:flex");
    expect(screen.getByText("Facts")).toBeTruthy();
    expect(screen.queryByTestId("hive-header-ask-pill")).toBeNull();
  });

  it("truncates long hive names in the breadcrumb and exposes the full name", () => {
    const longName = "Southern District widget manufacturing and supply cooperative review";
    pathname = `/hives/${HIVE_ID}/board`;
    render(
      <AppHeader
        workspace={{
          hiveId: HIVE_ID,
          hiveName: longName,
          section: "board",
          startingView: "own",
          hiveKind: "own",
        }}
        account={{ ...account, startingView: "own" }}
      />,
    );
    const hiveCrumb = screen.getByTitle(longName);
    expect(hiveCrumb.className).toContain("truncate");
  });

  it("opens an accessible account menu from the keyboard and returns focus on Escape", () => {
    render(<AppHeader workspace={null} account={account} />);
    const button = screen.getByRole("button", { name: "Account" });
    expect(button.textContent).toBe("MR");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(button, { key: "ArrowDown" });
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(menu.id);
    expect(within(menu).getByText("Maya Rivera")).toBeTruthy();
    expect(within(menu).getByText("maya.rivera@example.test")).toBeTruthy();
    expect(within(menu).getByText("Client hives")).toBeTruthy();
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Switch to my own paperwork",
      "Sign out",
    ]);
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("shows the current starting view and switches without a password item", async () => {
    const ownAccount = { ...account, startingView: "own" as const };
    render(<AppHeader workspace={null} account={ownAccount} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Account" }), { key: "ArrowDown" });
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(within(menu).getByText("My own paperwork")).toBeTruthy();
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Switch to client hives",
      "Sign out",
    ]);
    expect(within(menu).queryByText(/password/i)).toBeNull();

    mockedSwitchStartingView.mockResolvedValue();
    fireEvent.click(items[0]!);
    await waitFor(() => expect(mockedSwitchStartingView).toHaveBeenCalledTimes(1));
  });

  it("closes the menu on a click outside it", () => {
    render(
      <AppHeader
        workspace={null}
        account={{ initials: null, displayName: null, email: null, startingView: null }}
      />,
    );
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