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

vi.mock("@/components/hives/HiveOmni", () => ({
  HiveOmni: ({ audience }: { audience: "staff" | "client" }) => (
    <div data-testid="omni">
      <input
        placeholder={audience === "client" ? "Ask HiveForYou about your documents" : "Ask HiveForYou or find anything in this hive"}
      />
    </div>
  ),
}));

const classOf = (element: Element) => element.getAttribute("class") ?? "";

describe("AppHeader", () => {
  it("uses the top bar height and has one hive box inside a hive", () => {
    pathname = `/hives/${HIVE_ID}/study`;
    render(<AppHeader workspace={{ hiveId: HIVE_ID, hiveName: "Widget batch review", staffView: true }} account={account} />);
    const header = screen.getByTestId("app-header");
    expect(header.tagName).toBe("HEADER");
    expect(classOf(header)).toMatch(/h-top|h-\[60px\]/);
    expect(screen.getByTestId("omni")).toBeTruthy();
    expect(header.querySelector(".bg-blue-deep")).toBeNull();
  });

  it("shows the staff breadcrumb inside a hive", () => {
    pathname = `/hives/${HIVE_ID}/documents`;
    render(<AppHeader workspace={{ hiveId: HIVE_ID, hiveName: "Widget batch review", staffView: true }} account={account} />);
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumb.textContent).toContain("All hives");
    expect(crumb.textContent).toContain("Widget batch review");
  });

  it("keeps the mark and a quiet My hives link outside a hive", () => {
    pathname = "/hives";
    render(
      <ClientsHomeProvider enabled={false}>
        <AppHeader workspace={null} account={{ ...account, startingView: "own" }} />
      </ClientsHomeProvider>,
    );
    const home = screen.getByRole("link", { name: "HiveForYou, my hives" });
    expect(home.getAttribute("href")).toBe("/hives");
    expect(screen.getByRole("link", { name: "My hives" }).getAttribute("href")).toBe("/hives");
    expect(screen.queryByTestId("omni")).toBeNull();
    expect(screen.queryByTestId("header-find-client")).toBeNull();
  });

  it("does not put Find a client in the top bar", () => {
    pathname = "/hives";
    render(
      <ClientsHomeProvider enabled>
        <AppHeader workspace={null} account={account} />
      </ClientsHomeProvider>,
    );
    expect(screen.queryByLabelText("Find a client")).toBeNull();
    expect(screen.queryByTestId("omni")).toBeNull();
  });

  it("puts All hives in the breadcrumb, not a filled button", () => {
    pathname = `/hives/${HIVE_ID}/board`;
    render(
      <AppHeader
        workspace={{
          hiveId: HIVE_ID,
          hiveName: "Widget batch review",
          section: "board",
          startingView: "clients",
          hiveKind: "client",
          staffView: true,
        }}
        account={account}
      />,
    );
    const link = screen.getByRole("link", { name: "All hives" });
    expect(link.getAttribute("href")).toBe("/hives");
    expect(link.className).not.toMatch(/\bbg-blue-deep/);
    expect(screen.queryByTestId("header-all-hives")).toBeNull();
  });

  it("hides the breadcrumb from a client", () => {
    pathname = `/hives/${HIVE_ID}/findings`;
    render(
      <AppHeader
        workspace={{
          hiveId: HIVE_ID,
          hiveName: "Widget batch review",
          section: "findings",
          startingView: "own",
          hiveKind: "client",
          staffView: false,
          firmId: "22222222-2222-4222-8222-222222222222",
        }}
        account={account}
      />,
    );
    expect(screen.queryByTestId("workspace-breadcrumb")).toBeNull();
    expect(screen.getByPlaceholderText(/about your documents/)).toBeTruthy();
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