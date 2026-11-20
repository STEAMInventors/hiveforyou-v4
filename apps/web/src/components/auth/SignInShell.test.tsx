// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SignInShell } from "./SignInShell";

afterEach(cleanup);

describe("SignInShell split layout", () => {
  it("keeps the about aside in the document with hidden min-[960px]:flex (390px vs 1280px)", () => {
    render(
      <SignInShell>
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
      <SignInShell>
        <p>Form body</p>
      </SignInShell>,
    );
    expect(screen.getByRole("link", { name: "HiveForYou home" }).getAttribute("href")).toBe("/");
  });

  it("keeps the aside free of buttons and links", () => {
    render(
      <SignInShell>
        <p>Form body</p>
      </SignInShell>,
    );
    const aside = screen.getByRole("complementary", { name: "About HiveForYou", hidden: true });
    expect(within(aside).queryAllByRole("button")).toHaveLength(0);
    expect(within(aside).queryAllByRole("link")).toHaveLength(0);
  });

  it("skips the aside when splitPage is false", () => {
    render(
      <SignInShell splitPage={false}>
        <p>Help body</p>
      </SignInShell>,
    );
    expect(screen.queryByRole("complementary", { name: "About HiveForYou" })).toBeNull();
  });
});