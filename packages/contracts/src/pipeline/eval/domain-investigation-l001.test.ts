/**
 * Synthetic L001 corpus through the coordinated investigation ledger and the study engine.
 * Field ids below are the shipped pack's data. The engine does not special-case them.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CoordinatedInvestigationLedger } from "../domain-investigation-agent";
import type { AuthorizedDocument } from "../domain-investigation-binder";
import { compileDomainPack } from "../domain-pack-compiler";
import { prepareInvestigationStudy, runInvestigationStudyEngine } from "../investigation-study-engine";
import type { DocExtraction, ExtractionFact } from "../extraction-contracts";
import type { DomainPackSource } from "../domain-pack-source";
import type { SupplementalArtifacts } from "../domain-investigation-plan";

const ROOT = join(import.meta.dirname, "../../../../../");
const PACK = join(ROOT, "packs/drafts/iep-us-federal/v0.4.0");
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

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(PACK, name), "utf8")) as unknown;
}

function pageText(file: string): string[] {
  const script = "import json,pymupdf,sys; doc=pymupdf.open(sys.argv[1]); print(json.dumps([page.get_text('text') for page in doc]))";
  const raw = execFileSync("python", ["-c", script, join(DOCS, file)], { encoding: "utf8" });
  return JSON.parse(raw) as string[];
}

function fact(id: string, written: string, page: number, quote: string): ExtractionFact {
  return {
    id,
    modelId: id,
    category: "record",
    subject: "record",
    attribute: written,
    value: written,
    valueAsWritten: written,
    unit: null,
    per: null,
    timeframe: { from: null, to: null, asWritten: null },
    modality: "stated",
    attributedTo: null,
    aboutPersonRef: null,
    tableContext: null,
    evidence: [{ page, printedPageLabel: null, quote }],
    confidence: "high",
  };
}

function extraction(documentId: string, fileName: string, pages: string[], facts: ExtractionFact[], referenced: DocExtraction["referencedDocuments"] = []): DocExtraction {
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
    referencedDocuments: referenced,
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

describe("synthetic L001 coordinated investigation", () => {
  const corpus = FILES.map((file) => ({ file, id: file.slice(0, 2), pages: pageText(file) }));
  const textOf = (file: string) => corpus.find((item) => item.file === file)?.pages.join("\n") ?? "";
  const prepared = prepareInvestigationStudy({
    packSource: loadJson("iep-domain-pack-source.v0.4.0.json") as DomainPackSource,
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

  it("reads the golden quotes from the eight synthetic PDFs", () => {
    const golden = JSON.parse(readFileSync(join(ROOT, "eval/corpora/special-ed-l001/golden.json"), "utf8")) as {
      anchorDocument: string;
      spine: { evidence: { file: string; quoteFragment: string }[] }[];
      negativeControls: { statement: string }[];
    };
    expect(golden.anchorDocument).toBe("08_initial_iep.pdf");
    for (const item of golden.spine) {
      for (const evidence of item.evidence) {
        expect(textOf(evidence.file).replace(/\s+/g, " ")).toContain(evidence.quoteFragment.replace(/\s+/g, " "));
      }
    }
    expect(golden.negativeControls.length).toBeGreaterThan(0);
  });

  it("assembles a source-backed study and refuses invented progress", () => {
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const iep = textOf("08_initial_iep.pdf");
    const pages: AuthorizedDocument[] = corpus.map((item) => ({
      documentId: item.id,
      pages: item.pages.map((text, index) => ({ pageNumber: index + 1, text })),
    }));
    const extractions: DocExtraction[] = corpus.map((item) => {
      if (item.file !== "08_initial_iep.pdf" && item.file !== "06_speech_language_evaluation.pdf") {
        return extraction(item.id, item.file, item.pages, []);
      }
      if (item.file === "06_speech_language_evaluation.pdf") {
        return extraction(item.id, item.file, item.pages, [
          fact("F-speech", "No separate speech-language educational need is identified from this evaluation", 1, "No separate speech-language educational need is identified from this evaluation"),
        ]);
      }
      return extraction(item.id, item.file, item.pages, [
        fact("F-name", "Maya Carter", 1, "Student:\nMaya Carter"),
        fact("F-category", "Specific Learning Disability (SLD) - Reading", 1, "Specific Learning Disability (SLD) - Reading"),
        fact("F-eligible-date", "2024-11-01", 1, "Determination Date:\n2024-11-01"),
        fact("F-baseline", "42", 2, "Baseline:\n42 WCPM"),
        fact("F-target", "75", 2, "Target:\n75 WCPM"),
        fact("F-area", "Reading Fluency", 1, "Reading Fluency"),
        fact("F-goal", "75 WCPM", 3, "The annual goal targets 75 WCPM"),
        fact("F-service", "Specialized reading instruction", 2, "Specialized reading instruction is provided 150 minutes weekly"),
        fact("F-setting", "special education", 2, "in the special education setting"),
        fact("F-extended", "Extended time for classroom reading assessments", 2, "Extended time for classroom reading assessments"),
        fact("F-directions", "Directions read aloud when reading ability is not being assessed", 2, "Directions read aloud when reading ability is not being assessed"),
      ], [{
        id: "R-progress",
        modelId: null,
        description: "IEP progress report",
        date: null,
        page: 2,
        quote: "reported quarterly",
      }]);
    });
    const ledger = new CoordinatedInvestigationLedger("run-l001", prepared.prepared.pack, extractions, pages, "Should the family schedule a dentist visit before signing?");
    const iepId = "08";
    const proposals = [
      call("name", "propose_field", { documentId: iepId, extractionFactId: "F-name", entityId: "entity:student", instanceId: "maya", fieldId: "displayName", valueType: "TEXT", value: "Maya Carter" }),
      call("category", "propose_field", { documentId: iepId, extractionFactId: "F-category", entityId: "entity:eligibility-determination", instanceId: "elig", fieldId: "category", valueType: "TEXT", value: "Specific Learning Disability (SLD) - Reading" }),
      call("elig-date", "propose_field", { documentId: iepId, extractionFactId: "F-eligible-date", entityId: "entity:eligibility-determination", instanceId: "elig", fieldId: "determinationDate", valueType: "DATE", value: "2024-11-01" }),
      call("area", "propose_field", { documentId: iepId, extractionFactId: "F-area", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "area", valueType: "TEXT", value: "Reading Fluency" }),
      call("goal", "propose_field", { documentId: iepId, extractionFactId: "F-goal", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "goalText", valueType: "TEXT", value: "75 WCPM" }),
      call("baseline", "propose_field", { documentId: iepId, extractionFactId: "F-baseline", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "baselineValue", valueType: "NUMBER", value: "42" }),
      call("target", "propose_field", { documentId: iepId, extractionFactId: "F-target", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "targetValue", valueType: "NUMBER", value: "75" }),
      call("service", "propose_field", { documentId: iepId, extractionFactId: "F-service", entityId: "entity:service", instanceId: "reading", fieldId: "serviceName", valueType: "TEXT", value: "Specialized reading instruction" }),
      call("setting", "propose_field", { documentId: iepId, extractionFactId: "F-setting", entityId: "entity:service", instanceId: "reading", fieldId: "serviceCategory", valueType: "TEXT", value: "special education" }),
      call("extended", "propose_field", { documentId: iepId, extractionFactId: "F-extended", entityId: "entity:accommodation", instanceId: "extended", fieldId: "text", valueType: "TEXT", value: "Extended time for classroom reading assessments" }),
      call("extended-context", "propose_field", { documentId: iepId, extractionFactId: "F-directions", entityId: "entity:accommodation", instanceId: "extended", fieldId: "context", valueType: "TEXT", value: "Directions read aloud when reading ability is not being assessed" }),
      call("base-role", "propose_measurement", { documentId: iepId, extractionFactId: "F-baseline", role: "BASELINE" }),
      call("target-role", "propose_measurement", { documentId: iepId, extractionFactId: "F-target", role: "TARGET" }),
      call("bad-role", "propose_measurement", { documentId: iepId, extractionFactId: "F-baseline", role: "ACTUAL" }),
      call("invented", "propose_field", { documentId: iepId, extractionFactId: "F-baseline", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "baselineValue", valueType: "NUMBER", value: "90" }),
      call("met", "propose_assessment", { statement: "The annual goal has been met.", factIds: ["F-baseline", "F-target"] }),
      call("false-conflict", "propose_conflict", { statement: "The baseline and the target contradict each other.", factIds: ["F-baseline", "F-target"] }),
      call("open", "propose_determination", { statement: "Whether the services are appropriate is a professional decision." }),
      call("anchor", "propose_document_role", { documentId: iepId, role: "ANCHOR", page: 1, quote: "Initial Individualized Education Program (IEP)" }),
      call("bad-anchor", "propose_document_role", { documentId: iepId, role: "ANCHOR", page: 1, quote: "This sentence was not written on the page." }),
    ];
    ledger.beginTurn();
    const results = proposals.map((proposal) => ledger.execute(proposal));
    expect(JSON.parse(results.find((item) => item.toolCallId === "baseline")?.content ?? "{}").ok).toBe(true);
    expect(JSON.parse(results.find((item) => item.toolCallId === "bad-role")?.content ?? "{}").ok).toBe(false);
    expect(JSON.parse(results.find((item) => item.toolCallId === "invented")?.content ?? "{}").error).toBe("invented_value");
    expect(JSON.parse(results.find((item) => item.toolCallId === "bad-anchor")?.content ?? "{}").error).toBe("quote_not_on_page");
    const finished = ledger.execute(call("done", "finish_investigation", { ready: true }));
    expect(JSON.parse(finished.content).ok).toBe(true);
    const assembled = ledger.assemble();
    expect(assembled).not.toBeNull();
    if (!assembled) return;
    const study = runInvestigationStudyEngine({
      prepared: prepared.prepared,
      extractions,
      pages,
      proposal: assembled.proposal,
      investigation: assembled.record,
      studyDate: "2026-11-25",
    });
    expect(study.ok).toBe(true);
    if (!study.ok) return;
    expect(study.study.documents).toHaveLength(8);
    expect(study.study.documents.find((document) => document.sourceDocumentId === iepId)).toMatchObject({ role: "ANCHOR" });
    expect(study.study.spineSource).toBe("ANCHOR");
    const labels = study.study.spine.map((item) => item.label).join("\n");
    expect(labels).toContain("Baseline:");
    expect(labels).toContain("42");
    expect(labels).toContain("Target:");
    expect(labels).toContain("75");
    expect(labels).toContain("Specific Learning Disability (SLD) - Reading");
    expect(labels).toContain("Specialized reading instruction");
    expect(labels).toContain("Extended time for classroom reading assessments");
    expect(study.study.spine.some((item) => /has been met/i.test(item.label))).toBe(false);
    expect(JSON.stringify(study.study.outsideSpine)).toContain("No subsequent measurement supports a progress conclusion");
    expect(study.study.conflicts).toEqual([]);
    expect(JSON.stringify(study.study.outsideSpine)).toContain("not two values of the same field");
    expect(JSON.stringify(study.study.outsideSpine)).toContain("Open for a professional");
    expect(JSON.stringify(study.study.outsideSpine)).toContain("No separate speech-language educational need");
    expect(JSON.stringify(study.study.outsideSpine)).toContain("dentist");
    const missingDocument = study.study.gaps.find((gap) => gap.kind === "REQUESTABLE_DOCUMENT");
    const missingInformation = study.study.gaps.find((gap) => gap.kind === "OBSERVATION");
    expect(missingDocument?.title.toLowerCase()).toContain("progress");
    expect(missingInformation?.statement).toContain("Missing information");
    expect(study.study.checklist?.some((item) => item.verdict === "NOT_ASSESSED")).toBe(true);
    expect(study.study.checklist?.every((item) => item.verdict !== "SHOWN" && item.verdict !== "NOT_SHOWN")).toBe(true);
    expect(study.study.checklist?.every((item) => item.note.includes("not a legal conclusion"))).toBe(true);
    expect(study.study.spine.some((item) => item.kind === "progress" || item.kind === "calculation" || item.kind === "relationship")).toBe(false);
    expect(JSON.stringify(study.study.outsideSpine)).toContain("was not published");
    for (const item of study.study.checklist ?? []) {
      if (item.verdict === "SHOWN" || item.verdict === "CONFLICT" || item.verdict === "PARTLY_SHOWN") {
        expect(item.factIds.length).toBeGreaterThan(0);
      }
    }
    const audiences = new Set(study.study.personaCoverage?.map((item) => item.audience));
    expect(audiences.has("customer")).toBe(true);
    expect(audiences.has("professional")).toBe(true);
    expect(iep).toContain("Initial Individualized Education Program (IEP)");
  });

  it("keeps the v0.4.0 digest and publishes only source-supported v0.5.0 results", () => {
    const preserved = compileDomainPack(loadJson("iep-domain-pack-source.v0.4.0.json"));
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;
    expect(preserved.value.identity.digest).toBe("809565eb3826b773aec305010d8e8ac7ce7bf022875ab10e977c17608bdddf0f");
    const root = join(ROOT, "packs/drafts/iep-us-federal/v0.5.0");
    const read = (name: string) => JSON.parse(readFileSync(join(root, name), "utf8")) as unknown;
    const next = prepareInvestigationStudy({
      packSource: read("iep-domain-pack-source.v0.5.0.json") as DomainPackSource,
      artifacts: {
        ontology: read("iep-domain-ontology-spec.json"),
        authorityRegister: read("iep-domain-authority-register.json"),
        conflictPatterns: read("iep-domain-conflict-patterns.v1.json"),
        stateOverlays: read("iep-domain-state-overlays.v1.json"),
        factClasses: read("iep-domain-fact-classes.v1.json"),
        workflowCoverage: read("iep-domain-workflow-coverage.v1.json"),
        unsupportedOperators: read("iep-domain-unsupported-operators.v1.json"),
      } as SupplementalArtifacts,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.prepared.pack.identity.digest).toBe("2108f8297a240b5daee6d175c2ba6e3699b952613e4b329ff1712d0a25a7a066");
    const checks = next.prepared.pack.definitions.filter((definition) => definition.kind === "check");
    expect(checks).toHaveLength(67);
    const executable = checks.filter((definition) => definition.kind === "check" && definition.criterion.op !== "REVIEW_REQUIRED").map((definition) => definition.id).sort();
    expect(executable).toEqual(["check:A3", "check:G2", "check:S1"]);
    const pages: AuthorizedDocument[] = corpus.map((item) => ({
      documentId: item.id,
      pages: item.pages.map((text, index) => ({ pageNumber: index + 1, text })),
    }));
    const iep = corpus.find((item) => item.file === "08_initial_iep.pdf");
    if (!iep) throw new Error("missing iep");
    const extractions: DocExtraction[] = corpus.map((item) => item.file === "08_initial_iep.pdf"
      ? extraction(item.id, item.file, item.pages, [
        fact("F-eligible-date", "2024-11-01", 1, "Determination Date:\n2024-11-01"),
        fact("F-baseline", "42", 2, "Baseline:\n42 WCPM"),
        fact("F-target", "75", 2, "Target:\n75 WCPM"),
      ])
      : extraction(item.id, item.file, item.pages, []));
    const ledger = new CoordinatedInvestigationLedger("run-l001-v5", next.prepared.pack, extractions, pages, "What should the family ask the school?");
    const proposals = [
      call("elig-date", "propose_field", { documentId: "08", extractionFactId: "F-eligible-date", entityId: "entity:eligibility-determination", instanceId: "elig", fieldId: "determinationDate", valueType: "DATE", value: "2024-11-01" }),
      call("baseline", "propose_field", { documentId: "08", extractionFactId: "F-baseline", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "baselineValue", valueType: "NUMBER", value: "42" }),
      call("target", "propose_field", { documentId: "08", extractionFactId: "F-target", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "targetValue", valueType: "NUMBER", value: "75" }),
      call("met", "propose_assessment", { statement: "The annual goal has been met.", factIds: ["F-baseline", "F-target"] }),
      call("done", "finish_investigation", { ready: true }),
    ];
    ledger.beginTurn();
    for (const proposal of proposals) ledger.execute(proposal);
    const assembled = ledger.assemble();
    expect(assembled).not.toBeNull();
    if (!assembled) return;
    const study = runInvestigationStudyEngine({
      prepared: next.prepared,
      extractions,
      pages,
      proposal: assembled.proposal,
      investigation: assembled.record,
      studyDate: "2026-11-25",
    });
    expect(study.ok).toBe(true);
    if (!study.ok) return;
    expect(study.study.spine.some((item) => item.kind === "calculation" && item.label.includes("2027-11-01"))).toBe(true);
    expect(study.study.spine.some((item) => item.kind === "relationship")).toBe(false);
    expect(study.study.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ date: "2024-11-01", factIds: ["F-eligible-date"] })]));
    expect(study.study.spine.some((item) => /has been met/i.test(item.label))).toBe(false);
    expect(JSON.stringify(study.study.outsideSpine)).toContain("No subsequent measurement supports a progress conclusion");
    expect(study.study.checklist?.some((item) => item.verdict === "NOT_ASSESSED")).toBe(true);
    expect(study.study.checklist?.find((item) => item.checkId === "check:T2")?.verdict).toBe("NOT_ASSESSED");
    expect(study.study.checklist?.find((item) => item.checkId === "check:G2")?.verdict).toBe("NOT_SHOWN");
    expect(study.study.checklist?.find((item) => item.checkId === "check:G2")?.factIds).toEqual(["F-baseline", "F-target"]);
    expect(study.study.gaps.length).toBeGreaterThan(0);
    expect(JSON.stringify(study.study.outsideSpine)).toContain("What should the family ask the school?");
    const audiences = new Set(study.study.personaCoverage?.map((item) => item.audience));
    expect(audiences.has("customer")).toBe(true);
    expect(audiences.has("professional")).toBe(true);
    const golden = JSON.parse(readFileSync(join(ROOT, "eval/corpora/special-ed-l001/golden.json"), "utf8")) as { negativeControls: { statement: string }[] };
    const supported = study.study.spine.map((item) => item.label).join("\n");
    for (const control of golden.negativeControls) expect(supported).not.toContain(control.statement);
  });
});
