/**
 * Maya L001 golden measures. Scripted tool calls through CoordinatedInvestigationLedger,
 * then runInvestigationStudyEngine. No model, no network, no Hive pin.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractText } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CoordinatedInvestigationLedger,
  renderInvestigationWindow,
  selectInvestigationWindows,
} from "../domain-investigation-agent";
import type { AuthorizedDocument } from "../domain-investigation-binder";
import { acceptCanonicalInvestigation, prepareInvestigationStudy, runInvestigationStudyEngine } from "../investigation-study-engine";
import type { DocExtraction, ExtractionFact } from "../extraction-contracts";
import type { DomainPackSource } from "../domain-pack-source";
import type { SupplementalArtifacts } from "../domain-investigation-plan";

const ROOT = join(import.meta.dirname, "../../../../../");
const PACK = join(ROOT, "packs/drafts/iep-us-federal/v0.5.0");
const DOCS = join(ROOT, "eval/corpora/special-ed-l001/docs");
const FILES = [
  "01_initial_referral.pdf",
  "02_evaluation_plan.pdf",
  "03_parent_evaluation_consent.pdf",
  "04_psychoeducational_evaluation.pdf",
  "05_academic_evaluation.pdf",
  "06_speech_language_evaluation.pdf",
  "07_eligibility_determination.pdf",
  "08_initial_iep.pdf",
] as const;

const INTENT = [
  "What is the initial IEP, and when is it in effect?",
  "What did the evaluations find about reading?",
  "What goal, services, and accommodations does the IEP provide?",
  "What progress evidence is in the file, and is the plan current?",
  "What should a parent ask before a meeting?",
].join(" ");

const PROGRESS_UNCERTAINTY = "Progress is not shown by the baseline and the target. Currentness comes from the written effective period. No later measurement was found in the authorized corpus.";
const MEETING_UNCERTAINTY = "What a parent should ask before a meeting stays open.";

type Mapped = {
  id: string;
  golden: string;
  file: string;
  page: number;
  quote: string;
  written: string;
  entityId: string;
  instanceId: string;
  fieldId: string;
  valueType: "TEXT" | "NUMBER" | "DATE" | "QUANTITY";
};

const MAPPED: Mapped[] = [
  { id: "F-iep-type", golden: "G1", file: "08_initial_iep.pdf", page: 1, quote: "Initial Individualized Education Program (IEP)", written: "Initial Individualized Education Program (IEP)", entityId: "entity:iep", instanceId: "iep-doc", fieldId: "iepType", valueType: "TEXT" },
  { id: "F-start", golden: "G2", file: "08_initial_iep.pdf", page: 1, quote: "2024-11-12 through 2025-11-11", written: "2024-11-12", entityId: "entity:iep", instanceId: "iep-doc", fieldId: "effectiveStartDate", valueType: "DATE" },
  { id: "F-end", golden: "G2", file: "08_initial_iep.pdf", page: 1, quote: "2024-11-12 through 2025-11-11", written: "2025-11-11", entityId: "entity:iep", instanceId: "iep-doc", fieldId: "effectiveEndDate", valueType: "DATE" },
  { id: "F-category", golden: "G3", file: "08_initial_iep.pdf", page: 1, quote: "Specific Learning Disability (SLD) - Reading", written: "Specific Learning Disability (SLD) - Reading", entityId: "entity:eligibility-determination", instanceId: "elig", fieldId: "category", valueType: "TEXT" },
  { id: "F-determined", golden: "G3", file: "08_initial_iep.pdf", page: 1, quote: "Determination Date:\n2024-11-01", written: "2024-11-01", entityId: "entity:eligibility-determination", instanceId: "elig", fieldId: "determinationDate", valueType: "DATE" },
  { id: "F-need", golden: "G4", file: "08_initial_iep.pdf", page: 1, quote: "The primary educational need is Reading Fluency", written: "The primary educational need is Reading Fluency", entityId: "entity:present-level", instanceId: "present", fieldId: "statementText", valueType: "TEXT" },
  { id: "F-area", golden: "G4", file: "08_initial_iep.pdf", page: 1, quote: "The primary educational need is Reading Fluency", written: "Reading Fluency", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "area", valueType: "TEXT" },
  { id: "F-baseline", golden: "G5", file: "08_initial_iep.pdf", page: 1, quote: "reading fluency baseline of 42 WCPM", written: "42", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "baselineValue", valueType: "NUMBER" },
  { id: "F-accuracy", golden: "G6", file: "08_initial_iep.pdf", page: 1, quote: "oral reading accuracy of 86%", written: "oral reading accuracy of 86%", entityId: "entity:evaluation-finding", instanceId: "accuracy", fieldId: "findingText", valueType: "TEXT" },
  { id: "F-accuracy-domain", golden: "G6", file: "08_initial_iep.pdf", page: 1, quote: "oral reading accuracy of 86%", written: "reading", entityId: "entity:evaluation-finding", instanceId: "accuracy", fieldId: "domain", valueType: "TEXT" },
  { id: "F-goal", golden: "G7", file: "08_initial_iep.pdf", page: 1, quote: "Maya will read at least 75 words correct per minute", written: "Maya will read at least 75 words correct per minute", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "goalText", valueType: "TEXT" },
  { id: "F-mastery", golden: "G7", file: "08_initial_iep.pdf", page: 1, quote: "at least 95% accuracy across three consecutive probes", written: "at least 95% accuracy across three consecutive probes", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "masteryCriterion", valueType: "TEXT" },
  { id: "F-target", golden: "G7", file: "08_initial_iep.pdf", page: 2, quote: "Target:\n75 WCPM", written: "75", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "targetValue", valueType: "NUMBER" },
  { id: "F-service", golden: "G8", file: "08_initial_iep.pdf", page: 2, quote: "Specialized reading instruction is provided 150 minutes weekly", written: "Specialized reading instruction", entityId: "entity:service", instanceId: "reading", fieldId: "serviceName", valueType: "TEXT" },
  { id: "F-setting", golden: "G8", file: "08_initial_iep.pdf", page: 2, quote: "in the special education setting", written: "special education", entityId: "entity:service", instanceId: "reading", fieldId: "serviceCategory", valueType: "TEXT" },
  { id: "F-frequency", golden: "G8", file: "08_initial_iep.pdf", page: 2, quote: "150 minutes weekly", written: "150 minutes weekly", entityId: "entity:service", instanceId: "reading", fieldId: "frequencyAsWritten", valueType: "TEXT" },
  { id: "F-minutes", golden: "G8", file: "08_initial_iep.pdf", page: 2, quote: "150 minutes weekly", written: "150", entityId: "entity:service", instanceId: "reading-minutes", fieldId: "minutesPerWeek", valueType: "QUANTITY" },
  { id: "F-extended", golden: "G9", file: "08_initial_iep.pdf", page: 2, quote: "Extended time for classroom reading assessments", written: "Extended time for classroom reading assessments", entityId: "entity:accommodation", instanceId: "extended", fieldId: "text", valueType: "TEXT" },
  { id: "F-extended-context", golden: "G9", file: "08_initial_iep.pdf", page: 2, quote: "Extended time for classroom reading assessments", written: "classroom reading assessments", entityId: "entity:accommodation", instanceId: "extended", fieldId: "context", valueType: "TEXT" },
  { id: "F-directions", golden: "G10", file: "08_initial_iep.pdf", page: 2, quote: "Directions read aloud when reading ability is not being assessed", written: "Directions read aloud when reading ability is not being assessed", entityId: "entity:accommodation", instanceId: "directions", fieldId: "text", valueType: "TEXT" },
  { id: "F-directions-context", golden: "G10", file: "08_initial_iep.pdf", page: 2, quote: "Directions read aloud when reading ability is not being assessed", written: "reading ability", entityId: "entity:accommodation", instanceId: "directions", fieldId: "context", valueType: "TEXT" },
  { id: "F-quarterly", golden: "G11", file: "08_initial_iep.pdf", page: 2, quote: "reported quarterly", written: "reported quarterly", entityId: "entity:progress-reporting-plan", instanceId: "progress-plan", fieldId: "reportingFrequencyAsWritten", valueType: "TEXT" },
  { id: "F-speech", golden: "G12", file: "06_speech_language_evaluation.pdf", page: 1, quote: "No separate speech-language educational need is identified from this evaluation", written: "No separate speech-language educational need is identified from this evaluation", entityId: "entity:evaluation-finding", instanceId: "speech", fieldId: "findingText", valueType: "TEXT" },
  { id: "F-speech-domain", golden: "G12", file: "06_speech_language_evaluation.pdf", page: 1, quote: "No separate speech-language educational need is identified from this evaluation", written: "speech-language", entityId: "entity:evaluation-finding", instanceId: "speech", fieldId: "domain", valueType: "TEXT" },
  { id: "F-speech-service", golden: "G12", file: "06_speech_language_evaluation.pdf", page: 1, quote: "No speech-language service is recommended", written: "No speech-language service is recommended", entityId: "entity:evaluation-recommendation", instanceId: "speech-rec", fieldId: "recommendationText", valueType: "TEXT" },
  { id: "F-cognitive", golden: "G13", file: "04_psychoeducational_evaluation.pdf", page: 2, quote: "No global cognitive limitation is identified as the primary explanation", written: "No global cognitive limitation is identified as the primary explanation", entityId: "entity:evaluation-finding", instanceId: "cognitive", fieldId: "findingText", valueType: "TEXT" },
  { id: "F-cognitive-domain", golden: "G13", file: "04_psychoeducational_evaluation.pdf", page: 2, quote: "No global cognitive limitation is identified as the primary explanation", written: "cognitive", entityId: "entity:evaluation-finding", instanceId: "cognitive", fieldId: "domain", valueType: "TEXT" },
  { id: "F-academic", golden: "G14", file: "05_academic_evaluation.pdf", page: 1, quote: "explicit systematic reading instruction", written: "explicit systematic reading instruction", entityId: "entity:evaluation-recommendation", instanceId: "academic-rec", fieldId: "recommendationText", valueType: "TEXT" },
  { id: "F-psych-rec", golden: "G15", file: "04_psychoeducational_evaluation.pdf", page: 2, quote: "Academic assessment of reading achievement and fluency should be completed next", written: "Academic assessment of reading achievement and fluency should be completed next", entityId: "entity:evaluation-recommendation", instanceId: "psych-rec", fieldId: "recommendationText", valueType: "TEXT" },
];

const NEGATIVE = [
  "A prior IEP exists, or this IEP revises, amends or continues an earlier IEP.",
  "Speech-language services are provided.",
  "The speech-language evaluation's negative finding means there is no reading need or no eligibility.",
];

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(PACK, name), "utf8")) as unknown;
}

function fact(row: Mapped): ExtractionFact {
  return {
    id: row.id,
    modelId: row.id,
    category: "record",
    subject: "record",
    attribute: row.written,
    value: row.written,
    valueAsWritten: row.written,
    unit: null,
    per: null,
    timeframe: { from: null, to: null, asWritten: null },
    modality: "stated",
    attributedTo: null,
    aboutPersonRef: null,
    tableContext: null,
    evidence: [{ page: row.page, printedPageLabel: null, quote: row.quote }],
    confidence: "high",
  };
}

function extraction(documentId: string, fileName: string, pages: string[], facts: ExtractionFact[]): DocExtraction {
  return {
    schema: "hive.doc-extraction/1",
    documentId,
    fileName,
    pageRange: null,
    document: {
      titleAsPrinted: fileName,
      documentType: fileName.replace(/\.pdf$/, "").replace(/_/g, " "),
      domain: { label: "record", confidence: null },
      issuer: null,
      aboutPeople: [],
      keyDates: [],
      summary: "",
    },
    facts,
    emptyFields: [],
    referencedDocuments: [],
    glossary: [],
    instructionsIgnored: [],
    coverage: {
      pageCount: pages.length,
      pagesRead: pages.map((_, index) => index + 1),
      pagesBlankOrUnreadable: [],
      truncated: false,
      lastPageCompleted: pages.length,
    },
  };
}

function call(id: string, name: string, args: Record<string, unknown>) {
  return { id, name, arguments: JSON.stringify(args) };
}

function parsed(content: string): { ok: boolean; error?: string; message?: string } {
  return JSON.parse(content) as { ok: boolean; error?: string; message?: string };
}

describe("Maya L001 golden investigation", () => {
  let corpus: { file: string; id: string; pages: string[] }[] = [];
  beforeAll(async () => {
    corpus = await Promise.all(FILES.map(async (file) => ({ file, id: file.slice(0, 2), pages: await pageText(file) })));
  }, 60_000);

  it("reconstructs the golden study and rejects an early finish", () => {
    const prepared = prepareInvestigationStudy({
      packSource: loadJson("iep-domain-pack-source.v0.5.0.json") as DomainPackSource,
      artifacts: {
        ontology: loadJson("iep-domain-ontology-spec.json"),
        authorityRegister: loadJson("iep-domain-authority-register.json"),
        conflictPatterns: loadJson("iep-domain-conflict-patterns.v1.json"),
        stateOverlays: loadJson("iep-domain-state-overlays.v1.json"),
        factClasses: loadJson("iep-domain-fact-classes.v1.json"),
        workflowCoverage: loadJson("iep-domain-workflow-coverage.v1.json"),
        unsupportedOperators: loadJson("iep-domain-unsupported-operators.v1.json"),
      } as SupplementalArtifacts,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.prepared.pack.identity.digest).toBe("2108f8297a240b5daee6d175c2ba6e3699b952613e4b329ff1712d0a25a7a066");

    for (const row of MAPPED) {
      const document = corpus.find((item) => item.file === row.file);
      const text = (document?.pages[row.page - 1] ?? "").replace(/\s+/g, " ");
      expect(text, `${row.id} ${row.file} p${row.page}`).toContain(row.quote.replace(/\s+/g, " "));
    }

    const pages: AuthorizedDocument[] = corpus.map((item) => ({
      documentId: item.id,
      pages: item.pages.map((text, index) => ({ pageNumber: index + 1, text })),
    }));
    const extractions = corpus.map((item) => extraction(
      item.id,
      item.file,
      item.pages,
      MAPPED.filter((row) => row.file === item.file).map(fact),
    ));
    const ledger = new CoordinatedInvestigationLedger("run-l001-golden", prepared.prepared.pack, extractions, pages, INTENT);
    const windows = selectInvestigationWindows({
      plan: prepared.prepared.plan,
      pack: prepared.prepared.pack,
      extractions,
    });
    const firstWindow = renderInvestigationWindow({ window: windows[0]!, extractions, intentText: INTENT });
    expect(firstWindow.intent).toBe(INTENT.slice(0, 2000));
    expect(JSON.stringify(firstWindow.chains)).toContain("chain:CH1");
    expect(JSON.stringify(firstWindow)).not.toContain(pages[0]?.pages[0]?.text ?? "missing-page");

    ledger.armCompletion({ windowCount: windows.length, documentIds: extractions.map((item) => item.documentId) });
    ledger.beginTurn();
    const early = parsed(ledger.execute(call("finish-early", "finish_investigation", { ready: true })).content);
    expect(early.ok).toBe(false);
    expect(early.error).toBe("investigation_incomplete");
    expect(early.message).toContain("window");

    for (const window of windows) {
      const rendered = renderInvestigationWindow({ window, extractions, intentText: INTENT });
      const questions = Array.isArray(rendered.questions) ? rendered.questions : [];
      ledger.presentWindow(window.index, {
        questionIds: questions.flatMap((item) => {
          if (!item || typeof item !== "object" || !("id" in item)) return [];
          const id = (item as { id?: unknown }).id;
          return typeof id === "string" ? [id] : [];
        }),
      });
    }
    const beforeRoles = parsed(ledger.execute(call("finish-roles", "finish_investigation", { ready: true })).content);
    expect(beforeRoles).toMatchObject({ ok: false, error: "investigation_incomplete" });
    expect(beforeRoles.message).toContain("evidence-backed role");

    for (const item of corpus) {
      const text = item.pages.map((page) => page.replace(/\s+/g, " ").trim()).find((page) => page.length >= 20) ?? "";
      const page = item.pages.findIndex((pageText) => pageText.replace(/\s+/g, " ").trim().length >= 20) + 1;
      const quote = item.file === "08_initial_iep.pdf"
        ? "Initial Individualized Education Program (IEP)"
        : text.slice(0, 60);
      const role = ledger.execute(call(`role-${item.id}`, "propose_document_role", {
        documentId: item.id,
        role: item.file === "08_initial_iep.pdf" ? "ANCHOR" : "SUPPORTING",
        page: item.file === "08_initial_iep.pdf" ? 1 : page,
        quote,
      }));
      expect(parsed(role.content).ok, role.content).toBe(true);
    }
    const beforeRead = parsed(ledger.execute(call("finish-anchor", "finish_investigation", { ready: true })).content);
    expect(beforeRead.message).toContain("anchor page");

    const anchor = corpus.find((item) => item.file === "08_initial_iep.pdf");
    if (!anchor) throw new Error("missing anchor");
    for (let start = 1; start <= anchor.pages.length; start += 3) {
      const end = Math.min(anchor.pages.length, start + 2);
      const read = ledger.execute(call(`read-08-${start}`, "read_pages", { documentId: anchor.id, startPage: start, endPage: end }));
      expect(parsed(read.content).ok, read.content).toBe(true);
    }
    const beforeAnswers = parsed(ledger.execute(call("finish-questions", "finish_investigation", { ready: true })).content);
    expect(beforeAnswers.message).toContain("question");

    const questions = prepared.prepared.pack.definitions.filter((definition) => definition.kind === "question");
    questions.forEach((question, index) => {
      if (question.kind !== "question") return;
      const answer = ledger.execute(call(`answer-${index}`, "propose_answer", {
        questionId: question.id,
        audience: question.audience,
        factIds: [],
        uncertainty: "Not answered from the saved evidence in this window.",
      }));
      expect(parsed(answer.content).ok, answer.content).toBe(true);
    });
    const beforeIntent = parsed(ledger.execute(call("finish-intent", "finish_investigation", { ready: true })).content);
    expect(beforeIntent.message).toContain("request");

    for (const row of MAPPED) {
      const documentId = row.file.slice(0, 2);
      const proposed = ledger.execute(call(row.id, "propose_field", {
        documentId,
        extractionFactId: row.id,
        entityId: row.entityId,
        instanceId: row.instanceId,
        fieldId: row.fieldId,
        valueType: row.valueType,
        value: row.written,
      }));
      expect(parsed(proposed.content).ok, `${row.id} ${proposed.content}`).toBe(true);
    }
    expect(parsed(ledger.execute(call("base-role", "propose_measurement", { documentId: "08", extractionFactId: "F-baseline", role: "BASELINE" })).content).ok).toBe(true);
    expect(parsed(ledger.execute(call("target-role", "propose_measurement", { documentId: "08", extractionFactId: "F-target", role: "TARGET" })).content).ok).toBe(true);
    for (const [index, statement] of NEGATIVE.entries()) {
      const assessment = ledger.execute(call(`n${index + 1}`, "propose_assessment", { statement, factIds: ["F-baseline", "F-target"] }));
      expect(parsed(assessment.content).ok, assessment.content).toBe(true);
    }
    expect(parsed(ledger.execute(call("met", "propose_assessment", {
      statement: "The annual goal has been met.",
      factIds: ["F-baseline", "F-target"],
    })).content).ok).toBe(true);
    expect(parsed(ledger.execute(call("n4", "propose_conflict", {
      statement: "The 42 WCPM baseline and the 75 WCPM target contradict each other.",
      factIds: ["F-baseline", "F-target"],
    })).content).ok).toBe(true);
    expect(parsed(ledger.execute(call("meeting", "propose_determination", {
      statement: "What a parent should ask before a meeting is still open.",
    })).content).ok).toBe(true);

    const intentAnswers = [
      { questionId: "intent:1", factIds: ["F-iep-type", "F-start", "F-end"], uncertainty: undefined },
      { questionId: "intent:2", factIds: ["F-accuracy", "F-speech", "F-cognitive"], uncertainty: undefined },
      { questionId: "intent:3", factIds: ["F-goal", "F-frequency", "F-extended", "F-directions"], uncertainty: undefined },
      { questionId: "intent:4", factIds: [], uncertainty: PROGRESS_UNCERTAINTY },
      { questionId: "intent:5", factIds: [], uncertainty: MEETING_UNCERTAINTY },
    ];
    for (const answer of intentAnswers) {
      const result = ledger.execute(call(answer.questionId, "propose_answer", {
        questionId: answer.questionId,
        audience: "customer",
        factIds: answer.factIds,
        ...(answer.uncertainty ? { uncertainty: answer.uncertainty } : {}),
      }));
      expect(parsed(result.content).ok, result.content).toBe(true);
    }

    const finished = parsed(ledger.execute(call("finish-done", "finish_investigation", { ready: true })).content);
    expect(finished.ok, finished.message).toBe(true);
    const assembled = ledger.assemble();
    expect(assembled).not.toBeNull();
    if (!assembled) return;
    const study = runInvestigationStudyEngine({
      prepared: prepared.prepared,
      extractions,
      pages,
      proposal: assembled.proposal,
      investigation: assembled.record,
      studyDate: "2026-11-26",
    });
    expect(study.ok, study.ok ? "" : study.code).toBe(true);
    if (!study.ok) return;

    expect(study.study.documents).toHaveLength(8);
    expect(study.study.documents.filter((document) => document.role === "ANCHOR").map((document) => document.sourceDocumentId)).toEqual(["08"]);
    expect(study.study.documents.every((document) => document.chainPosition === null)).toBe(true);
    expect(study.study.documents.every((document) => document.version === null)).toBe(true);
    expect(study.study.documents.find((document) => document.sourceDocumentId === "08")?.date).toBe("2024-11-12");
    for (const document of study.study.documents) {
      if (document.sourceDocumentId === "08") expect(document.role).toBe("ANCHOR");
      else expect(["SUPPORTING", "REFERENCE"]).toContain(document.role);
    }
    expect(JSON.stringify(study.study.outsideSpine)).not.toContain("has no evidence-backed role");

    const spineFacts = new Set(study.study.spine.filter((item) => item.status === "SUPPORTED").flatMap((item) => item.supportingFactIds));
    for (const golden of ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "G13", "G14", "G15"]) {
      const rows = MAPPED.filter((row) => row.golden === golden && row.valueType !== "QUANTITY");
      expect(rows.some((row) => spineFacts.has(row.id)), golden).toBe(true);
    }
    expect(spineFacts.has("F-minutes")).toBe(false);
    expect(JSON.stringify(study.study.outsideSpine)).toContain("Written value was not converted: 150");
    expect(study.study.spine.some((item) => item.kind === "progress")).toBe(false);
    expect(study.study.spine.some((item) => /has been met/i.test(item.label))).toBe(false);
    const supported = study.study.spine.map((item) => item.label).join("\n");
    for (const statement of NEGATIVE) expect(supported).not.toContain(statement);
    expect(supported).not.toContain("contradict each other");
    expect(study.study.conflicts).toEqual([]);
    expect(JSON.stringify(study.study.outsideSpine)).toContain(PROGRESS_UNCERTAINTY);
    expect(JSON.stringify(study.study.outsideSpine)).toContain(MEETING_UNCERTAINTY);
    expect(JSON.stringify(study.study.outsideSpine)).toContain("Open for a professional");
    expect(study.study.gaps).toEqual([]);
    expect(study.study.documents.every((document) => document.classification === "QUOTED")).toBe(true);
    expect(study.study.checklist?.some((item) => item.verdict === "NOT_ASSESSED")).toBe(true);
    expect(study.study.checklist?.find((item) => item.checkId === "check:T2")?.verdict).toBe("NOT_ASSESSED");
    expect(study.study.chains).toHaveLength(7);
    for (const chain of study.study.chains ?? []) {
      expect(chain.rows.length).toBeGreaterThan(0);
      expect(chain.rows[0]?.links.length).toBeGreaterThan(0);
      for (const link of chain.rows[0]?.links ?? []) expect(link).toEqual({ unresolved: true });
    }
    expect(study.completeness.complete, study.completeness.unfinished.join(", ")).toBe(true);
    expect(acceptCanonicalInvestigation(study)).toEqual({ ok: true, study: study.study });
    expect(study.study.spineSource).toBe("ANCHOR");
  });
});

async function pageText(file: string): Promise<string[]> {
  const bytes = new Uint8Array(readFileSync(join(DOCS, file)));
  const extracted = await extractText(bytes, { mergePages: false });
  return extracted.text;
}
