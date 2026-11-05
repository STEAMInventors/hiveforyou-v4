/**
 * Synthetic test data only (no real person, school or document). "Maya" is a fictional student whose
 * eight fictional IEP records exercise the Canonical Study verifier, the Writer validator, scenarios
 * and the A2UI binder offline.
 */

export const MAYA_RUN_ID = "5a5a5a5a-0000-4000-8000-000000000001";
export const MAYA_INTENT_ID = "5a5a5a5a-0000-4000-8000-0000000000a1";
export const MAYA_INTENT_TEXT =
  "I want to understand Maya's IEP, Prep for the IEP meeting and want to know if Maya is progressing";

export const MAYA_DOCS = {
  iep2025: "5a5a5a5a-0000-4000-8000-0000000000d1",
  iep2024: "5a5a5a5a-0000-4000-8000-0000000000d2",
  progressNov: "5a5a5a5a-0000-4000-8000-0000000000d3",
  serviceLog: "5a5a5a5a-0000-4000-8000-0000000000d4",
  evaluation: "5a5a5a5a-0000-4000-8000-0000000000d5",
  progressJan: "5a5a5a5a-0000-4000-8000-0000000000d6",
  meetingNotice: "5a5a5a5a-0000-4000-8000-0000000000d7",
  teacherNotes: "5a5a5a5a-0000-4000-8000-0000000000d8",
} as const;

export const MAYA_FILE_NAMES: Record<string, string> = {
  [MAYA_DOCS.iep2025]: "Maya IEP 2025.pdf",
  [MAYA_DOCS.iep2024]: "Maya IEP 2024.pdf",
  [MAYA_DOCS.progressNov]: "Progress report Nov 2025.pdf",
  [MAYA_DOCS.serviceLog]: "Speech service log.xlsx",
  [MAYA_DOCS.evaluation]: "Psychoeducational evaluation.pdf",
  [MAYA_DOCS.progressJan]: "Progress report Jan 2026.pdf",
  [MAYA_DOCS.meetingNotice]: "Meeting notice.docx",
  [MAYA_DOCS.teacherNotes]: "Teacher notes.docx",
};

export const MAYA_PAGES: Record<string, string> = {
  [`${MAYA_DOCS.iep2025}:1`]:
    "Individualized Education Program for Maya.\r\nMeeting date: March 4, 2025.\nGoal 1: Maya will read 90 words correct per minute by March 2026.\nBaseline:   62 words correct per minute.",
  [`${MAYA_DOCS.iep2025}:2`]: "Services: Speech-language therapy, 480 minutes per semester.",
  [`${MAYA_DOCS.iep2024}:1`]: "Individualized Education Program, 2024. Goal 1: Maya will read 60 words correct per minute.",
  [`${MAYA_DOCS.progressNov}:1`]:
    "Progress report, November 14, 2025. Goal 1 reading fluency: 74 words correct per minute. Progress: making adequate progress.",
  [`${MAYA_DOCS.serviceLog}:1`]:
    "Speech therapy minutes delivered September to November 2025: 360 minutes. Minutes required by IEP: 480 minutes.",
  [`${MAYA_DOCS.evaluation}:1`]: "Psychoeducational evaluation. The evaluator did not report a reading comprehension score.",
  [`${MAYA_DOCS.progressJan}:1`]: "Progress report, January 2026. Goal 1 data not yet collected.",
  [`${MAYA_DOCS.meetingNotice}:1`]: "Notice of IEP meeting. The annual review meeting is scheduled for March 3, 2026.",
  [`${MAYA_DOCS.teacherNotes}:1`]: "Teacher notes. Maya participates in small-group reading four days a week.",
};

export const MAYA_PLAN_QUESTION_IDS = ["P1", "P2", "P3"] as const;
export const MAYA_SIX_PLAN_QUESTION_IDS = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;

const quote = (doc: string, page: number, text: string) => ({ sourceDocumentId: doc, pageNumber: page, quote: text });

export function mayaStudyOutput() {
  const baseline = quote(MAYA_DOCS.iep2025, 1, "Baseline: 62 words correct per minute.");
  const target = quote(MAYA_DOCS.iep2025, 1, "Maya will read 90 words correct per minute by March 2026.");
  const current = quote(MAYA_DOCS.progressNov, 1, "Goal 1 reading fluency: 74 words correct per minute.");
  const delivered = quote(MAYA_DOCS.serviceLog, 1, "Speech therapy minutes delivered September to November 2025: 360 minutes.");
  const required = quote(MAYA_DOCS.serviceLog, 1, "Minutes required by IEP: 480 minutes.");
  const noScore = quote(MAYA_DOCS.evaluation, 1, "The evaluator did not report a reading comprehension score.");
  const meeting = quote(MAYA_DOCS.iep2025, 1, "Meeting date: March 4, 2025.");
  return {
    schema: "hive.study-investigation/1",
    processingRunId: MAYA_RUN_ID,
    answers: [
      {
        planQuestionId: "P1",
        status: "PARTIALLY_ANSWERED",
        answer: "Reading fluency rose from 62 to 74 words correct per minute against a goal of 90.",
        facts: [
          { statement: "The baseline was 62 words correct per minute.", evidence: [baseline] },
          { statement: "The goal is 90 words correct per minute by March 2026.", evidence: [target, meeting] },
          { statement: "In November 2025 Maya read 74 words correct per minute.", evidence: [current] },
        ],
        calculations: [
          {
            description: "Gain since the baseline",
            inputs: [
              { label: "Current", valueAsWritten: "74 words correct per minute", evidence: [current] },
              { label: "Baseline", valueAsWritten: "62 words correct per minute", evidence: [baseline] },
            ],
            arithmetic: "74 - 62 = 12",
            result: "12 words correct per minute",
            formula: { op: "-", args: [{ input: 0 }, { input: 1 }] },
          },
          {
            description: "Remaining gap to the goal",
            inputs: [
              { label: "Goal", valueAsWritten: "90 words correct per minute", evidence: [target] },
              { label: "Current", valueAsWritten: "74 words correct per minute", evidence: [current] },
            ],
            arithmetic: "90 - 74 = 18",
            result: "18 words correct per minute",
            formula: { op: "-", args: [{ input: 0 }, { input: 1 }] },
          },
        ],
        assessments: [
          {
            judgment: "Maya is improving but has not yet reached the goal.",
            criterion: "Compare the latest measurement with the baseline and the goal.",
            criterionSource: "GENERAL_KNOWLEDGE",
            criterionEvidence: [],
            factIndexes: [0, 1, 2],
            reasoning: "The latest value is above the baseline and below the goal.",
            strength: "MODERATE",
            wouldChangeIf: ["A later progress report shows a different value."],
          },
        ],
        uncertainties: ["Only one progress measurement after the baseline was available."],
        professionalDeterminations: [
          { determination: "Whether progress is sufficient", bearingFacts: [0, 2], decidedBy: "The IEP team" },
        ],
        evidence: [baseline, current],
        conflicts: [],
        limitations: [],
      },
      {
        planQuestionId: "P2",
        status: "ANSWERED",
        answer: "The log shows 360 of 480 required speech minutes were delivered.",
        facts: [
          { statement: "360 speech minutes were delivered.", evidence: [delivered] },
          { statement: "480 minutes are required.", evidence: [required] },
        ],
        calculations: [
          {
            description: "Share of required minutes delivered",
            inputs: [
              { label: "Delivered", valueAsWritten: "360 minutes", evidence: [delivered] },
              { label: "Required", valueAsWritten: "480 minutes", evidence: [required] },
            ],
            arithmetic: "360 / 480 × 100 = 75",
            result: "75%",
            formula: { op: "*", args: [{ op: "/", args: [{ input: 0 }, { input: 1 }] }, { value: "100" }] },
          },
        ],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [delivered, required],
        conflicts: [],
        limitations: [],
      },
      {
        planQuestionId: "P3",
        status: "MISSING_EVIDENCE",
        answer: "No reading comprehension score was reported.",
        facts: [{ statement: "The evaluation did not report a comprehension score.", evidence: [noScore] }],
        calculations: [],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [noScore],
        conflicts: [],
        limitations: ["Comprehension cannot be assessed from these records."],
      },
    ],
    coverageNotes: [],
    instructionsIgnored: [],
  };
}

type ScriptedCall = { id: string; name: string; arguments: string };

type MayaDocumentScript = {
  documentId: string;
  role: "PRIMARY" | "SUPPORTING" | "REFERENCE" | "UNCERTAIN";
  documentType: string;
  roleReasoning: string;
  temporalStatus: "CURRENT" | "HISTORICAL" | "UPCOMING" | "UNSPECIFIED";
  evidenceIds: string[];
};

/** `record_document` arguments for the eight-document Maya corpus (E1–E11 as recorded by both Maya scripts). */
function mayaDocumentRecords(): MayaDocumentScript[] {
  return [
    {
      documentId: MAYA_DOCS.iep2025,
      role: "PRIMARY",
      documentType: "Individualized Education Program",
      roleReasoning: "Current plan that sets the reading baseline and goal the questions measure progress against.",
      temporalStatus: "CURRENT",
      evidenceIds: ["E1", "E3"],
    },
    {
      documentId: MAYA_DOCS.iep2024,
      role: "SUPPORTING",
      documentType: "Individualized Education Program",
      roleReasoning: "Earlier plan whose reading goal differs from the current plan.",
      temporalStatus: "HISTORICAL",
      evidenceIds: ["E8"],
    },
    {
      documentId: MAYA_DOCS.progressNov,
      role: "SUPPORTING",
      documentType: "Progress report",
      roleReasoning: "Latest reading fluency measurement against Goal 1.",
      temporalStatus: "CURRENT",
      evidenceIds: ["E4"],
    },
    {
      documentId: MAYA_DOCS.serviceLog,
      role: "SUPPORTING",
      documentType: "Service delivery log",
      roleReasoning: "Delivered and required speech therapy minutes.",
      temporalStatus: "CURRENT",
      evidenceIds: ["E5", "E6"],
    },
    {
      documentId: MAYA_DOCS.evaluation,
      role: "SUPPORTING",
      documentType: "Psychoeducational evaluation",
      roleReasoning: "Shows whether a reading comprehension score was reported.",
      temporalStatus: "CURRENT",
      evidenceIds: ["E7"],
    },
    {
      documentId: MAYA_DOCS.progressJan,
      role: "SUPPORTING",
      documentType: "Progress report",
      roleReasoning: "Later progress report for Goal 1.",
      temporalStatus: "CURRENT",
      evidenceIds: ["E9"],
    },
    {
      documentId: MAYA_DOCS.meetingNotice,
      role: "REFERENCE",
      documentType: "Meeting notice",
      roleReasoning: "Schedules the upcoming annual review meeting.",
      temporalStatus: "UPCOMING",
      evidenceIds: ["E10"],
    },
    {
      documentId: MAYA_DOCS.teacherNotes,
      role: "REFERENCE",
      documentType: "Teacher notes",
      roleReasoning: "Describes classroom reading support.",
      temporalStatus: "CURRENT",
      evidenceIds: ["E11"],
    },
  ];
}

/**
 * A scripted Canonical Study investigation over the case-wide Maya corpus (D-042): one model turn
 * per inner list. Evidence ids E1–E11, fact ids F1–F6, calculation ids C1–C3 and document findings
 * DF1–DF7 follow from the order. P1 draws on three documents and flags the differing 2024 and 2025
 * reading targets as a conflict. Every document is recorded and reconciled (V4-004L).
 */
