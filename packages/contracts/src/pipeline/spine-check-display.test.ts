import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "./canonical-study-contracts";
import { parsePackMarkdown } from "./pack-contracts";
import { formatCheckIssueLine } from "./spine-check-display";

const ROOT = resolve(import.meta.dirname, "../../../..");
const pack = parsePackMarkdown(readFileSync(join(ROOT, "packs/HiveForYou-Pack-iep-initial.md"), "utf8"));
if (!pack.ok) throw new Error("pack load failed");

describe("spine-check-display", () => {
  it("never emits bare check text without a verdict prefix", () => {
    const check = pack.value.checks.find((row) => row.id === "T4");
    expect(check).toBeDefined();
    const line = formatCheckIssueLine("NOT_SHOWN", "", check!.check);
    expect(line.startsWith("Not shown:")).toBe(true);
    expect(line).not.toBe(check!.check);
  });

  it("uses the model note when present", () => {
    const line = formatCheckIssueLine("PARTLY_SHOWN", "Notice lists time only.", "Example check");
    expect(line).toBe("Partly shown: Notice lists time only.");
  });
});
