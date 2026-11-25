import type {
  CanonicalGap,
  CanonicalStudy,
  FindingsGlanceMetric,
  FindingsOpenItem,
  FindingsTopic,
  Pack,
  StudyView,
  StudyViewSources,
} from "@hiveforyou/contracts";
import { PACK_SCHEMA } from "@hiveforyou/contracts";

import type { ComponentProps } from "react";

import { FindingsPageView } from "@/components/findings/FindingsPageView";

import { GALLERY_HIVE_ID } from "./board-messages";

export type GalleryFindingsProps = ComponentProps<typeof FindingsPageView>;

const value = (
  factId: string,
  doc: string,
  page: number,
  quote: string,
  written: string,
): StudyView["blocks"][number]["rows"][number]["values"][number] => ({
  factId,
  valueAsWritten: written,
  sourceRef: { sourceDocumentId: doc, pageNumber: page, quote },
});

function openItem(
  id: string,
  kind: FindingsOpenItem["kind"],
  title: string,
  question: string,
  factIds: string[] = [],
): FindingsOpenItem {
  return { id, kind, title, question, factIds };
}

function statement(id: string, text: string, doc: string, page: number, quote: string) {
  return {
    id,
    text,
    values: [value(`f-${id}`, doc, page, quote, text)],
  };
}

const GALLERY_PACK: Pack = {
  schema: PACK_SCHEMA,
  meta: {
    pack: "gallery-medicaid",
    version: 1,
    title: "Medicaid financial review",
    description: "Gallery fixture",
    matches: { intent: [], documents: [] },
    jurisdiction: "synthetic",
    verified: "2026-01-01",
    status: "demo",
  },
  briefOnly: true,
  rules: [],
  personas: [],
  askThePerson: [],
  checks: [],
  standingQuestions: [],
  chains: [],
  computedValues: [
    {
      id: "c1",
      label: "Flagged transfers out",
      op: "Add withdrawals and transfers of $1,000 or more with no matching deposit",
      inputs: "Mar 2024 savings transfer, Aug 2025 check to R. Ellis",
      per: "",
    },
  ],
  referenceTables: [],
  documentsUsuallyNeeded: [],
  terms: [],
  generalNotes: [],
  customerReport: null,
  professionalReport: null,
  sources: [],
};

const medicaidTopics: FindingsTopic[] = [
  {
    id: "topic-people",
    title: "People and accounts",
    uncertain: false,
    statements: [
      statement("s1", "Margaret Ellis is the account holder on Checking 4421 and Savings 3819.", "m1", 1, "MARGARET ELLIS"),
      statement("s2", "Account 7710 appears only as a transfer destination.", "m7", 14, "acct ****7710"),
      statement("s3", "R. Ellis appears once, as the payee on check 1184.", "m4", 15, "R. Ellis"),
      statement("s4", "The agency letter lists every account from January 2022 through August 2026.", "m9", 1, "January 2022"),
    ],
    openItems: [],
  },
  {
    id: "topic-dates",
    title: "Dates and periods",
    uncertain: false,
    statements: [
      statement("s5", "Checking statements run from January 2022 to June 2026, with April–June 2023 missing.", "m1", 1, "Jan 2022"),
      statement("s6", "Savings statements run from January 2023 to March 2026.", "m7", 1, "Jan 2023"),
      statement("s7", "The latest checking statement covers June 2026.", "m6", 12, "June 2026"),
    ],
    openItems: [],
  },
  {
    id: "topic-relationships",
    title: "Relationships",
    uncertain: false,
    statements: [
      statement("s8", "$5,000.00 left Checking on September 5, 2023 and arrived in Savings the same day.", "m2", 11, "Sep 5, 2023"),
      statement(
        "s9",
        "A duplicate of the 2025 check scan was set aside as an exact copy of the first file.",
        "m5",
        1,
        "duplicate",
      ),
    ],
    openItems: [],
  },
  {
    id: "topic-uncertain",
    title: "Uncertain",
    uncertain: true,
    statements: [
      statement(
        "s10",
        "The $2,400.00 deposit on November 22, 2024 may be the November 20 withdrawal.",
        "m3",
        21,
        "Nov 20, 2024",
      ),
      statement("s11", "These records don't show who R. Ellis is.", "m4", 15, "R. Ellis"),
    ],
    openItems: [],
  },
];

