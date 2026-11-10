import type { ReportAudience } from "@hiveforyou/contracts";

import { buildFixture, type FixtureInput, type ReportFixture, sentence } from "./fixture-builder";

const D1 = "5a5a5a5a-0000-4000-8000-0000000000d1";
const D2 = "5a5a5a5a-0000-4000-8000-0000000000d3";
const D3 = "5a5a5a5a-0000-4000-8000-0000000000d5";
const HIVE = "5a5a5a5a-0000-4000-8000-0000000000aa";

/** Maya's Hive: 4 ask-now, 2 ask-for-later, 1 observation (attached to a spine row). */
const INPUT: FixtureInput = {
  hiveId: HIVE,
  intent: "I want to understand Maya's IEP and whether she is progressing.",
  documents: [
    { id: D1, fileName: "Maya IEP 2025.pdf", pages: 2, canonical: { role: "ANCHOR", typeInPlainWords: "Individualized education program", date: "2025-03-04", version: null, chainPosition: 1 } },
    { id: D2, fileName: "Progress report Nov 2025.pdf", pages: 1, canonical: { role: "SUPPORTING", typeInPlainWords: "Progress report", date: "2025-11-14", version: null, chainPosition: null } },
    { id: D3, fileName: "Psychoeducational evaluation.pdf", pages: 1, canonical: { role: "SUPPORTING", typeInPlainWords: "Evaluation report", date: "2025-02-01", version: null, chainPosition: null } },
  ],
  facts: [
    ["F1", D1, 1, "Goal 1", "target", "90 words correct per minute by March 2026", "Maya will read 90 words correct per minute by March 2026."],
    ["F2", D1, 1, "Goal 1", "baseline", "62 words correct per minute", "Baseline: 62 words correct per minute."],
    ["F3", D2, 1, "Goal 1", "current", "74 words correct per minute", "Goal 1 reading fluency: 74 words correct per minute."],
    ["F4", D3, 1, "Reading comprehension", "score", "not reported", "The evaluator did not report a reading comprehension score."],
  ],
  study: {
    domainLabel: "Special education",
    spineSource: "ANCHOR",
    spine: [
      { id: "S1", label: "Reading fluency goal of 90 words correct per minute by March 2026", kind: "commitment", status: "SUPPORTED", supportingFactIds: ["F1", "F2", "F3"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
    ],
    outsideSpine: [],
    conflicts: [],
    timeline: [],
    gaps: [
      { id: "X1", statement: "", relatedSpineIds: ["S1"], kind: "REQUESTABLE_DOCUMENT", title: "Service delivery log", why: "Shows minutes of specialized reading instruction delivered.", holder: "School district", when: null, basisType: "USUALLY_EXPECTED", relatedFactIds: [] },
      { id: "X2", statement: "", relatedSpineIds: ["S1"], kind: "REQUESTABLE_DOCUMENT", title: "January 2026 progress report", why: "Latest fluency measure after November.", holder: "School district", when: null, basisType: "USUALLY_EXPECTED", relatedFactIds: [] },
      { id: "X3", statement: "", relatedSpineIds: ["S1"], kind: "REQUESTABLE_DOCUMENT", title: "Parent communication log", why: "Documents whether progress was shared with the family.", holder: "School district", when: null, basisType: "USUALLY_EXPECTED", relatedFactIds: [] },
      { id: "X4", statement: "", relatedSpineIds: ["S1"], kind: "REQUESTABLE_DOCUMENT", title: "Benchmark assessment results", why: "Shows current performance against the annual goal.", holder: "School district", when: null, basisType: "USUALLY_EXPECTED", relatedFactIds: [] },
      { id: "X5", statement: "", relatedSpineIds: ["S1"], kind: "FUTURE_RECORD", title: "Annual IEP review meeting notice", why: "The team will meet to review goals.", holder: "School district", when: "March 3, 2026", basisType: null, relatedFactIds: [] },
      { id: "X6", statement: "", relatedSpineIds: ["S1"], kind: "FUTURE_RECORD", title: "Updated progress report", why: "Next reporting period after January.", holder: "School district", when: "Spring 2026", basisType: null, relatedFactIds: [] },
      {
        id: "X7",
        statement: "",
        relatedSpineIds: ["S1"],
        kind: "OBSERVATION",
        title: "",
        why: "The evaluation did not include a reading comprehension score, so comprehension progress cannot be compared here.",
        holder: "",
        when: null,
        basisType: null,
        relatedFactIds: ["F4"],
      },
    ],
  },
  referencedDocuments: [],
  writes: {
    CUSTOMER: {
      sections: [{ heading: "Reading goal", paragraphs: [{ sentences: [sentence("Maya's goal is 90 words per minute by March 2026.", "F1")] }] }],
      blocks: ["spine_table", "documents"],
      components: [{ name: "DocumentRequestList" }],
    },
    PRO: {
      sections: [{ heading: "Fluency tracking", paragraphs: [{ sentences: [sentence("November progress was 74 words per minute against a baseline of 62.", "F3", "F2")] }] }],
      blocks: ["spine_table", "documents"],
      components: [{ name: "DocumentRequestList" }],
    },
  },
};

export function mayaIepFixture(audience: ReportAudience): ReportFixture {
  return buildFixture(INPUT, audience);
}
