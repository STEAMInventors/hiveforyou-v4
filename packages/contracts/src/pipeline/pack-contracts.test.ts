import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PACK_SCHEMA,
  parsePackMarkdown,
  type Pack,
} from "./pack-contracts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const FIXTURE = join(import.meta.dirname, "../testing/fixtures/widget-review-pack.md");
const BRIEF_PACK = join(ROOT, "packs/HiveForYou-Pack-chapter13-confirmation.md");

const loadFixture = (): Pack => {
  const parsed = parsePackMarkdown(readFileSync(FIXTURE, "utf8"));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("fixture parse failed");
  return parsed.value;
};

describe("parsePackMarkdown", () => {
  it("parses every format-2 section from the neutral widget-review fixture", () => {
    const pack = loadFixture();
    expect(pack.schema).toBe(PACK_SCHEMA);
    expect(pack.briefOnly).toBe(false);
    expect(pack.meta.pack).toBe("widget-review");
    expect(pack.meta.version).toBe(2);
    expect(pack.rules.length).toBeGreaterThan(0);

    expect(pack.personas.map((p) => p.audience).sort()).toEqual(["customer", "professional"]);
    const customer = pack.personas.find((p) => p.audience === "customer");
    expect(customer?.lookingFor.map((q) => q.id)).toEqual(["L1", "L2", "L3"]);
    expect(customer?.lookingFor[0]?.text).toMatch(/vendor decide/i);

    expect(pack.askThePerson).toHaveLength(3);
    expect(pack.checks.map((c) => c.id).sort()).toEqual(["S1", "T1", "T2"]);
    expect(pack.standingQuestions.map((sq) => sq.id)).toEqual(["SQ1", "SQ2"]);
    expect(pack.checks.find((c) => c.id === "T2")?.question).toBeNull();
    expect(pack.chains).toHaveLength(2);
    expect(pack.computedValues.map((c) => c.id)).toEqual(["C1", "C2"]);
    expect(pack.referenceTables[0]?.name).toBe("Throughput norms");
    expect(pack.referenceTables[0]?.rows.length).toBe(2);

    expect(pack.documentsUsuallyNeeded).toHaveLength(3);
    expect(pack.documentsUsuallyNeeded[0]?.gapKind).toBe("REQUESTABLE_DOCUMENT");
    expect(pack.documentsUsuallyNeeded[0]?.settlesCheckIds).toEqual(["T1", "T2"]);
    expect(pack.documentsUsuallyNeeded[2]?.gapKind).toBe("FUTURE_RECORD");

    expect(pack.terms.length).toBeGreaterThanOrEqual(3);
    expect(pack.generalNotes.map((n) => n.id)).toEqual(["N1", "N2"]);
    expect(pack.customerReport?.sections.length).toBe(4);
    expect(pack.professionalReport?.sections.length).toBe(4);
    expect(pack.customerReport?.sections[0]?.questionIds).toEqual(["L1", "L2", "L3"]);
    expect(pack.customerReport?.sections[0]?.blocks.some((b) => b.name === "unanswered")).toBe(true);
    expect(pack.sources.length).toBeGreaterThan(0);
  });

  it("rejects duplicate check ids", () => {
    const base = readFileSync(FIXTURE, "utf8");
    const broken = base.replace("| T2 | Testing finished", "| T1 | Testing finished");
    const parsed = parsePackMarkdown(broken);
    expect(parsed).toEqual({
      ok: false,
      reason: "pack_duplicate_check_id",
      message: 'Duplicate check id "T1".',
    });
  });

  it("rejects duplicate persona question ids within a persona", () => {
    const base = readFileSync(FIXTURE, "utf8");
    const broken = base.replace(
      "L1 What did the vendor decide",
      "L1 What did the vendor decide; L1 Repeated question",
    );
    const parsed = parsePackMarkdown(broken);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe("pack_duplicate_persona_question_id");
  });

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
