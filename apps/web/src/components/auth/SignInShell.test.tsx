// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SignInShell } from "./SignInShell";

afterEach(cleanup);

describe("SignInShell column layout (default)", () => {
  it("has the signed-out bar, one 400px column and no about aside", () => {
    render(
      <SignInShell>
        <p>Form body</p>
      </SignInShell>,
    );
    expect(screen.getByTestId("signed-out-bar")).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "About HiveForYou", hidden: true })).toBeNull();
    const main = screen.getByRole("main");
    expect(main.className).toContain("max-w-[400px]");
    expect(within(main).getByText("Form body")).toBeTruthy();
  });

  it("links the bar's mark to home exactly once", () => {
    render(
      <SignInShell>
        <p>Form body</p>
      </SignInShell>,
    );
    const links = screen.getAllByRole("link", { name: "HiveForYou home" });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/");
  });
});

describe("SignInShell split layout (welcome)", () => {
  it("keeps the about aside in the document with hidden min-[960px]:flex (390px vs 1280px)", () => {
    render(
      <SignInShell layout="split">
        <p>Form body</p>
      </SignInShell>,
    );
    const aside = screen.getByRole("complementary", { name: "About HiveForYou", hidden: true });
    expect(aside.className).toMatch(/\bhidden\b/);
    expect(aside.className).toContain("min-[960px]:flex");
    expect(screen.getByRole("heading", { level: 2, name: /Every page read/, hidden: true })).toBeTruthy();
  });

  it("links the hive mark to home", () => {
    render(
      <SignInShell layout="split">
        <p>Form body</p>
      </SignInShell>,
    );
    expect(screen.getByRole("link", { name: "HiveForYou home" }).getAttribute("href")).toBe("/");
  });

  it("keeps the aside free of buttons and links", () => {
    render(
      <SignInShell layout="split">
        <p>Form body</p>
      </SignInShell>,
    );
    const aside = screen.getByRole("complementary", { name: "About HiveForYou", hidden: true });
    expect(within(aside).queryAllByRole("button")).toHaveLength(0);
    expect(within(aside).queryAllByRole("link")).toHaveLength(0);
  });
});

describe("SignInShell plain layout (sign-in help)", () => {
  it("has no aside and no signed-out bar, and links the mark to home", () => {
    render(
      <SignInShell layout="plain">
        <p>Help body</p>
      </SignInShell>,
    );
    expect(screen.queryByRole("complementary", { name: "About HiveForYou" })).toBeNull();
    expect(screen.queryByTestId("signed-out-bar")).toBeNull();
    expect(screen.getByRole("link", { name: "HiveForYou home" }).getAttribute("href")).toBe("/");
  });
});
