import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDomainPack, packDigest } from "./domain-pack-compiler";
import {
  authorizedExtractionDigest,
  bindInvestigationCandidates,
  INVESTIGATION_CANDIDATES_SCHEMA,
  UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA,
  type UnresolvedCandidate,
  type UnresolvedCandidates,
} from "./domain-investigation-binder";
import { compileInvestigationPlan, type DomainInvestigationPlan, type InvestigationPlanInput, type SupplementalArtifacts } from "./domain-investigation-plan";
import {
  buildCoverageLedger,
  investigationEvidenceDigest,
  type DomainInvestigationLedger,
} from "./domain-investigation-ledger";
import { evaluateDomainRules, VERIFIED_CASE_FACTS_SCHEMA, type VerifiedCaseFacts, type VerifiedFact, type VerifiedRelationshipFact } from "./domain-pack-rules";
import { DOMAIN_PACK_SOURCE_SCHEMA, type CompiledDomainPack, type DomainPackSource, type PackDefinition } from "./domain-pack-source";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";

function none(): UnresolvedCandidates {
  return { schema: UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA, candidates: [] };
}

function facts(coverage: VerifiedCaseFacts["coverage"], rows: VerifiedFact[], relationships: VerifiedRelationshipFact[] = []): VerifiedCaseFacts {
  return { schema: VERIFIED_CASE_FACTS_SCHEMA, coverage, facts: rows, documents: [], relationships, conflicts: [] };
}

function dateFact(id: string, entityId: string, instanceId: string, fieldId: string, value: string, documentId: string, page: string): VerifiedFact {
  return { id, status: "VERIFIED", entityId, instanceId, fieldId, value: { valueType: "DATE", value }, sourceRefs: [{ documentId, page }] };
}

function textFact(id: string, entityId: string, instanceId: string, fieldId: string, value: string, documentId: string): VerifiedFact {
  return { id, status: "VERIFIED", entityId, instanceId, fieldId, value: { valueType: "TEXT", value }, sourceRefs: [{ documentId, page: "1" }] };
}

function link(id: string, relationshipId: string, fromInstanceId: string, toInstanceId: string, documentId: string, page = "3"): VerifiedRelationshipFact {
  return { id, status: "VERIFIED", relationshipId, fromInstanceId, toInstanceId, sourceRefs: [{ documentId, page }] };
}

function ledgerFor(pack: CompiledDomainPack, plan: DomainInvestigationPlan, verified: VerifiedCaseFacts, unresolved = none()) {
  return buildCoverageLedger({
    plan,
    pack,
    verified,
    unresolved,
    evidenceDigest: investigationEvidenceDigest(verified, unresolved),
  });
}