export function mayaStudyAgentTurns(): ScriptedCall[][] {
  let n = 0;
  const call = (name: string, args: Record<string, unknown>): ScriptedCall => ({
    id: `toolu_maya_${(n += 1)}`,
    name,
    arguments: JSON.stringify(args),
  });
  const read = (doc: string, from: number, to = from) => call("read_pages", { documentId: doc, fromPage: from, toPage: to });
  const cite = (doc: string, page: number, quote: string) => call("record_evidence", { documentId: doc, pageNumber: page, quote });
  const fact = (questionId: string, statement: string, evidenceIds: string[]) => call("record_fact", { questionId, statement, evidenceIds });
  const input = (label: string, valueAsWritten: string, evidenceIds: string[]) => ({ label, valueAsWritten, evidenceIds });
  return [
    [
      call("search_case", { query: "words correct per minute" }),
      read(MAYA_DOCS.iep2025, 1, 2),
      read(MAYA_DOCS.iep2024, 1),
      read(MAYA_DOCS.progressNov, 1),
      read(MAYA_DOCS.serviceLog, 1),
      read(MAYA_DOCS.evaluation, 1),
      read(MAYA_DOCS.progressJan, 1),
      read(MAYA_DOCS.meetingNotice, 1),
      read(MAYA_DOCS.teacherNotes, 1),
    ],
    [
      cite(MAYA_DOCS.iep2025, 1, "Baseline: 62 words correct per minute."),
      cite(MAYA_DOCS.iep2025, 1, "Maya will read 90 words correct per minute by March 2026."),
      cite(MAYA_DOCS.iep2025, 1, "Meeting date: March 4, 2025."),
      cite(MAYA_DOCS.progressNov, 1, "Goal 1 reading fluency: 74 words correct per minute."),
      cite(MAYA_DOCS.serviceLog, 1, "Speech therapy minutes delivered September to November 2025: 360 minutes."),
      cite(MAYA_DOCS.serviceLog, 1, "Minutes required by IEP: 480 minutes."),
      cite(MAYA_DOCS.evaluation, 1, "The evaluator did not report a reading comprehension score."),
      cite(MAYA_DOCS.iep2024, 1, "Goal 1: Maya will read 60 words correct per minute."),
      cite(MAYA_DOCS.progressJan, 1, "Goal 1 data not yet collected."),
      cite(MAYA_DOCS.meetingNotice, 1, "The annual review meeting is scheduled for March 3, 2026."),
      cite(MAYA_DOCS.teacherNotes, 1, "Maya participates in small-group reading four days a week."),
    ],
    [
      fact("P1", "The baseline was 62 words correct per minute.", ["E1"]),
      fact("P1", "The goal is 90 words correct per minute by March 2026.", ["E2", "E3"]),
      fact("P1", "In November 2025 Maya read 74 words correct per minute.", ["E4"]),
      call("record_calculation", {
        questionId: "P1",
        description: "Gain since the baseline",
        inputs: [input("Current", "74 words correct per minute", ["E4"]), input("Baseline", "62 words correct per minute", ["E1"])],
        formula: { op: "-", args: [{ input: 0 }, { input: 1 }] },
      }),
      call("record_calculation", {
        questionId: "P1",
        description: "Remaining gap to the goal",
        inputs: [input("Goal", "90 words correct per minute", ["E2"]), input("Current", "74 words correct per minute", ["E4"])],
        formula: { op: "-", args: [{ input: 0 }, { input: 1 }] },
      }),
      call("record_assessment", {
        questionId: "P1",
        judgment: "Maya is improving but has not yet reached the goal.",
        criterion: "Compare the latest measurement with the baseline and the goal.",
        criterionSource: "GENERAL_KNOWLEDGE",
        criterionEvidenceIds: [],
        factIds: ["F1", "F2", "F3"],
        reasoning: "The latest value is above the baseline and below the goal.",
        strength: "MODERATE",
        wouldChangeIf: ["A later progress report shows a different value."],
      }),
      call("record_professional_determination", {
        questionId: "P1",
        determination: "Whether progress is sufficient",
        bearingFactIds: ["F1", "F3"],
        decidedBy: "The IEP team",
      }),
      call("flag_conflict", {
        questionId: "P1",
        evidenceIds: ["E8", "E2"],
        description: "The 2024 plan sets a reading goal of 60 words correct per minute; the 2025 plan sets 90.",
      }),
      fact("P2", "360 speech minutes were delivered.", ["E5"]),
      fact("P2", "480 minutes are required.", ["E6"]),
      call("record_calculation", {
        questionId: "P2",
        description: "Share of required minutes delivered",
        inputs: [input("Delivered", "360 minutes", ["E5"]), input("Required", "480 minutes", ["E6"])],
        formula: { op: "*", args: [{ op: "/", args: [{ input: 0 }, { input: 1 }] }, { value: "100" }] },
      }),
      fact("P3", "The evaluation did not report a comprehension score.", ["E7"]),
    ],
    [
      ...mayaDocumentRecords().map((document) => call("record_document", document)),
      ...mayaCoreDocumentFindings().map((args) => call("record_document_finding", args)),
    ],
    [
      call("finish_question", {
        questionId: "P1",
        status: "PARTIALLY_ANSWERED",
        answer: "Reading fluency rose from 62 to 74 words correct per minute against a goal of 90.",
        evidenceIds: ["E1", "E4"],
        uncertainties: ["Only one progress measurement after the baseline was available."],
        limitations: ["No progress measurement after November 2025 was available."],
        evidenceNeeds: [
          { need: "Reading fluency baseline and annual goal", status: "FOUND", findingIds: ["DF1", "DF2"] },
          { need: "Latest reading fluency measurement", status: "FOUND", findingIds: ["DF4"] },
          {
            need: "Reading fluency measurement after November 2025",
            status: "NOT_FOUND",
            explanation: "No later measurement appears in the authorized pages examined.",
          },
        ],
      }),
      call("finish_question", {
        questionId: "P2",
        status: "ANSWERED",
        answer: "The log shows 360 of 480 required speech minutes were delivered.",
        evidenceIds: ["E5", "E6"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [{ need: "Delivered and required speech therapy minutes", status: "FOUND", findingIds: ["DF5", "DF6"] }],
      }),
      call("finish_question", {
        questionId: "P3",
        status: "MISSING_EVIDENCE",
        answer: "No reading comprehension score was reported.",
        evidenceIds: ["E7"],
        uncertainties: [],
        limitations: ["Comprehension cannot be assessed from these records."],
        evidenceNeeds: [
          {
            need: "Reading comprehension score",
            status: "NOT_FOUND",
            explanation: "The evaluation states that no comprehension score was reported; none appears in the pages examined.",
          },
        ],
      }),
      call("finish_study", {
        coverageNotes: [],
        documentReconciliations: [
          ...mayaCoreReconciliations(),
          {
            documentId: MAYA_DOCS.progressJan,
            disposition: "NO_MATERIAL_FINDINGS",
            reason: "Reports only that Goal 1 data was not yet collected; no measurement bears on these questions.",
          },
          {
            documentId: MAYA_DOCS.meetingNotice,
            disposition: "NO_MATERIAL_FINDINGS",
            reason: "Schedules the annual review; it bears on none of these three questions.",
          },
          {
            documentId: MAYA_DOCS.teacherNotes,
            disposition: "NO_MATERIAL_FINDINGS",
            reason: "Describes classroom reading support, which none of these three questions asks about.",
          },
        ],
      }),
    ],
  ];
}

/** Document findings DF1–DF7 shared by both Maya scripts (E1–E8). */
function mayaCoreDocumentFindings(): Record<string, unknown>[] {
  const finding = (documentId: string, category: string, subject: string, attribute: string, valueAsWritten: string, statement: string, evidenceIds: string[], modality = "STATED") => ({
    documentId,
    category,
    subject,
    attribute,
    valueAsWritten,
    statement,
    modality,
    evidenceIds,
  });
  return [
    finding(MAYA_DOCS.iep2025, "annual_goal", "Goal 1", "baseline", "62 words correct per minute", "The Goal 1 baseline is 62 words correct per minute.", ["E1"], "MEASURED"),
    finding(MAYA_DOCS.iep2025, "annual_goal", "Goal 1", "target", "90 words correct per minute by March 2026", "Maya will read 90 words correct per minute by March 2026.", ["E2"], "PLANNED"),
    finding(MAYA_DOCS.iep2024, "annual_goal", "Goal 1", "target", "60 words correct per minute", "The earlier plan set Goal 1 at 60 words correct per minute.", ["E8"], "HISTORICAL"),
    finding(MAYA_DOCS.progressNov, "progress", "Goal 1", "reading_fluency", "74 words correct per minute", "Goal 1 reading fluency was 74 words correct per minute.", ["E4"], "MEASURED"),
    finding(MAYA_DOCS.serviceLog, "service_delivery", "Speech therapy", "delivered_minutes", "360 minutes", "Speech therapy minutes delivered September to November 2025: 360 minutes.", ["E5"], "MEASURED"),
    finding(MAYA_DOCS.serviceLog, "service_delivery", "Speech therapy", "required_minutes", "480 minutes", "Minutes required by IEP: 480 minutes.", ["E6"]),
    finding(MAYA_DOCS.evaluation, "evaluation", "Reading comprehension", "score", "did not report a reading comprehension score", "The evaluator did not report a reading comprehension score.", ["E7"], "EMPTY_FIELD"),
  ];
}

function mayaCoreReconciliations(): Record<string, unknown>[] {
  return [
    { documentId: MAYA_DOCS.iep2025, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF1", "DF2"] },
    { documentId: MAYA_DOCS.iep2024, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF3"] },
    { documentId: MAYA_DOCS.progressNov, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF4"] },
    { documentId: MAYA_DOCS.serviceLog, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF5", "DF6"] },
    { documentId: MAYA_DOCS.evaluation, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF7"] },
  ];
}

/**
 * Six-question batched Maya investigation (`P1`–`P6`, allowance = 19 rounds) demonstrating the D-044
 * case-wide phase execution pattern:
 * - Turn 1: locate and read relevant pages across all 6 questions in one turn.
 * - Turn 2: batch verified evidence recording (`E1`–`E11`) across the read pages.
 * - Turn 3: batch source-backed facts (`F1`–`F11`, reusing `E1`/`E2`/`E4`/`E5`/`E6` across questions),
 *   calculations (`C1`–`C3`) and conflicts (`K1`).
 * - Turn 4: record all eight documents and document findings `DF1`–`DF10` (V4-004L).
 * - Turn 5: batch assessments (`A1`, `A2`) and professional determinations (`D1`, `D2`) using only
 *   same-question `F…` ids (`P4` and `P6` depend on `P1`/`P2`/`P3` and use their own `F6`–`F11`).
 * - Turn 6: close all 6 questions (`P1`–`P6`, respecting `dependsOn`) with evidence needs and call
 *   `finish_study` with one disposition per document.
 */
export function mayaSixQuestionStudyAgentTurns(): ScriptedCall[][] {
  let n = 0;
  const call = (name: string, args: Record<string, unknown>): ScriptedCall => ({
    id: `toolu_maya6_${(n += 1)}`,
    name,
    arguments: JSON.stringify(args),
  });
  const read = (doc: string, from: number, to = from) => call("read_pages", { documentId: doc, fromPage: from, toPage: to });
  const cite = (doc: string, page: number, quote: string) => call("record_evidence", { documentId: doc, pageNumber: page, quote });
  const fact = (questionId: string, statement: string, evidenceIds: string[]) => call("record_fact", { questionId, statement, evidenceIds });
  const input = (label: string, valueAsWritten: string, evidenceIds: string[]) => ({ label, valueAsWritten, evidenceIds });
  return [
    [
      call("search_case", { query: "words correct per minute" }),
      read(MAYA_DOCS.iep2025, 1, 2),
      read(MAYA_DOCS.iep2024, 1),
      read(MAYA_DOCS.progressNov, 1),
      read(MAYA_DOCS.serviceLog, 1),
      read(MAYA_DOCS.evaluation, 1),
      read(MAYA_DOCS.progressJan, 1),
      read(MAYA_DOCS.meetingNotice, 1),
      read(MAYA_DOCS.teacherNotes, 1),
    ],
    [
      cite(MAYA_DOCS.iep2025, 1, "Baseline: 62 words correct per minute."),
      cite(MAYA_DOCS.iep2025, 1, "Maya will read 90 words correct per minute by March 2026."),
      cite(MAYA_DOCS.iep2025, 1, "Meeting date: March 4, 2025."),
      cite(MAYA_DOCS.progressNov, 1, "Goal 1 reading fluency: 74 words correct per minute."),
      cite(MAYA_DOCS.serviceLog, 1, "Speech therapy minutes delivered September to November 2025: 360 minutes."),
      cite(MAYA_DOCS.serviceLog, 1, "Minutes required by IEP: 480 minutes."),
      cite(MAYA_DOCS.evaluation, 1, "The evaluator did not report a reading comprehension score."),
      cite(MAYA_DOCS.iep2024, 1, "Goal 1: Maya will read 60 words correct per minute."),
      cite(MAYA_DOCS.progressJan, 1, "Goal 1 data not yet collected."),
      cite(MAYA_DOCS.meetingNotice, 1, "The annual review meeting is scheduled for March 3, 2026."),
      cite(MAYA_DOCS.teacherNotes, 1, "Maya participates in small-group reading four days a week."),
    ],
    [
      // P1: Reading fluency baseline, target, November progress, calculations and 2024 vs 2025 conflict
      fact("P1", "The baseline was 62 words correct per minute.", ["E1"]),
      fact("P1", "The goal is 90 words correct per minute by March 2026.", ["E2", "E3"]),
      fact("P1", "In November 2025 Maya read 74 words correct per minute.", ["E4"]),
      call("record_calculation", {
        questionId: "P1",
        description: "Gain since the baseline",
        inputs: [input("Current", "74 words correct per minute", ["E4"]), input("Baseline", "62 words correct per minute", ["E1"])],
        formula: { op: "-", args: [{ input: 0 }, { input: 1 }] },
      }),
      call("record_calculation", {
        questionId: "P1",
        description: "Remaining gap to the goal",
        inputs: [input("Goal", "90 words correct per minute", ["E2"]), input("Current", "74 words correct per minute", ["E4"])],
        formula: { op: "-", args: [{ input: 0 }, { input: 1 }] },
      }),
      call("flag_conflict", {
        questionId: "P1",
        evidenceIds: ["E8", "E2"],
        description: "The 2024 plan sets a reading goal of 60 words correct per minute; the 2025 plan sets 90.",
      }),
      // P2: Speech service delivery
      fact("P2", "360 speech minutes were delivered.", ["E5"]),
      fact("P2", "480 minutes are required.", ["E6"]),
      call("record_calculation", {
        questionId: "P2",
        description: "Share of required minutes delivered",
        inputs: [input("Delivered", "360 minutes", ["E5"]), input("Required", "480 minutes", ["E6"])],
        formula: { op: "*", args: [{ op: "/", args: [{ input: 0 }, { input: 1 }] }, { value: "100" }] },
      }),
      // P3: Comprehension score gap (missing evidence)
      fact("P3", "The evaluation did not report a comprehension score.", ["E7"]),
      // P4 (depends on P1): Overall reading progress evaluation reusing E1, E2, E4 + E9 (Jan 2026)
      fact("P4", "Reading fluency rose from 62 to 74 words correct per minute against the 90-word target.", ["E1", "E2", "E4"]),
      fact("P4", "January 2026 Goal 1 progress data was not yet collected.", ["E9"]),
      // P5: Classroom support and annual review schedule
      fact("P5", "The annual review meeting is scheduled for March 3, 2026.", ["E10"]),
      fact("P5", "Maya participates in small-group reading four days a week.", ["E11"]),
      // P6 (depends on P2, P3, P4): Meeting preparation synthesis reusing E5, E6, E7, E9, E10
      fact("P6", "120 required speech therapy minutes remain undelivered before the March 3, 2026 review.", ["E5", "E6", "E10"]),
      fact("P6", "Neither a reading comprehension score nor January 2026 fluency data is in the record.", ["E7", "E9"]),
    ],
    [
      ...mayaDocumentRecords().map((document) => call("record_document", document)),
      ...mayaCoreDocumentFindings().map((args) => call("record_document_finding", args)),
      call("record_document_finding", {
        documentId: MAYA_DOCS.progressJan,
        category: "progress",
        subject: "Goal 1",
        attribute: "reading_fluency",
        valueAsWritten: "data not yet collected",
        statement: "Goal 1 data not yet collected.",
        modality: "EMPTY_FIELD",
        evidenceIds: ["E9"],
      }), // DF8
      call("record_document_finding", {
        documentId: MAYA_DOCS.meetingNotice,
        category: "schedule",
        subject: "Annual review meeting",
        attribute: "scheduled_date",
        valueAsWritten: "March 3, 2026",
        statement: "The annual review meeting is scheduled for March 3, 2026.",
        modality: "PLANNED",
        evidenceIds: ["E10"],
      }), // DF9
      call("record_document_finding", {
        documentId: MAYA_DOCS.teacherNotes,
        category: "classroom_support",
        subject: "Small-group reading",
        attribute: "frequency",
        valueAsWritten: "four days a week",
        statement: "Maya participates in small-group reading four days a week.",
        modality: "REPORTED",
        evidenceIds: ["E11"],
      }), // DF10
    ],
    [
      call("record_assessment", {
        questionId: "P1",
        judgment: "Maya is improving but has not yet reached the goal.",
        criterion: "Compare the latest measurement with the baseline and the goal.",
        criterionSource: "GENERAL_KNOWLEDGE",
        criterionEvidenceIds: [],
        factIds: ["F1", "F2", "F3"],
        reasoning: "The latest value is above the baseline and below the goal.",
        strength: "MODERATE",
        wouldChangeIf: ["A later progress report shows a different value."],
      }),
      call("record_professional_determination", {
        questionId: "P1",
        determination: "Whether progress is sufficient",
        bearingFactIds: ["F1", "F3"],
        decidedBy: "The IEP team",
      }),
      call("record_assessment", {
        questionId: "P4",
        judgment: "Reading fluency shows positive trajectory through November 2025, but current status before the March 2026 meeting is unconfirmed.",
        criterion: "Compare documented measurements against the annual target and required reporting periods.",
        criterionSource: "GENERAL_KNOWLEDGE",
        criterionEvidenceIds: [],
        factIds: ["F7", "F8"],
        reasoning: "Fluency gained 12 words per minute by November 2025, but the January 2026 report collected no data.",
        strength: "MODERATE",
        wouldChangeIf: ["January or February 2026 fluency measurements are provided."],
      }),
      call("record_professional_determination", {
        questionId: "P6",
        determination: "Whether compensatory speech services are warranted for the 120-minute shortfall",
        bearingFactIds: ["F11"],
        decidedBy: "The IEP team",
      }),
    ],
    [
      call("finish_question", {
        questionId: "P1",
        status: "PARTIALLY_ANSWERED",
        answer: "Reading fluency rose from 62 to 74 words correct per minute against a goal of 90.",
        evidenceIds: ["E1", "E4"],
        uncertainties: ["Only one progress measurement after the baseline was available."],
        limitations: ["No progress measurement after November 2025 was available."],
        evidenceNeeds: [
          { need: "Reading fluency baseline, goal and latest measurement", status: "FOUND", findingIds: ["DF1", "DF2", "DF4"] },
          {
            need: "Reading fluency measurement after November 2025",
            status: "NOT_FOUND",
            explanation: "The January 2026 report says the data was not yet collected; no later value appears in the pages examined.",
          },
        ],
      }),
      call("finish_question", {
        questionId: "P2",
        status: "ANSWERED",
        answer: "The log shows 360 of 480 required speech minutes were delivered.",
        evidenceIds: ["E5", "E6"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [{ need: "Delivered and required speech therapy minutes", status: "FOUND", findingIds: ["DF5", "DF6"] }],
      }),
      call("finish_question", {
        questionId: "P3",
        status: "MISSING_EVIDENCE",
        answer: "No reading comprehension score was reported.",
        evidenceIds: ["E7"],
        uncertainties: [],
        limitations: ["Comprehension cannot be assessed from these records."],
        evidenceNeeds: [
          {
            need: "Reading comprehension score",
            status: "NOT_FOUND",
            explanation: "The evaluation states that no comprehension score was reported; none appears in the pages examined.",
          },
        ],
      }),
      call("finish_question", {
        questionId: "P4",
        status: "PARTIALLY_ANSWERED",
        answer: "Fluency improved from 62 to 74 words per minute by November 2025, but January 2026 data was not collected.",
        evidenceIds: ["E1", "E4", "E9"],
        uncertainties: ["January 2026 progress data was not collected."],
        limitations: ["No post-November 2025 reading measurement is in the case records."],
        evidenceNeeds: [
          { need: "Fluency trajectory from baseline to the latest measurement", status: "FOUND", findingIds: ["DF1", "DF4"] },
          {
            need: "January 2026 fluency measurement",
            status: "UNCERTAIN",
            findingIds: ["DF8"],
            explanation: "The January 2026 report exists but records that the data was not yet collected.",
          },
        ],
      }),
      call("finish_question", {
        questionId: "P5",
        status: "ANSWERED",
        answer: "Small-group reading occurs four days a week and the annual review meeting is set for March 3, 2026.",
        evidenceIds: ["E10", "E11"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [
          { need: "Classroom reading support", status: "FOUND", findingIds: ["DF10"] },
          { need: "Annual review meeting date", status: "FOUND", findingIds: ["DF9"] },
        ],
      }),
      call("finish_question", {
        questionId: "P6",
        status: "PARTIALLY_ANSWERED",
        answer: "For the March 3, 2026 meeting, the records show a 120-minute speech shortfall and missing comprehension and January 2026 fluency data.",
        evidenceIds: ["E5", "E6", "E7", "E9", "E10"],
        uncertainties: [],
        limitations: ["The records do not state why 120 speech minutes were missed or provide January 2026 fluency data."],
        evidenceNeeds: [
          { need: "Speech minutes delivered against required minutes", status: "FOUND", findingIds: ["DF5", "DF6"] },
          {
            need: "Reason the speech minutes were not delivered",
            status: "NOT_FOUND",
            explanation: "No page examined explains the shortfall.",
          },
        ],
      }),
      call("finish_study", {
        coverageNotes: [],
        documentReconciliations: [
          ...mayaCoreReconciliations(),
          { documentId: MAYA_DOCS.progressJan, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF8"] },
          { documentId: MAYA_DOCS.meetingNotice, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF9"] },
          { documentId: MAYA_DOCS.teacherNotes, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF10"] },
        ],
      }),
    ],
  ];
}

export function mayaWriterOutput(audience: "CUSTOMER" | "PRO" = "CUSTOMER") {
  return {
    schema: "hive.writer-report/1",
    audience,
    title: audience === "CUSTOMER" ? "Maya's reading and services" : "IEP progress and service delivery review",
    summary: [
      {
        type: "DOCUMENTED",
        text: "Maya's reading went from 62 to 74 words correct per minute, a gain of {{calc:P1.C0}} words.",
        claimRefs: ["P1.F0", "P1.F2", "P1.C0"],
      },
    ],
    sections: [
      {
        id: "s1",
        heading: "Reading progress",
        blocks: [
          { type: "DOCUMENTED", text: "The goal is 90 words correct per minute by March 2026.", claimRefs: ["P1.F1"] },
          { type: "INTERPRETATION", text: "Maya is improving but has not reached the goal yet.", claimRefs: ["P1.A0"] },
          {
            type: "UNCERTAINTY",
            text: "Only one progress measurement was available, and the remaining gap could not be confirmed.",
            claimRefs: ["P1.U0", "P1.C1"],
          },
        ],
      },
      {
        id: "s2",
        heading: "Speech services",
        blocks: [
          {
            type: "DOCUMENTED",
            text: "Maya received 360 of 480 required speech minutes ({{calc:P2.C0}}%).",
            claimRefs: ["P2.F0", "P2.F1", "P2.C0"],
          },
        ],
      },
      {
        id: "s3",
        heading: "What is missing",
        blocks: [
          { type: "UNCERTAINTY", text: "The evaluation did not include a reading comprehension score.", claimRefs: ["P3"] },
          { type: "QUESTION", text: "Can the team share a reading comprehension score?", claimRefs: ["P3"] },
          { type: "GENERAL_INFORMATION", text: "Parents can ask for a copy of progress data before the meeting.", claimRefs: [] },
        ],
      },
    ],
    scenarios: [
      {
        id: "S1",
        title: "Catching up on speech minutes",
        question: "How many extra minutes a week would close the gap?",
        rationale: "The log shows fewer minutes than required.",
        claimRefs: ["P2.F0", "P2.F1"],
        parameters: [
          { name: "required", label: "Required minutes", value: "480", unit: "minutes", basis: "DOCUMENTED", claimRef: "P2.F1" },
          { name: "delivered", label: "Delivered minutes", value: "360", unit: "minutes", basis: "DOCUMENTED", claimRef: "P2.F0" },
          { name: "weeks", label: "Weeks left", value: "8", unit: "weeks", basis: "ASSUMPTION", claimRef: null },
        ],
        results: [
          { id: "R1", label: "Minutes short", unit: "minutes", formula: { op: "-", args: [{ param: "required" }, { param: "delivered" }] } },
          { id: "R2", label: "Extra minutes per week", unit: "minutes", formula: { op: "/", args: [{ ref: "R1" }, { param: "weeks" }] } },
        ],
      },
    ],
    view: [
      { component: "Narrative", props: { sectionId: "summary" } },
      { component: "Metric", props: { label: "Reading gain", binding: "{{calc:P1.C0}}", unit: "words per minute" } },
      { component: "Narrative", props: { sectionId: "s1" } },
      {
        component: "Timeline",
        props: {
          title: "Key dates",
          events: [{ date: "March 4, 2025", text: "Reading goal of 90 words correct per minute set", claimRefs: ["P1.F1"] }],
        },
      },
      { component: "Narrative", props: { sectionId: "s2" } },
      { component: "ScenarioExplorer", props: { scenarioId: "S1" } },
      { component: "Narrative", props: { sectionId: "s3" } },
      { component: "KeyFindings", props: { title: "Key findings", claimIds: ["P1.F2", "P2.C0"] } },
    ],
  };
}

/**
 * Compact presentation plan (`hive.writer-presentation-plan/1`) for Maya's Customer or Pro report (D-047, V4-004G).
 * Customer and Pro plans reference the same verified Canonical Study claims while differentiating
 * audienceObjective, priorityFindings, section organization/purpose, and A2UI component selection.
 */
export function mayaWriterPresentationPlan(audience: "CUSTOMER" | "PRO" = "CUSTOMER") {
  if (audience === "PRO") {
    return {
      audienceObjective:
        "Audit source-backed baselines, service delivery shortfalls, assessment criteria, and evidentiary gaps to advise on compensatory services and IEP team determinations.",
      summaryDetailLevel: "COMPREHENSIVE" as const,
      priorityFindings: [
        { claimId: "P2.C0", priority: "HIGH" as const },
        { claimId: "P3", priority: "HIGH" as const },
        { claimId: "P1.A0", priority: "HIGH" as const },
        { claimId: "P1.D0", priority: "HIGH" as const },
        { claimId: "P1.U0", priority: "MEDIUM" as const },
      ],
      sections: [
        {
          id: "s1",
          heading: "Service delivery compliance and shortfall analysis",
          priority: "HIGH" as const,
          goalIds: ["G1", "G2"],
          specialistQuestionIds: ["I2"],
          purpose: "Verify delivered vs mandated speech therapy minutes from the service log before the review.",
          claimIds: ["P2.F0", "P2.F1", "P2.C0"],
        },
        {
          id: "s2",
          heading: "Fluency trajectory, assessment criteria, and open determinations",
          priority: "HIGH" as const,
          goalIds: ["G3", "G1"],
          specialistQuestionIds: ["I1"],
          purpose: "Audit baseline and November progress against the declared criterion and reserved IEP team decision.",
          claimIds: ["P1.F0", "P1.F1", "P1.F2", "P1.C0", "P1.A0", "P1.D0"],
        },
        {
          id: "s3",
          heading: "Evidentiary gaps and unassessed areas",
          priority: "HIGH" as const,
          goalIds: ["G2", "G3"],
          specialistQuestionIds: ["I3"],
          purpose: "Document missing comprehension evaluation data and single-point measurement limitations.",
          claimIds: ["P1.U0", "P1.C1", "P3"],
        },
      ],
      components: [
        {
          component: "Narrative" as const,
          sectionId: "summary",
          claimIds: ["P1.F0", "P1.F2", "P1.C0"],
          purpose: "Synthesize case posture and verified calculations for specialist review.",
        },
        {
          component: "Comparison" as const,
          claimIds: ["P2.F0", "P2.F1", "P1.F0", "P1.F2"],
          purpose: "Compare mandated vs delivered speech minutes and baseline vs progress side by side.",
        },
        {
          component: "RecordTable" as const,
          claimIds: ["P1.F0", "P1.F1", "P1.F2", "P2.F0", "P2.F1"],
          purpose: "Provide a source-backed ledger of measurements, targets, and service logs.",
        },
        {
          component: "EvidencePanel" as const,
          claimIds: ["P1.A0", "P1.D0", "P2.C0"],
          purpose: "Inspect verbatim quotes, general-knowledge assessment criteria, and reserved determinations.",
        },
        {
          component: "IssueList" as const,
          claimIds: ["P1.U0", "P3"],
          purpose: "Track evidentiary gaps and unconfirmed measurements by severity.",
        },
        {
          component: "Narrative" as const,
          sectionId: "s1",
          claimIds: ["P2.F0", "P2.F1", "P2.C0"],
          purpose: "Detail service delivery compliance findings.",
        },
        {
          component: "Narrative" as const,
          sectionId: "s2",
          claimIds: ["P1.F1", "P1.A0", "P1.D0"],
          purpose: "Detail reading fluency trajectory and criterion analysis.",
        },
        {
          component: "Narrative" as const,
          sectionId: "s3",
          claimIds: ["P1.U0", "P3"],
          purpose: "Detail open evidentiary gaps for the IEP team.",
        },
      ],
    };
  }
  return {
    audienceObjective:
      "Understand what Maya's IEP says, see whether she is progressing toward her reading goal, and prepare concrete questions and catch-up options for the IEP meeting.",
    summaryDetailLevel: "BALANCED" as const,
    priorityFindings: [
      { claimId: "P1.C0", priority: "HIGH" as const },
      { claimId: "P2.C0", priority: "HIGH" as const },
      { claimId: "P1.A0", priority: "MEDIUM" as const },
      { claimId: "P3", priority: "HIGH" as const },
    ],
    sections: [
      {
        id: "s1",
        heading: "Reading progress",
        priority: "HIGH" as const,
        goalIds: ["G1", "G3"],
        specialistQuestionIds: ["I1"],
        purpose: "Explain reading baseline, November progress, and remaining uncertainty in plain words.",
        claimIds: ["P1.F1", "P1.A0", "P1.U0", "P1.C1"],
      },
      {
        id: "s2",
        heading: "Speech services",
        priority: "HIGH" as const,
        goalIds: ["G1", "G2"],
        specialistQuestionIds: ["I2"],
        purpose: "Show delivered vs required speech minutes and what-if catch-up options for the meeting.",
        claimIds: ["P2.F0", "P2.F1", "P2.C0"],
      },
      {
        id: "s3",
        heading: "What is missing",
        priority: "MEDIUM" as const,
        goalIds: ["G2", "G3"],
        specialistQuestionIds: ["I3"],
        purpose: "Highlight missing comprehension data and practical questions to ask the IEP team.",
        claimIds: ["P3"],
      },
    ],
    components: [
      {
        component: "Narrative" as const,
        sectionId: "summary",
        claimIds: ["P1.F0", "P1.F2", "P1.C0"],
        purpose: "Give a calm, plain-language overview of Maya's reading gain.",
      },
      {
        component: "Metric" as const,
        claimIds: ["P1.C0"],
        purpose: "Highlight the verified 12-word reading gain at a glance.",
      },
      {
        component: "Narrative" as const,
        sectionId: "s1",
        claimIds: ["P1.F1", "P1.A0", "P1.U0"],
        purpose: "Walk through reading fluency progress and what remains uncertain.",
      },
      {
        component: "Timeline" as const,
        claimIds: ["P1.F1"],
        purpose: "Show key IEP dates in chronological order.",
      },
      {
        component: "Narrative" as const,
        sectionId: "s2",
        claimIds: ["P2.F0", "P2.F1", "P2.C0"],
        purpose: "Explain the speech therapy minutes delivered vs required.",
      },
      {
        component: "ScenarioExplorer" as const,
        scenarioId: "S1",
        claimIds: ["P2.F0", "P2.F1"],
        purpose: "Let the parent explore how many weekly speech minutes would close the 120-minute gap.",
      },
      {
        component: "Narrative" as const,
        sectionId: "s3",
        claimIds: ["P3"],
        purpose: "Explain what evaluation data is missing and what to ask at the meeting.",
      },
      {
        component: "KeyFindings" as const,
        claimIds: ["P1.F2", "P2.C0"],
        purpose: "Summarize the most important verified takeaways for the parent.",
      },
    ],
  };
}

/**
 * Validated Study preparation context fixtures for Maya (V4-004G): intent decomposition,
 * domain proposal, specialist questions (`whyItMatters`, `supportsOutcome`), and investigation plan.
 */
export function mayaStudyContextArtifacts() {
  return {
    intentDecomposition: {
      schema: "hive.intent-analysis/1" as const,
      processingRunId: MAYA_RUN_ID,
      intents: [{ intentRequestId: MAYA_INTENT_ID, verbatimText: MAYA_INTENT_TEXT, audience: "Maya's parent" }],
      subjects: [{ name: "Maya", statedAs: "Maya's IEP", intentRequestId: MAYA_INTENT_ID }],
      goals: [
        {
          goalId: "G1",
          intentRequestId: MAYA_INTENT_ID,
          statedAs: "understand Maya's IEP",
          goal: "Understand what Maya's IEP says and means",
          questions: [
            {
              questionId: "Q1",
              question: "What does Maya's IEP say about her goals and services?",
              answerForm: "EXPLANATION" as const,
              needsJudgment: false,
              dependsOn: [],
            },
          ],
          unclear: [],
        },
        {
          goalId: "G2",
          intentRequestId: MAYA_INTENT_ID,
          statedAs: "Prep for the IEP meeting",
          goal: "Prepare for the IEP meeting",
          questions: [
            {
              questionId: "Q2",
              question: "How can the parent prepare for the IEP meeting?",
              answerForm: "PREPARATION" as const,
              needsJudgment: false,
              dependsOn: ["Q1"],
            },
          ],
          unclear: [
            {
              unclearId: "U1",
              about: "the IEP meeting",
              possibleMeanings: ["annual review", "amendment meeting"],
              likelyReading: "annual review",
              likelyReadingBasis: "GLOSSARY" as const,
              askThePerson: "Which IEP meeting are you preparing for, and what are your top priorities?",
              blocksAnswer: false,
            },
          ],
        },
        {
          goalId: "G3",
          intentRequestId: MAYA_INTENT_ID,
          statedAs: "want to know if Maya is progressing",
          goal: "Determine whether Maya is progressing",
          questions: [
            {
              questionId: "Q3",
              question: "Is Maya progressing toward her reading goal?",
              answerForm: "YES_NO_WITH_REASONS" as const,
              needsJudgment: true,
              dependsOn: ["Q1"],
            },
          ],
          unclear: [],
        },
      ],
      reservedDecisions: [
        {
          questionId: "Q3",
          decision: "Whether Maya's progress is sufficient or requires IEP revision",
          decidedBy: "The IEP team",
        },
      ],
      instructionsIgnored: [],
    },
    domainProposal: {
      schema: "hive.domain-proposal/1" as const,
      primary: {
        label: "Special education",
        subdomain: "Individualized Education Program (IEP) & progress monitoring",
        confidence: "HIGH" as const,
        reasoning: "The records include dated IEPs, progress monitoring probes, a speech service log, and an evaluation.",
        supportingRefs: [{ sourceDocumentId: MAYA_DOCS.iep2025, pageNumber: 1 }],
      },
      alternatives: [],
      unknownDomain: false,
      mixedDomain: false,
      ambiguous: false,
      ambiguityNotes: [],
      confidenceIsAdvisory: true as const,
    },
    intentIntelligence: {
      schema: "hive.intent-intelligence/1" as const,
      questions: [
        {
          id: "I1",
          goalId: "G3",
          analysisQuestionIds: ["Q1", "Q3"],
          question: "How does Maya's November 2025 reading fluency measurement compare with her March 2025 baseline and March 2026 annual target?",
          whyItMatters: "Comparing the baseline, interim probe, and annual target shows whether fluency is moving in the right direction before the annual review.",
          supportsOutcome: "Deciding what progress data and instructional adjustments to discuss at the IEP meeting.",
          dependsOn: [],
          requiresJudgment: true,
          judgmentBasis: "Compare the latest measurement with the baseline and the goal.",
          contextRefs: [{ sourceDocumentId: MAYA_DOCS.iep2025, pageNumber: 1 }],
        },
        {
          id: "I2",
          goalId: "G1",
          analysisQuestionIds: ["Q1", "Q2"],
          question: "Were the speech-language therapy minutes required by the IEP actually delivered during the reporting period?",
          whyItMatters: "A shortfall between mandated and delivered service minutes directly affects whether the plan was implemented as written.",
          supportsOutcome: "Preparing concrete questions about missed service minutes and make-up options at the meeting.",
          dependsOn: [],
          requiresJudgment: false,
          judgmentBasis: null,
          contextRefs: [{ sourceDocumentId: MAYA_DOCS.serviceLog, pageNumber: 1 }],
        },
        {
          id: "I3",
          goalId: "G2",
          analysisQuestionIds: ["Q2", "Q3"],
          question: "Does the psychoeducational evaluation report a reading comprehension score alongside fluency?",
          whyItMatters: "Fluency alone does not show whether Maya understands what she reads, and missing evaluation scores need to be requested.",
          supportsOutcome: "Identifying missing evaluation metrics to request before or during the IEP meeting.",
          dependsOn: ["I1"],
          requiresJudgment: false,
          judgmentBasis: null,
          contextRefs: [{ sourceDocumentId: MAYA_DOCS.evaluation, pageNumber: 1 }],
        },
      ],
      completenessReview: [
        {
          goalId: "G1",
          wouldFulfilIntent: true as const,
          gapsFound: ["Service log implementation needed alongside plan text."],
          revisions: ["Added I2 on speech service delivery."],
          remainingLimits: ["Classroom work samples outside the uploaded records are not available."],
        },
        {
          goalId: "G2",
          wouldFulfilIntent: true as const,
          gapsFound: ["Missing comprehension score affects meeting questions."],
          revisions: ["Added I3 on comprehension evaluation coverage."],
          remainingLimits: ["Only the IEP team can decide compensatory service terms."],
        },
        {
          goalId: "G3",
          wouldFulfilIntent: true as const,
          gapsFound: [],
          revisions: [],
          remainingLimits: ["Only one interim fluency measurement after the baseline is in the record."],
        },
      ],
    },
    investigationPlan: {
      schema: "hive.investigation-plan/1" as const,
      domainBasis: {
        primaryDomain: "Special education",
        uncertain: false,
        considerations: [
          {
            text: "Compare baseline measurements, interim progress probes, and annual goal targets alongside mandated vs delivered service logs.",
            supportingRefs: [{ sourceDocumentId: MAYA_DOCS.iep2025, pageNumber: 1 }],
          },
        ],
      },
      questions: [
        {
          id: "P1",
          goalId: "G3",
          specialistQuestionIds: ["I1"],
          establish: "Maya's reading fluency baseline, annual target, and November 2025 progress measurement.",
          requiredEvidence: ["2025 IEP reading goal and baseline", "November 2025 progress report"],
          sourceDependencies: ["Maya IEP 2025.pdf", "Progress report Nov 2025.pdf"],
          comparison: "Compare the 62 wcpm baseline and 74 wcpm November measurement against the 90 wcpm target.",
          chronology: "Order baseline, interim measurement, and target dates chronologically.",
          calculation: "Compute the gain from baseline and remaining gap to the goal.",
          evaluation: "Apply: Compare the latest measurement with the baseline and the goal.",
          missingEvidenceConditions: ["No post-November 2025 progress measurement is present"],
          answerType: "COMPARISON" as const,
          deliverable: "A sourced comparison and chronology of reading fluency baseline, interim progress, and target",
          dependsOn: [],
          domainConsiderationRefs: [{ sourceDocumentId: MAYA_DOCS.iep2025, pageNumber: 1 }],
        },
        {
          id: "P2",
          goalId: "G1",
          specialistQuestionIds: ["I2"],
          establish: "Delivered vs required speech-language therapy minutes from the service log.",
          requiredEvidence: ["Speech service log delivered and required minutes"],
          sourceDependencies: ["Speech service log.xlsx"],
          comparison: "Compare delivered speech minutes against IEP required minutes.",
          chronology: null,
          calculation: "Compute percentage of required speech minutes delivered.",
          evaluation: null,
          missingEvidenceConditions: ["No service log or minute totals in the record"],
          answerType: "CALCULATION" as const,
          deliverable: "A sourced numeric result comparing delivered and required speech therapy minutes",
          dependsOn: [],
          domainConsiderationRefs: [],
        },
        {
          id: "P3",
          goalId: "G2",
          specialistQuestionIds: ["I3"],
          establish: "Whether the psychoeducational evaluation reports a reading comprehension score.",
          requiredEvidence: ["Psychoeducational evaluation reading comprehension section"],
          sourceDependencies: ["Psychoeducational evaluation.pdf"],
          comparison: null,
          chronology: null,
          calculation: null,
          evaluation: null,
          missingEvidenceConditions: ["The evaluation does not report a reading comprehension score"],
          answerType: "FACT" as const,
          deliverable: "A sourced finding on whether a reading comprehension score was reported",
          dependsOn: ["P1"],
          domainConsiderationRefs: [],
        },
      ],
    },
  };
}

import {
  l001CustomerEditorialPlan,
  l001ProEditorialPlan,
  mayaEditorialPlan,
  revision6CustomerEditorialPlan,
} from "../reports/editorial-plan-fixtures";
import type { EditorialPlan } from "../reports/editorial-plan-contracts";

export {
  l001CustomerEditorialPlan,
  l001ProEditorialPlan,
  mayaEditorialPlan,
  revision6CustomerEditorialPlan,
};

/**
 * Single-call editorial Writer submission (V4-004K.3) using `submit_editorial_plan`.
 */
export function mayaWriterEditorialTurns(
  audience: "CUSTOMER" | "PRO" = "CUSTOMER",
  plan: EditorialPlan = mayaEditorialPlan(audience),
): ScriptedCall[][] {
  return [
    [
      {
        id: `toolu_editorial_${audience.toLowerCase()}_1`,
        name: "submit_editorial_plan",
        arguments: JSON.stringify(plan),
      },
    ],
  ];
}

/**
 * Single-call structured Writer composition (D-047) with presentation planning and dynamic A2UI composition.
 */
export function mayaWriterComposeTurns(
  audience: "CUSTOMER" | "PRO" = "CUSTOMER",
  draft: ReturnType<typeof mayaWriterOutput> = mayaWriterOutput(audience),
  presentationPlan = mayaWriterPresentationPlan(audience),
): ScriptedCall[][] {
  return [
    [
      {
        id: `toolu_compose_${audience.toLowerCase()}_1`,
        name: "compose_writer_report",
        arguments: JSON.stringify({
          presentationPlan,
          title: draft.title,
          summary: draft.summary,
          sections: draft.sections,
          scenarios: draft.scenarios,
          view: draft.view,
        }),
      },
    ],
  ];
}

/**
 * Scripted Writer tool-calling sequence (D-045) that builds `draft` (default: `mayaWriterOutput(audience)`)
 * through `WriterAgentLedger` and finishes in one batched turn.
 */
export function mayaWriterAgentTurns(
  audience: "CUSTOMER" | "PRO" = "CUSTOMER",
  draft: ReturnType<typeof mayaWriterOutput> = mayaWriterOutput(audience),
): ScriptedCall[][] {
  let n = 0;
  const call = (name: string, args: Record<string, unknown>): ScriptedCall => ({
    id: `toolu_writer_${audience.toLowerCase()}_${(n += 1)}`,
    name,
    arguments: JSON.stringify(args),
  });
  return [
    [
      call("set_report_outline", { title: draft.title, summary: draft.summary }),
      ...draft.sections.map((section) =>
        call("record_section", { id: section.id, heading: section.heading, blocks: section.blocks }),
      ),
      ...draft.scenarios.map((scenario) => call("record_scenario", scenario)),
      ...draft.view.map((component) =>
        call("record_view_component", { component: component.component, props: component.props }),
      ),
      call("finish_report", {}),
    ],
  ];
}

export const MAYA_REVISION_6_PLAN_QUESTION_IDS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"] as const;

export const MAYA_REVISION_6_PAGES: Record<string, string> = {
  [`${MAYA_DOCS.iep2024}:1`]: [
    "Individualized Education Program for Maya.",
    "Effective period: 2024-11-12 to 2025-11-11.",
    "Baseline: 62 words correct per minute.",
    "Goal 1: Maya will read 60 words correct per minute.",
  ].join("\n"),
  [`${MAYA_DOCS.iep2025}:1`]: [
    "Individualized Education Program Amendment for Maya.",
    "Meeting date: March 4, 2025.",
    "Baseline: 62 words correct per minute.",
    "Goal 1: Maya will read 90 words correct per minute by March 2026.",
  ].join("\n"),
  [`${MAYA_DOCS.progressNov}:1`]: [
    "Progress report, November 14, 2025.",
    "Goal 1 reading fluency: 74 words correct per minute.",
  ].join("\n"),
  [`${MAYA_DOCS.progressJan}:1`]: [
    "Progress report, January 15, 2026.",
    "Goal 1 reading fluency: 74 words correct per minute.",
    "Comprehension probe data was not collected in January 2026.",
  ].join("\n"),
  [`${MAYA_DOCS.serviceLog}:1`]: [
    "Speech therapy minutes delivered September to November 2025: 360 minutes.",
    "Minutes required by IEP: 480 minutes.",
  ].join("\n"),
  [`${MAYA_DOCS.evaluation}:1`]: [
    "Psychoeducational evaluation.",
    "The evaluator did not report a reading comprehension score.",
  ].join("\n"),
  [`${MAYA_DOCS.meetingNotice}:1`]: [
    "Notice of IEP meeting.",
    "The annual review meeting is scheduled for March 3, 2026.",
  ].join("\n"),
};

/**
 * Synthetic 7-question revision-6 Study fixture (`P1`–`P7`) exercising Gate 1 and Gate 2:
 * - Repeated baseline facts across `P1.F0`, `P2.F0`, `P7.F0`
 * - Repeated uncertainties across `P1.U0` and `P6.U0`
 * - Distinct same-text measurements from different dates (`P1.F2` Nov 2025 vs `P5.F0` Jan 2026)
 * - Conflicting annual reading goals (`P1.F3` 60 wcpm vs `P2.F1` 90 wcpm, plus `P1.K0`)
 * - Compound facts flagged `REQUIRES_SEMANTIC_ATOMIZATION` (`P1.F1`, `P4.F0`)
 * - Historical IEP effective period `2024-11-12 to 2025-11-11` (`P1.F4`)
 */
export function mayaRevision6StudyOutput() {
  const baselineEv = quote(MAYA_DOCS.iep2024, 1, "Baseline: 62 words correct per minute.");
  const period2024Ev = quote(MAYA_DOCS.iep2024, 1, "Effective period: 2024-11-12 to 2025-11-11.");
  const goal60Ev = quote(MAYA_DOCS.iep2024, 1, "Goal 1: Maya will read 60 words correct per minute.");
  const goal90Ev = quote(MAYA_DOCS.iep2025, 1, "Goal 1: Maya will read 90 words correct per minute by March 2026.");
  const nov74Ev = quote(
    MAYA_DOCS.progressNov,
    1,
    "Progress report, November 14, 2025. Goal 1 reading fluency: 74 words correct per minute.",
  );
  const jan74Ev = quote(
    MAYA_DOCS.progressJan,
    1,
    "Progress report, January 15, 2026. Goal 1 reading fluency: 74 words correct per minute.",
  );
  const janMissingEv = quote(
    MAYA_DOCS.progressJan,
    1,
    "Comprehension probe data was not collected in January 2026.",
  );
  const deliveredEv = quote(
    MAYA_DOCS.serviceLog,
    1,
    "Speech therapy minutes delivered September to November 2025: 360 minutes.",
  );
  const requiredEv = quote(MAYA_DOCS.serviceLog, 1, "Minutes required by IEP: 480 minutes.");
  const evalMissingEv = quote(
    MAYA_DOCS.evaluation,
    1,
    "The evaluator did not report a reading comprehension score.",
  );
  const meetingEv = quote(
    MAYA_DOCS.meetingNotice,
    1,
    "The annual review meeting is scheduled for March 3, 2026.",
  );

  return {
    schema: "hive.study-investigation/1",
    processingRunId: MAYA_RUN_ID,
    answers: [
      {
        planQuestionId: "P1",
        status: "CONFLICTING",
        answer: "Baseline is 62 wcpm; November fluency is 74 wcpm; 2024 and 2025 plans state different targets.",
        facts: [
          {
            statement: "The baseline was 62 words correct per minute.",
            evidence: [baselineEv],
          },
          {
            statement:
              "Under the 2024-11-12 to 2025-11-11 IEP, reading fluency rose from 62 to 74 words correct per minute against the 90 words correct per minute goal.",
            evidence: [period2024Ev, baselineEv, nov74Ev, goal90Ev],
          },
          {
            statement: "Goal 1 reading fluency was 74 words correct per minute.",
            evidence: [nov74Ev],
          },
          {
            statement: "The annual reading goal is 60 words correct per minute.",
            evidence: [goal60Ev],
          },
          {
            statement: "The IEP effective period is 2024-11-12 to 2025-11-11.",
            evidence: [period2024Ev],
          },
        ],
        calculations: [
          {
            description: "Gain since the baseline",
            inputs: [
              { label: "Current", valueAsWritten: "74 words correct per minute", evidence: [nov74Ev] },
              { label: "Baseline", valueAsWritten: "62 words correct per minute", evidence: [baselineEv] },
            ],
            arithmetic: "74 - 62 = 12",
            result: "12 words correct per minute",
            formula: { op: "-", args: [{ input: 0 }, { input: 1 }] },
          },
        ],
        assessments: [
          {
            judgment: "Maya is improving above baseline toward the annual target.",
            criterion: "Compare interim progress probes against the documented baseline.",
            criterionSource: "GENERAL_KNOWLEDGE" as const,
            criterionEvidence: [],
            factIndexes: [0, 2],
            reasoning: "74 wcpm exceeds the 62 wcpm baseline by 12 wcpm.",
            strength: "MODERATE" as const,
            wouldChangeIf: ["Subsequent probes show regression."],
          },
        ],
        uncertainties: ["Comprehension probe data after November 2025 was not available in the record."],
        professionalDeterminations: [
          {
            determination: "Whether reading fluency progress is sufficient for FAPE",
            bearingFacts: [0, 2],
            decidedBy: "The IEP team",
          },
        ],
        evidence: [baselineEv, nov74Ev],
        conflicts: [
          {
            description: "The 2024 plan sets a reading goal of 60 words correct per minute; the 2025 plan sets 90.",
            evidence: [goal60Ev, goal90Ev],
          },
        ],
        limitations: [],
      },
      {
        planQuestionId: "P2",
        status: "ANSWERED",
        answer: "Baseline was 62 wcpm and the 2025 target is 90 wcpm.",
        facts: [
          {
            statement: "baseline: 62 words correct per minute",
            evidence: [baselineEv],
          },
          {
            statement: "The annual reading goal is 90 words correct per minute.",
            evidence: [goal90Ev],
          },
        ],
        calculations: [],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [baselineEv, goal90Ev],
        conflicts: [],
        limitations: [],
      },
      {
        planQuestionId: "P3",
        status: "ANSWERED",
        answer: "360 of 480 speech minutes were delivered.",
        facts: [
          {
            statement: "360 speech therapy minutes were delivered between September and November 2025.",
            evidence: [deliveredEv],
          },
          {
            statement: "480 speech therapy minutes are required by the IEP.",
            evidence: [requiredEv],
          },
        ],
        calculations: [
          {
            description: "Share of required speech minutes delivered",
            inputs: [
              { label: "Delivered", valueAsWritten: "360 minutes", evidence: [deliveredEv] },
              { label: "Required", valueAsWritten: "480 minutes", evidence: [requiredEv] },
            ],
            arithmetic: "360 / 480 * 100 = 75",
            result: "75%",
            formula: {
              op: "*",
              args: [{ op: "/", args: [{ input: 0 }, { input: 1 }] }, { value: "100" }],
            },
          },
        ],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [deliveredEv, requiredEv],
        conflicts: [],
        limitations: [],
      },
      {
        planQuestionId: "P4",
        status: "PARTIALLY_ANSWERED",
        answer: "Composite review of reading trajectory, speech minutes, and missing comprehension data.",
        facts: [
          {
            statement:
              "Reading fluency rose from 62 to 74 words correct per minute while speech therapy delivered 360 of 480 required minutes, and comprehension probe data was not collected in January 2026.",
            evidence: [baselineEv, nov74Ev, deliveredEv, requiredEv, janMissingEv],
          },
        ],
        calculations: [],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [baselineEv, nov74Ev, deliveredEv, janMissingEv],
        conflicts: [],
        limitations: [],
      },
      {
        planQuestionId: "P5",
        status: "ANSWERED",
        answer: "In January 2026 reading fluency remained 74 words correct per minute.",
        facts: [
          {
            statement: "Goal 1 reading fluency was 74 words correct per minute.",
            evidence: [jan74Ev],
          },
        ],
        calculations: [],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [jan74Ev],
        conflicts: [],
        limitations: [],
      },
      {
        planQuestionId: "P6",
        status: "MISSING_EVIDENCE",
        answer: "Comprehension score and post-November comprehension probes are missing before the March 3, 2026 meeting.",
        facts: [
          {
            statement: "The psychoeducational evaluation did not report a reading comprehension score.",
            evidence: [evalMissingEv],
          },
          {
            statement: "The annual review meeting is scheduled for March 3, 2026.",
            evidence: [meetingEv],
          },
        ],
        calculations: [],
        assessments: [],
        uncertainties: ["Comprehension probe data after November 2025 was not available in the record"],
        professionalDeterminations: [],
        evidence: [evalMissingEv, meetingEv],
        conflicts: [],
        limitations: ["Comprehension progress cannot be determined from the current record."],
      },
      {
        planQuestionId: "P7",
        status: "ANSWERED",
        answer: "Baseline reading fluency was 62 words correct per minute.",
        facts: [
          {
            statement: "Baseline was 62 words correct per minute.",
            evidence: [baselineEv],
          },
        ],
        calculations: [],
        assessments: [],
        uncertainties: [],
        professionalDeterminations: [],
        evidence: [baselineEv],
        conflicts: [],
        limitations: [],
      },
    ],
    coverageNotes: [],
    instructionsIgnored: [],
  };
}

export const MAYA_LIN_VARIANT_IEP_DOC_ID = "5a5a5a5a-0000-4000-8000-0000000000d9";
/** @deprecated Alias for `MAYA_LIN_VARIANT_IEP_DOC_ID` (synthetic Maya Lin 62→90 WCPM variant, not L001 `08_initial_iep.pdf`). */
export const MAYA_INITIAL_IEP_DOC_ID = MAYA_LIN_VARIANT_IEP_DOC_ID;

export const MAYA_LIN_VARIANT_FILE_NAMES: Record<string, string> = {
  ...MAYA_FILE_NAMES,
  [MAYA_LIN_VARIANT_IEP_DOC_ID]: "maya_lin_variant_initial_iep.pdf",
};
/** @deprecated Alias for `MAYA_LIN_VARIANT_FILE_NAMES`. */
export const MAYA_DOCUMENT_CENTERED_FILE_NAMES = MAYA_LIN_VARIANT_FILE_NAMES;

/**
 * Three-page synthetic Maya Lin variant IEP corpus (62→90 WCPM, speech therapy, Oakridge USD)
 * plus supporting progress reports, service log, evaluation, and meeting notice.
 * Distinct synthetic variant — NOT an exact transcription of L001 `08_initial_iep.pdf`.
 */
export const MAYA_LIN_VARIANT_IEP_PAGES: Record<string, string> = {
  [`${MAYA_LIN_VARIANT_IEP_DOC_ID}:1`]: [
    "Oakridge Unified School District — Individualized Education Program (IEP)",
    "Document Type: Initial IEP",
    "IEP Meeting Date: 11/12/2024",
    "IEP Effective Period: 11/12/2024 to 11/11/2025",
    "Student Name: Maya Lin | Date of Birth: 04/18/2016 | Grade: 3",
    "School: Cedar Grove Elementary School | District: Oakridge Unified School District",
    "Eligibility Category: Specific Learning Disability (SLD) | Eligibility Determination Date: 11/05/2024",
    "Present Levels of Academic Achievement and Functional Performance: Maya decodes single-syllable words accurately but reads connected 3rd-grade text at 62 words correct per minute, which is below the 3rd-grade fall benchmark.",
    "Educational Impact: Reduced oral reading fluency slows independent comprehension across general education reading and science assignments.",
  ].join("\n"),
  [`${MAYA_LIN_VARIANT_IEP_DOC_ID}:2`]: [
    "Annual Measurable Goals",
    "Goal ID: Goal 1 (Reading Fluency)",
    "Baseline: 62 words correct per minute on 3rd-grade oral reading probes.",
    "Annual Target: By 11/11/2025, Maya will read 3rd-grade connected text at 90 words correct per minute with 95% accuracy across 3 consecutive weekly probes.",
    "Goal Period: 11/12/2024 to 11/11/2025",
    "Special Education and Related Services",
    "Service: Speech-Language Therapy | Frequency: 2 times per week | Duration: 30 minutes per session (480 minutes per semester) | Location: Therapy room | Start Date: 11/18/2024",
    "Classroom and Testing Accommodations",
    "Accommodation 1: Extended time (1.5x) on classroom and district reading assessments.",
    "Accommodation 2: Preferential seating near the point of instruction.",
  ].join("\n"),
  [`${MAYA_LIN_VARIANT_IEP_DOC_ID}:3`]: [
    "Progress Monitoring and Reporting",
    "Progress Measurement Method: Biweekly 1-minute oral reading fluency curriculum-based measurement probes.",
    "Progress Reporting Frequency: Quarterly progress reports issued with report cards (4 times per year).",
    "IEP Team Participation (Meeting Date: 11/12/2024)",
    "Team Role: Parent/Guardian (Elena Lin) — Participated 11/12/2024",
    "Team Role: Special Education Teacher (Ms. Rachel Patel) — Participated 11/12/2024",
    "Team Role: General Education Teacher (Mr. David Kim) — Participated 11/12/2024",
    "Team Role: Speech-Language Pathologist (Ms. Priya Nair) — Participated 11/12/2024",
    "Team Role: District Representative / LEA (Dr. Marcus Vance) — Participated 11/12/2024",
  ].join("\n"),
  [`${MAYA_DOCS.progressNov}:1`]: [
    "Progress report, November 14, 2025.",
    "Goal 1 reading fluency: 74 words correct per minute.",
  ].join("\n"),
  [`${MAYA_DOCS.serviceLog}:1`]: [
    "Speech therapy minutes delivered September to November 2025: 360 minutes.",
    "Minutes required by IEP: 480 minutes.",
  ].join("\n"),
  [`${MAYA_DOCS.evaluation}:1`]: [
    "Psychoeducational evaluation.",
    "The evaluator did not report a reading comprehension score.",
  ].join("\n"),
  [`${MAYA_DOCS.meetingNotice}:1`]: [
    "Notice of IEP meeting.",
    "The annual review meeting is scheduled for March 3, 2026.",
  ].join("\n"),
};
/** @deprecated Alias for `MAYA_LIN_VARIANT_IEP_PAGES` (synthetic Maya Lin 62→90 WCPM variant). */
export const MAYA_INITIAL_IEP_PAGES = MAYA_LIN_VARIANT_IEP_PAGES;

/**
 * Document-centered Canonical Study investigation turns over the 3-page Maya Lin synthetic variant IEP
 * (62→90 WCPM, speech therapy) and supporting records (`P1`–`P7`, V4-004I Gate 2 variant).
 */
export function mayaLinVariantDocumentCenteredStudyAgentTurns(): ScriptedCall[][] {
  let n = 0;
  const call = (name: string, args: Record<string, unknown>): ScriptedCall => ({
    id: `toolu_maya_doc_${(n += 1)}`,
    name,
    arguments: JSON.stringify(args),
  });
  const read = (doc: string, from: number, to = from) =>
    call("read_pages", { documentId: doc, fromPage: from, toPage: to });
  const cite = (doc: string, page: number, quoteText: string) =>
    call("record_evidence", { documentId: doc, pageNumber: page, quote: quoteText });
  const df = (
    doc: string,
    category: string,
    subject: string,
    attribute: string,
    valueAsWritten: string,
    statement: string,
    evidenceIds: string[],
    extra: Record<string, unknown> = {},
  ) =>
    call("record_document_finding", {
      documentId: doc,
      category,
      subject,
      attribute,
      valueAsWritten,
      statement,
      modality: "STATED",
      itemKey: null,
      dates: [],
      evidenceIds,
      ...extra,
    });

  return [
    // Turn 1: Read all 3 pages of primary 08_initial_iep.pdf + supporting documents
    [
      read(MAYA_INITIAL_IEP_DOC_ID, 1, 3),
      read(MAYA_DOCS.progressNov, 1),
      read(MAYA_DOCS.serviceLog, 1),
      read(MAYA_DOCS.evaluation, 1),
      read(MAYA_DOCS.meetingNotice, 1),
    ],
    // Turn 2: Record verbatim evidence quotes (E1–E20) from page 1 & 2 of 08_initial_iep.pdf
    [
      cite(MAYA_INITIAL_IEP_DOC_ID, 1, "Document Type: Initial IEP"), // E1
      cite(MAYA_INITIAL_IEP_DOC_ID, 1, "IEP Meeting Date: 11/12/2024"), // E2
      cite(MAYA_INITIAL_IEP_DOC_ID, 1, "IEP Effective Period: 11/12/2024 to 11/11/2025"), // E3
      cite(MAYA_INITIAL_IEP_DOC_ID, 1, "Student Name: Maya Lin | Date of Birth: 04/18/2016 | Grade: 3"), // E4
      cite(MAYA_INITIAL_IEP_DOC_ID, 1, "School: Cedar Grove Elementary School | District: Oakridge Unified School District"), // E5
      cite(MAYA_INITIAL_IEP_DOC_ID, 1, "Eligibility Category: Specific Learning Disability (SLD) | Eligibility Determination Date: 11/05/2024"), // E6
      cite(
        MAYA_INITIAL_IEP_DOC_ID,
        1,
        "Present Levels of Academic Achievement and Functional Performance: Maya decodes single-syllable words accurately but reads connected 3rd-grade text at 62 words correct per minute, which is below the 3rd-grade fall benchmark.",
      ), // E7
      cite(
        MAYA_INITIAL_IEP_DOC_ID,
        1,
        "Educational Impact: Reduced oral reading fluency slows independent comprehension across general education reading and science assignments.",
      ), // E8
      cite(MAYA_INITIAL_IEP_DOC_ID, 2, "Goal ID: Goal 1 (Reading Fluency)"), // E9
      cite(MAYA_INITIAL_IEP_DOC_ID, 2, "Baseline: 62 words correct per minute on 3rd-grade oral reading probes."), // E10
      cite(
        MAYA_INITIAL_IEP_DOC_ID,
        2,
        "Annual Target: By 11/11/2025, Maya will read 3rd-grade connected text at 90 words correct per minute with 95% accuracy across 3 consecutive weekly probes.",
      ), // E11
      cite(MAYA_INITIAL_IEP_DOC_ID, 2, "Goal Period: 11/12/2024 to 11/11/2025"), // E12
      cite(
        MAYA_INITIAL_IEP_DOC_ID,
        2,
        "Service: Speech-Language Therapy | Frequency: 2 times per week | Duration: 30 minutes per session (480 minutes per semester) | Location: Therapy room | Start Date: 11/18/2024",
      ), // E13
      cite(
        MAYA_INITIAL_IEP_DOC_ID,
        2,
        "Accommodation 1: Extended time (1.5x) on classroom and district reading assessments.",
      ), // E14
      cite(
        MAYA_INITIAL_IEP_DOC_ID,
        2,
        "Accommodation 2: Preferential seating near the point of instruction.",
      ), // E15
    ],
    // Turn 3: Record verbatim evidence quotes (E16–E27) from page 3 of 08_initial_iep.pdf and supporting documents + record_document calls
    [
      cite(
        MAYA_INITIAL_IEP_DOC_ID,
        3,
        "Progress Measurement Method: Biweekly 1-minute oral reading fluency curriculum-based measurement probes.",
      ), // E16
      cite(
        MAYA_INITIAL_IEP_DOC_ID,
        3,
        "Progress Reporting Frequency: Quarterly progress reports issued with report cards (4 times per year).",
      ), // E17
      cite(MAYA_INITIAL_IEP_DOC_ID, 3, "Team Role: Parent/Guardian (Elena Lin) — Participated 11/12/2024"), // E18
      cite(MAYA_INITIAL_IEP_DOC_ID, 3, "Team Role: Special Education Teacher (Ms. Rachel Patel) — Participated 11/12/2024"), // E19
      cite(MAYA_INITIAL_IEP_DOC_ID, 3, "Team Role: General Education Teacher (Mr. David Kim) — Participated 11/12/2024"), // E20
      cite(MAYA_INITIAL_IEP_DOC_ID, 3, "Team Role: Speech-Language Pathologist (Ms. Priya Nair) — Participated 11/12/2024"), // E21
      cite(MAYA_INITIAL_IEP_DOC_ID, 3, "Team Role: District Representative / LEA (Dr. Marcus Vance) — Participated 11/12/2024"), // E22
      cite(MAYA_DOCS.progressNov, 1, "Progress report, November 14, 2025.\nGoal 1 reading fluency: 74 words correct per minute."), // E23
      cite(MAYA_DOCS.serviceLog, 1, "Speech therapy minutes delivered September to November 2025: 360 minutes."), // E24
      cite(MAYA_DOCS.serviceLog, 1, "Minutes required by IEP: 480 minutes."), // E25
      cite(MAYA_DOCS.evaluation, 1, "The evaluator did not report a reading comprehension score."), // E26
      cite(MAYA_DOCS.meetingNotice, 1, "The annual review meeting is scheduled for March 3, 2026."), // E27
      call("record_document", {
        documentId: MAYA_INITIAL_IEP_DOC_ID,
        role: "PRIMARY",
        roleReasoning: "Central Individualized Education Program establishing Maya's baseline, goals, services, accommodations, and team.",
        documentType: "Individualized Education Program",
        temporalStatus: "HISTORICAL",
        declaredReadCoverage: "FULL_DOCUMENT_READ",
        titleAsPrinted: "Oakridge Unified School District — Individualized Education Program (IEP)",
        issuer: "Oakridge Unified School District",
        subjects: ["Maya Lin"],
        effectivePeriod: {
          startDate: "2024-11-12",
          endDate: "2025-11-11",
          asWritten: "11/12/2024 to 11/11/2025",
        },
        evidenceIds: ["E1", "E3"],
      }),
      call("record_document", {
        documentId: MAYA_DOCS.progressNov,
        role: "SUPPORTING",
        roleReasoning: "Interim reading fluency progress measurement for Goal 1.",
        documentType: "Progress Report",
        temporalStatus: "CURRENT",
        declaredReadCoverage: "FULL_DOCUMENT_READ",
        evidenceIds: ["E23"],
      }),
      call("record_document", {
        documentId: MAYA_DOCS.serviceLog,
        role: "SUPPORTING",
        roleReasoning: "Service delivery log comparing delivered vs required speech therapy minutes.",
        documentType: "Service Delivery Log",
        temporalStatus: "CURRENT",
        declaredReadCoverage: "FULL_DOCUMENT_READ",
        evidenceIds: ["E24", "E25"],
      }),
      call("record_document", {
        documentId: MAYA_DOCS.evaluation,
        role: "SUPPORTING",
        roleReasoning: "Psychoeducational evaluation noting absence of a reading comprehension score.",
        documentType: "Psychoeducational Evaluation",
        temporalStatus: "CURRENT",
        declaredReadCoverage: "FULL_DOCUMENT_READ",
        evidenceIds: ["E26"],
      }),
      call("record_document", {
        documentId: MAYA_DOCS.meetingNotice,
        role: "REFERENCE",
        roleReasoning: "Notice scheduling the upcoming annual IEP review meeting.",
        documentType: "Meeting Notice",
        temporalStatus: "UPCOMING",
        declaredReadCoverage: "FULL_DOCUMENT_READ",
        evidenceIds: ["E27"],
      }),
    ],
    // Turn 4: Record atomic document findings DF1–DF18 (Student profile, IEP metadata, Eligibility, Present levels, Goal 1)
    [
      df(MAYA_INITIAL_IEP_DOC_ID, "student_profile", "Maya Lin", "student_name", "Maya Lin", "Student name is Maya Lin.", ["E4"], { itemKey: "student-maya" }), // DF1
      df(MAYA_INITIAL_IEP_DOC_ID, "student_profile", "Maya Lin", "date_of_birth", "04/18/2016", "Maya Lin's date of birth is 04/18/2016.", ["E4"], { itemKey: "student-maya", dates: ["2016-04-18"] }), // DF2
      df(MAYA_INITIAL_IEP_DOC_ID, "student_profile", "Maya Lin", "grade", "3", "Maya Lin is in Grade 3.", ["E4"], { itemKey: "student-maya" }), // DF3
      df(MAYA_INITIAL_IEP_DOC_ID, "student_profile", "Maya Lin", "school", "Cedar Grove Elementary School", "Maya attends Cedar Grove Elementary School.", ["E5"], { itemKey: "student-maya" }), // DF4
      df(MAYA_INITIAL_IEP_DOC_ID, "student_profile", "Maya Lin", "district", "Oakridge Unified School District", "The school district is Oakridge Unified School District.", ["E5"], { itemKey: "student-maya" }), // DF5
      df(MAYA_INITIAL_IEP_DOC_ID, "iep_metadata", "Initial IEP", "iep_type", "Initial IEP", "The document type is Initial IEP.", ["E1"], { itemKey: "iep-2024" }), // DF6
      df(MAYA_INITIAL_IEP_DOC_ID, "iep_metadata", "Initial IEP", "iep_date", "11/12/2024", "The IEP meeting date is 11/12/2024.", ["E2"], { itemKey: "iep-2024", dates: ["2024-11-12"] }), // DF7
      df(MAYA_INITIAL_IEP_DOC_ID, "iep_metadata", "Initial IEP", "effective_period", "11/12/2024 to 11/11/2025", "The IEP effective period is 11/12/2024 to 11/11/2025.", ["E3"], { itemKey: "iep-2024", modality: "HISTORICAL", dates: ["2024-11-12", "2025-11-11"] }), // DF8
      df(MAYA_INITIAL_IEP_DOC_ID, "eligibility", "Maya Lin", "eligibility_category", "Specific Learning Disability (SLD)", "Maya's eligibility category is Specific Learning Disability (SLD).", ["E6"], { itemKey: "eligibility-sld" }), // DF9
      df(MAYA_INITIAL_IEP_DOC_ID, "eligibility", "Maya Lin", "determination_date", "11/05/2024", "Eligibility determination date is 11/05/2024.", ["E6"], { itemKey: "eligibility-sld", dates: ["2024-11-05"] }), // DF10
      df(MAYA_INITIAL_IEP_DOC_ID, "present_levels", "Oral Reading Fluency", "present_level", "62 words correct per minute", "Maya decodes single-syllable words accurately and reads connected 3rd-grade text at 62 words correct per minute.", ["E7"], { itemKey: "plaaafp-reading", modality: "MEASURED", unit: "words correct per minute" }), // DF11
      df(MAYA_INITIAL_IEP_DOC_ID, "present_levels", "Oral Reading Fluency", "educational_impact", "Reduced oral reading fluency slows independent comprehension across general education reading and science assignments.", "Reduced oral reading fluency slows independent comprehension across general education reading and science assignments.", ["E8"], { itemKey: "plaaafp-reading" }), // DF12
      df(MAYA_INITIAL_IEP_DOC_ID, "annual_goal", "Goal 1 (Reading Fluency)", "goal_identifier", "Goal 1", "Annual reading fluency goal identifier is Goal 1.", ["E9"], { itemKey: "goal-1" }), // DF13
      df(MAYA_INITIAL_IEP_DOC_ID, "annual_goal", "Goal 1 (Reading Fluency)", "baseline", "62 words correct per minute", "Goal 1 baseline is 62 words correct per minute on 3rd-grade oral reading probes.", ["E10"], { itemKey: "goal-1", modality: "MEASURED", unit: "words correct per minute", relatedFindingIds: ["DF13"] }), // DF14
      df(MAYA_INITIAL_IEP_DOC_ID, "annual_goal", "Goal 1 (Reading Fluency)", "target", "90 words correct per minute", "Goal 1 target is 90 words correct per minute on 3rd-grade connected text.", ["E11"], { itemKey: "goal-1", modality: "PLANNED", unit: "words correct per minute", relatedFindingIds: ["DF13", "DF14"] }), // DF15
      df(MAYA_INITIAL_IEP_DOC_ID, "annual_goal", "Goal 1 (Reading Fluency)", "accuracy", "95% accuracy", "Goal 1 requires 95% accuracy.", ["E11"], { itemKey: "goal-1", modality: "PLANNED", unit: "percent", relatedFindingIds: ["DF13"] }), // DF16
      df(MAYA_INITIAL_IEP_DOC_ID, "annual_goal", "Goal 1 (Reading Fluency)", "mastery_criterion", "across 3 consecutive weekly probes", "Goal 1 mastery criterion is 3 consecutive weekly probes.", ["E11"], { itemKey: "goal-1", modality: "PLANNED", relatedFindingIds: ["DF13"] }), // DF17
      df(MAYA_INITIAL_IEP_DOC_ID, "annual_goal", "Goal 1 (Reading Fluency)", "goal_dates", "11/12/2024 to 11/11/2025", "Goal 1 period is 11/12/2024 to 11/11/2025 with target date 11/11/2025.", ["E11", "E12"], { itemKey: "goal-1", modality: "PLANNED", dates: ["2024-11-12", "2025-11-11"], relatedFindingIds: ["DF13"] }), // DF18
    ],
    // Turn 5: Record atomic document findings DF19–DF33 (Services, Accommodations, Progress monitoring, Team roles, Supporting docs)
    [
      df(MAYA_INITIAL_IEP_DOC_ID, "service", "Speech-Language Therapy", "frequency", "2 times per week", "Speech-Language Therapy frequency is 2 times per week.", ["E13"], { itemKey: "service-speech", modality: "PLANNED", per: "week" }), // DF19
      df(MAYA_INITIAL_IEP_DOC_ID, "service", "Speech-Language Therapy", "minutes", "30 minutes per session (480 minutes per semester)", "Speech-Language Therapy duration is 30 minutes per session (480 minutes per semester).", ["E13"], { itemKey: "service-speech", modality: "PLANNED", unit: "minutes", per: "semester" }), // DF20
      df(MAYA_INITIAL_IEP_DOC_ID, "service", "Speech-Language Therapy", "location", "Therapy room", "Speech-Language Therapy location is the Therapy room.", ["E13"], { itemKey: "service-speech", modality: "PLANNED" }), // DF21
      df(MAYA_INITIAL_IEP_DOC_ID, "service", "Speech-Language Therapy", "start_date", "11/18/2024", "Speech-Language Therapy start date is 11/18/2024.", ["E13"], { itemKey: "service-speech", modality: "PLANNED", dates: ["2024-11-18"] }), // DF22
      df(MAYA_INITIAL_IEP_DOC_ID, "accommodation", "Accommodation 1", "description", "Extended time (1.5x) on classroom and district reading assessments.", "Accommodation 1 provides extended time (1.5x) on classroom and district reading assessments.", ["E14"], { itemKey: "accommodation-1", modality: "PLANNED" }), // DF23
      df(MAYA_INITIAL_IEP_DOC_ID, "accommodation", "Accommodation 2", "description", "Preferential seating near the point of instruction.", "Accommodation 2 provides preferential seating near the point of instruction.", ["E15"], { itemKey: "accommodation-2", modality: "PLANNED" }), // DF24
      df(MAYA_INITIAL_IEP_DOC_ID, "progress_monitoring", "Goal 1 Progress Monitoring", "measurement_method", "Biweekly 1-minute oral reading fluency curriculum-based measurement probes.", "Progress is measured using biweekly 1-minute oral reading fluency curriculum-based measurement probes.", ["E16"], { itemKey: "progress-monitoring" }), // DF25
      df(MAYA_INITIAL_IEP_DOC_ID, "progress_monitoring", "Goal 1 Progress Monitoring", "reporting_frequency", "Quarterly progress reports issued with report cards (4 times per year).", "Progress reports are issued quarterly with report cards (4 times per year).", ["E17"], { itemKey: "progress-monitoring", per: "year" }), // DF26
      df(MAYA_INITIAL_IEP_DOC_ID, "iep_team", "Parent/Guardian", "participation", "Elena Lin — Participated 11/12/2024", "Parent/Guardian Elena Lin participated in the IEP meeting on 11/12/2024.", ["E18"], { itemKey: "team-parent", dates: ["2024-11-12"] }), // DF27
      df(MAYA_INITIAL_IEP_DOC_ID, "iep_team", "Special Education Teacher", "participation", "Ms. Rachel Patel — Participated 11/12/2024", "Special Education Teacher Ms. Rachel Patel participated on 11/12/2024.", ["E19"], { itemKey: "team-sped", dates: ["2024-11-12"] }), // DF28
      df(MAYA_INITIAL_IEP_DOC_ID, "iep_team", "General Education Teacher", "participation", "Mr. David Kim — Participated 11/12/2024", "General Education Teacher Mr. David Kim participated on 11/12/2024.", ["E20"], { itemKey: "team-gened", dates: ["2024-11-12"] }), // DF29
      df(MAYA_INITIAL_IEP_DOC_ID, "iep_team", "Speech-Language Pathologist", "participation", "Ms. Priya Nair — Participated 11/12/2024", "Speech-Language Pathologist Ms. Priya Nair participated on 11/12/2024.", ["E21"], { itemKey: "team-slp", dates: ["2024-11-12"] }), // DF30
      df(MAYA_INITIAL_IEP_DOC_ID, "iep_team", "District Representative / LEA", "participation", "Dr. Marcus Vance — Participated 11/12/2024", "District Representative / LEA Dr. Marcus Vance participated on 11/12/2024.", ["E22"], { itemKey: "team-lea", dates: ["2024-11-12"] }), // DF31
      df(MAYA_DOCS.progressNov, "progress_probe", "Goal 1 (Reading Fluency)", "november_2025_probe", "74 words correct per minute", "On November 14, 2025, Goal 1 reading fluency was 74 words correct per minute.", ["E23"], { itemKey: "probe-nov-2025", modality: "MEASURED", unit: "words correct per minute", dates: ["2025-11-14"], relatedFindingIds: ["DF13", "DF14", "DF15"] }), // DF32
      df(MAYA_DOCS.serviceLog, "service_delivery", "Speech-Language Therapy", "delivered_minutes", "360 minutes", "360 speech therapy minutes were delivered between September and November 2025 against 480 required minutes.", ["E24", "E25"], { itemKey: "service-speech-log", modality: "MEASURED", unit: "minutes", relatedFindingIds: ["DF20"] }), // DF33
    ],
    // Turn 6: Supporting findings DF34–DF35 + calculations, assessments, determinations + finish P1–P7 referencing shared DF IDs + finish_study
    [
      df(MAYA_DOCS.evaluation, "evaluation_gap", "Reading Comprehension", "score_reported", "The evaluator did not report a reading comprehension score.", "The psychoeducational evaluation did not report a reading comprehension score.", ["E26"], { itemKey: "eval-comprehension", modality: "EMPTY_FIELD" }), // DF34
      df(MAYA_DOCS.meetingNotice, "meeting_schedule", "Annual IEP Review", "scheduled_date", "March 3, 2026", "The annual review meeting is scheduled for March 3, 2026.", ["E27"], { itemKey: "meeting-2026", modality: "PLANNED", dates: ["2026-03-03"] }), // DF35
      call("record_calculation", {
        questionId: "P1",
        description: "Gain since the baseline",
        inputs: [
          { label: "November 2025 probe", valueAsWritten: "74 words correct per minute", findingIds: ["DF32"] },
          { label: "Initial IEP baseline", valueAsWritten: "62 words correct per minute", findingIds: ["DF14"] },
        ],
        formula: { op: "-", args: [{ input: 0 }, { input: 1 }] },
      }),
      call("record_calculation", {
        questionId: "P3",
        description: "Share of required speech minutes delivered",
        inputs: [
          { label: "Delivered", valueAsWritten: "360 minutes", findingIds: ["DF33"] },
          { label: "Required", valueAsWritten: "480 minutes", findingIds: ["DF20"] },
        ],
        formula: { op: "*", args: [{ op: "/", args: [{ input: 0 }, { input: 1 }] }, { value: "100" }] },
      }),
      call("record_assessment", {
        questionId: "P1",
        judgment: "Maya gained 12 words correct per minute above her 62 wcpm baseline but remains 16 wcpm below the 90 wcpm annual target.",
        criterion: "Compare interim progress probes against the documented baseline and annual target.",
        criterionSource: "GENERAL_KNOWLEDGE",
        criterionEvidenceIds: [],
        findingIds: ["DF14", "DF15", "DF32"],
        reasoning: "Fluency increased from 62 wcpm to 74 wcpm by November 14, 2025, moving toward the 90 wcpm goal.",
        strength: "MODERATE",
        wouldChangeIf: ["Additional biweekly probes show higher fluency or regression."],
      }),
      call("record_professional_determination", {
        questionId: "P1",
        determination: "Whether reading fluency progress is sufficient for FAPE",
        bearingFindingIds: ["DF14", "DF15", "DF32"],
        decidedBy: "The IEP team",
      }),
      call("finish_question", {
        questionId: "P1",
        status: "PARTIALLY_ANSWERED",
        answer: "Maya's reading fluency rose from 62 wcpm to 74 wcpm against her 90 wcpm target under the 11/12/2024 to 11/11/2025 Initial IEP.",
        findingIds: ["DF8", "DF13", "DF14", "DF15", "DF16", "DF17", "DF18", "DF32"],
        uncertainties: ["Only one interim fluency probe after baseline is in the record."],
        limitations: ["No post-November 2025 fluency probe is present."],
        evidenceNeeds: [
          { need: "Goal 1 baseline, target and goal period", status: "FOUND", findingIds: ["DF14", "DF15", "DF18"] },
          { need: "Interim fluency probe", status: "FOUND", findingIds: ["DF32"] },
          {
            need: "Fluency probe after November 2025",
            status: "NOT_FOUND",
            explanation: "No later probe appears in the authorized pages examined.",
          },
        ],
      }),
      call("finish_question", {
        questionId: "P2",
        status: "ANSWERED",
        answer: "Goal 1 sets a baseline of 62 wcpm and an annual target of 90 wcpm with 95% accuracy across 3 consecutive weekly probes by 11/11/2025.",
        findingIds: ["DF13", "DF14", "DF15", "DF16", "DF17", "DF18"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [{ need: "Goal 1 baseline, target and mastery criteria", status: "FOUND", findingIds: ["DF14", "DF15", "DF16", "DF17"] }],
      }),
      call("finish_question", {
        questionId: "P3",
        status: "ANSWERED",
        answer: "360 of 480 required speech-language therapy minutes (75%) were delivered.",
        findingIds: ["DF19", "DF20", "DF21", "DF22", "DF33"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [
          { need: "Required speech-language therapy minutes", status: "FOUND", findingIds: ["DF20"] },
          { need: "Delivered speech-language therapy minutes", status: "FOUND", findingIds: ["DF33"] },
        ],
      }),
      call("finish_question", {
        questionId: "P4",
        status: "PARTIALLY_ANSWERED",
        answer: "Fluency improved by 12 wcpm and speech therapy reached 75% of required minutes, while reading comprehension remains unassessed.",
        findingIds: ["DF11", "DF12", "DF14", "DF15", "DF20", "DF32", "DF33", "DF34"],
        uncertainties: [],
        limitations: ["Reading comprehension score is absent from the evaluation."],
        evidenceNeeds: [
          { need: "Fluency and service delivery progress", status: "FOUND", findingIds: ["DF14", "DF32", "DF20", "DF33"] },
          {
            need: "Reading comprehension score",
            status: "NOT_FOUND",
            findingIds: ["DF34"],
            explanation: "The evaluation records that no comprehension score was reported.",
          },
        ],
      }),
      call("finish_question", {
        questionId: "P5",
        status: "ANSWERED",
        answer: "The Initial IEP provides extended time (1.5x) and preferential seating, biweekly CBM probes, and quarterly progress reporting.",
        findingIds: ["DF23", "DF24", "DF25", "DF26"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [
          { need: "Accommodations", status: "FOUND", findingIds: ["DF23", "DF24"] },
          { need: "Progress monitoring method and reporting frequency", status: "FOUND", findingIds: ["DF25", "DF26"] },
        ],
      }),
      call("finish_question", {
        questionId: "P6",
        status: "MISSING_EVIDENCE",
        answer: "The evaluation did not report a reading comprehension score ahead of the March 3, 2026 annual review meeting.",
        findingIds: ["DF34", "DF35"],
        uncertainties: ["No reading comprehension baseline or probe is in the record."],
        limitations: ["Reading comprehension progress cannot be determined from the uploaded records."],
        evidenceNeeds: [
          {
            need: "Reading comprehension baseline or probe",
            status: "NOT_FOUND",
            explanation: "Not found in the authorized pages examined; the evaluation reports no comprehension score.",
          },
          { need: "Annual review meeting date", status: "FOUND", findingIds: ["DF35"] },
        ],
      }),
      call("finish_question", {
        questionId: "P7",
        status: "ANSWERED",
        answer: "Maya Lin (DOB 04/18/2016, Grade 3, Cedar Grove Elementary, Oakridge USD) qualified under SLD on 11/05/2024; her 5-role IEP team met on 11/12/2024.",
        findingIds: ["DF1", "DF2", "DF3", "DF4", "DF5", "DF6", "DF7", "DF8", "DF9", "DF10", "DF14", "DF27", "DF28", "DF29", "DF30", "DF31"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [
          { need: "Student profile and eligibility", status: "FOUND", findingIds: ["DF1", "DF2", "DF3", "DF9", "DF10"] },
          { need: "IEP team participation", status: "FOUND", findingIds: ["DF27", "DF28", "DF29", "DF30", "DF31"] },
        ],
      }),
      call("finish_study", {
        coverageNotes: ["All 3 pages of maya_lin_variant_initial_iep.pdf and all supporting single-page records were read."],
        documentReconciliations: [
          {
            documentId: MAYA_LIN_VARIANT_IEP_DOC_ID,
            disposition: "MATERIAL_FINDINGS_RECORDED",
            findingIds: ["DF1", "DF8", "DF13", "DF14", "DF15", "DF20", "DF23", "DF25", "DF27"],
          },
          { documentId: MAYA_DOCS.progressNov, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF32"] },
          { documentId: MAYA_DOCS.serviceLog, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF33"] },
          { documentId: MAYA_DOCS.evaluation, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF34"] },
          { documentId: MAYA_DOCS.meetingNotice, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF35"] },
        ],
      }),
    ],
  ];
}
/** @deprecated Alias for `mayaLinVariantDocumentCenteredStudyAgentTurns` (synthetic Maya Lin 62→90 WCPM variant). */
export const mayaDocumentCenteredStudyAgentTurns = mayaLinVariantDocumentCenteredStudyAgentTurns;

// ---------------------------------------------------------------------------
// Independent L001 Original-Document Golden (`08_initial_iep.pdf`, Maya Carter)
// ---------------------------------------------------------------------------

export const L001_INITIAL_IEP_DOC_ID = "5a5a5a5a-0000-4000-8000-000000000108";

export const L001_INITIAL_IEP_FILE_NAMES: Record<string, string> = {
  [L001_INITIAL_IEP_DOC_ID]: "08_initial_iep.pdf",
};

/**
 * Exact 3-page transcription of the founder-supplied original synthetic L001 `08_initial_iep.pdf`
 * (`packages/contracts/src/testing/fixtures/l001/08_initial_iep.pdf`, NestIEP Corpus • L001, Maya Carter,
 * 3 pages, 10 numbered sections).
 */
export const L001_INITIAL_IEP_PAGES: Record<string, string> = {
  [`${L001_INITIAL_IEP_DOC_ID}:1`]: [
    "SYNTHETIC DEVELOPMENT RECORD • NestIEP Corpus • L001 Page 1",
    "Initial Individualized Education Program (IEP)",
    "SYNTHETIC DEVELOPMENT RECORD — NOT A REAL STUDENT",
    "1. Student / IEP Information",
    "Student: Maya Carter",
    "Date of Birth: 2017-04-18",
    "Grade: 2",
    "School: Synthetic Elementary School",
    "District: Synthetic District",
    "IEP Date: 2024-11-12",
    "IEP Period: 2024-11-12 through 2025-11-11",
    "2. Eligibility",
    "Eligibility Category: Specific Learning Disability (SLD) - Reading",
    "Primary Educational",
    "Need:",
    "Reading Fluency",
    "Determination Date: 2024-11-01",
    "This IEP implements the educational eligibility determination. It is not a medical diagnosis.",
    "3. Present Levels of Academic Achievement and Functional Performance",
    "Maya has a persistent reading fluency concern. Classroom performance and teacher information indicate",
    "difficulty reading connected grade-level text accurately and fluently.",
    "The academic evaluation dated 2024-10-18 documents a reading fluency baseline of 42 WCPM and oral reading",
    "accuracy of 86%. Reading comprehension during grade-level text tasks is below expected classroom level.",
    "Connected-text reading is slow and effortful, with frequent pauses. Isolated word reading is stronger than",
    "connected-text reading.",
    "4. Educational Need",
    "The primary educational need is Reading Fluency. Maya has difficulty reading connected grade-level text",
    "accurately and fluently. This difficulty affects Maya's ability to access grade-level reading activities independently.",
    "5. Annual Goal",
    "Given a grade-level connected text passage, Maya will read at least 75 words correct per minute (WCPM) with at",
    "least 95% accuracy across three consecutive probes.",
    "Goal ID: GOAL_READING_FLUENCY",
  ].join("\n"),
  [`${L001_INITIAL_IEP_DOC_ID}:2`]: [
    "SYNTHETIC DEVELOPMENT RECORD • NestIEP Corpus • L001 Page 2",
    "Baseline: 42 WCPM",
    "Target: 75 WCPM",
    "Accuracy Criterion: at least 95% accuracy",
    "Mastery Criterion: across three consecutive probes",
    "Start Date: 2024-11-12",
    "Target Date: 2025-11-11",
    "Progress will be measured using curriculum-based oral reading fluency probes.",
    "6. Special Education Services",
    "Service Frequency Minutes Location Start Date",
    "Specialized reading",
    "instruction Weekly 150 minutes special education",
    "setting 2024-11-12",
    "Specialized reading instruction is provided 150 minutes weekly in the special education setting.",
    "7. Accommodations",
    "• Extended time for classroom reading assessments.",
    "• Directions read aloud when reading ability is not being assessed.",
    "8. Progress Reporting",
    "Progress toward the annual goal will be measured using oral-reading-fluency probes and reported quarterly,",
    "concurrent with report periods.",
    "9. Team / Parent Participation",
    "The following roles participate in development of this IEP. No personal names, telephone numbers, or addresses",
    "are recorded in this synthetic record.",
    "Parent/Guardian: [Synthetic signature omitted]",
    "General Education Teacher: [Synthetic signature omitted]",
    "Special Education Teacher: [Synthetic signature omitted]",
    "District Representative: [Synthetic signature omitted]",
    "Date: 2024-11-12",
  ].join("\n"),
  [`${L001_INITIAL_IEP_DOC_ID}:3`]: [
    "SYNTHETIC DEVELOPMENT RECORD • NestIEP Corpus • L001 Page 3",
    "10. IEP Summary",
    "This initial IEP addresses Reading Fluency for Maya Carter. The documented baseline is 42 WCPM. The annual",
    "goal targets 75 WCPM with at least 95% accuracy across three consecutive probes by 2025-11-11.",
  ].join("\n"),
};

export const L001_INITIAL_IEP_PLAN_QUESTION_IDS = ["P1", "P2", "P3", "P4", "P5", "P6"] as const;

/**
 * Document-centered Canonical Study investigation turns over the original synthetic L001 `08_initial_iep.pdf`
 * (`packages/contracts/src/testing/fixtures/l001/08_initial_iep.pdf`, Maya Carter, 3 pages, 10 numbered sections):
 * - Reads all 3 pages of `08_initial_iep.pdf` (`PRIMARY`, `HISTORICAL` effective period `2024-11-12` through `2025-11-11`).
 * - Records 34 atomic `DF1`–`DF34` document findings once across all 10 numbered sections (`1. Student / IEP Information`
 *   through `10. IEP Summary`) with exact page numbers and verbatim quotes.
 * - Answers all 6 investigation questions (`P1`–`P6`) by reusing `DF…` IDs across questions with zero question-scoped
 *   duplicate `record_fact` calls (`answer.facts === []`).
 */
export function l001InitialIepStudyAgentTurns(): ScriptedCall[][] {
  let n = 0;
  const call = (name: string, args: Record<string, unknown>): ScriptedCall => ({
    id: `toolu_l001_iep_${(n += 1)}`,
    name,
    arguments: JSON.stringify(args),
  });
  const read = (doc: string, from: number, to = from) =>
    call("read_pages", { documentId: doc, fromPage: from, toPage: to });
  const cite = (doc: string, page: number, quoteText: string) =>
    call("record_evidence", { documentId: doc, pageNumber: page, quote: quoteText });
  const df = (
    doc: string,
    category: string,
    subject: string,
    attribute: string,
    valueAsWritten: string,
    statement: string,
    evidenceIds: string[],
    extra: Record<string, unknown> = {},
  ) =>
    call("record_document_finding", {
      documentId: doc,
      category,
      subject,
      attribute,
      valueAsWritten,
      statement,
      modality: "STATED",
      itemKey: null,
      dates: [],
      evidenceIds,
      ...extra,
    });

  return [
    // Turn 1: Read all 3 pages of L001 08_initial_iep.pdf
    [read(L001_INITIAL_IEP_DOC_ID, 1, 3)],
    // Turn 2: Record verbatim evidence quotes (E1–E17) from Page 1 (Sections 1–5)
    [
      cite(L001_INITIAL_IEP_DOC_ID, 1, "Initial Individualized Education Program (IEP)"), // E1
      cite(L001_INITIAL_IEP_DOC_ID, 1, "Student: Maya Carter"), // E2
      cite(L001_INITIAL_IEP_DOC_ID, 1, "Date of Birth: 2017-04-18"), // E3
      cite(L001_INITIAL_IEP_DOC_ID, 1, "Grade: 2"), // E4
      cite(L001_INITIAL_IEP_DOC_ID, 1, "School: Synthetic Elementary School"), // E5
      cite(L001_INITIAL_IEP_DOC_ID, 1, "District: Synthetic District"), // E6
      cite(L001_INITIAL_IEP_DOC_ID, 1, "IEP Date: 2024-11-12"), // E7
      cite(L001_INITIAL_IEP_DOC_ID, 1, "IEP Period: 2024-11-12 through 2025-11-11"), // E8
      cite(L001_INITIAL_IEP_DOC_ID, 1, "Eligibility Category: Specific Learning Disability (SLD) - Reading"), // E9
      cite(L001_INITIAL_IEP_DOC_ID, 1, "Primary Educational\nNeed:\nReading Fluency"), // E10
      cite(L001_INITIAL_IEP_DOC_ID, 1, "Determination Date: 2024-11-01"), // E11
      cite(
        L001_INITIAL_IEP_DOC_ID,
        1,
        "The academic evaluation dated 2024-10-18 documents a reading fluency baseline of 42 WCPM and oral reading\naccuracy of 86%.",
      ), // E12
      cite(
        L001_INITIAL_IEP_DOC_ID,
        1,
        "Reading comprehension during grade-level text tasks is below expected classroom level.\nConnected-text reading is slow and effortful, with frequent pauses. Isolated word reading is stronger than\nconnected-text reading.",
      ), // E13
      cite(
        L001_INITIAL_IEP_DOC_ID,
        1,
        "The primary educational need is Reading Fluency. Maya has difficulty reading connected grade-level text\naccurately and fluently. This difficulty affects Maya's ability to access grade-level reading activities independently.",
      ), // E14
      cite(
        L001_INITIAL_IEP_DOC_ID,
        1,
        "Given a grade-level connected text passage, Maya will read at least 75 words correct per minute (WCPM) with at\nleast 95% accuracy across three consecutive probes.",
      ), // E15
      cite(L001_INITIAL_IEP_DOC_ID, 1, "Goal ID: GOAL_READING_FLUENCY"), // E16
    ],
    // Turn 3: Record verbatim evidence quotes (E17–E35) from Pages 2 & 3 (Sections 5–10) + record_document
    [
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Baseline: 42 WCPM"), // E17
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Target: 75 WCPM"), // E18
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Accuracy Criterion: at least 95% accuracy"), // E19
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Mastery Criterion: across three consecutive probes"), // E20
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Start Date: 2024-11-12"), // E21
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Target Date: 2025-11-11"), // E22
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Progress will be measured using curriculum-based oral reading fluency probes."), // E23
      cite(
        L001_INITIAL_IEP_DOC_ID,
        2,
        "Specialized reading\ninstruction Weekly 150 minutes special education\nsetting 2024-11-12",
      ), // E24
      cite(
        L001_INITIAL_IEP_DOC_ID,
        2,
        "Specialized reading instruction is provided 150 minutes weekly in the special education setting.",
      ), // E25
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Extended time for classroom reading assessments."), // E26
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Directions read aloud when reading ability is not being assessed."), // E27
      cite(
        L001_INITIAL_IEP_DOC_ID,
        2,
        "Progress toward the annual goal will be measured using oral-reading-fluency probes and reported quarterly,\nconcurrent with report periods.",
      ), // E28
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Parent/Guardian: [Synthetic signature omitted]"), // E29
      cite(L001_INITIAL_IEP_DOC_ID, 2, "General Education Teacher: [Synthetic signature omitted]"), // E30
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Special Education Teacher: [Synthetic signature omitted]"), // E31
      cite(L001_INITIAL_IEP_DOC_ID, 2, "District Representative: [Synthetic signature omitted]"), // E32
      cite(L001_INITIAL_IEP_DOC_ID, 2, "Date: 2024-11-12"), // E33
      cite(
        L001_INITIAL_IEP_DOC_ID,
        3,
        "This initial IEP addresses Reading Fluency for Maya Carter. The documented baseline is 42 WCPM. The annual\ngoal targets 75 WCPM with at least 95% accuracy across three consecutive probes by 2025-11-11.",
      ), // E34
      call("record_document", {
        documentId: L001_INITIAL_IEP_DOC_ID,
        role: "PRIMARY",
        roleReasoning:
          "Primary Initial Individualized Education Program (IEP) for Maya Carter establishing student profile, eligibility, present levels, annual reading fluency goal, specialized reading instruction, accommodations, progress reporting, and IEP team participation.",
        documentType: "Initial Individualized Education Program (IEP)",
        temporalStatus: "HISTORICAL",
        declaredReadCoverage: "FULL_DOCUMENT_READ",
        titleAsPrinted: "Initial Individualized Education Program (IEP)",
        issuer: "Synthetic District",
        subjects: ["Maya Carter"],
        effectivePeriod: {
          startDate: "2024-11-12",
          endDate: "2025-11-11",
          asWritten: "2024-11-12 through 2025-11-11",
        },
        evidenceIds: ["E1", "E2", "E6", "E8"],
      }),
    ],
    // Turn 4: Record atomic DF findings DF1–DF19 (Sections 1–5)
    [
      // Section 1: Student / IEP Information (Page 1)
      df(L001_INITIAL_IEP_DOC_ID, "student_profile", "Maya Carter", "student_name", "Maya Carter", "Student is Maya Carter.", ["E2"], { itemKey: "student-maya-carter", section: "1. Student / IEP Information" }), // DF1
      df(L001_INITIAL_IEP_DOC_ID, "student_profile", "Maya Carter", "date_of_birth", "2017-04-18", "Maya Carter's date of birth is 2017-04-18.", ["E3"], { itemKey: "student-maya-carter", dates: ["2017-04-18"], section: "1. Student / IEP Information" }), // DF2
      df(L001_INITIAL_IEP_DOC_ID, "student_profile", "Maya Carter", "grade", "2", "Maya Carter is in Grade 2.", ["E4"], { itemKey: "student-maya-carter", section: "1. Student / IEP Information" }), // DF3
      df(L001_INITIAL_IEP_DOC_ID, "student_profile", "Maya Carter", "school", "Synthetic Elementary School", "Maya Carter's school is Synthetic Elementary School.", ["E5"], { itemKey: "student-maya-carter", section: "1. Student / IEP Information" }), // DF4
      df(L001_INITIAL_IEP_DOC_ID, "student_profile", "Maya Carter", "district", "Synthetic District", "The school district is Synthetic District.", ["E6"], { itemKey: "student-maya-carter", section: "1. Student / IEP Information" }), // DF5
      df(L001_INITIAL_IEP_DOC_ID, "iep_metadata", "Initial Individualized Education Program (IEP)", "iep_type", "Initial Individualized Education Program (IEP)", "Document is an Initial Individualized Education Program (IEP).", ["E1"], { itemKey: "iep-l001", section: "1. Student / IEP Information" }), // DF6
      df(L001_INITIAL_IEP_DOC_ID, "iep_metadata", "Initial Individualized Education Program (IEP)", "iep_date", "2024-11-12", "IEP Date is 2024-11-12.", ["E7"], { itemKey: "iep-l001", dates: ["2024-11-12"], section: "1. Student / IEP Information" }), // DF7
      df(L001_INITIAL_IEP_DOC_ID, "iep_metadata", "Initial Individualized Education Program (IEP)", "iep_period", "2024-11-12 through 2025-11-11", "IEP Period is 2024-11-12 through 2025-11-11.", ["E8"], { itemKey: "iep-l001", modality: "HISTORICAL", dates: ["2024-11-12", "2025-11-11"], section: "1. Student / IEP Information" }), // DF8
      // Section 2: Eligibility (Page 1)
      df(L001_INITIAL_IEP_DOC_ID, "eligibility", "Maya Carter", "eligibility_category", "Specific Learning Disability (SLD) - Reading", "Eligibility category is Specific Learning Disability (SLD) - Reading.", ["E9"], { itemKey: "eligibility-sld-reading", section: "2. Eligibility" }), // DF9
      df(L001_INITIAL_IEP_DOC_ID, "eligibility", "Maya Carter", "primary_educational_need", "Reading Fluency", "Primary educational need under Eligibility is Reading Fluency.", ["E10"], { itemKey: "eligibility-sld-reading", section: "2. Eligibility" }), // DF10
      df(L001_INITIAL_IEP_DOC_ID, "eligibility", "Maya Carter", "determination_date", "2024-11-01", "Eligibility determination date is 2024-11-01.", ["E11"], { itemKey: "eligibility-sld-reading", dates: ["2024-11-01"], section: "2. Eligibility" }), // DF11
      // Section 3: Present Levels of Academic Achievement and Functional Performance (Page 1)
      df(L001_INITIAL_IEP_DOC_ID, "present_levels", "Academic Evaluation (2024-10-18)", "evaluation_date", "2024-10-18", "The academic evaluation referenced in Present Levels is dated 2024-10-18.", ["E12"], { itemKey: "plaaafp-reading", dates: ["2024-10-18"], section: "3. Present Levels of Academic Achievement and Functional Performance" }), // DF12
      df(L001_INITIAL_IEP_DOC_ID, "present_levels", "Reading Fluency", "reading_fluency_baseline", "42 WCPM", "The academic evaluation dated 2024-10-18 documents a reading fluency baseline of 42 WCPM.", ["E12"], { itemKey: "plaaafp-reading", modality: "MEASURED", unit: "WCPM", dates: ["2024-10-18"], section: "3. Present Levels of Academic Achievement and Functional Performance", relatedFindingIds: ["DF12"] }), // DF13
      df(L001_INITIAL_IEP_DOC_ID, "present_levels", "Reading Fluency", "oral_reading_accuracy", "86%", "The academic evaluation dated 2024-10-18 documents oral reading accuracy of 86%.", ["E12"], { itemKey: "plaaafp-reading", modality: "MEASURED", unit: "percent", dates: ["2024-10-18"], section: "3. Present Levels of Academic Achievement and Functional Performance", relatedFindingIds: ["DF12"] }), // DF14
      df(L001_INITIAL_IEP_DOC_ID, "present_levels", "Reading Performance", "functional_performance", "Reading comprehension during grade-level text tasks is below expected classroom level. Connected-text reading is slow and effortful, with frequent pauses. Isolated word reading is stronger than connected-text reading.", "Reading comprehension during grade-level text tasks is below expected classroom level; connected-text reading is slow and effortful with frequent pauses, while isolated word reading is stronger.", ["E13"], { itemKey: "plaaafp-reading", section: "3. Present Levels of Academic Achievement and Functional Performance" }), // DF15
      // Section 4: Educational Need (Page 1)
      df(L001_INITIAL_IEP_DOC_ID, "educational_need", "Reading Fluency", "educational_impact", "The primary educational need is Reading Fluency. Maya has difficulty reading connected grade-level text accurately and fluently. This difficulty affects Maya's ability to access grade-level reading activities independently.", "Difficulty reading connected grade-level text accurately and fluently affects Maya's ability to access grade-level reading activities independently.", ["E14"], { itemKey: "need-reading-fluency", section: "4. Educational Need" }), // DF16
      // Section 5: Annual Goal (Page 1 & Page 2)
      df(L001_INITIAL_IEP_DOC_ID, "annual_goal", "GOAL_READING_FLUENCY", "goal_identifier", "GOAL_READING_FLUENCY", "Annual goal identifier is GOAL_READING_FLUENCY.", ["E16"], { itemKey: "goal-reading-fluency", section: "5. Annual Goal" }), // DF17
      df(L001_INITIAL_IEP_DOC_ID, "annual_goal", "GOAL_READING_FLUENCY", "goal_statement", "Given a grade-level connected text passage, Maya will read at least 75 words correct per minute (WCPM) with at least 95% accuracy across three consecutive probes.", "Given a grade-level connected text passage, Maya will read at least 75 words correct per minute (WCPM) with at least 95% accuracy across three consecutive probes.", ["E15"], { itemKey: "goal-reading-fluency", modality: "PLANNED", section: "5. Annual Goal", relatedFindingIds: ["DF17"] }), // DF18
      df(L001_INITIAL_IEP_DOC_ID, "annual_goal", "GOAL_READING_FLUENCY", "baseline", "42 WCPM", "GOAL_READING_FLUENCY baseline is 42 WCPM.", ["E17"], { itemKey: "goal-reading-fluency", modality: "MEASURED", unit: "WCPM", section: "5. Annual Goal", relatedFindingIds: ["DF17", "DF13"] }), // DF19
    ],
    // Turn 5: Record atomic DF findings DF20–DF35 (Sections 5–10)
    [
      df(L001_INITIAL_IEP_DOC_ID, "annual_goal", "GOAL_READING_FLUENCY", "target", "75 WCPM", "GOAL_READING_FLUENCY target is 75 WCPM.", ["E18", "E15"], { itemKey: "goal-reading-fluency", modality: "PLANNED", unit: "WCPM", section: "5. Annual Goal", relatedFindingIds: ["DF17", "DF19"] }), // DF20
      df(L001_INITIAL_IEP_DOC_ID, "annual_goal", "GOAL_READING_FLUENCY", "accuracy_criterion", "at least 95% accuracy", "GOAL_READING_FLUENCY accuracy criterion is at least 95% accuracy.", ["E19", "E15"], { itemKey: "goal-reading-fluency", modality: "PLANNED", unit: "percent", section: "5. Annual Goal", relatedFindingIds: ["DF17"] }), // DF21
      df(L001_INITIAL_IEP_DOC_ID, "annual_goal", "GOAL_READING_FLUENCY", "mastery_criterion", "across three consecutive probes", "GOAL_READING_FLUENCY mastery criterion is across three consecutive probes.", ["E20", "E15"], { itemKey: "goal-reading-fluency", modality: "PLANNED", section: "5. Annual Goal", relatedFindingIds: ["DF17"] }), // DF22
      df(L001_INITIAL_IEP_DOC_ID, "annual_goal", "GOAL_READING_FLUENCY", "start_date", "2024-11-12", "GOAL_READING_FLUENCY start date is 2024-11-12.", ["E21"], { itemKey: "goal-reading-fluency", modality: "PLANNED", dates: ["2024-11-12"], section: "5. Annual Goal", relatedFindingIds: ["DF17"] }), // DF23
      df(L001_INITIAL_IEP_DOC_ID, "annual_goal", "GOAL_READING_FLUENCY", "target_date", "2025-11-11", "GOAL_READING_FLUENCY target date is 2025-11-11.", ["E22"], { itemKey: "goal-reading-fluency", modality: "PLANNED", dates: ["2025-11-11"], section: "5. Annual Goal", relatedFindingIds: ["DF17"] }), // DF24
      df(L001_INITIAL_IEP_DOC_ID, "annual_goal", "GOAL_READING_FLUENCY", "measurement_method", "Progress will be measured using curriculum-based oral reading fluency probes.", "Goal progress will be measured using curriculum-based oral reading fluency probes.", ["E23"], { itemKey: "goal-reading-fluency", modality: "PLANNED", section: "5. Annual Goal", relatedFindingIds: ["DF17"] }), // DF25
      // Section 6: Special Education Services (Page 2)
      df(L001_INITIAL_IEP_DOC_ID, "service", "Specialized reading instruction", "frequency", "Weekly", "Specialized reading instruction frequency is Weekly.", ["E24", "E25"], { itemKey: "service-reading-instruction", modality: "PLANNED", per: "week", section: "6. Special Education Services" }), // DF26
      df(L001_INITIAL_IEP_DOC_ID, "service", "Specialized reading instruction", "minutes", "150 minutes", "Specialized reading instruction is provided 150 minutes weekly.", ["E24", "E25"], { itemKey: "service-reading-instruction", modality: "PLANNED", unit: "minutes", per: "week", section: "6. Special Education Services" }), // DF27
      df(L001_INITIAL_IEP_DOC_ID, "service", "Specialized reading instruction", "location", "special education setting", "Specialized reading instruction location is the special education setting.", ["E24", "E25"], { itemKey: "service-reading-instruction", modality: "PLANNED", section: "6. Special Education Services" }), // DF28
      df(L001_INITIAL_IEP_DOC_ID, "service", "Specialized reading instruction", "start_date", "2024-11-12", "Specialized reading instruction start date is 2024-11-12.", ["E24"], { itemKey: "service-reading-instruction", modality: "PLANNED", dates: ["2024-11-12"], section: "6. Special Education Services" }), // DF29
      // Section 7: Accommodations (Page 2)
      df(L001_INITIAL_IEP_DOC_ID, "accommodation", "Classroom reading assessments", "extended_time", "Extended time for classroom reading assessments.", "Accommodation provides extended time for classroom reading assessments.", ["E26"], { itemKey: "accommodation-extended-time", modality: "PLANNED", section: "7. Accommodations" }), // DF30
      df(L001_INITIAL_IEP_DOC_ID, "accommodation", "Directions read aloud", "read_aloud_condition", "Directions read aloud when reading ability is not being assessed.", "Accommodation provides directions read aloud when reading ability is not being assessed.", ["E27"], { itemKey: "accommodation-directions-read-aloud", modality: "PLANNED", section: "7. Accommodations" }), // DF31
      // Section 8: Progress Reporting (Page 2)
      df(L001_INITIAL_IEP_DOC_ID, "progress_reporting", "Annual Goal Progress Reporting", "probes_and_schedule", "Progress toward the annual goal will be measured using oral-reading-fluency probes and reported quarterly, concurrent with report periods.", "Progress toward the annual goal is measured using oral-reading-fluency probes and reported quarterly, concurrent with report periods.", ["E28"], { itemKey: "progress-reporting-quarterly", modality: "PLANNED", per: "quarter", section: "8. Progress Reporting" }), // DF32
      // Section 9: Team / Parent Participation (Page 2)
      df(L001_INITIAL_IEP_DOC_ID, "iep_team", "Parent/Guardian", "role_participation", "Parent/Guardian: [Synthetic signature omitted]", "Parent/Guardian role participated in development of the IEP on 2024-11-12 (no personal names recorded in synthetic record).", ["E29", "E33"], { itemKey: "team-parent-guardian", dates: ["2024-11-12"], section: "9. Team / Parent Participation" }), // DF33
      df(L001_INITIAL_IEP_DOC_ID, "iep_team", "General Education Teacher", "role_participation", "General Education Teacher: [Synthetic signature omitted]", "General Education Teacher role participated in development of the IEP on 2024-11-12 (no personal names recorded in synthetic record).", ["E30", "E33"], { itemKey: "team-gen-ed-teacher", dates: ["2024-11-12"], section: "9. Team / Parent Participation" }), // DF34
      df(L001_INITIAL_IEP_DOC_ID, "iep_team", "Special Education Teacher", "role_participation", "Special Education Teacher: [Synthetic signature omitted]", "Special Education Teacher role participated in development of the IEP on 2024-11-12 (no personal names recorded in synthetic record).", ["E31", "E33"], { itemKey: "team-spec-ed-teacher", dates: ["2024-11-12"], section: "9. Team / Parent Participation" }), // DF35
      df(L001_INITIAL_IEP_DOC_ID, "iep_team", "District Representative", "role_participation", "District Representative: [Synthetic signature omitted]", "District Representative role participated in development of the IEP on 2024-11-12 (no personal names recorded in synthetic record).", ["E32", "E33"], { itemKey: "team-district-rep", dates: ["2024-11-12"], section: "9. Team / Parent Participation" }), // DF36
      // Section 10: IEP Summary (Page 3)
      df(L001_INITIAL_IEP_DOC_ID, "iep_summary", "Initial IEP Summary", "summary_statement", "This initial IEP addresses Reading Fluency for Maya Carter. The documented baseline is 42 WCPM. The annual goal targets 75 WCPM with at least 95% accuracy across three consecutive probes by 2025-11-11.", "Section 10 summarizes that the initial IEP addresses Reading Fluency for Maya Carter with a 42 WCPM baseline and an annual goal targeting 75 WCPM with at least 95% accuracy across three consecutive probes by 2025-11-11.", ["E34"], { itemKey: "iep-summary", dates: ["2025-11-11"], section: "10. IEP Summary", relatedFindingIds: ["DF1", "DF17", "DF19", "DF20", "DF21", "DF22", "DF24"] }), // DF37
    ],
    // Turn 6: Calculations, assessments, determinations, finish P1–P6 reusing DF1–DF37 without duplicate facts, finish_study
    [
      call("record_calculation", {
        questionId: "P2",
        description: "Required reading fluency gain from baseline to annual target",
        inputs: [
          { label: "Annual goal target", valueAsWritten: "75 WCPM", findingIds: ["DF20"] },
          { label: "Documented baseline", valueAsWritten: "42 WCPM", findingIds: ["DF19"] },
        ],
        formula: { op: "-", args: [{ input: 0 }, { input: 1 }] },
      }),
      call("record_calculation", {
        questionId: "P2",
        description: "Required oral reading accuracy increase from baseline to goal criterion",
        inputs: [
          { label: "Goal accuracy criterion", valueAsWritten: "95%", findingIds: ["DF21"] },
          { label: "Baseline oral reading accuracy", valueAsWritten: "86%", findingIds: ["DF14"] },
        ],
        formula: { op: "-", args: [{ input: 0 }, { input: 1 }] },
      }),
      call("record_assessment", {
        questionId: "P2",
        judgment:
          "GOAL_READING_FLUENCY requires a 33 WCPM fluency increase (from 42 WCPM to at least 75 WCPM) and a 9 percentage-point accuracy increase (from 86% to at least 95%) across three consecutive probes by 2025-11-11.",
        criterion: "Compare the documented baseline measurements against the annual goal target, accuracy, and mastery criteria.",
        criterionSource: "DOCUMENT",
        criterionEvidenceIds: ["E15", "E17", "E18", "E19", "E20"],
        findingIds: ["DF13", "DF14", "DF17", "DF18", "DF19", "DF20", "DF21", "DF22", "DF23", "DF24", "DF37"],
        reasoning:
          "Section 3 and Section 5 establish a 42 WCPM fluency baseline and 86% oral reading accuracy on 2024-10-18, and set the annual target at 75 WCPM with at least 95% accuracy across three consecutive probes from 2024-11-12 to 2025-11-11.",
        strength: "STRONG",
        wouldChangeIf: ["Subsequent IEP amendments or quarterly progress probes revise the baseline or annual goal criteria."],
      }),
      call("record_professional_determination", {
        questionId: "P6",
        determination: "Whether Maya Carter achieved the 75 WCPM and 95% accuracy annual goal by 2025-11-11 and what successor IEP goals or services are warranted",
        bearingFindingIds: ["DF8", "DF13", "DF14", "DF17", "DF19", "DF20", "DF21", "DF22", "DF24", "DF26", "DF27", "DF32", "DF37"],
        decidedBy: "The IEP team",
      }),
      call("finish_question", {
        questionId: "P1",
        status: "ANSWERED",
        answer:
          "Maya Carter (DOB 2017-04-18, Grade 2, Synthetic Elementary School, Synthetic District) was found eligible under Specific Learning Disability (SLD) - Reading on 2024-11-01 with Reading Fluency as her primary educational need; this Initial IEP is dated 2024-11-12 for the period 2024-11-12 through 2025-11-11.",
        findingIds: ["DF1", "DF2", "DF3", "DF4", "DF5", "DF6", "DF7", "DF8", "DF9", "DF10", "DF11", "DF37"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [
          { need: "Student profile and IEP dates", status: "FOUND", findingIds: ["DF1", "DF2", "DF3", "DF7", "DF8"] },
          { need: "Eligibility category, need and determination date", status: "FOUND", findingIds: ["DF9", "DF10", "DF11"] },
        ],
      }),
      call("finish_question", {
        questionId: "P2",
        status: "ANSWERED",
        answer:
          "On the 2024-10-18 academic evaluation, Maya's reading fluency baseline is 42 WCPM with 86% oral reading accuracy; annual goal GOAL_READING_FLUENCY targets at least 75 WCPM with at least 95% accuracy across three consecutive probes from 2024-11-12 to 2025-11-11.",
        findingIds: ["DF10", "DF12", "DF13", "DF14", "DF15", "DF16", "DF17", "DF18", "DF19", "DF20", "DF21", "DF22", "DF23", "DF24", "DF25", "DF37"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [
          { need: "Reading fluency and accuracy baseline", status: "FOUND", findingIds: ["DF13", "DF14", "DF19"] },
          { need: "Annual goal target, accuracy and mastery criteria", status: "FOUND", findingIds: ["DF20", "DF21", "DF22", "DF24"] },
        ],
      }),
      call("finish_question", {
        questionId: "P3",
        status: "ANSWERED",
        answer:
          "The IEP provides Specialized reading instruction Weekly for 150 minutes in the special education setting starting 2024-11-12, plus two classroom accommodations: extended time for classroom reading assessments and directions read aloud when reading ability is not being assessed.",
        findingIds: ["DF16", "DF17", "DF26", "DF27", "DF28", "DF29", "DF30", "DF31"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [
          { need: "Special education services", status: "FOUND", findingIds: ["DF26", "DF27", "DF28", "DF29"] },
          { need: "Accommodations", status: "FOUND", findingIds: ["DF30", "DF31"] },
        ],
      }),
      call("finish_question", {
        questionId: "P4",
        status: "ANSWERED",
        answer:
          "Progress toward GOAL_READING_FLUENCY is measured using curriculum-based oral-reading-fluency probes and reported quarterly, concurrent with report periods.",
        findingIds: ["DF17", "DF19", "DF20", "DF21", "DF22", "DF25", "DF32"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [{ need: "Progress measurement method and reporting schedule", status: "FOUND", findingIds: ["DF25", "DF32"] }],
      }),
      call("finish_question", {
        questionId: "P5",
        status: "ANSWERED",
        answer:
          "Four IEP team roles participated on 2024-11-12: Parent/Guardian, General Education Teacher, Special Education Teacher, and District Representative (no personal names are recorded in the synthetic record).",
        findingIds: ["DF1", "DF7", "DF8", "DF33", "DF34", "DF35", "DF36"],
        uncertainties: [],
        limitations: [],
        evidenceNeeds: [{ need: "IEP team roles and participation date", status: "FOUND", findingIds: ["DF33", "DF34", "DF35", "DF36"] }],
      }),
      call("finish_question", {
        questionId: "P6",
        status: "PARTIALLY_ANSWERED",
        answer:
          "The Initial IEP period (2024-11-12 through 2025-11-11) has ended as of the report date, and while baseline (42 WCPM, 86% accuracy) and target criteria (75 WCPM, 95% accuracy across three consecutive probes by 2025-11-11) are documented, no post-2024-11-12 quarterly progress probes or subsequent IEP records are included in this single-document corpus.",
        findingIds: ["DF7", "DF8", "DF12", "DF13", "DF14", "DF17", "DF19", "DF20", "DF21", "DF22", "DF23", "DF24", "DF26", "DF27", "DF32", "DF37"],
        uncertainties: [
          "No quarterly oral-reading-fluency probe results after 2024-11-12 or successor IEP for the period after 2025-11-11 are in this single-document corpus.",
        ],
        limitations: [
          "The 2024-10-18 academic evaluation referenced in Section 3 and quarterly progress reports referenced in Section 8 are not separately attached in this single-document test.",
        ],
        evidenceNeeds: [
          { need: "Baseline and annual goal criteria", status: "FOUND", findingIds: ["DF13", "DF14", "DF19", "DF20", "DF21", "DF22", "DF24"] },
          {
            need: "Quarterly progress probe results after 2024-11-12",
            status: "NOT_FOUND",
            explanation:
              "Not found in the authorized pages examined; the IEP refers to quarterly reports, which may exist outside this corpus.",
          },
        ],
      }),
      call("finish_study", {
        coverageNotes: ["All 3 pages of L001 08_initial_iep.pdf were read."],
        documentReconciliations: [
          {
            documentId: L001_INITIAL_IEP_DOC_ID,
            disposition: "MATERIAL_FINDINGS_RECORDED",
            findingIds: ["DF1", "DF9", "DF13", "DF17", "DF20", "DF26", "DF30", "DF32", "DF33", "DF37"],
          },
        ],
      }),
    ],
  ];
}
