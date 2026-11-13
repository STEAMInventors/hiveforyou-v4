import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANONICAL_STUDY_SCHEMA, type CanonicalStudy } from "@hiveforyou/contracts";
import {
  buildStudyView,
  packReportSectionHeadings,
  parsePackMarkdown,
  primarySubjectFirstName,
} from "@hiveforyou/contracts";

const ROOT = resolve(import.meta.dirname, "..");
const IEP_PACK = join(ROOT, "packs/HiveForYou-Pack-iep-initial.md");

/** Prints the Customer pack section list shape for special-ed-l001 (revision 6 style). */
describe("special-ed-l001 customer report sections", () => {
  const iepPack = parsePackMarkdown(readFileSync(IEP_PACK, "utf8"));
  if (!iepPack.ok) throw new Error("iep pack parse failed");

  it("assembles nine Customer sections from pack template (no paid write)", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "case",
      spineSource: "ANCHOR",
      documents: [
        {
          sourceDocumentId: "05acad0000-0000-4000-8000-000000000005",
          role: "SUPPORTING",
          typeInPlainWords: "Academic evaluation report",
          date: "2024-10-18",
          version: null,
          chainPosition: null,
        },
        {
          sourceDocumentId: "08acad0000-0000-4000-8000-000000000008",
          role: "ANCHOR",
          typeInPlainWords: "Initial individualized education program",
          date: "2024-11-12",
          version: null,
          chainPosition: 1,
        },
      ],
      spine: [
        {
          id: "S1",
          label: "Reading goal",
          kind: "goal",
          status: "CURRENT",
          supportingFactIds: ["F1"],
          contradictingFactIds: [],
          updatingFactIds: [],
          missing: [],
        },
      ],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [
        {
          id: "X1",
          statement: "",
          relatedSpineIds: [],
          kind: "REQUESTABLE_DOCUMENT",
          title: "Prior written notice",
          why: "These documents don't show:\n• Meeting notice details",
          holder: "School",
          holderType: "THIRD_PARTY",
          when: null,
          basisType: "USUALLY_EXPECTED",
          relatedFactIds: [],
          settlesCheckIds: ["T4"],
        },
      ],
      checklist: [
        { checkId: "T1", verdict: "NOT_SHOWN", factIds: [], note: "" },
        { checkId: "T4", verdict: "NOT_SHOWN", factIds: [], note: "" },
      ],
      chains: [
        {
          chainId: "CH1",
          rows: [{ label: "Concern", links: [{ factIds: ["F1"] }, { missing: true }] }],
        },
        { chainId: "CH2", rows: [{ label: "Need", links: [{ factIds: ["F1"] }, { factIds: ["F1"] }] }] },
      ],
      questionOrder: ["T1", "T4"],
      standingQuestions: [{ id: "SQ1", applies: true, factIds: [] }],
      packRef: { id: "iep-initial", version: 6 },
    };

    const template = iepPack.value.customerReport?.sections ?? [];
    const firstName = primarySubjectFirstName(study, [
      {
        id: "F1",
        subject: "Maya Carter",
        attribute: "goal",
        valueAsWritten: "70 wpm",
        sourceDocumentId: "08acad0000-0000-4000-8000-000000000008",
        pageNumber: 1,
        quote: "Maya FAPE and IEP reading goal 70 wpm",
      },
    ]);
    expect(firstName).toBe("Maya");

    const narrative = template.map((section) => ({
      heading: section.heading.replace(/\{first name\}/gi, firstName ?? ""),
      paragraphs: [{ sentences: [{ text: "Your documents show a reading goal for Maya.", factIds: ["F1"] }] }],
    }));

    const { view, drops } = buildStudyView(
      study,
      { sections: narrative, blocks: [], components: [{ name: "DocumentRequestList" }] },
      [
        {
          id: "F1",
          subject: "Maya",
          attribute: "goal",
          valueAsWritten: "70 wpm",
          sourceDocumentId: "08acad0000-0000-4000-8000-000000000008",
          pageNumber: 1,
          quote: "Maya FAPE and IEP reading goal 70 wpm",
        },
      ],
      {},
      { pack: iepPack.value, reportAudience: "customer" },
    );

    const headings = packReportSectionHeadings(view.packSections ?? []);
    const withCounts = (view.packSections ?? []).map((section) => {
      const blockCounts = section.blocks.map((block) => `${block.name}:${block.rows.length}`).join(", ");
      const gaps =
        blockCounts.includes("gaps:0") && section.documentRequestList
          ? `gaps:${section.documentRequestList.items.length}`
          : null;
      const blocks = gaps ? blockCounts.replace("gaps:0", gaps) : blockCounts;
      return `${section.order}. ${section.heading} [${blocks}]`;
    });
    console.log("Customer report sections (special-ed-l001):\n" + withCounts.map((h) => `  ${h}`).join("\n"));
    console.log(`packSectionsOmitted: ${drops.packSectionsOmitted}`);

    expect(headings.length).toBe(9);
    expect(drops.packSectionsOmitted).toBe(0);
  });
});
