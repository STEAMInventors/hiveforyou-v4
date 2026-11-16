// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("white page background", () => {
  it("does not fetch fonts from Google at build time", () => {
    const layout = readFileSync(path.join(__dirname, "../app/layout.tsx"), "utf8");
    expect(layout).not.toContain("next/font/google");
    expect(layout).toContain("next/font/local");
  });

  it("uses paper on the root body and AppShell", () => {
    const layout = readFileSync(path.join(__dirname, "../app/layout.tsx"), "utf8");
    const header = readFileSync(path.join(__dirname, "app-header.tsx"), "utf8");
    const appShell = header.match(/export function AppShell[\s\S]*?^}/m)?.[0] ?? "";
    expect(layout).toContain("bg-paper");
    expect(header).toContain("bg-paper");
    expect(appShell).not.toMatch(/bg-mist/);
  });

  it("does not use a mist page band on hive workspace or new client screens", () => {
    const workspace = readFileSync(path.join(__dirname, "hive-workspace-layout.tsx"), "utf8");
    const landing = readFileSync(path.join(__dirname, "../app/page.tsx"), "utf8");
    const newClient = readFileSync(path.join(__dirname, "hives/NewClientHiveForm.tsx"), "utf8");
    expect(workspace).toContain("bg-paper");
    expect(workspace).not.toMatch(/flex flex-1 flex-col bg-mist/);
    expect(landing).toContain("bg-paper");
    expect(newClient).not.toContain("bg-mist");
  });
});