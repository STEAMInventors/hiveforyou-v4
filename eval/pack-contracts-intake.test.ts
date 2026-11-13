import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parsePackMarkdown } from "@hiveforyou/contracts";

const ROOT = resolve(import.meta.dirname, "..");
const INTAKE_PACK = join(ROOT, "packs/HiveForYou-Pack-bankruptcy-intake.md");

describe("parsePackMarkdown (bankruptcy intake pack)", () => {
  const markdown = readFileSync(INTAKE_PACK, "utf8");

  it("loads version 1 with every format-2 section although the file has a Record kinds section", () => {
    expect(markdown).toMatch(/^## Record kinds$/m);
    const parsed = parsePackMarkdown(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const pack = parsed.value;
    expect(pack.meta.pack).toBe("bankruptcy-intake");
    expect(pack.meta.version).toBe(1);
    expect(pack.briefOnly).toBe(false);
    expect(pack.personas.map((p) => p.audience).sort()).toEqual(["customer", "professional"]);
    expect(pack.askThePerson.map((q) => q.id)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]);
    expect(pack.checks).toHaveLength(20);
    expect(pack.standingQuestions).toHaveLength(6);
    expect(pack.chains.map((c) => c.id)).toEqual(["CH1", "CH2"]);
    expect(pack.documentsUsuallyNeeded).toHaveLength(15);
    expect(pack.terms).toHaveLength(10);
    expect(pack.generalNotes.map((n) => n.id)).toEqual(["N1", "N2", "N3", "N4"]);
    expect(pack.customerReport?.sections).toHaveLength(7);
    expect(pack.professionalReport?.sections).toHaveLength(9);
    expect(pack.sources).toHaveLength(3);
  });

  it("keeps the sections on both sides of Record kinds intact", () => {
    const parsed = parsePackMarkdown(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Chains comes just before Record kinds and Computed values just after it.
    expect(parsed.value.chains[1]?.id).toBe("CH2");
    expect(parsed.value.computedValues.map((c) => c.id)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6"]);
    // No Record kinds row leaks into a known table.
    const leaked = JSON.stringify(parsed.value).includes("account last 4");
    expect(leaked).toBe(false);
  });
});
