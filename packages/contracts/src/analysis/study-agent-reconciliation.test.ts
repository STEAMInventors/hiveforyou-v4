import { describe, expect, it } from "vitest";

import {
  L001_INITIAL_IEP_DOC_ID,
  L001_INITIAL_IEP_PAGES,
  MAYA_LIN_VARIANT_IEP_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_REVISION_6_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaLinVariantDocumentCenteredStudyAgentTurns,
  mayaStudyOutput,
  MAYA_PAGES,
} from "../testing/maya-fixture";
import { StudyAgentLedger, type StudyAgentCorpusPage, studyAgentAllowance } from "./study-agent";
import { verifyStudyInvestigation } from "./study-verification";

/** Synthetic, non-IEP corpus: a lease, two rent invoices, a cover email and a blank scan. */
const LEASE = "c0c0c0c0-0000-4000-8000-0000000000a1";
const INVOICE_MARCH = "c0c0c0c0-0000-4000-8000-0000000000a2";
const INVOICE_APRIL = "c0c0c0c0-0000-4000-8000-0000000000a3";
const EMAIL = "c0c0c0c0-0000-4000-8000-0000000000a4";
const BLANK = "c0c0c0c0-0000-4000-8000-0000000000a5";

const GENERIC_PAGES: StudyAgentCorpusPage[] = [
  { sourceDocumentId: LEASE, pageNumber: 1, text: "Residential lease agreement.\nMonthly rent: $1,200.\nRent is due on the first day of each month." },
  { sourceDocumentId: LEASE, pageNumber: 2, text: "Signatures: Landlord and Tenant." },
  { sourceDocumentId: INVOICE_MARCH, pageNumber: 1, text: "Invoice for March rent.\nAmount due: $1,200." },
  { sourceDocumentId: INVOICE_APRIL, pageNumber: 1, text: "Invoice for April rent.\nAmount due: $1,350." },
  { sourceDocumentId: EMAIL, pageNumber: 1, text: "Cover email: please find the invoices attached." },
  { sourceDocumentId: BLANK, pageNumber: 1, text: "" },
];

const pageMap = (pages: readonly StudyAgentCorpusPage[]) =>
  new Map(pages.map((page) => [`${page.sourceDocumentId}:${page.pageNumber}`, page.text]));

let sequence = 0;
function run(target: StudyAgentLedger, name: string, args: unknown): Record<string, unknown> & { ok: boolean } {
  sequence += 1;
  const result = target.execute({ id: `rc${sequence}`, name, arguments: JSON.stringify(args) });
  return { ...(JSON.parse(result.content) as Record<string, unknown>), ok: result.ok };
}

/** A scripted step that must succeed; a failure means the fixture itself is wrong. */
function step(target: StudyAgentLedger, name: string, args: unknown) {
  const result = run(target, name, args);
  if (!result.ok) throw new Error(`fixture step ${name} rejected: ${String(result.error)}`);
  return result;
}

const doc = (documentId: string, role: string, documentType: string, roleReasoning: string, evidenceIds: string[], extra = {}) => ({
  documentId,
  role,
  documentType,
  roleReasoning,
  evidenceIds,
  ...extra,
});

const GENERIC_ANSWERS = {
  P1: {
    questionId: "P1",
    status: "ANSWERED",
    answer: "The lease sets rent at $1,200; the March invoice matches and the April invoice bills $1,350.",
    findingIds: ["DF1", "DF2", "DF3"],
    uncertainties: [],
    limitations: [],
    evidenceNeeds: [
      { need: "Monthly rent stated in the lease", status: "FOUND", findingIds: ["DF1"] },
      { need: "Amount billed on each rent invoice", status: "FOUND", findingIds: ["DF2", "DF3"] },
    ],
  },
  P2: {
    questionId: "P2",
    status: "MISSING_EVIDENCE",
    answer: "No late-fee clause was found in the examined pages.",
    uncertainties: [],
    limitations: ["No late-fee clause appears in the lease pages that were examined."],
    evidenceNeeds: [
      {
        need: "Late-fee clause in the lease",
        status: "NOT_FOUND",
        explanation: "Not found in the authorized lease pages examined; this does not prove no such clause exists.",
      },
    ],
  },
};

