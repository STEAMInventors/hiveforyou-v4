import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parsePackMarkdown } from "../pipeline/pack-contracts";
import { packChecklistItems } from "./hive-request-contracts";

const repoRoot = join(import.meta.dirname, "../../../..");
const packsDir = join(repoRoot, "packs");

const loadPack = (fileName: string) => {
  const parsed = parsePackMarkdown(readFileSync(join(packsDir, fileName), "utf8"));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`pack parse failed: ${fileName}`);
  return parsed.value;
};

describe("packChecklistItems", () => {
  for (const name of readdirSync(packsDir).filter((entry) => entry.endsWith(".md"))) {
    it(`builds checklist rows from ${name}`, () => {
      const pack = loadPack(name);
      const items = packChecklistItems(pack);
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(60);
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        expect(item?.position).toBe(i + 1);
        expect(item?.key).toBe(item?.title.replace(/\s+/g, " ").trim().toLowerCase());
        expect(item?.title.length).toBeGreaterThan(0);
      }
      const futureRows = pack.documentsUsuallyNeeded.filter((r) => r.gapKind === "FUTURE_RECORD");
      for (const row of futureRows) {
        const title = row.document.replace(/\s+/g, " ").trim().toLowerCase();
        expect(items.some((item) => item.key === title)).toBe(false);
      }
    });
  }
});