function openLedger(pack: CompiledDomainPack, plan: DomainInvestigationPlan, verified: VerifiedCaseFacts, unresolved = none()): DomainInvestigationLedger {
  const result = ledgerFor(pack, plan, verified, unresolved);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function rowsFor(value: DomainInvestigationLedger, definitionId: string) {
  return value.rows.filter((row) => row.definitionId === definitionId);
}

describe("ledger implementation", () => {
  it("does not name a definition id in the ledger implementation", () => {
    const source = readFileSync(join(import.meta.dirname, "domain-investigation-ledger.ts"), "utf8");
    expect(source).not.toMatch(/calculation:C\d/);
    expect(source).not.toMatch(/check:G\d/);
  });
});

function exampleSource(): DomainPackSource {
  const item: PackDefinition = {
    id: "entity:item", kind: "entity", label: "Item",
    fields: [
      { id: "label", valueType: "TEXT" },
      { id: "startDate", valueType: "DATE" },
      { id: "endDate", valueType: "DATE" },
    ],
  };
  const other: PackDefinition = {
    id: "entity:other", kind: "entity", label: "Other",
    fields: [{ id: "name", valueType: "TEXT" }, { id: "when", valueType: "DATE" }],
  };
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: "example-review", version: "1.0.0", title: "Example review" },
    ownership: { scope: "PRO", ownerId: "pro-1", authoredBy: "pro-1" },
    applicability: { jurisdiction: "unspecified", verification: "UNVERIFIED" },
    definitions: [
      item,
      other,
      { id: "relationship:item-other", kind: "relationship", label: "Item to other", fromEntityId: "entity:item", toEntityId: "entity:other", evidenceRequired: true },
      { id: "document:record", kind: "document", label: "Record", aliases: ["record"], appliesWhen: { op: "REVIEW_REQUIRED" }, settlesCheckIds: [] },
      { id: "check:review", kind: "check", label: "Review", criterion: { op: "REVIEW_REQUIRED" }, question: "Is the record complete?" },
      { id: "check:present", kind: "check", label: "Present", criterion: { op: "FIELD_PRESENT", entityId: "entity:item", fieldId: "label" } },
      {
        id: "check:cross", kind: "check", label: "Cross",
        criterion: { op: "ALL", conditions: [{ op: "FIELD_PRESENT", entityId: "entity:item", fieldId: "label" }, { op: "FIELD_PRESENT", entityId: "entity:other", fieldId: "name" }] },
      },
      {
        id: "calculation:span", kind: "calculation", label: "Span", operator: "DAYS_BETWEEN", inputFields: ["startDate", "endDate"], state: "EXECUTABLE",
        bindings: [
          { role: "start", entityId: "entity:item", fieldId: "startDate" },
          { role: "end", entityId: "entity:item", fieldId: "endDate" },
        ],
      },
      {
        id: "calculation:between", kind: "calculation", label: "Between", operator: "DAYS_BETWEEN", inputFields: ["startDate", "when"], state: "EXECUTABLE",
        bindings: [
          { role: "start", entityId: "entity:item", fieldId: "startDate" },
          { role: "end", entityId: "entity:other", fieldId: "when" },
        ],
      },
      { id: "calculation:gap", kind: "calculation", label: "Gap", operator: "DIFFERENCE", inputFields: ["left", "right"], state: "DECLARATION_ONLY", legacyInputs: "left minus right" },
      { id: "question:ask", kind: "question", label: "Ask", audience: "all", text: "What happened?", appliesWhen: { op: "REVIEW_REQUIRED" } },
      { id: "term:word", kind: "term", label: "Word", meaning: "A defined word." },
      { id: "workflow:steps", kind: "workflow", label: "Steps", steps: [{ id: "ask", action: "ASK_QUESTION", requiresReview: true }] },
    ],
    changes: [],
    review: { status: "DRAFT" },
  };
}

