import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { loadPackById, loadPackEntries } from "../apps/web/src/server/pipeline/pack-loader-core";

const ROOT = resolve(import.meta.dirname, "..");

describe("iep pack versioned loading", () => {
  it("loads pinned v6 from packs/archive", () => {
    const pack = loadPackById("iep-initial", 6, ROOT);
    expect(pack).not.toBeNull();
    expect(pack?.meta.version).toBe(6);
    expect(pack?.meta.pack).toBe("iep-initial");
  });

  it("exposes only the active copy in the selection index (archive excluded)", () => {
    const { entries } = loadPackEntries(ROOT);
    const versions = entries.filter((row) => row.id === "iep-initial").map((row) => row.pack.meta.version);
    expect(versions.length).toBeLessThanOrEqual(1);
    if (versions.length === 1) {
      const active = loadPackById("iep-initial", versions[0]!, ROOT);
      expect(active?.meta.version).toBe(versions[0]);
    }
  });

  it("does not substitute a different version when the pin is missing", () => {
    expect(loadPackById("iep-initial", 9999, ROOT)).toBeNull();
  });
});