const medicaidOpen: FindingsOpenItem[] = [
  openItem("x1", "needs", "Savings transfer to account 7710", "No matching deposit appears in the uploads.", ["f-x1"]),
  openItem("x2", "needs", "Check to R. Ellis for $8,500.00", "No matching deposit appears in another uploaded account.", ["f-x2"]),
  openItem("x3", "needs", "Proposed $2,400.00 match", "Withdrawal and deposit may be the same funds.", ["f-x3"]),
  openItem("gap-x4", "missing", "Checking statements Apr–Jun 2023", "Those months are not in any uploaded file.", []),
  openItem("gap-x5", "missing", "Checking statements Jul–Aug 2026", "July and August are within the review period.", []),
  openItem("gap-x6", "missing", "Savings statements Q2–Q3 2026", "April through August are within the review period.", []),
  openItem("x7", "needs", "Savings account open in 2022?", "No 2022 savings documents were uploaded.", ["f-x7"]),
  openItem("x8", "difference", "Unreadable page on June 2024 checking", "Page 11 could not be read, so its transactions are excluded.", ["f-x8"]),
];

const medicaidGlance: FindingsGlanceMetric[] = [
  { id: "g1", label: "Files read", value: "9", sub: "8 unique · 1 exact duplicate", values: [], calculationId: null },
  {
    id: "g2",
    label: "Accounts found",
    value: "2",
    sub: "Checking 4421 · Savings 3819",
    values: [value("f-g2", "m1", 1, "Checking", "2")],
    calculationId: null,
  },
  {
    id: "g3",
    label: "Flagged transfers out",
    value: "$21,900.00",
    sub: "No matching deposit in another uploaded account",
    values: [value("f-g3", "m7", 14, "$12,000", "$21,900.00")],
    calculationId: "c1",
  },
];

function medicaidView(): StudyView {
  const docTypes = [
    "Checking account statements",
    "Savings account statements",
    "Brokerage statements",
    "IRA statements",
    "Credit card statements",
    "Mortgage statements",
    "Pay stubs",
    "Tax return",
    "Medicaid agency letter",
  ];
  const docs = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"].map((id, index) => ({
    id,
    typeInPlainWords: docTypes[index] ?? "Document",
    date: "2022-01-15",
    asWritten: null,
    statement: null,
    status: "SUPPORTED",
    values: [],
  }));
  const timeline = [
    { id: "t1", date: "2022-01-01", statement: "Review period begins", asWritten: null, status: "SUPPORTED", values: [value("f-t1", "m9", 1, "Jan 2022", "Review period begins")] },
    { id: "t2", date: "2023-09-05", statement: "$5,000.00 Checking → Savings (matched)", asWritten: null, status: "SUPPORTED", values: [value("f-t2", "m2", 11, "Sep 5", "matched")] },
    { id: "t3", date: "2024-03-14", statement: "$12,000.00 Savings → account 7710", asWritten: null, status: "SUPPORTED", values: [value("f-t3", "m7", 14, "Mar 14", "7710")] },
    { id: "t4", date: "2024-11-20", statement: "$2,400.00 withdrawn from Checking", asWritten: null, status: "SUPPORTED", values: [value("f-t4", "m3", 21, "Nov 20", "withdrawal")] },
    { id: "t5", date: "2025-08-02", statement: "$8,500.00 check to R. Ellis", asWritten: null, status: "SUPPORTED", values: [value("f-t5", "m4", 15, "Aug 2", "check")] },
    { id: "t6", date: "2026-08-04", statement: "Agency checklist letter", asWritten: null, status: "SUPPORTED", values: [value("f-t6", "m9", 1, "Aug 4", "letter")] },
  ];
  const conflicts = [
    {
      id: "c-1",
      statement: "Sep 5, 2023 transfer",
      asWritten: null,
      status: "SUPPORTED",
      values: [
        value("f-c1a", "m2", 11, "$5,000.00", "$5,000.00"),
        value("f-c1b", "m7", 8, "$5,000.00", "$5,000.00"),
      ],
    },
    {
      id: "c-2",
      statement: "Mar 14, 2024 transfer",
      asWritten: null,
      status: "CONFLICTED",
      values: [
        value("f-c2a", "m7", 14, "$12,000.00", "$12,000.00"),
        value("f-c2b", "m7", 14, "no deposit", "No matching deposit"),
      ],
    },
    {
      id: "c-3",
      statement: "Nov 20–22, 2024 amounts",
      asWritten: null,
      status: "CONFLICTED",
      values: [
        value("f-c3a", "m3", 21, "$2,400.00", "$2,400.00"),
        value("f-c3b", "m7", 23, "$2,400.00", "$2,400.00"),
      ],
    },
    {
      id: "c-4",
      statement: "Aug 2, 2025 check",
      asWritten: null,
      status: "CONFLICTED",
      values: [
        value("f-c4a", "m4", 15, "$8,500.00", "$8,500.00"),
        value("f-c4b", "m4", 15, "no deposit", "No matching deposit"),
      ],
    },
  ];
  return {
    schema: "hive.study-view/1",
    sections: [],
    blocks: [
      { name: "documents", rows: docs },
      { name: "conflicts", rows: conflicts },
      { name: "timeline", rows: timeline },
    ],
    components: [],
    spineSource: null,
  };
}