const GENERIC_RECONCILIATIONS = [
  { documentId: LEASE, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF1"] },
  { documentId: INVOICE_MARCH, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF2"] },
  { documentId: INVOICE_APRIL, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF3"] },
  { documentId: EMAIL, disposition: "NO_MATERIAL_FINDINGS", reason: "Transmittal only; it states no amounts or terms." },
  { documentId: BLANK, disposition: "UNRESOLVED", reason: "The scanned page contains no extractable text." },
];

/** Reads, quotes, records and finds across the generic corpus; optionally skips documents or question closure. */
function genericLedger(options: { skipDocuments?: readonly string[]; finishQuestions?: boolean } = {}) {
  const target = new StudyAgentLedger({ processingRunId: MAYA_RUN_ID, planQuestionIds: ["P1", "P2"], pages: GENERIC_PAGES });
  step(target, "read_pages", { documentId: LEASE, fromPage: 1, toPage: 2 });
  for (const documentId of [INVOICE_MARCH, INVOICE_APRIL, EMAIL]) step(target, "read_pages", { documentId, fromPage: 1, toPage: 1 });
  step(target, "record_evidence", { documentId: LEASE, pageNumber: 1, quote: "Monthly rent: $1,200." });
  step(target, "record_evidence", { documentId: INVOICE_MARCH, pageNumber: 1, quote: "Amount due: $1,200." });
  step(target, "record_evidence", { documentId: INVOICE_APRIL, pageNumber: 1, quote: "Amount due: $1,350." });
  step(target, "record_evidence", { documentId: EMAIL, pageNumber: 1, quote: "Cover email: please find the invoices attached." });
  const documents = [
    doc(LEASE, "PRIMARY", "Residential lease", "Sets the rent the invoices are measured against.", ["E1"]),
    doc(INVOICE_MARCH, "SUPPORTING", "Rent invoice", "Bills one month of rent under the lease.", ["E2"]),
    doc(INVOICE_APRIL, "SUPPORTING", "Rent invoice", "Bills one month of rent under the lease.", ["E3"]),
    doc(EMAIL, "REFERENCE", "Cover email", "Transmits the invoices; adds no terms.", ["E4"]),
    doc(BLANK, "UNCERTAIN", "UNDETERMINED", "The scan has no text, so its type cannot be established.", []),
  ];
  for (const item of documents) if (!options.skipDocuments?.includes(item.documentId)) step(target, "record_document", item);
  const finding = (documentId: string, subject: string, valueAsWritten: string, statement: string, evidenceId: string) =>
    step(target, "record_document_finding", {
      documentId,
      category: "rent",
      subject,
      attribute: "amount",
      valueAsWritten,
      statement,
      evidenceIds: [evidenceId],
    });
  finding(LEASE, "Monthly rent", "$1,200", "The lease sets monthly rent at $1,200.", "E1");
  finding(INVOICE_MARCH, "March invoice", "$1,200", "The March invoice bills $1,200.", "E2");
  finding(INVOICE_APRIL, "April invoice", "$1,350", "The April invoice bills $1,350.", "E3");
  step(target, "search_case", { query: "late fee" });
  if (options.finishQuestions !== false) {
    step(target, "finish_question", GENERIC_ANSWERS.P1);
    step(target, "finish_question", GENERIC_ANSWERS.P2);
  }
  return target;
}

function verifyGeneric(output: unknown, requireCorpusReconciliation = true) {
  return verifyStudyInvestigation(output, {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: ["P1", "P2"],
    pages: pageMap(GENERIC_PAGES),
    requireCorpusReconciliation,
  });
}

function finishedGenericOutput() {
  const target = genericLedger();
  step(target, "finish_study", { coverageNotes: [], documentReconciliations: GENERIC_RECONCILIATIONS });
  return structuredClone(target.assemble()) as unknown as {
    documents: { sourceDocumentId: string; reconciliation?: { findingIds: string[] } }[];
    answers: { planQuestionId: string; evidenceNeeds?: { status: string; findingIds: string[]; evidence: unknown[] }[] }[];
    coverageNotes: string[];
  };
}

describe("V4-004L corpus reconciliation — ledger (finish_question / finish_study)", () => {
  it("accounts for every document of a non-IEP corpus, keeps the blank scan visible, and passes the mandatory verifier gate", () => {
    const target = genericLedger();
    expect(run(target, "finish_study", { coverageNotes: [], documentReconciliations: GENERIC_RECONCILIATIONS })).toMatchObject({
      ok: true,
      finished: true,
      unresolvedDocuments: 1,
    });
    const output = target.assemble();
    expect(output.coverageNotes).toEqual([
      `Unresolved document ${BLANK} (type undetermined): The scanned page contains no extractable text.`,
    ]);
    expect(output.documents!.map((item) => [item.sourceDocumentId, item.reconciliation?.disposition])).toEqual([
      [LEASE, "MATERIAL_FINDINGS_RECORDED"],
      [INVOICE_MARCH, "MATERIAL_FINDINGS_RECORDED"],
      [INVOICE_APRIL, "MATERIAL_FINDINGS_RECORDED"],
      [EMAIL, "NO_MATERIAL_FINDINGS"],
      [BLANK, "UNRESOLVED"],
    ]);
    expect(output.answers[1]!.evidenceNeeds).toEqual([
      expect.objectContaining({ status: "NOT_FOUND", findingIds: [], evidence: [] }),
    ]);

    const verified = verifyGeneric(output);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.verification.documentCoverage!.map((item) => item.reconciliationDisposition)).toEqual([
      "MATERIAL_FINDINGS_RECORDED",
      "MATERIAL_FINDINGS_RECORDED",
      "MATERIAL_FINDINGS_RECORDED",
      "NO_MATERIAL_FINDINGS",
      "UNRESOLVED",
    ]);
  });

  it("rejects a study that omits a SUPPORTING or REFERENCE document, or leaves one without a disposition", () => {
    for (const omitted of [INVOICE_APRIL, EMAIL]) {
      const target = genericLedger({ skipDocuments: [omitted] });
      const result = run(target, "finish_study", { coverageNotes: [], documentReconciliations: GENERIC_RECONCILIATIONS });
      expect(result).toMatchObject({ ok: false, error: "documents_unrecorded" });
      expect(String(result.message)).toContain(omitted);
      expect(target.finished).toBe(false);
    }
    const target = genericLedger();
    const withoutEmail = GENERIC_RECONCILIATIONS.filter((item) => item.documentId !== EMAIL);
    expect(run(target, "finish_study", { coverageNotes: [], documentReconciliations: withoutEmail })).toMatchObject({
      ok: false,
      error: "documents_unreconciled",
    });
    expect(run(target, "finish_study", { coverageNotes: [] })).toMatchObject({ ok: false, error: "documents_unreconciled" });
  });

  it("rejects forged, cross-document and inconsistent dispositions without changing the ledger", () => {
    const target = genericLedger();
    const replace = (documentId: string, entry: Record<string, unknown>) =>
      GENERIC_RECONCILIATIONS.map((item) => (item.documentId === documentId ? { documentId, ...entry } : item));
    const attempt = (reconciliations: unknown[]) =>
      run(target, "finish_study", { coverageNotes: [], documentReconciliations: reconciliations });

    expect(attempt(replace(LEASE, { disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF9"] }))).toMatchObject({ error: "unknown_finding" });
    expect(attempt(replace(LEASE, { disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF2"] }))).toMatchObject({
      error: "finding_other_document",
    });
    expect(attempt(replace(LEASE, { disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: [] }))).toMatchObject({
      error: "disposition_inconsistent",
    });
    expect(attempt(replace(INVOICE_MARCH, { disposition: "NO_MATERIAL_FINDINGS", reason: "Nothing material here." }))).toMatchObject({
      error: "disposition_inconsistent",
    });
    expect(attempt(replace(EMAIL, { disposition: "NO_MATERIAL_FINDINGS" }))).toMatchObject({ error: "document_reconciliation_invalid" });
    expect(attempt(replace(BLANK, { disposition: "NO_MATERIAL_FINDINGS", reason: "Nothing material here." }))).toMatchObject({
      error: "disposition_inconsistent",
    });
    expect(attempt([...GENERIC_RECONCILIATIONS, GENERIC_RECONCILIATIONS[0]])).toMatchObject({ error: "document_reconciliation_invalid" });
    expect(
      attempt([...GENERIC_RECONCILIATIONS, { documentId: "c0c0c0c0-0000-4000-8000-0000000000ff", disposition: "UNRESOLVED", reason: "Unknown." }]),
    ).toMatchObject({ error: "page_not_authorized" });

    expect(target.finished).toBe(false);
    expect(() => target.assemble()).toThrow("study_agent_unfinished");

    const emailUnresolved = replace(EMAIL, { disposition: "UNRESOLVED", findingIds: [], reason: "Attachment list could not be matched." });
    expect(attempt(emailUnresolved)).toMatchObject({ ok: true, unresolvedDocuments: 2 });
    const output = target.assemble();
    expect(output.documents!.find((item) => item.sourceDocumentId === EMAIL)!.reconciliation).toEqual({
      disposition: "UNRESOLVED",
      findingIds: [],
      reason: "Attachment list could not be matched.",
    });
    expect(output.coverageNotes.filter((note) => note.startsWith("Unresolved document "))).toHaveLength(2);
  });

  it("requires evidence needs on every question, with references for FOUND and a limitation for NOT_FOUND", () => {
    const target = genericLedger({ finishQuestions: false });
    const { evidenceNeeds: _needs, ...withoutNeeds } = GENERIC_ANSWERS.P1;
    expect(run(target, "finish_question", withoutNeeds)).toMatchObject({ error: "evidence_needs_missing" });
    expect(run(target, "finish_question", { ...GENERIC_ANSWERS.P1, evidenceNeeds: [] })).toMatchObject({ error: "evidence_needs_missing" });
    expect(
      run(target, "finish_question", { ...GENERIC_ANSWERS.P1, evidenceNeeds: [{ need: "Monthly rent in the lease", status: "FOUND" }] }),
    ).toMatchObject({ error: "evidence_need_unsupported" });
    expect(
      run(target, "finish_question", {
        ...GENERIC_ANSWERS.P1,
        evidenceNeeds: [{ need: "Monthly rent in the lease", status: "FOUND", evidenceIds: ["E99"] }],
      }),
    ).toMatchObject({ error: "unknown_evidence" });
    expect(
      run(target, "finish_question", {
        ...GENERIC_ANSWERS.P1,
        evidenceNeeds: [{ need: "Monthly rent in the lease", status: "FOUND", findingIds: ["DF42"] }],
      }),
    ).toMatchObject({ error: "unknown_finding" });
    expect(
      run(target, "finish_question", {
        ...GENERIC_ANSWERS.P1,
        evidenceNeeds: Array.from({ length: 13 }, (_, i) => ({ need: `Rent evidence ${i}`, status: "FOUND", findingIds: ["DF1"] })),
      }),
    ).toMatchObject({ error: "invalid_arguments" });

    expect(run(target, "finish_question", { ...GENERIC_ANSWERS.P2, limitations: [] })).toMatchObject({ error: "status_inconsistent" });
    expect(
      run(target, "finish_question", {
        ...GENERIC_ANSWERS.P2,
        status: "PARTIALLY_ANSWERED",
        findingIds: ["DF1"],
        limitations: [],
        uncertainties: ["Whether a separate addendum exists."],
      }),
    ).toMatchObject({ error: "status_inconsistent" });
    expect(
      run(target, "finish_question", {
        ...GENERIC_ANSWERS.P2,
        evidenceNeeds: [{ need: "Late-fee clause in the lease", status: "NOT_FOUND" }],
      }),
    ).toMatchObject({ error: "evidence_need_unexplained" });
    expect(
      run(target, "finish_question", {
        ...GENERIC_ANSWERS.P2,
        evidenceNeeds: [{ need: "Monthly rent in the lease", status: "FOUND", findingIds: ["DF1"] }],
      }),
    ).toMatchObject({ error: "evidence_need_status_inconsistent" });

    // FOUND may cite findings from any document; NOT_REQUIRED never forces a missing-evidence claim
    expect(
      run(target, "finish_question", {
        ...GENERIC_ANSWERS.P1,
        evidenceNeeds: [
          ...GENERIC_ANSWERS.P1.evidenceNeeds,
          { need: "Currency conversion", status: "NOT_REQUIRED", explanation: "All amounts are in one currency." },
        ],
      }),
    ).toMatchObject({ ok: true });
    expect(run(target, "finish_question", GENERIC_ANSWERS.P2)).toMatchObject({ ok: true });
  });

  it("allows UNDETERMINED for a blank document, requires a read for any other, and keeps a partly read document UNRESOLVED", () => {
    const LETTER = "c0c0c0c0-0000-4000-8000-0000000000a6";
    const pages = [
      ...GENERIC_PAGES,
      { sourceDocumentId: LETTER, pageNumber: 1, text: "Letter from the tenant about the April invoice." },
      { sourceDocumentId: LETTER, pageNumber: 2, text: "The tenant disputes the April amount." },
      { sourceDocumentId: LETTER, pageNumber: 3, text: "Signed, the tenant." },
    ];
    const target = new StudyAgentLedger({ processingRunId: MAYA_RUN_ID, planQuestionIds: ["P1"], pages });
    const undetermined = (documentId: string) =>
      run(target, "record_document", doc(documentId, "UNCERTAIN", "UNDETERMINED", "Its type could not be established.", []));

    expect(undetermined(BLANK)).toMatchObject({ ok: true });
    expect(undetermined(LETTER)).toMatchObject({ error: "document_not_reviewed" });
    expect(run(target, "record_document", doc(EMAIL, "REFERENCE", "unknown", "Transmits the invoices.", []))).toMatchObject({
      error: "document_description_unusable",
    });
    expect(run(target, "record_document", doc(EMAIL, "REFERENCE", "UNDETERMINED", "Transmits the invoices.", []))).toMatchObject({
      error: "document_description_unusable",
    });

    step(target, "read_pages", { documentId: LETTER, fromPage: 1, toPage: 1 });
    expect(run(target, "record_document", doc(LETTER, "REFERENCE", "Tenant letter", "Raises the invoice question.", []))).toMatchObject({
      error: "document_evidence_missing",
    });
    step(target, "record_evidence", { documentId: LETTER, pageNumber: 1, quote: "Letter from the tenant about the April invoice." });
    expect(
      run(target, "record_document", doc(LETTER, "REFERENCE", "Tenant letter", "Raises the invoice question.", ["E1"], { declaredReadCoverage: "PARTIAL_DOCUMENT_READ" })),
    ).toMatchObject({ ok: true, readCoverageStatus: "PARTIAL_PAGES_READ" });
  });

  it("scales the allowance with the corpus under the same hard ceilings", () => {
    expect(studyAgentAllowance(3, 0)).toEqual(studyAgentAllowance(3));
    expect(studyAgentAllowance(3, 8)).toEqual({ rounds: 13, toolCalls: 84, invalidCalls: 7 });
    expect(studyAgentAllowance(6, 8)).toEqual({ rounds: 19, toolCalls: 132, invalidCalls: 10 });
    expect(studyAgentAllowance(40, 100)).toEqual({ rounds: 24, toolCalls: 200, invalidCalls: 12 });
  });
});

/** Synthetic eight-document corpus shaped like the L001 case: the original IEP plus seven companions. */
const L001_COMPANIONS = {
  priorIep: "5a5a5a5a-0000-4000-8000-000000000201",
  progress: "5a5a5a5a-0000-4000-8000-000000000202",
  evaluation: "5a5a5a5a-0000-4000-8000-000000000203",
  serviceLog: "5a5a5a5a-0000-4000-8000-000000000204",
  notice: "5a5a5a5a-0000-4000-8000-000000000205",
  parentLetter: "5a5a5a5a-0000-4000-8000-000000000206",
  blankScan: "5a5a5a5a-0000-4000-8000-000000000207",
} as const;

const L001_EIGHT_PAGES: StudyAgentCorpusPage[] = [
  ...Object.entries(L001_INITIAL_IEP_PAGES).map(([key, text]) => ({
    sourceDocumentId: key.split(":")[0]!,
    pageNumber: Number(key.split(":")[1]),
    text,
  })),
  { sourceDocumentId: L001_COMPANIONS.priorIep, pageNumber: 1, text: "Draft eligibility summary.\nReading fluency screening: 38 WCPM." },
  { sourceDocumentId: L001_COMPANIONS.progress, pageNumber: 1, text: "Quarter 1 progress report.\nReading fluency probe: 51 WCPM." },
  { sourceDocumentId: L001_COMPANIONS.evaluation, pageNumber: 1, text: "Psychoeducational evaluation.\nOral reading fluency is below grade level." },
  { sourceDocumentId: L001_COMPANIONS.serviceLog, pageNumber: 1, text: "Service log.\nReading intervention sessions delivered: 18." },
  { sourceDocumentId: L001_COMPANIONS.notice, pageNumber: 1, text: "Notice of meeting.\nThe team will meet to review progress." },
  { sourceDocumentId: L001_COMPANIONS.parentLetter, pageNumber: 1, text: "Letter from the parent.\nWe would like an update on reading." },
  { sourceDocumentId: L001_COMPANIONS.parentLetter, pageNumber: 2, text: "Please also share the probe schedule." },
  { sourceDocumentId: L001_COMPANIONS.blankScan, pageNumber: 1, text: "   " },
];

describe("V4-004L corpus reconciliation — L001-shaped eight-document corpus", () => {
  it("records every role, reconciles all eight documents within budget, and the verifier accepts it", () => {
    const target = new StudyAgentLedger({ processingRunId: MAYA_RUN_ID, planQuestionIds: ["P1"], pages: L001_EIGHT_PAGES });
    step(target, "read_pages", { documentId: L001_INITIAL_IEP_DOC_ID, fromPage: 1, toPage: 3 });
    for (const documentId of Object.values(L001_COMPANIONS).filter((id) => id !== L001_COMPANIONS.blankScan)) {
      step(target, "read_pages", { documentId, fromPage: 1, toPage: 1 });
    }
    step(target, "search_case", { query: "WCPM" });
    const cite = (documentId: string, pageNumber: number, quote: string) => step(target, "record_evidence", { documentId, pageNumber, quote });
    cite(L001_INITIAL_IEP_DOC_ID, 1, "Student: Maya Carter"); // E1
    cite(L001_INITIAL_IEP_DOC_ID, 2, "Baseline: 42 WCPM"); // E2
    cite(L001_COMPANIONS.priorIep, 1, "Draft eligibility summary."); // E3
    cite(L001_COMPANIONS.progress, 1, "Reading fluency probe: 51 WCPM."); // E4
    cite(L001_COMPANIONS.evaluation, 1, "Psychoeducational evaluation."); // E5
    cite(L001_COMPANIONS.serviceLog, 1, "Reading intervention sessions delivered: 18."); // E6
    cite(L001_COMPANIONS.notice, 1, "Notice of meeting."); // E7
    cite(L001_COMPANIONS.parentLetter, 1, "Letter from the parent."); // E8

    const records = [
      doc(L001_INITIAL_IEP_DOC_ID, "PRIMARY", "Initial IEP", "The plan the questions are about.", ["E1"]),
      doc(L001_COMPANIONS.priorIep, "SUPPORTING", "Eligibility summary draft", "Earlier screening context.", ["E3"]),
      doc(L001_COMPANIONS.progress, "SUPPORTING", "Progress report", "Later fluency measurement.", ["E4"]),
      doc(L001_COMPANIONS.evaluation, "SUPPORTING", "Psychoeducational evaluation", "Background on reading skills.", ["E5"]),
      doc(L001_COMPANIONS.serviceLog, "SUPPORTING", "Service log", "Records delivered intervention sessions.", ["E6"]),
      doc(L001_COMPANIONS.notice, "REFERENCE", "Meeting notice", "Schedules a review meeting only.", ["E7"]),
      doc(L001_COMPANIONS.parentLetter, "REFERENCE", "Parent letter", "Asks for an update; page 2 not examined.", ["E8"], {
        declaredReadCoverage: "PARTIAL_DOCUMENT_READ",
      }),
      doc(L001_COMPANIONS.blankScan, "UNCERTAIN", "UNDETERMINED", "The scan has no text, so its type cannot be established.", []),
    ];
    for (const record of records) step(target, "record_document", record);
    const finding = (documentId: string, attribute: string, valueAsWritten: string, statement: string, evidenceId: string) =>
      step(target, "record_document_finding", {
        documentId,
        category: "reading_fluency",
        subject: "Oral reading fluency",
        attribute,
        valueAsWritten,
        statement,
        evidenceIds: [evidenceId],
      });
    finding(L001_INITIAL_IEP_DOC_ID, "baseline", "42 WCPM", "The IEP baseline is 42 WCPM.", "E2"); // DF1
    finding(L001_COMPANIONS.progress, "probe", "51 WCPM", "The later probe was 51 WCPM.", "E4"); // DF2
    finding(L001_COMPANIONS.serviceLog, "sessions_delivered", "18", "18 intervention sessions were delivered.", "E6"); // DF3

    step(target, "finish_question", {
      questionId: "P1",
      status: "ANSWERED",
      answer: "The baseline was 42 WCPM and a later probe was 51 WCPM.",
      findingIds: ["DF1", "DF2"],
      uncertainties: [],
      limitations: [],
      evidenceNeeds: [
        { need: "Reading fluency baseline in the IEP", status: "FOUND", findingIds: ["DF1"] },
        { need: "Later reading fluency measurement", status: "FOUND", findingIds: ["DF2"] },
        { need: "Intervention delivered", status: "FOUND", findingIds: ["DF3"] },
      ],
    });
    const result = run(target, "finish_study", {
      coverageNotes: [],
      documentReconciliations: [
        { documentId: L001_INITIAL_IEP_DOC_ID, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF1"] },
        { documentId: L001_COMPANIONS.priorIep, disposition: "NO_MATERIAL_FINDINGS", reason: "Draft screening superseded by the IEP." },
        { documentId: L001_COMPANIONS.progress, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF2"] },
        { documentId: L001_COMPANIONS.evaluation, disposition: "NO_MATERIAL_FINDINGS", reason: "Qualitative background only." },
        { documentId: L001_COMPANIONS.serviceLog, disposition: "MATERIAL_FINDINGS_RECORDED", findingIds: ["DF3"] },
        { documentId: L001_COMPANIONS.notice, disposition: "NO_MATERIAL_FINDINGS", reason: "Scheduling notice with no measurements." },
        { documentId: L001_COMPANIONS.parentLetter, disposition: "UNRESOLVED", reason: "Page 2 was not examined." },
        { documentId: L001_COMPANIONS.blankScan, disposition: "UNRESOLVED", reason: "The scan contains no text." },
      ],
    });
    expect(result).toMatchObject({ ok: true, finished: true, unresolvedDocuments: 2 });
    const allowance = studyAgentAllowance(1, Object.keys(L001_COMPANIONS).length + 1);
    expect(target.toolCalls).toBeLessThanOrEqual(allowance.toolCalls);
    expect(target.invalidCalls).toBe(0);

    const output = target.assemble();
    expect(new Set(output.documents!.map((item) => item.role))).toEqual(new Set(["PRIMARY", "SUPPORTING", "REFERENCE", "UNCERTAIN"]));
    const verified = verifyStudyInvestigation(output, {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: ["P1"],
      pages: pageMap(L001_EIGHT_PAGES),
      requireCorpusReconciliation: true,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const coverage = new Map(verified.value.verification.documentCoverage!.map((item) => [item.sourceDocumentId, item]));
    expect(coverage.size).toBe(8);
    expect(coverage.get(L001_COMPANIONS.parentLetter)).toMatchObject({
      readCoverageStatus: "PARTIAL_PAGES_READ",
      reconciliationDisposition: "UNRESOLVED",
    });
    expect(coverage.get(L001_COMPANIONS.blankScan)).toMatchObject({ reconciliationDisposition: "UNRESOLVED" });
  });
});

describe("V4-004L corpus reconciliation — verifier on hand-built or bypassed output", () => {
  it("rejects missing documents, missing dispositions and forged or cross-document finding references", () => {
    const withoutEmail = finishedGenericOutput();
    withoutEmail.documents = withoutEmail.documents.filter((item) => item.sourceDocumentId !== EMAIL);
    expect(verifyGeneric(withoutEmail)).toMatchObject({ ok: false, diagnosticReason: "study_documents_unrecorded" });

    const unreconciled = finishedGenericOutput();
    delete unreconciled.documents.find((item) => item.sourceDocumentId === EMAIL)!.reconciliation;
    expect(verifyGeneric(unreconciled)).toMatchObject({ ok: false, diagnosticReason: "study_documents_unreconciled" });

    const crossDocument = finishedGenericOutput();
    crossDocument.documents[0]!.reconciliation!.findingIds = ["DF2"];
    expect(verifyGeneric(crossDocument)).toMatchObject({ ok: false, diagnosticReason: "study_finding_other_document" });

    const forged = finishedGenericOutput();
    forged.documents[0]!.reconciliation!.findingIds = ["DF99"];
    expect(verifyGeneric(forged)).toMatchObject({ ok: false, diagnosticReason: "study_finding_ref_invalid" });
  });

  it("rejects a hidden UNRESOLVED document and missing or unsupported evidence needs", () => {
    const hidden = finishedGenericOutput();
    hidden.coverageNotes = [];
    expect(verifyGeneric(hidden)).toMatchObject({ ok: false, diagnosticReason: "study_unresolved_document_hidden" });

    const noNeeds = finishedGenericOutput();
    delete noNeeds.answers[0]!.evidenceNeeds;
    expect(verifyGeneric(noNeeds)).toMatchObject({ ok: false, diagnosticReason: "study_evidence_needs_missing" });

    const unsupported = finishedGenericOutput();
    unsupported.answers[0]!.evidenceNeeds![0]!.findingIds = [];
    expect(verifyGeneric(unsupported)).toMatchObject({ ok: false, diagnosticReason: "study_evidence_need_unsupported" });

    const forgedNeed = finishedGenericOutput();
    forgedNeed.answers[0]!.evidenceNeeds![0]!.findingIds = ["DF77"];
    expect(verifyGeneric(forgedNeed)).toMatchObject({ ok: false, diagnosticReason: "study_finding_ref_invalid" });
  });

  it("keeps historical outputs valid without the flag and rejects them when new-run reconciliation is required", () => {
    const legacyContext = {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: [...MAYA_PLAN_QUESTION_IDS],
      pages: new Map(Object.entries(MAYA_PAGES)),
    };
    expect(verifyStudyInvestigation(mayaStudyOutput(), legacyContext).ok).toBe(true);
    expect(verifyStudyInvestigation(mayaStudyOutput(), { ...legacyContext, requireCorpusReconciliation: true })).toMatchObject({
      ok: false,
      diagnosticReason: "study_evidence_needs_missing",
    });

    // Revision-6-shaped document-centered output: documents and findings, no dispositions or evidence needs
    const target = new StudyAgentLedger({
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
      pages: Object.entries(MAYA_LIN_VARIANT_IEP_PAGES).map(([key, text]) => ({
        sourceDocumentId: key.split(":")[0]!,
        pageNumber: Number(key.split(":")[1]),
        text,
      })),
    });
    for (const turn of mayaLinVariantDocumentCenteredStudyAgentTurns()) for (const item of turn) target.execute(item);
    const revision6 = structuredClone(target.assemble()) as unknown as {
      documents: { reconciliation?: unknown }[];
      answers: { evidenceNeeds?: unknown }[];
      coverageNotes: string[];
    };
    for (const item of revision6.documents) delete item.reconciliation;
    for (const answer of revision6.answers) delete answer.evidenceNeeds;
    const revision6Context = {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: [...MAYA_REVISION_6_PLAN_QUESTION_IDS],
      pages: new Map(Object.entries(MAYA_LIN_VARIANT_IEP_PAGES)),
    };
    const legacy = verifyStudyInvestigation(revision6, revision6Context);
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.value.verification.documentCoverage!.every((item) => item.reconciliationDisposition === undefined)).toBe(true);
    expect(verifyStudyInvestigation(revision6, { ...revision6Context, requireCorpusReconciliation: true }).ok).toBe(false);
  });
});