function exampleArtifacts(pack: CompiledDomainPack): SupplementalArtifacts {
  const reviewMapped = pack.definitions.some((definition) => definition.id === "check:review");
  const mapped = [...(reviewMapped ? ["check:review"] : []), "conflictPattern:sample", "stateOverlay:sample"];
  return {
    ontology: {
      schema: "hive.domain-ontology-spec/1",
      packRef: { packId: pack.identity.packId, version: pack.identity.version },
      entities: [
        {
          id: "entity:item", factClass: "EVENT",
          fields: [{ id: "label", valueType: "TEXT" }, { id: "startDate", valueType: "DATE" }, { id: "endDate", valueType: "DATE" }],
          ruleIds: ["check:review", "check:present", "question:ask", "calculation:span", "calculation:between"],
          documentKinds: ["document:record"],
          identityKeys: ["label"],
        },
        {
          id: "entity:other", factClass: "EVENT",
          fields: [{ id: "name", valueType: "TEXT" }, { id: "when", valueType: "DATE" }],
          ruleIds: [],
          documentKinds: [],
          identityKeys: ["name"],
        },
      ],
      relationships: [{ id: "relationship:item-other", fromEntityId: "entity:item", toEntityId: "entity:other", evidenceForLink: "The records name one another." }],
      documents: [{ id: "document:record", entities: ["entity:item"], checksSupported: [], requirementBasis: "PROFESSIONALLY_RECOMMENDED" }],
      calculations: [
        { id: "calculation:span", join: null },
        { id: "calculation:between", join: { relationshipId: "relationship:item-other" } },
      ],
    },
    authorityRegister: {
      schema: "hive.domain-authority-register/1",
      authorities: [{
        authorityId: "AUTH-EXAMPLE",
        authorityType: "PROFESSIONAL_REFERENCE",
        evidenceStrength: "PROFESSIONAL_STANDARD",
        humanReview: "NOT_REVIEWED",
        verificationStatus: "AUTHOR_PROPOSED",
        interpretation: { establishes: "A practice note.", doesNotEstablish: "Not a conclusion about a person." },
        limitations: ["Unreviewed practice note."],
        relatedDefinitionIds: mapped,
      }],
      definitionAuthorityMap: Object.fromEntries(mapped.map((id) => [id, ["AUTH-EXAMPLE"]])),
      authorityRoles: reviewMapped ? { "check:review": { "AUTH-EXAMPLE": "CLAIM_AUTHOR_PROPOSED" } } : {},
      authorityClassIndex: { legend: { PROFESSIONAL_REFERENCE: "PROFESSIONAL_CRITERIA" } },
      structuralDefinitions: { "term:word": "STRUCTURAL - persona/report/intake definition; makes no domain claim." },
      unusedAuthorityDisposition: {},
    },
    conflictPatterns: { schema: "hive.domain-conflict-pattern-spec/1", dp1Supported: false, patterns: [{ id: "conflictPattern:sample", entities: ["entity:item"], fields: ["label"], relationshipRequirements: ["relationship:item-other"], authorityIds: ["AUTH-EXAMPLE"] }] },
    stateOverlays: { schema: "hive.domain-state-overlay-spec/1", dp1Supported: false, overlays: [{ id: "stateOverlay:sample", authorityIds: ["AUTH-EXAMPLE"], storedThreshold: null }] },
    factClasses: { schema: "hive.domain-fact-class-spec/1", dp1Supported: false, classes: ["EVENT"] },
    workflowCoverage: { schema: "hive.domain-workflow-coverage-spec/1", dp1Supported: false, rows: [{ workflow: "Deferred path", answers: { remainingClassified: "DEFERRED" }, note: "Deferred module." }] },
    unsupportedOperators: { schema: "hive.domain-unsupported-operator-spec/1", dp1Supported: false, operators: [{ id: "EVERY", status: "UNSUPPORTED", dp1Predicate: false }, { id: "EXISTS", status: "UNSUPPORTED", dp1Predicate: false }] },
  };
}

function examplePlan(source: DomainPackSource = exampleSource(), upstream?: CompiledDomainPack) {
  const compiled = compileDomainPack(source, upstream);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
  const artifacts = exampleArtifacts(compiled.value);
  const digests = Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, packDigest(value)])) as InvestigationPlanInput["digests"];
  const plan = compileInvestigationPlan({ pack: compiled.value, artifacts, digests });
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  return { pack: compiled.value, plan: plan.value };
}