function medicaidDocumentRequestGap(
  id: string,
  title: string,
  why: string,
): CanonicalGap {
  return {
    id,
    statement: why,
    relatedSpineIds: [],
    kind: "REQUESTABLE_DOCUMENT",
    title,
    why,
    holder: "Client",
    holderType: "ASKER_OR_CLIENT",
    when: null,
    basisType: "USUALLY_EXPECTED",
    relatedFactIds: [],
  };
}

/** Unsatisfied requestable gaps — same titles as medicaidOpen missing rows; drives board checklist on Documents. */
export const MEDICAID_DOCUMENT_REQUEST_GAPS: readonly CanonicalGap[] = [
  medicaidDocumentRequestGap(
    "x4",
    "Checking statements Apr–Jun 2023",
    "Those months are not in any uploaded file.",
  ),
  medicaidDocumentRequestGap(
    "x5",
    "Checking statements Jul–Aug 2026",
    "July and August are within the review period.",
  ),
  medicaidDocumentRequestGap(
    "x6",
    "Savings statements Q2–Q3 2026",
    "April through August are within the review period.",
  ),
];

const medicaidCanonical: CanonicalStudy = {
  schema: "hive.canonical-study/1",
  domainLabel: "medicaid-gallery",
  spineSource: null,
  documents: medicaidView()
    .blocks.find((block) => block.name === "documents")!
    .rows.map((row) => ({
      sourceDocumentId: row.id,
      role: "SUPPORTING",
      typeInPlainWords: row.typeInPlainWords ?? "Document",
      date: row.date ?? null,
      version: null,
      chainPosition: null,
    })),
  spine: [],
  outsideSpine: [],
  conflicts: [],
  timeline: [],
  gaps: [...MEDICAID_DOCUMENT_REQUEST_GAPS],
  checklist: [],
};

const medicaidSources: StudyViewSources = {
  documents: {},
  facts: {
    "f-x1": { sourceDocumentId: "m7", pageNumber: 14, quote: "$12,000.00" },
    "f-x2": { sourceDocumentId: "m4", pageNumber: 15, quote: "$8,500.00" },
    "f-x3": { sourceDocumentId: "m3", pageNumber: 21, quote: "$2,400.00" },
    "f-x7": { sourceDocumentId: "m7", pageNumber: 1, quote: "Savings" },
    "f-x8": { sourceDocumentId: "m3", pageNumber: 11, quote: "unreadable" },
  },
};

