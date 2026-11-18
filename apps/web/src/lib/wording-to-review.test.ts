import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

function walk(dir: string, into: string[]) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, into);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) into.push(full);
  }
}

describe("to-review wording", () => {
  it("does not say Needs you in the findings rail or page", () => {
    const files = [
      "lib/hive-routes.ts",
      "components/workspace/HiveSidebar.tsx",
      "components/workspace/sidebar-counts.ts",
      "app/hives/[hiveId]/findings/page.tsx",
      "app/hives/[hiveId]/audit/page.tsx",
      "server/hives/findings-summary.ts",
    ];
    for (const relative of files) {
      const text = readFileSync(path.join(SRC, relative), "utf8");
      expect(text.toLowerCase(), relative).not.toContain("needs you");
    }
  });

  it("no longer uses the boardNeedsYou identifier", () => {
    const files: string[] = [];
    walk(SRC, files);
    const hits = files.filter((file) => readFileSync(file, "utf8").includes("boardNeedsYou"));
    expect(hits).toEqual([]);
  });
});
