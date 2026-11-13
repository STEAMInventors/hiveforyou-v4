import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "./canonical-study-contracts";
import { parsePackMarkdown } from "./pack-contracts";
import { buildChecklistRows, buildQuestionRows } from "./pack-study-view";
import { buildStudyView, parseWriteOutput } from "./study-view-contracts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const FIXTURE = join(ROOT, "packages/contracts/src/testing/fixtures/widget-review-pack.md");

const loadPack = () => {
  const parsed = parsePackMarkdown(readFileSync(FIXTURE, "utf8"));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("fixture parse failed");
  return parsed.value;
};

const baseStudy = (): CanonicalStudy => ({
  schema: CANONICAL_STUDY_SCHEMA,
  domainLabel: "widgets",
  spineSource: null,
  documents: [],
  spine: [],
  outsideSpine: [],
  conflicts: [],
  timeline: [],
  gaps: [],
  checklist: [
    { checkId: "T1", verdict: "NOT_SHOWN", factIds: [], note: "no notice copy" },
    { checkId: "T2", verdict: "SHOWN", factIds: ["F1"], note: "" },
  ],
  standingQuestions: [{ id: "SQ1", applies: true, factIds: ["F1"] }],
  questionOrder: ["T1", "SQ1"],
  packRef: { id: "widget-review", version: 2 },
});

describe("pack study view blocks", () => {
  const pack = loadPack();

  it("puts authority on its own field for professional checklist rows", () => {
    const rows = buildChecklistRows(baseStudy(), pack, new Map(), "professional");
    const t1 = rows.find((row) => row.id === "T1");
    expect(t1?.authority).toBe("REF-1");
    expect(t1?.missing).toBeUndefined();
  });

  it("customer render has no check id or authority in any pack block", () => {
    const write = parseWriteOutput({
      sections: [],
      blocks: ["checklist", "questions", "chains", "general_notes"],
    });
    if (!write.ok) throw new Error("write parse failed");
    const { view } = buildStudyView(baseStudy(), write.value, [], {}, { pack, reportAudience: "customer" });
    const authorities = new Set(pack.checks.map((c) => c.authority).filter(Boolean));
    for (const block of view.blocks) {
      for (const row of block.rows) {
        expect(row.id).not.toMatch(/^(?:SQ|T|P|E|G|S|A|L|M|F)\d+$/);
        expect(row.authority ?? null).toBeNull();
        for (const auth of authorities) {
          expect(row.statement ?? "").not.toContain(auth);
        }
      }
    }
  });

  it("mixes standing questions into the questions block by audience", () => {
    const rows = buildQuestionRows(baseStudy(), pack, new Map(), "customer");
    expect(rows.map((row) => row.statement)).toEqual([
      pack.checks.find((c) => c.id === "T1")?.question,
      pack.standingQuestions.find((sq) => sq.id === "SQ1")?.question,
    ]);
    expect(rows.find((row) => row.id === "T2")).toBeUndefined();
  });

  it("omits SHOWN checks, includes CONFLICT, dedupes text and caps customer questions", () => {
    const study: CanonicalStudy = {
      ...baseStudy(),
      checklist: [
        { checkId: "T1", verdict: "CONFLICT", factIds: ["F1", "F2"], note: "" },
        { checkId: "T2", verdict: "SHOWN", factIds: ["F1"], note: "" },
      ],
      questionOrder: ["T1", "T1", "T2"],
      standingQuestions: [],
    };
    const rows = buildQuestionRows(study, pack, new Map(), "customer");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.statement).toBe(pack.checks.find((c) => c.id === "T1")?.question);
  });
});