export const MEDICAID_FINDINGS: GalleryFindingsProps = {
  hiveId: GALLERY_HIVE_ID,
  revisionNumber: 3,
  view: medicaidView(),
  sources: medicaidSources,
  canonicalStudy: medicaidCanonical,
  pack: GALLERY_PACK,
  topics: medicaidTopics,
  otherOpenItems: medicaidOpen,
  glanceMetrics: medicaidGlance,
  chainEvidence: [],
  openItemCount: medicaidOpen.length,
  coverageGaps: [],
  documentPages: Object.fromEntries(["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"].map((id) => [id, 12])),
  preparation: null,
};

function cloneLarge(): GalleryFindingsProps {
  const extraItems: FindingsOpenItem[] = Array.from({ length: 11 }, (_, index) =>
    openItem(
      `extra-${index}`,
      index % 3 === 0 ? "missing" : index % 3 === 1 ? "difference" : "needs",
      `Additional review item ${index + 1} from the combined samples`,
      `Detail line for item ${index + 1} used to exercise long lists.`,
      [],
    ),
  );
  const extraTopics: FindingsTopic[] = [
    {
      id: "topic-iep",
      title: "School program summary",
      uncertain: false,
      statements: Array.from({ length: 4 }, (_, index) =>
        statement(`edu-${index}`, `Education sample statement ${index + 1} for the large hive fixture.`, "m1", 1, "education"),
      ),
      openItems: [],
    },
    {
      id: "topic-claim",
      title: "Insurance claim",
      uncertain: true,
      statements: Array.from({ length: 4 }, (_, index) =>
        statement(`ins-${index}`, `Insurance sample statement ${index + 1} for the large hive fixture.`, "m2", 2, "claim"),
      ),
      openItems: [],
    },
  ];
  const extraTimeline = Array.from({ length: 4 }, (_, index) => ({
    id: `lt${index}`,
    date: `2024-0${(index % 9) + 1}-01`,
    statement: `Additional dated event ${index + 1} for long timeline checks.`,
    asWritten: null,
    status: "SUPPORTED",
    values: [value(`f-lt${index}`, "m3", index + 1, "event", `event ${index}`)],
  }));
  const baseView = medicaidView();
  const view: StudyView = {
    ...baseView,
    blocks: baseView.blocks.map((block) =>
      block.name === "timeline" ? { ...block, rows: [...block.rows, ...extraTimeline] } : block,
    ),
  };
  return {
    ...MEDICAID_FINDINGS,
    topics: [...medicaidTopics, ...extraTopics],
    otherOpenItems: [...medicaidOpen, ...extraItems],
    openItemCount: medicaidOpen.length + extraItems.length,
    view,
  };
}

export const LARGE_FINDINGS: GalleryFindingsProps = cloneLarge();

const EVIDENCE_LABEL_BY_DOC: Record<string, string> = {
  m1: "Checking 4421 · 2020",
  m2: "Checking 4422 · 2021",
  m3: "Checking 4423 · 2022",
  m4: "Checking 4424 · 2023",
  m5: "Checking 4425 · 2024",
  m6: "Checking 4426 · 2020",
  m7: "Savings 3819 · 2023",
  m8: "Pay stubs · 2022",
  m9: "Agency letter · 2026",
};

export const MEDICAID_EVIDENCE_LABELS = new Map(Object.entries(EVIDENCE_LABEL_BY_DOC));

const CHIP_LABEL_BY_DOC: Record<string, string> = {
  m1: "Checking stmts",
  m2: "Checking stmts",
  m3: "Checking stmts",
  m4: "Checking stmts",
  m5: "Checking stmts",
  m6: "Checking stmts",
  m7: "Savings stmts",
  m8: "Pay stubs",
  m9: "Agency letter",
};

export const MEDICAID_CHIP_LABELS = new Map(Object.entries(CHIP_LABEL_BY_DOC));