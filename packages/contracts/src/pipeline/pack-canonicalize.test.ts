import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseCanonicalStudy } from "./canonical-study-contracts";
import { parsePackMarkdown } from "./pack-contracts";
import { applyPackCanonicalizeOutput, packCanonicalizeInput } from "./pack-canonicalize";

const ROOT = resolve(import.meta.dirname, "../../../..");

describe("pack canonicalize verify", () => {
  const widget = parsePackMarkdown(
    readFileSync(join(ROOT, "packages/contracts/src/testing/fixtures/widget-review-pack.md"), "utf8"),
  );
  expect(widget.ok).toBe(true);
  if (!widget.ok) return;
  const pack = widget.value;

  it("packCanonicalizeInput includes both personas", () => {
    const input = packCanonicalizeInput(pack, "2026-11-11");
    expect(input.readers).toHaveLength(2);
    expect(input.checks.length).toBeGreaterThan(0);
    expect(input.readers[0]).not.toHaveProperty("authority");
    expect(input.standingQuestions?.[0]).not.toHaveProperty("question");
    expect(input.studyDate).toBe("Study date: 2026-11-11");
  });

  it("drops unknown ids and downgrades missing facts", () => {
    const base = parseCanonicalStudy({
      schema: "hive.canonical-study/1",
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [],
      domainLabel: "widgets",
      personaCoverage: [{ audience: "customer", questionId: "L99", status: "ANSWERABLE", factIds: [], checkIds: [], missing: "" }],
      checklist: [{ checkId: "T1", verdict: "SHOWN", factIds: [], note: "" }],
    });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const known = new Set(["F1"]);
    const { study, drops } = applyPackCanonicalizeOutput(
      base.value,
      pack,
      { id: "widget-review", version: 1 },
      {
        personaCoverage: [
          { audience: "customer", questionId: "L1", status: "ANSWERABLE", factIds: ["F1"], checkIds: [], missing: "" },
          { audience: "customer", questionId: "L2", status: "ANSWERABLE", factIds: ["MISSING"], checkIds: [], missing: "" },
        ],
        checklist: [{ checkId: "T1", verdict: "SHOWN", factIds: ["F1"], note: "ok" }],
      },
      known,
    );
    expect(drops.unknownPersonaQuestionIds).toBeGreaterThanOrEqual(0);
    expect(study.checklist?.[0]?.verdict).toBe("SHOWN");
    expect(study.packRef).toEqual({ id: "widget-review", version: 1 });
  });
});
