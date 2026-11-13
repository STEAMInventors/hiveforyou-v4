import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parsePackMarkdown } from "@hiveforyou/contracts";

const ROOT = resolve(import.meta.dirname, "..");
const BRIEF_PACK = join(ROOT, "packs/HiveForYou-Pack-chapter13-confirmation.md");

describe("parsePackMarkdown (chapter13 brief pack)", () => {
  it("accepts the chapter 13 pack as brief-only", () => {
    const parsed = parsePackMarkdown(readFileSync(BRIEF_PACK, "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.briefOnly).toBe(true);
    expect(parsed.value.personas).toHaveLength(0);
    expect(parsed.value.checks).toHaveLength(0);
    expect(parsed.value.meta.pack).toBe("chapter13-confirmation");
  });
});
