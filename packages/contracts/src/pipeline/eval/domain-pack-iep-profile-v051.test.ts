/**
 * v0.5.1 profile draft. Objectives live on the personas.
 * Synthetic Maya is the L001 corpus. No model call.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDomainPack } from "../domain-pack-compiler";
import { assignInvestigationObligations, type InvestigationObligation, type SupplementalArtifacts } from "../domain-investigation-plan";
import { prepareInvestigationStudy } from "../investigation-study-engine";
import type { DomainPackSource, PackDefinition, PackPersonaObjective } from "../domain-pack-source";

const ROOT = join(import.meta.dirname, "../../../../../");
const V050 = join(ROOT, "packs/drafts/iep-us-federal/v0.5.0");
const V051 = join(ROOT, "packs/drafts/iep-us-federal/v0.5.1");
const DOCS = join(ROOT, "eval/corpora/special-ed-l001/docs");
const PUBLISHED_DIGEST = "2108f8297a240b5daee6d175c2ba6e3699b952613e4b329ff1712d0a25a7a066";

const MAYA_PRESENT_DOCUMENTS = [
  "document:referral-or-request-for-evaluation",
  "document:signed-consent-to-evaluate",
  "document:evaluation-report",
  "document:eligibility-determination",
  "document:iep",
];

function load(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
}

function artifacts(dir: string): SupplementalArtifacts {
  return {
    ontology: load(dir, "iep-domain-ontology-spec.json"),
    authorityRegister: load(dir, "iep-domain-authority-register.json"),
    conflictPatterns: load(dir, "iep-domain-conflict-patterns.v1.json"),
    stateOverlays: load(dir, "iep-domain-state-overlays.v1.json"),
    factClasses: load(dir, "iep-domain-fact-classes.v1.json"),
    workflowCoverage: load(dir, "iep-domain-workflow-coverage.v1.json"),
    unsupportedOperators: load(dir, "iep-domain-unsupported-operators.v1.json"),
  };
}

const previous = load(V050, "iep-domain-pack-source.v0.5.0.json") as DomainPackSource;
const source = load(V051, "iep-domain-pack-source.v0.5.1.json") as DomainPackSource;
const compiledPrevious = compileDomainPack(previous);
const compiled = compileDomainPack(source);
if (!compiledPrevious.ok || !compiled.ok) throw new Error("profile draft did not compile");
const pack = compiled.value;
const byId = new Map(pack.definitions.map((definition) => [definition.id, definition]));

function personaObjectives(audience: "customer" | "professional"): PackPersonaObjective[] {
  const persona = byId.get("persona:" + audience);
  if (persona?.kind !== "persona" || !persona.objectives) return [];
  return persona.objectives;
}

function sectionShape(definitions: readonly PackDefinition[], reportId: string): string[] {
  const report = definitions.find((definition) => definition.id === reportId);
  if (!report || report.kind !== "report") return [];
  return report.sections.map((section) => section.id + "|" + section.heading + "|" + section.blocks.join(","));
}

const prepared = prepareInvestigationStudy({ packSource: source, artifacts: artifacts(V051) });
if (!prepared.ok) throw new Error(prepared.code);
const plan = prepared.prepared.plan;
const objectives = plan.obligations;

describe("IEP profile draft v0.5.1", () => {
  it("leaves the published 0.5.0 edition and its digest unchanged", () => {
    expect(compiledPrevious.value.identity.version).toBe("0.5.0");
    expect(compiledPrevious.value.identity.digest).toBe(PUBLISHED_DIGEST);
    const catalog = load(join(ROOT, "packs/published"), "domain-pack-catalog.json") as { editions: { version: string; directory: string }[] };
    expect(catalog.editions.map((edition) => edition.version + " " + edition.directory)).toEqual([
      "0.5.0 drafts/iep-us-federal/v0.5.0",
      "0.5.1 drafts/iep-us-federal/v0.5.1",
    ]);
    for (const audience of ["customer", "professional"] as const) {
      const persona = compiledPrevious.value.definitions.find((definition) => definition.id === "persona:" + audience);
      expect(persona?.kind === "persona" ? persona.objectives : ["present"]).toBeUndefined();
    }
    const previousPlan = prepareInvestigationStudy({ packSource: previous, artifacts: artifacts(V050) });
    expect(previousPlan.ok).toBe(true);
    if (!previousPlan.ok) return;
    expect(previousPlan.prepared.plan.obligations).toEqual([]);
    expect(pack.identity.version).toBe("0.5.1");
    expect(pack.identity.digest).not.toBe(PUBLISHED_DIGEST);
    expect(pack.publication).toBe("UNPUBLISHED");
  });

  it("compiles both profiles into the pack and the investigation plan", () => {
    expect(plan.pack.version).toBe("0.5.1");
    expect(personaObjectives("customer")).toHaveLength(11);
    expect(personaObjectives("professional")).toHaveLength(14);
    expect(objectives.map((item) => item.audience + ":" + item.objectiveId).sort()).toEqual(
      [...personaObjectives("customer"), ...personaObjectives("professional")].map((item) => {
        const audience = item.id.startsWith("objective:customer:") ? "customer" : "professional";
        return audience + ":" + item.id;
      }).sort(),
    );
    expect(new Set(objectives.map((item) => item.objectiveId)).size).toBe(25);
    expect(objectives.filter((item) => item.role === "REPORT")).toHaveLength(11);
    expect(objectives.filter((item) => item.role === "INVESTIGATE")).toHaveLength(14);
    const previousIds = new Set(compiledPrevious.value.definitions.map((definition) => definition.id));
    const added = pack.definitions.map((definition) => definition.id).filter((id) => !previousIds.has(id)).sort();
    expect(added).toEqual(["guideline:profile-conditional-activation", "guideline:profile-no-signature-advice"]);
    expect(pack.definitions.filter((definition) => definition.kind === "check")).toHaveLength(67);
    expect(pack.definitions.filter((definition) => definition.kind === "workflow")).toHaveLength(0);
    for (const reportId of ["report:customer", "report:professional"]) {
      expect(sectionShape(pack.definitions, reportId)).toEqual(sectionShape(compiledPrevious.value.definitions, reportId));
    }
    const questions = new Map(pack.definitions.filter((definition) => definition.kind === "question").map((definition) => [definition.id, definition]));
    for (const definition of compiledPrevious.value.definitions) {
      if (definition.kind !== "question") continue;
      const next = questions.get(definition.id);
      expect(next && next.kind === "question" ? next.text : "").toBe(definition.text);
      expect(next && next.kind === "question" ? next.appliesWhen : null).toEqual(definition.appliesWhen);
    }
    for (const audience of ["customer", "professional"] as const) {
      const before = compiledPrevious.value.definitions.find((definition) => definition.id === "persona:" + audience);
      const after = byId.get("persona:" + audience);
      expect(before?.kind === "persona" ? before.questionIds : []).toEqual(after?.kind === "persona" ? after.questionIds : ["missing"]);
    }
  });

  it("keeps the prior-IEP condition on the objective and leaves the question unchanged", () => {
    const prior = objectives.find((item) => item.objectiveId === "objective:customer:prior-iep-changes");
    expect(prior?.applicability).toBe("CONDITIONAL");
    expect(prior?.appliesWhen).toEqual({
      op: "ANY",
      conditions: [
        { op: "DOCUMENT_PRESENT", documentKindId: "document:prior-iep" },
        { op: "DOCUMENT_PRESENT", documentKindId: "document:iep-amendment" },
      ],
    });
    const question = byId.get("question:customer:L3");
    expect(question?.kind === "question" ? question.appliesWhen : null).toEqual({ op: "REVIEW_REQUIRED" });
  });

  it("rejects a question field and broken objective references", () => {
    const investigated = structuredClone(source);
    const question = investigated.definitions.find((definition) => definition.id === "question:customer:L1");
    if (!question || question.kind !== "question") throw new Error("missing L1");
    (question as { investigates?: string[] }).investigates = ["check:E2"];
    const rejectedQuestion = compileDomainPack(investigated);
    expect(rejectedQuestion.ok).toBe(false);
    if (!rejectedQuestion.ok) expect(rejectedQuestion.issues.some((issue) => issue.code === "unknown_field")).toBe(true);

    const missingCheck = structuredClone(source);
    const customer = missingCheck.definitions.find((definition) => definition.id === "persona:customer");
    const eligibility = customer?.kind === "persona" ? customer.objectives?.find((item) => item.id === "objective:customer:eligibility-and-needs") : undefined;
    if (!eligibility) throw new Error("missing eligibility objective");
    eligibility.definitionIds = [...eligibility.definitionIds, "check:missing"];
    const rejectedCheck = compileDomainPack(missingCheck);
    expect(rejectedCheck.ok).toBe(false);
    if (!rejectedCheck.ok) expect(rejectedCheck.issues.some((issue) => issue.code === "objective_reference_missing" && issue.message.includes("check:missing"))).toBe(true);

    const wrongSection = structuredClone(source);
    const customerAgain = wrongSection.definitions.find((definition) => definition.id === "persona:customer");
    const needs = customerAgain?.kind === "persona" ? customerAgain.objectives?.find((item) => item.id === "objective:customer:eligibility-and-needs") : undefined;
    if (!needs) throw new Error("missing eligibility objective");
    needs.reportSectionIds = [...needs.reportSectionIds, "section:checklist"];
    const rejectedSection = compileDomainPack(wrongSection);
    expect(rejectedSection.ok).toBe(false);
    if (!rejectedSection.ok) expect(rejectedSection.issues.some((issue) => issue.code === "objective_reference_missing" && issue.message.includes("section:checklist"))).toBe(true);

    const outsideBranch = structuredClone(source);
    const professional = outsideBranch.definitions.find((definition) => definition.id === "persona:professional");
    const evaluation = professional?.kind === "persona" ? professional.objectives?.find((item) => item.id === "objective:professional:evaluation-eligibility-review") : undefined;
    const branch = evaluation?.branches?.find((item) => item.id === "sld-documentation");
    if (!branch) throw new Error("missing SLD branch");
    branch.definitionIds = [...branch.definitionIds, "check:G1"];
    const rejectedBranch = compileDomainPack(outsideBranch);
    expect(rejectedBranch.ok).toBe(false);
    if (!rejectedBranch.ok) expect(rejectedBranch.issues.some((issue) => issue.code === "objective_reference_missing")).toBe(true);
  });

  it("assigns customer and professional obligations without new investigation tasks", () => {
    const taskIds = new Set(plan.tasks.map((task) => task.taskId));
    expect(plan.tasks.some((task) => task.definitionId.startsWith("objective:"))).toBe(false);
    const stripped = structuredClone(source);
    for (const definition of stripped.definitions) {
      if (definition.kind === "persona") delete definition.objectives;
    }
    const withoutObjectives = prepareInvestigationStudy({ packSource: stripped, artifacts: artifacts(V051) });
    expect(withoutObjectives.ok).toBe(true);
    if (!withoutObjectives.ok) return;
    expect(withoutObjectives.prepared.plan.tasks.map((task) => task.taskId).sort()).toEqual(plan.tasks.map((task) => task.taskId).sort());
    expect(withoutObjectives.prepared.plan.obligations).toEqual([]);

    const customerQuestions = new Set(personaObjectives("customer").flatMap((item) => item.questionIds));
    const professionalQuestions = new Set(personaObjectives("professional").flatMap((item) => item.questionIds));
    expect([...customerQuestions].sort()).toEqual([
      "question:customer:L1", "question:customer:L2", "question:customer:L3", "question:customer:L4", "question:customer:L5",
    ]);
    expect([...professionalQuestions].sort()).toEqual([
      "question:professional:L1", "question:professional:L2", "question:professional:L3", "question:professional:L4",
      "question:professional:L5", "question:professional:L6", "question:professional:L7",
    ]);
    for (const item of objectives) {
      expect(item.personaId).toBe("persona:" + item.audience);
      expect(item.reportId).toBe("report:" + item.audience);
      expect(item.limits?.toLowerCase()).toContain("no legal conclusion");
      expect(item.evidenceStatement.length).toBeGreaterThan(20);
      for (const taskId of item.linkedTaskIds) expect(taskIds.has(taskId)).toBe(true);
      const report = byId.get(item.reportId ?? "");
      const sections = new Set(report?.kind === "report" ? report.sections.map((section) => section.id) : []);
      for (const sectionId of item.reportSectionIds) expect(sections.has(sectionId)).toBe(true);
      if (item.role === "REPORT") expect(plan.tasks.some((task) => task.taskId === "task:" + item.objectiveId)).toBe(false);
    }
    const byWindow = new Map<string, InvestigationObligation[]>();
    for (const item of objectives) {
      const rows = byWindow.get(item.window) ?? [];
      rows.push(item);
      byWindow.set(item.window, rows);
    }
    expect(byWindow.get("customer-eligibility")?.some((item) => item.questionIds.includes("question:customer:L1"))).toBe(true);
    expect(byWindow.get("customer-plan")?.some((item) => item.definitionIds.includes("check:G1"))).toBe(true);
    expect(byWindow.get("professional-procedure")?.some((item) => item.definitionIds.includes("chain:CH4") && item.definitionIds.includes("calculation:C1"))).toBe(true);
    expect(byWindow.get("professional-evaluation")?.some((item) => item.definitionIds.includes("check:E4"))).toBe(true);
    expect(byWindow.get("professional-provision")?.some((item) => item.definitionIds.includes("chain:CH2"))).toBe(true);
    expect(byWindow.get("professional-progress")?.some((item) => item.definitionIds.includes("calculation:C13"))).toBe(true);
    const professionalWork = byWindow.get("professional-work") ?? [];
    const professionalSections = new Set(professionalWork.flatMap((item) => item.reportSectionIds));
    for (const sectionId of ["section:checklist", "section:chronology", "section:document-requests", "section:meeting-agenda", "section:coverage-and-caveats"]) {
      expect(professionalSections.has(sectionId)).toBe(true);
    }
    const customerSections = new Set(objectives.filter((item) => item.audience === "customer").flatMap((item) => item.reportSectionIds));
    for (const sectionId of ["section:checklist", "section:chronology", "section:points-to-raise", "section:coverage-and-caveats"]) {
      expect(customerSections.has(sectionId)).toBe(false);
    }
    const customerIds = new Set(objectives.filter((item) => item.audience === "customer").flatMap((item) => item.definitionIds));
    const professionalIds = new Set(objectives.filter((item) => item.audience === "professional" && item.role === "INVESTIGATE").flatMap((item) => item.definitionIds));
    expect([...professionalIds].filter((id) => !customerIds.has(id)).length).toBeGreaterThan(15);
    expect(objectives.filter((item) => item.role === "REPORT" && item.audience === "professional")).toHaveLength(9);
    expect(objectives.filter((item) => item.role === "REPORT" && item.audience === "customer").map((item) => item.objectiveId).sort()).toEqual([
      "objective:customer:meeting-questions-and-records",
      "objective:customer:not-established",
    ]);
  });

  it("assigns synthetic Maya obligations without activating review-required branches", () => {
    const files = new Set(readdirSync(DOCS));
    expect(files.has("08_initial_iep.pdf")).toBe(true);
    expect(files.has("prior-iep.pdf")).toBe(false);
    expect(files.has("progress-report.pdf")).toBe(false);
    expect(files.has("service-log.pdf")).toBe(false);
    const iep = readFileSync(join(ROOT, "eval/corpora/special-ed-l001/reader-pages/08_initial_iep.p1.txt"), "utf8");
    expect(iep).toContain("2017-04-18");
    expect(iep).toContain("2025-11-11");
    expect(iep).toContain("Specific Learning Disability (SLD) - Reading");

    const assigned = assignInvestigationObligations(plan, MAYA_PRESENT_DOCUMENTS);
    const assignedById = new Map(assigned.map((item) => [item.objectiveId, item]));
    expect(assigned).toHaveLength(25);

    for (const obligation of objectives) {
      const row = assignedById.get(obligation.objectiveId);
      if (obligation.applicability === "REVIEW_REQUIRED") expect(row?.applicability).toBe("REVIEW_REQUIRED");
      if (row?.role === "REPORT") {
        expect(row.investigationTaskIds).toEqual([]);
        expect(row.branches.every((branch) => branch.investigationTaskIds.length === 0)).toBe(true);
      }
    }

    const prior = assignedById.get("objective:customer:prior-iep-changes");
    expect(prior?.applicability).toBe("OUT_OF_SCOPE");
    expect(prior?.investigationTaskIds).toEqual([]);
    expect(prior?.reportSectionIds).toEqual([]);

    const progress = assignedById.get("objective:professional:progress-implementation");
    expect(progress?.applicability).toBe("REVIEW_REQUIRED");
    expect(progress?.branches.map((branch) => branch.id + ":" + branch.applicability).sort()).toEqual([
      "actual-progress:OUT_OF_SCOPE",
      "reporting-plan:REVIEW_REQUIRED",
      "service-delivery:OUT_OF_SCOPE",
      "version-change:OUT_OF_SCOPE",
    ]);
    expect(progress?.investigationTaskIds).toContain("task:check:G4");
    expect(progress?.investigationTaskIds).not.toContain("task:calculation:C13");
    expect(progress?.investigationTaskIds).not.toContain("task:chain:CH5");
    expect(progress?.investigationTaskIds).not.toContain("task:chain:CH6");

    const evaluation = assignedById.get("objective:professional:evaluation-eligibility-review");
    const sld = evaluation?.branches.find((branch) => branch.id === "sld-documentation");
    expect(evaluation?.applicability).toBe("REVIEW_REQUIRED");
    expect(sld?.applicability).toBe("REVIEW_REQUIRED");
    expect(sld?.investigationTaskIds).toContain("task:check:E4");

    const factors = assignedById.get("objective:professional:individualized-factors");
    expect(factors?.applicability).toBe("REVIEW_REQUIRED");
    expect(factors?.branches.find((branch) => branch.id === "accommodations-and-lre")?.applicability).toBe("APPLICABLE");
    expect(factors?.branches.find((branch) => branch.id === "transfer")?.applicability).toBe("OUT_OF_SCOPE");
    expect(factors?.branches.find((branch) => branch.id === "transition")?.applicability).toBe("REVIEW_REQUIRED");
    expect(factors?.branches.find((branch) => branch.id === "behavior")?.applicability).toBe("REVIEW_REQUIRED");
    expect(factors?.investigationTaskIds).not.toContain("task:check:TF1");
    expect(factors?.investigationTaskIds).toContain("task:check:A1");
    expect(factors?.investigationTaskIds).toContain("task:check:BH1");

    const customerTasks = new Set(assigned.filter((item) => item.audience === "customer").flatMap((item) => item.investigationTaskIds));
    const professionalTasks = new Set(assigned.filter((item) => item.audience === "professional" && item.role === "INVESTIGATE").flatMap((item) => item.investigationTaskIds));
    expect([...professionalTasks].filter((taskId) => !customerTasks.has(taskId)).length).toBeGreaterThan(15);
    expect(customerTasks.has("task:check:E4")).toBe(false);
    expect(professionalTasks.has("task:check:E4")).toBe(true);
  });
});
