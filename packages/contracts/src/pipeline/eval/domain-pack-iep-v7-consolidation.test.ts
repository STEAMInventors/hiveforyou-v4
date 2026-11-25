import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDomainPack, packDigest } from "../domain-pack-compiler";
import { compileInvestigationPlan, type SupplementalArtifacts } from "../domain-investigation-plan";
import { legacyPackToEditableSource } from "../domain-pack-legacy-adapter";
import { parsePackMarkdown } from "../pack-contracts";
import {
  evaluateDomainRules,
  VERIFIED_CASE_FACTS_SCHEMA,
  type VerifiedCaseFacts,
  type VerifiedFact,
  type VerifiedRelationshipFact,
} from "../domain-pack-rules";
import type { DomainPackSource, PackDefinition } from "../domain-pack-source";

const V7 = join(import.meta.dirname, "../../../../../packs/HiveForYou-Pack-iep-initial.md");
const STAGE = join(import.meta.dirname, "../../../../../packs/drafts/iep-us-federal/v0.3.0");
const CANDIDATE = join(import.meta.dirname, "../../../../../packs/drafts/iep-us-federal/v0.4.0");
const EXECUTABLE = ["calculation:C1", "calculation:C2", "calculation:C3", "calculation:C14", "calculation:C15", "calculation:C20", "calculation:C21"];
const ADDED = [
  "guideline:v7-two-readers",
  "guideline:v7-evidence-question",
  "guideline:v7-standing-when-shown",
  "guideline:v7-chain-row",
  "guideline:v7-cited-arithmetic",
  "guideline:v7-orf-passage",
  "guideline:v7-general-notes-not-proof",
  "guideline:v7-request-timing",
  "guideline:v7-limits",
  "guideline:v7-sources",
];

function load(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
}

function byId(definitions: PackDefinition[]): Map<string, PackDefinition> {
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

const stage = load(STAGE, "iep-domain-pack-source.stage4b.json") as DomainPackSource;
const source = load(CANDIDATE, "iep-domain-pack-source.v0.4.0.json") as DomainPackSource;
const compiled = compileDomainPack(source);
if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
const pack = compiled.value;

const artifacts: SupplementalArtifacts = {
  ontology: load(CANDIDATE, "iep-domain-ontology-spec.json"),
  authorityRegister: load(CANDIDATE, "iep-domain-authority-register.json"),
  conflictPatterns: load(CANDIDATE, "iep-domain-conflict-patterns.v1.json"),
  stateOverlays: load(CANDIDATE, "iep-domain-state-overlays.v1.json"),
  factClasses: load(CANDIDATE, "iep-domain-fact-classes.v1.json"),
  workflowCoverage: load(CANDIDATE, "iep-domain-workflow-coverage.v1.json"),
  unsupportedOperators: load(CANDIDATE, "iep-domain-unsupported-operators.v1.json"),
};
const digests = Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, packDigest(value)])) as InvestigationPlanInputDigests;
type InvestigationPlanInputDigests = Record<keyof SupplementalArtifacts, string>;

const v7 = parsePackMarkdown(readFileSync(V7, "utf8"));
if (!v7.ok) throw new Error(v7.message);
const imported = legacyPackToEditableSource(v7.value, { scope: "PLATFORM", ownerId: "hiveforyou", authoredBy: "test" });
if (!imported.ok) throw new Error(imported.errors.join("\n"));

type Crosswalk = {
  items: { v7Id: string; status: string; definitionIds: string[]; authorityIds: string[] }[];
  coverageGaps: { id: string; definitionIds: string[] }[];
  origin: { v7ImportDefinitionIds: string[]; stage4bExpansionDefinitionIds: string[]; addedGuidelineIds: string[] };
};

const crosswalk = load(CANDIDATE, "iep-domain-v7-crosswalk.json") as Crosswalk;
const STATUSES = new Set(["preserved", "enhanced", "missing", "conflicting", "currently unsupported"]);

