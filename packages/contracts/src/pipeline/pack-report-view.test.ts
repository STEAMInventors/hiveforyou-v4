import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "./canonical-study-contracts";
import { parsePackMarkdown } from "./pack-contracts";
import { packReportSectionHeadings } from "./pack-report-view";
import { buildStudyView } from "./study-view-contracts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const FIXTURE_PACK = join(ROOT, "packages/contracts/src/testing/fixtures/widget-review-pack.md");

const loadPack = () => {
  const parsed = parsePackMarkdown(readFileSync(FIXTURE_PACK, "utf8"));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("fixture parse failed");
  return parsed.value;
};

const baseStudy = (): CanonicalStudy => ({
  schema: CANONICAL_STUDY_SCHEMA,
  domainLabel: "widgets",
  spineSource: "ANCHOR",
  documents: [
    {
      sourceDocumentId: "d1",
      role: "ANCHOR",
      typeInPlainWords: "Calibration worksheet",
      date: "2024-10-18",
      version: null,
      chainPosition: null,
    },
  ],
  spine: [{ id: "S1", label: "Batch tolerance", kind: "spec", status: "CURRENT", supportingFactIds: ["F1"], contradictingFactIds: [], updatingFactIds: [], missing: [] }],
  outsideSpine: [],
  conflicts: [],
  timeline: [],
  gaps: [
    {
      id: "X1",
      statement: "",
      relatedSpineIds: [],
      kind: "REQUESTABLE_DOCUMENT",
      title: "Operator sign-off sheet",
      why: "These documents don't show:\n• A dated sign-off",
      holder: "Vendor",
      holderType: "THIRD_PARTY",
      when: null,
      basisType: "USUALLY_EXPECTED",
      relatedFactIds: [],
      settlesCheckIds: ["T1"],
    },
  ],
  checklist: [
    { checkId: "T1", verdict: "NOT_SHOWN", factIds: [], note: "" },
    { checkId: "T2", verdict: "NOT_SHOWN", factIds: [], note: "" },
  ],
  chains: [
    {
      chainId: "CH1",
      rows: [{ label: "Lot start", links: [{ factIds: ["F1"] }, { missing: true }] }],
    },
  ],
  questionOrder: ["T1", "T2"],
  standingQuestions: [],
  packRef: { id: "widget-review", version: 2 },
});

describe("pack report view", () => {
  it("renders every customer template section in order with template blocks", () => {
    const pack = loadPack();
    const narrative = (pack.customerReport?.sections ?? []).map((section) => ({
      heading: section.heading,
      paragraphs: [{ sentences: [{ text: "The record shows a tolerance value.", factIds: ["F1"] }] }],
    }));
    const { view, drops } = buildStudyView(
      baseStudy(),
      { sections: narrative, blocks: [], components: [{ name: "DocumentRequestList" }] },
      [
        {
          id: "F1",
          subject: "Lot A",
          attribute: "tolerance",
          valueAsWritten: "0.02 mm",
          sourceDocumentId: "d1",
          pageNumber: 1,
          quote: "tolerance 0.02 mm",
        },
      ],
      {},
      { pack, reportAudience: "customer" },
    );
    expect(view.packSections?.length).toBe(4);
    expect(drops.packSectionsOmitted).toBe(0);
    expect(packReportSectionHeadings(view.packSections ?? [])).toEqual([
      "1. The short answer",
      "2. What the vendor decided",
      "3. Questions before you accept",
      "4. Words used in these documents",
    ]);
    const questions = view.packSections?.find((section) => section.order === 3);
    expect(questions?.blocks.some((block) => block.name === "questions" && block.rows.length > 0)).toBe(true);
  });
});