describe("ledger on a non-proof edition", () => {
  it("computes a same-instance span, leaves an undeclared cross check unevaluated, and keeps a disabled id", () => {
    const { pack, plan } = examplePlan();
    const verified = facts("COMPLETE", [
      textFact("label", "entity:item", "north", "label", "North", "doc-1"),
      textFact("name", "entity:other", "south", "name", "South", "doc-2"),
      dateFact("start", "entity:item", "north", "startDate", "2024-01-02", "doc-1", "1"),
      dateFact("end", "entity:item", "north", "endDate", "2024-02-01", "doc-1", "2"),
      dateFact("when", "entity:other", "south", "when", "2024-02-01", "doc-2", "2"),
    ], [link("independent", "relationship:item-other", "north", "south", "doc-link")]);
    const direct = evaluateDomainRules(pack, verified);
    if (!direct.ok) throw new Error(JSON.stringify(direct.issues));
    const value = openLedger(pack, plan, verified);
    expect(rowsFor(value, "calculation:span")[0]).toMatchObject({ disposition: "COMPUTED", daysBetween: "30", population: "VERIFIED_INSTANCE" });
    expect(rowsFor(value, "calculation:between").find((row) => row.disposition === "COMPUTED")).toMatchObject({ daysBetween: "30", relationshipFactIds: ["independent"] });
    expect(rowsFor(value, "check:present").find((row) => row.population === "VERIFIED_INSTANCE")).toMatchObject({ disposition: "ESTABLISHED" });
    expect(rowsFor(value, "check:present").find((row) => row.population === "VERIFIED_INSTANCE")?.authorityGate.length).toBeGreaterThan(0);
    const cross = rowsFor(value, "check:cross")[0];
    expect(cross).toMatchObject({ population: "UNRESOLVED_SUBJECT", disposition: "NOT_EVALUATED" });
    expect(cross?.reasonCodes).toEqual(expect.arrayContaining(["UNRESOLVED_SUBJECT", "RELATIONSHIP_UNDECLARED"]));
    expect(direct.results.find((result) => result.ruleId === "check:cross")?.outcome).toBe("ESTABLISHED");
    expect(rowsFor(value, "check:review").every((row) => row.disposition === "NOT_EVALUATED" && row.reasonCodes.includes("REVIEW_REQUIRED"))).toBe(true);
    expect(rowsFor(value, "calculation:gap").every((row) => row.disposition === "NOT_EVALUATED" && row.daysBetween === undefined)).toBe(true);
    expect(value.rows.filter((row) => row.taskKind === "NOTE_UNSUPPORTED").map((row) => row.disposition)).toEqual(["UNSUPPORTED", "UNSUPPORTED"]);
    expect(value.rows.some((row) => row.disposition === "DEFERRED")).toBe(true);
    expect(value.rows.find((row) => row.definitionId === "stateOverlay:sample")?.missingRequirements).toContain("storedThreshold");

    const disabled = examplePlan({
      schema: DOMAIN_PACK_SOURCE_SCHEMA,
      identity: { packId: "firm-example", version: "1.0.0", title: "Firm edition" },
      ownership: { scope: "FIRM", ownerId: "firm-1", authoredBy: "editor-1" },
      applicability: { jurisdiction: "unspecified", verification: "UNVERIFIED" },
      upstream: { packId: pack.identity.packId, version: pack.identity.version, digest: pack.identity.digest },
      definitions: [],
      changes: [{ op: "disable", definitionId: "check:review", reason: "Not used in this practice" }],
      review: { status: "DRAFT" },
    }, pack);
    const disabledLedger = openLedger(disabled.pack, disabled.plan, facts("COMPLETE", []));
    expect(disabledLedger.upstream?.digest).toBe(pack.identity.digest);
    expect(rowsFor(disabledLedger, "check:review")[0]).toMatchObject({ disposition: "DISABLED", disabledReason: "Not used in this practice" });
    expect(rowsFor(disabledLedger, "check:review").some((row) => row.disposition === "ESTABLISHED" || row.disposition === "NOT_EVALUATED")).toBe(false);
  });

  it("does not promote a binder relationship candidate", () => {
    const { pack, plan } = examplePlan();
    const documentId = "doc-1";
    const page = "Name: North. Started 2024-01-02. Other name: South. Ended 2024-02-01. North authorizes the review of South.";
    const extraction = (rows: ExtractionFact[]): DocExtraction => ({
      schema: "hive.doc-extraction/1",
      documentId,
      fileName: "record.txt",
      pageRange: null,
      document: { titleAsPrinted: "Record", documentType: "record", domain: { label: "review", confidence: null }, issuer: null, aboutPeople: [], keyDates: [], summary: "" },
      facts: rows,
      emptyFields: [],
      referencedDocuments: [],
      glossary: [],
      instructionsIgnored: [],
      coverage: { pageCount: 1, pagesRead: [1], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 1 },
    });
    const factRow = (id: string, written: string, quote: string): ExtractionFact => ({
      id, modelId: id, category: "record", subject: "record", attribute: "value", value: written, valueAsWritten: written,
      unit: null, per: null, timeframe: { from: null, to: null, asWritten: null }, modality: "stated", attributedTo: null,
      aboutPersonRef: null, tableContext: null, evidence: [{ page: 1, printedPageLabel: null, quote }], confidence: "high",
    });
    const extractions = [extraction([
      factRow("F-label", "North", "Name: North."),
      factRow("F-start", "2024-01-02", "Started 2024-01-02."),
      factRow("F-name", "South", "Other name: South."),
      factRow("F-when", "2024-02-01", "Ended 2024-02-01."),
    ])];
    const taskId = (definitionId: string) => plan.tasks.find((task) => task.definitionId === definitionId)?.taskId ?? "";
    const candidates = [
      { candidateId: "c-label", taskId: taskId("entity:item"), kind: "FIELD", entityId: "entity:item", instanceId: "north", fieldId: "label", documentId, extractionFactId: "F-label", value: { valueType: "TEXT", value: "North" } },
      { candidateId: "c-start", taskId: taskId("entity:item"), kind: "FIELD", entityId: "entity:item", instanceId: "north", fieldId: "startDate", documentId, extractionFactId: "F-start", value: { valueType: "DATE", value: "2024-01-02" } },
      { candidateId: "c-name", taskId: taskId("entity:other"), kind: "FIELD", entityId: "entity:other", instanceId: "south", fieldId: "name", documentId, extractionFactId: "F-name", value: { valueType: "TEXT", value: "South" } },
      { candidateId: "c-when", taskId: taskId("entity:other"), kind: "FIELD", entityId: "entity:other", instanceId: "south", fieldId: "when", documentId, extractionFactId: "F-when", value: { valueType: "DATE", value: "2024-02-01" } },
      { candidateId: "c-link", taskId: taskId("relationship:item-other"), kind: "RELATIONSHIP", relationshipId: "relationship:item-other", fromInstanceId: "north", toInstanceId: "south", evidence: [{ sourceDocumentId: documentId, page: 1, quote: "North authorizes the review of South." }] },
    ];
    const bound = bindInvestigationCandidates({
      plan,
      pack,
      extractions,
      documents: [{ documentId, pages: [{ pageNumber: 1, text: page }] }],
      candidates: { schema: INVESTIGATION_CANDIDATES_SCHEMA, planDigest: plan.digest, packDigest: pack.identity.digest, extractionDigest: authorizedExtractionDigest(extractions), candidates },
    });
    if (!bound.ok) throw new Error(JSON.stringify(bound.issues));
    expect(bound.verified.relationships).toEqual([]);
    const held = openLedger(pack, plan, bound.verified, bound.unresolved);
    expect(held.evidenceDigest).toBe(bound.digest);
    const review = held.rows.find((row) => row.candidateId === "c-link");
    expect(review).toMatchObject({ candidateTrust: "REVIEW_REQUIRED", disposition: "NOT_EVALUATED", relationshipFactIds: [] });
    expect(review?.reasonCodes).toEqual(expect.arrayContaining(["REVIEW_REQUIRED", "RELATIONSHIP_SEMANTICS_UNVERIFIED"]));
    expect(rowsFor(held, "calculation:between").every((row) => row.daysBetween === undefined)).toBe(true);
    const promoted: UnresolvedCandidate = bound.unresolved.candidates.find((candidate) => candidate.candidateId === "c-link")!;
    const refused = ledgerFor(pack, plan, {
      ...bound.verified,
      relationships: [{
        id: "copied-from-candidate",
        status: "VERIFIED",
        relationshipId: promoted.relationshipId ?? "",
        fromInstanceId: promoted.fromInstanceId ?? "",
        toInstanceId: promoted.toInstanceId ?? "",
        sourceRefs: promoted.sourceRefs.map((ref) => ({ ...ref })),
      }],
    }, bound.unresolved);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.issues.some((item) => item.code === "relationship_promoted")).toBe(true);
    const separate = openLedger(pack, plan, {
      ...bound.verified,
      relationships: [link("separate-link", promoted.relationshipId ?? "", promoted.fromInstanceId ?? "", promoted.toInstanceId ?? "", documentId, "2")],
    }, bound.unresolved);
    expect(rowsFor(separate, "calculation:between").find((row) => row.disposition === "COMPUTED")).toMatchObject({
      daysBetween: "30",
      relationshipFactIds: ["separate-link"],
    });
    expect(separate.rows.find((row) => row.candidateId === "c-link")).toMatchObject({
      candidateTrust: "REVIEW_REQUIRED",
      relationshipFactIds: [],
    });
  });
});