describe("IEP v7 consolidation candidate", () => {
  it("keeps the active v7 pack and the Stage 4B baseline unchanged in role", () => {
    expect(v7.value.meta).toMatchObject({ pack: "iep-initial", version: 7 });
    expect(stage.identity).toMatchObject({ packId: "iep-us-federal", version: "0.3.0" });
    expect(stage.definitions).toHaveLength(275);
    expect(readFileSync(V7, "utf8")).toContain("pack: iep-initial");
  });

  it("compiles an unpublished draft that adds only the v7 prose guidelines", () => {
    expect(source.identity).toMatchObject({ packId: "iep-us-federal", version: "0.4.0" });
    expect(source.applicability.verification).toBe("UNVERIFIED");
    expect(source.applicability.intentHints).toEqual(v7.value.meta.matches.intent);
    expect(source.applicability.documentHints).toEqual(v7.value.meta.matches.documents);
    expect(source.applicability.jurisdiction).toBe("US-FEDERAL");
    expect(source.review).toEqual({ status: "DRAFT" });
    expect(source.changes).toEqual([]);
    expect(pack.publication).toBe("UNPUBLISHED");
    expect(pack.definitions).toHaveLength(285);
    expect(new Set(pack.definitions.map((definition) => definition.id)).size).toBe(285);

    const stageIds = byId(stage.definitions);
    const candidateIds = byId(source.definitions);
    for (const [id, definition] of stageIds) expect(candidateIds.get(id)).toEqual(definition);
    expect([...candidateIds.keys()].filter((id) => !stageIds.has(id)).sort()).toEqual([...ADDED].sort());

    const checks = source.definitions.filter((definition) => definition.kind === "check");
    expect(checks).toHaveLength(67);
    expect(checks.every((definition) => definition.kind === "check" && definition.criterion.op === "REVIEW_REQUIRED")).toBe(true);
    const executable = source.definitions.filter((definition) => definition.kind === "calculation" && definition.state === "EXECUTABLE");
    expect(executable.map((definition) => definition.id).sort()).toEqual([...EXECUTABLE].sort());
    for (const id of EXECUTABLE) expect(candidateIds.get(id)).toEqual(stageIds.get(id));
    for (const id of ["calculation:C4", "calculation:C5", "calculation:C6", "calculation:C7a", "calculation:C7b", "calculation:C8", "calculation:C9", "calculation:C10"]) {
      expect(candidateIds.get(id)).toMatchObject({ kind: "calculation", state: "DECLARATION_ONLY" });
    }
  });

  it("quotes the v7 instructions that the legacy adapter did not import", () => {
    const text = (id: string): string => {
      const definition = source.definitions.find((item) => item.id === id);
      if (definition?.kind !== "guideline") throw new Error(id);
      return definition.text;
    };
    expect(text("guideline:v7-two-readers")).toContain("Two readers use the same Study.");
    expect(text("guideline:v7-standing-when-shown")).toContain("even if every check is SHOWN");
    expect(text("guideline:v7-chain-row")).toContain("Referral concern; Area assessed; Result");
    expect(text("guideline:v7-cited-arithmetic")).toContain("unless parent and school agree a re-evaluation is unnecessary");
    expect(text("guideline:v7-request-timing")).toContain("if progress is slow (later)");
    expect(text("guideline:v7-limits")).toContain("300.106 confirmed by section title only");
    expect(text("guideline:v7-limits")).toContain("state rules not included");
    expect(text("guideline:v7-general-notes-not-proof")).toContain("never proof about this child");
    expect(text("guideline:v7-sources")).toContain("Endrew F. v. Douglas County School District RE-1, 580 U.S. 386 (2017).");
    expect(text("guideline:v7-orf-passage")).toContain("unpracticed grade-level passages");
  });

  it("matches v7 customer and professional report requirements in the template text", () => {
    for (const audience of ["customer", "professional"] as const) {
      const template = audience === "customer" ? v7.value.customerReport : v7.value.professionalReport;
      const report = source.definitions.find((definition) => definition.id === "report:" + audience);
      expect(template).not.toBeNull();
      if (!template || report?.kind !== "report") throw new Error(audience);
      expect(report.label).toBe(template.title);
      expect(report.voice).toBe(template.voice);
      expect(report.sections.map((section) => section.heading)).toEqual(template.sections.map((section) => section.heading));
      expect(report.sections.map((section) => section.templateDescription)).toEqual(template.sections.map((section) => section.builtFromRaw));
      expect(report.sections.some((section) => section.blocks.includes("narrative"))).toBe(false);
    }
    const customer = source.definitions.find((definition) => definition.id === "report:customer");
    const professional = source.definitions.find((definition) => definition.id === "report:professional");
    if (customer?.kind !== "report" || professional?.kind !== "report") throw new Error("reports");
    expect(customer.sections.map((section) => section.heading)).toEqual([
      "The short answer",
      "What the school decided",
      "What {first name} will get",
      "Does the plan match the testing?",
      "Questions to ask before you sign",
      "What to ask the school for",
      "What signing means",
      "What happens next",
      "Words used in these documents",
    ]);
    expect(professional.sections.map((section) => section.heading)).toEqual([
      "Bottom line",
      "Points to raise",
      "Snapshot",
      "Chronology",
      "Checklist",
      "Alignment",
      "Goal analysis",
      "Services against recommendations",
      "Conflicts and inconsistencies",
      "Document requests",
      "Meeting agenda",
      "Coverage and caveats",
    ]);
    expect(customer.sections[4].templateDescription).toContain("at most seven");
    expect(professional.sections[3].templateDescription).toContain("state timeline not verified");
    expect(professional.sections[3].templateDescription).toContain("C1, C2, C3, C7a, C7b, C10");
  });

  it("maps every substantive v7 item and records the execution gaps", () => {
    expect(crosswalk.items.every((item) => STATUSES.has(item.status))).toBe(true);
    expect(crosswalk.items.filter((item) => item.status === "missing" || item.status === "conflicting")).toEqual([]);
    const ids = new Set(crosswalk.items.map((item) => item.v7Id));
    for (const check of v7.value.checks) expect(ids.has("check:" + check.id)).toBe(true);
    for (const question of [...v7.value.askThePerson, ...v7.value.standingQuestions]) expect(ids.has("question:" + question.id)).toBe(true);
    for (const persona of v7.value.personas) expect(ids.has("persona:" + persona.audience)).toBe(true);
    for (const value of v7.value.computedValues) expect(ids.has("calculation:" + value.id)).toBe(true);
    for (const chain of v7.value.chains) expect(ids.has("chain:" + chain.id)).toBe(true);
    for (const note of v7.value.generalNotes) expect(ids.has("note:" + note.id)).toBe(true);
    for (const definition of imported.source.definitions) expect(crosswalk.origin.v7ImportDefinitionIds).toContain(definition.id);
    expect(crosswalk.origin.v7ImportDefinitionIds).toHaveLength(119);
    expect(crosswalk.origin.stage4bExpansionDefinitionIds).toHaveLength(156);
    expect(crosswalk.origin.addedGuidelineIds).toEqual(ADDED);
    const candidateIds = new Set(source.definitions.map((definition) => definition.id));
    for (const item of crosswalk.items) {
      for (const id of item.definitionIds) expect(candidateIds.has(id)).toBe(true);
    }
    expect(crosswalk.coverageGaps.map((gap) => gap.id)).toEqual([
      "operator:RATE_PER_WEEK",
      "operator:SUM_BY",
      "operator:DIFFERENCE",
      "operator:ADD_INTERVAL",
      "operator:REFERENCE_GAP",
      "calculation:C10",
      "block:narrative",
      "predicate:applicability",
      "stateOverlay:evaluation-timeline",
      "register:check:S3:300.503-b",
    ]);
  });

  it("evaluates only the seven day counts and leaves checks review-only", () => {
    const facts: VerifiedFact[] = [
      {
        id: "c1-start",
        status: "VERIFIED",
        entityId: "entity:consent",
        instanceId: "consent-1",
        fieldId: "receivedDate",
        value: { valueType: "DATE", value: "2024-01-01" },
        sourceRefs: [{ documentId: "consent-doc", page: "1" }],
      },
      {
        id: "c1-end",
        status: "VERIFIED",
        entityId: "entity:evaluation",
        instanceId: "evaluation-1",
        fieldId: "completionDate",
        value: { valueType: "DATE", value: "2024-01-11" },
        sourceRefs: [{ documentId: "evaluation-doc", page: "2" }],
      },
    ];
    const relationships: VerifiedRelationshipFact[] = [{
      id: "c1-link",
      status: "VERIFIED",
      relationshipId: "relationship:consent-authorizes-evaluation",
      fromInstanceId: "consent-1",
      toInstanceId: "evaluation-1",
      sourceRefs: [{ documentId: "link-doc", page: "3" }],
    }];
    const evidence: VerifiedCaseFacts = {
      schema: VERIFIED_CASE_FACTS_SCHEMA,
      coverage: "COMPLETE",
      facts,
      documents: [],
      relationships,
      conflicts: [],
    };
    const evaluation = evaluateDomainRules(pack, evidence);
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const row = (id: string) => evaluation.results.filter((result) => result.ruleId === id);
    expect(row("calculation:C1")).toMatchObject([{ outcome: "COMPUTED", daysBetween: "10", operator: "DAYS_BETWEEN" }]);
    expect(row("calculation:C10")[0]).toMatchObject({ outcome: "NOT_EVALUATED" });
    expect(row("calculation:C10")[0].reasonCodes).toContain("CALCULATION_NOT_EXECUTABLE");
    expect(row("calculation:C10")[0].daysBetween).toBeUndefined();
    expect(row("calculation:C4")[0].reasonCodes).toContain("CALCULATION_NOT_EXECUTABLE");
    const checks = evaluation.results.filter((result) => result.kind === "check");
    expect(checks).toHaveLength(67);
    expect(checks.every((result) => result.outcome === "NOT_EVALUATED" && result.reasonCodes.includes("REVIEW_REQUIRED"))).toBe(true);
    expect(evaluation.results.some((result) => result.outcome === "ESTABLISHED" || result.outcome === "NOT_SATISFIED")).toBe(false);
    const computed = evaluation.results.filter((result) => result.outcome === "COMPUTED").map((result) => result.ruleId);
    expect(computed).toEqual(["calculation:C1"]);
  });

  it("compiles the investigation plan against the pinned companions", () => {
    const ontology = artifacts.ontology as { packRef: { packId: string; version: string } };
    expect(ontology.packRef).toEqual({ packId: "iep-us-federal", version: "0.4.0" });
    const register = artifacts.authorityRegister as { authorities: { humanReview: string }[] };
    expect(register.authorities).toHaveLength(149);
    expect(register.authorities.every((authority) => authority.humanReview === "NOT_REVIEWED")).toBe(true);
    const plan = compileInvestigationPlan({ pack, artifacts, digests });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.pack).toMatchObject({
      packId: "iep-us-federal",
      version: "0.4.0",
      publication: "UNPUBLISHED",
      reviewStatus: "DRAFT",
    });
    expect(plan.value.applicability.verification).toBe("UNVERIFIED");
    const presentation = new Set(plan.value.presentation.map((row) => row.definitionId));
    for (const id of ADDED) expect(presentation.has(id)).toBe(true);
    const taskIds = new Set(plan.value.tasks.map((task) => task.definitionId));
    for (const id of ADDED) expect(taskIds.has(id)).toBe(false);
    for (const definition of pack.definitions) {
      expect(presentation.has(definition.id) || taskIds.has(definition.id)).toBe(true);
    }
    expect(plan.value.tasks.filter((task) => task.taskKind === "COMPUTE_DAYS_BETWEEN").map((task) => task.definitionId).sort()).toEqual([...EXECUTABLE].sort());
    expect(plan.value.tasks.filter((task) => task.taskKind === "EVALUATE_CHECK")).toEqual([]);
    expect(plan.value.disabledDefinitionIds).toEqual([]);
  });
});
