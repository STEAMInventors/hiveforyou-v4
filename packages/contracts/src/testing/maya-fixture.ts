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

/**
 * A scripted Canonical Study investigation over the case-wide Maya corpus (D-042): one model turn
 * per inner list. Evidence ids E1–E8, fact ids F1–F6 and calculation ids C1–C3 follow from the order.
 * P1 draws on three documents and flags the differing 2024 and 2025 reading targets as a conflict.
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
      call("finish_question", {
        questionId: "P1",
        status: "PARTIALLY_ANSWERED",
        answer: "Reading fluency rose from 62 to 74 words correct per minute against a goal of 90.",
        evidenceIds: ["E1", "E4"],
        uncertainties: ["Only one progress measurement after the baseline was available."],
        limitations: ["No progress measurement after November 2025 was available."],
      }),
      call("finish_question", {
        questionId: "P2",
        status: "ANSWERED",
        answer: "The log shows 360 of 480 required speech minutes were delivered.",
        evidenceIds: ["E5", "E6"],
        uncertainties: [],
        limitations: [],
      }),
      call("finish_question", {
        questionId: "P3",
        status: "MISSING_EVIDENCE",
        answer: "No reading comprehension score was reported.",
        evidenceIds: ["E7"],
        uncertainties: [],
        limitations: ["Comprehension cannot be assessed from these records."],
      }),
      call("finish_study", { coverageNotes: [] }),
    ],
  ];
}

/**
 * Six-question batched Maya investigation (`P1`–`P6`, allowance = 18 rounds) demonstrating the D-044
 * case-wide phase execution pattern:
 * - Turn 1: locate and read relevant pages across all 6 questions in one turn.
 * - Turn 2: batch verified evidence recording (`E1`–`E11`) across the read pages.
 * - Turn 3: batch source-backed facts (`F1`–`F11`, reusing `E1`/`E2`/`E4`/`E5`/`E6` across questions),
 *   calculations (`C1`–`C3`) and conflicts (`K1`).
 * - Turn 4: batch assessments (`A1`, `A2`) and professional determinations (`D1`, `D2`) using only
 *   same-question `F…` ids (`P4` and `P6` depend on `P1`/`P2`/`P3` and use their own `F6`–`F11`).
 * - Turn 5: close all 6 questions (`P1`–`P6`, respecting `dependsOn`) and call `finish_study`.
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
      }),
      call("finish_question", {
        questionId: "P2",
        status: "ANSWERED",
        answer: "The log shows 360 of 480 required speech minutes were delivered.",
        evidenceIds: ["E5", "E6"],
        uncertainties: [],
        limitations: [],
      }),
      call("finish_question", {
        questionId: "P3",
        status: "MISSING_EVIDENCE",
        answer: "No reading comprehension score was reported.",
        evidenceIds: ["E7"],
        uncertainties: [],
        limitations: ["Comprehension cannot be assessed from these records."],
      }),
      call("finish_question", {
        questionId: "P4",
        status: "PARTIALLY_ANSWERED",
        answer: "Fluency improved from 62 to 74 words per minute by November 2025, but January 2026 data was not collected.",
        evidenceIds: ["E1", "E4", "E9"],
        uncertainties: ["January 2026 progress data was not collected."],
        limitations: ["No post-November 2025 reading measurement is in the case records."],
      }),
      call("finish_question", {
        questionId: "P5",
        status: "ANSWERED",
        answer: "Small-group reading occurs four days a week and the annual review meeting is set for March 3, 2026.",
        evidenceIds: ["E10", "E11"],
        uncertainties: [],
        limitations: [],
      }),
      call("finish_question", {
        questionId: "P6",
        status: "PARTIALLY_ANSWERED",
        answer: "For the March 3, 2026 meeting, the records show a 120-minute speech shortfall and missing comprehension and January 2026 fluency data.",
        evidenceIds: ["E5", "E6", "E7", "E9", "E10"],
        uncertainties: [],
        limitations: ["The records do not state why 120 speech minutes were missed or provide January 2026 fluency data."],
      }),
      call("finish_study", { coverageNotes: [] }),
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
