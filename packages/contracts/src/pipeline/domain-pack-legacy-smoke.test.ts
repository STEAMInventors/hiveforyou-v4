import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePackMarkdown } from "./pack-contracts";
import { compileDomainPack } from "./domain-pack-compiler";
import { legacyPackToEditableSource } from "./domain-pack-legacy-adapter";

const root = join(import.meta.dirname, "../../../../packs");

/**
 * Compilation smoke over the real first-party active Pack files.
 * This is intentionally file-discovered rather than domain-name hard-coded.
 * No legacy check or calculation becomes automatically executable.
 */
describe("real first-party Domain Packs offline import", () => {
  const files = readdirSync(root).filter((name) => name.endsWith(".md")).sort();
  it("includes at least one complete format-2 Pack", () => {
    const complete = files.map((name) => parsePackMarkdown(readFileSync(join(root,name),"utf8")))
      .filter((parsed) => parsed.ok && !parsed.value.briefOnly);
    expect(complete.length).toBeGreaterThan(0);
  });
  for (const name of files) {
    it("compiles the supported definitions from " + name, () => {
      const parsed = parsePackMarkdown(readFileSync(join(root,name),"utf8"));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const imported = legacyPackToEditableSource(parsed.value, {
        scope:"PLATFORM",ownerId:"platform",authoredBy:"offline-import",
      });
      expect(imported.ok).toBe(true);
      if (!imported.ok) return;
      const compiled = compileDomainPack(imported.source);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.value.identity.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(compiled.value.definitions.every((d) =>
        d.kind !== "check" || d.criterion.op === "REVIEW_REQUIRED")).toBe(true);
      expect(compiled.value.definitions.every((d) =>
        d.kind !== "calculation" || d.state === "DECLARATION_ONLY")).toBe(true);
    });
  }
});
