// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("white page background", () => {
  it("uses paper on the root body and AppShell", () => {
    const layout = readFileSync(path.join(__dirname, "../app/layout.tsx"), "utf8");
    const header = readFileSync(path.join(__dirname, "app-header.tsx"), "utf8");
    expect(layout).toContain("bg-paper");
    expect(header).toContain("bg-paper");
    expect(header).not.toMatch(/AppShell[\s\S]*bg-mist/);
  });
});