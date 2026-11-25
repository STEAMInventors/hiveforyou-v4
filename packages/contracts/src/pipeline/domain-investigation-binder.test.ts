import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileDomainPack, packDigest } from "./domain-pack-compiler";
import {
  authorizedExtractionDigest,
  bindInvestigationCandidates,
  INVESTIGATION_CANDIDATES_SCHEMA,
  type CandidateBinderInput,
} from "./domain-investigation-binder";
import { compileInvestigationPlan, type SupplementalArtifacts } from "./domain-investigation-plan";
import { evaluateDomainRules } from "./domain-pack-rules";
import {
  DOMAIN_PACK_SOURCE_SCHEMA,
  type CompiledDomainPack,
  type DomainPackSource,
} from "./domain-pack-source";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import type { VerificationPage } from "./verify-quotes";

const DOC = "doc-1";
const OTHER_DOC = "doc-2";
const PAGE_1 = [
  "Name: North.",
  "Started 2024-01-02.",
  "Other name: South.",
  "Ended 2024-02-01.",
  "North authorizes the review of South.",
  "North does not authorize the review of South.",
  "North was present and South was present.",
  "North disputes the record about South.",
  "South authorizes the review of North.",
  "The records name one another.",
  "Record cover: North.",
  "Noted March 1, 2024 in the margin.",
  "Answer: yes.",
].join(" ");
const PAGE_2 = "North and South are linked in this record.";
const OTHER_PAGE = "Unrelated ledger line.";

function source(): DomainPackSource {
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: "example-review", version: "1.0.0", title: "Example review" },
    ownership: { scope: "PRO", ownerId: "pro-1", authoredBy: "pro-1" },
    applicability: { jurisdiction: "unspecified", verification: "UNVERIFIED" },
    definitions: [
      {
        id: "entity:item", kind: "entity", label: "Item",
        fields: [
          { id: "label", valueType: "TEXT" },
          { id: "startDate", valueType: "DATE" },
          { id: "flag", valueType: "BOOLEAN" },
        ],
      },
      {
        id: "entity:other", kind: "entity", label: "Other",
        fields: [
          { id: "name", valueType: "TEXT" },
          { id: "when", valueType: "DATE" },
        ],
      },
      {
        id: "relationship:item-other", kind: "relationship", label: "Item to other",
        fromEntityId: "entity:item", toEntityId: "entity:other", evidenceRequired: true,
      },
      {
        id: "document:record", kind: "document", label: "Record", aliases: ["record"],
        appliesWhen: { op: "REVIEW_REQUIRED" }, settlesCheckIds: [],
      },
      {
        id: "calculation:between", kind: "calculation", label: "Days between records",
        operator: "DAYS_BETWEEN", inputFields: ["startDate", "when"], state: "EXECUTABLE",
        bindings: [
          { role: "start", entityId: "entity:item", fieldId: "startDate" },
          { role: "end", entityId: "entity:other", fieldId: "when" },
        ],
      },
      { id: "term:word", kind: "term", label: "Word", meaning: "A defined word." },
    ],
    changes: [],
    review: { status: "DRAFT" },
  };
}

function companions(pack: CompiledDomainPack): SupplementalArtifacts {
  return {
    ontology: {
      schema: "hive.domain-ontology-spec/1",
      packRef: { packId: pack.identity.packId, version: pack.identity.version },
      entities: [
        {
          id: "entity:item", factClass: "RECORD",
          fields: [
            { id: "label", valueType: "TEXT" },
            { id: "startDate", valueType: "DATE" },
            { id: "flag", valueType: "BOOLEAN" },
          ],
          ruleIds: ["calculation:between"],
          documentKinds: ["document:record"],
          instanceBoundary: "One record.",
          identityKeys: ["label"],
        },
        {
          id: "entity:other", factClass: "RECORD",
          fields: [
            { id: "name", valueType: "TEXT" },
            { id: "when", valueType: "DATE" },
          ],
          ruleIds: [],
          documentKinds: [],
          identityKeys: ["name"],
        },
      ],
      relationships: [{
        id: "relationship:item-other",
        fromEntityId: "entity:item",
        toEntityId: "entity:other",
        evidenceForLink: "The records name one another.",
        cardinality: "many",
      }],
      documents: [{
        id: "document:record",
        entities: ["entity:item"],
        checksSupported: [],
        requirementBasis: "PROFESSIONALLY_RECOMMENDED",
      }],
      calculations: [{ id: "calculation:between", join: { relationshipId: "relationship:item-other" } }],
    },
    authorityRegister: {
      schema: "hive.domain-authority-register/1",
      authorities: [],
      definitionAuthorityMap: {},
      authorityRoles: {},
      structuralDefinitions: {
        "term:word": "STRUCTURAL - persona/report/intake definition; makes no domain claim.",
      },
      unusedAuthorityDisposition: {},
    },
    conflictPatterns: { schema: "hive.domain-conflict-pattern-spec/1", dp1Supported: false, patterns: [] },
    stateOverlays: { schema: "hive.domain-state-overlay-spec/1", dp1Supported: false, overlays: [] },
    factClasses: { schema: "hive.domain-fact-class-spec/1", dp1Supported: false, classes: ["RECORD"] },
    workflowCoverage: { schema: "hive.domain-workflow-coverage-spec/1", dp1Supported: false, rows: [] },
    unsupportedOperators: {
      schema: "hive.domain-unsupported-operator-spec/1",
      dp1Supported: false,
      operators: [
        { id: "EVERY", status: "UNSUPPORTED", dp1Predicate: false },
        { id: "EXISTS", status: "UNSUPPORTED", dp1Predicate: false },
      ],
    },
  };
}

function compilePack(): CompiledDomainPack {
  const compiled = compileDomainPack(source());
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
  return compiled.value;
}

function compilePlan(pack: CompiledDomainPack) {
  const artifacts = companions(pack);
  const digests = Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, packDigest(value)])) as Record<keyof SupplementalArtifacts, string>;
  const plan = compileInvestigationPlan({ pack, artifacts, digests });
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  return plan.value;
}

function fact(id: string, written: string, page: number, quote: string): ExtractionFact {
  return {
    id,
    modelId: id,
    category: "record",
    subject: "record",
    attribute: "value",
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

function extraction(facts: ExtractionFact[], documentId = DOC): DocExtraction {
  return {
    schema: "hive.doc-extraction/1",
    documentId,
    fileName: documentId + ".txt",
    pageRange: null,
    document: {
      titleAsPrinted: "Record",
      documentType: "record",
      domain: { label: "review", confidence: null },
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
    coverage: { pageCount: 2, pagesRead: [1, 2], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 2 },
  };
}

const baseFacts = [
  fact("F-label", "North", 1, "Name: North."),
  fact("F-start", "2024-01-02", 1, "Started 2024-01-02."),
  fact("F-name", "South", 1, "Other name: South."),
  fact("F-when", "2024-02-01", 1, "Ended 2024-02-01."),
  fact("F-cover", "North", 1, "Record cover: North."),
  fact("F-prose", "March 1, 2024", 1, "Noted March 1, 2024 in the margin."),
  fact("F-yes", "yes", 1, "Answer: yes."),
];

function documents(): CandidateBinderInput["documents"] {
  return [
    { documentId: DOC, pages: [{ pageNumber: 1, text: PAGE_1 }, { pageNumber: 2, text: PAGE_2 }] satisfies VerificationPage[] },
    { documentId: OTHER_DOC, pages: [{ pageNumber: 1, text: OTHER_PAGE }] },
  ];
}

function world() {
  const pack = compilePack();
  const plan = compilePlan(pack);
  const extractions = [extraction(baseFacts), extraction([], OTHER_DOC)];
  return { pack, plan, extractions };
}

function taskId(plan: ReturnType<typeof compilePlan>, definitionId: string): string {
  const task = plan.tasks.find((item) => item.definitionId === definitionId);
  if (!task) throw new Error("missing task " + definitionId);
  return task.taskId;
}

function envelope(plan: ReturnType<typeof compilePlan>, pack: CompiledDomainPack, extractions: readonly DocExtraction[], candidates: unknown[]) {
  return {
    schema: INVESTIGATION_CANDIDATES_SCHEMA,
    planDigest: plan.digest,
    packDigest: pack.identity.digest,
    extractionDigest: authorizedExtractionDigest(extractions),
    candidates,
  };
}

function bindWith(candidates: unknown[], options?: { extractions?: DocExtraction[]; candidatesEnvelope?: unknown }) {
  const { pack, plan, extractions } = world();
  const used = options?.extractions ?? extractions;
  const result = bindInvestigationCandidates({
    pack,
    plan,
    extractions: used,
    documents: documents(),
    candidates: options?.candidatesEnvelope ?? envelope(plan, pack, used, candidates),
  });
  return { pack, plan, result };
}

function fieldCandidate(plan: ReturnType<typeof compilePlan>, overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "c-label",
    taskId: taskId(plan, "entity:item"),
    kind: "FIELD",
    entityId: "entity:item",
    instanceId: "north",
    fieldId: "label",
    documentId: DOC,
    extractionFactId: "F-label",
    value: { valueType: "TEXT", value: "North" },
    ...overrides,
  };
}

function validFields(plan: ReturnType<typeof compilePlan>) {
  return [
    fieldCandidate(plan),
    fieldCandidate(plan, {
      candidateId: "c-start",
      fieldId: "startDate",
      extractionFactId: "F-start",
      value: { valueType: "DATE", value: "2024-01-02" },
    }),
    fieldCandidate(plan, {
      candidateId: "c-name",
      taskId: taskId(plan, "entity:other"),
      entityId: "entity:other",
      instanceId: "south",
      fieldId: "name",
      extractionFactId: "F-name",
      value: { valueType: "TEXT", value: "South" },
    }),
    fieldCandidate(plan, {
      candidateId: "c-when",
      taskId: taskId(plan, "entity:other"),
      entityId: "entity:other",
      instanceId: "south",
      fieldId: "when",
      extractionFactId: "F-when",
      value: { valueType: "DATE", value: "2024-02-01" },
    }),
  ];
}

function linkCandidate(plan: ReturnType<typeof compilePlan>, overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "c-link",
    taskId: taskId(plan, "relationship:item-other"),
    kind: "RELATIONSHIP",
    relationshipId: "relationship:item-other",
    fromInstanceId: "north",
    toInstanceId: "south",
    evidence: [{ sourceDocumentId: DOC, page: 1, quote: "North authorizes the review of South." }],
    ...overrides,
  };
}

function expectBound(result: ReturnType<typeof bindInvestigationCandidates>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result;
}

function expectNoComputedDayCount(
  pack: CompiledDomainPack,
  verified: Extract<ReturnType<typeof bindInvestigationCandidates>, { ok: true }>["verified"],
) {
  expect(verified.relationships).toEqual([]);
  expect(JSON.stringify(verified)).not.toContain("relationship:item-other");
  const evaluation = evaluateDomainRules(pack, verified);
  expect(evaluation.ok).toBe(true);
  if (!evaluation.ok) return;
  const between = evaluation.results.find((item) => item.ruleId === "calculation:between");
  expect(between).toMatchObject({ outcome: "NOT_EVALUATED" });
  expect(between?.daysBetween).toBeUndefined();
  expect(between?.reasonCodes).not.toContain("CALCULATION_COMPUTED");
  expect(between?.supportingFactIds).toEqual([]);
}

function expectHeldFreeText(
  pack: CompiledDomainPack,
  result: ReturnType<typeof bindInvestigationCandidates>,
  candidateId: string,
  quotes: readonly string[],
) {
  const bound = expectBound(result);
  expect(bound.verified.facts).toHaveLength(4);
  const held = bound.unresolved.candidates.find((item) => item.candidateId === candidateId);
  expect(held).toMatchObject({
    kind: "RELATIONSHIP",
    trust: "REVIEW_REQUIRED",
    reasons: ["RELATIONSHIP_SEMANTICS_UNVERIFIED"],
    relationshipId: "relationship:item-other",
    fromEntityId: "entity:item",
    toEntityId: "entity:other",
    fromInstanceId: "north",
    toInstanceId: "south",
  });
  expect(held?.evidence.map((item) => item.quote)).toEqual(quotes);
  for (const item of held?.evidence ?? []) {
    expect(held?.sourceRefs).toContainEqual({ documentId: item.sourceDocumentId, page: String(item.page) });
  }
  expectNoComputedDayCount(pack, bound.verified);
  return bound;
}

describe("investigation candidate binder", () => {
  it("verifies scalar facts and documents and withholds a free-text relationship", () => {
    const { pack, plan, result } = bindWith([
      ...validFields(compilePlan(compilePack())),
    ]);
    const ready = expectBound(result);
    const fields = validFields(plan);
    const withDocument = bindWith([
      ...fields,
      {
        candidateId: "c-doc",
        taskId: taskId(plan, "document:record"),
        kind: "DOCUMENT",
        documentKindId: "document:record",
        documentId: DOC,
        extractionFactId: "F-cover",
        subject: { entityId: "entity:item", instanceId: "north" },
        evidence: [{ sourceDocumentId: DOC, page: 1, quote: "Record cover: North." }],
      },
      linkCandidate(plan),
    ]);
    const bound = expectBound(withDocument.result);
    expect(bound.verified.schema).toBe("hive.verified-case-facts/1");
    expect(bound.verified.coverage).toBe("INCOMPLETE");
    expect(bound.verified.facts).toHaveLength(4);
    expect(bound.verified.documents).toHaveLength(1);
    expect(bound.verified.relationships).toEqual([]);
    const label = bound.verified.facts.find((item) => item.fieldId === "label");
    expect(label).toMatchObject({
      status: "VERIFIED",
      entityId: "entity:item",
      instanceId: "north",
      value: { valueType: "TEXT", value: "North" },
      sourceRefs: [{ documentId: DOC, page: "1", excerptId: "F-label" }],
    });
    expect(bound.verified.documents[0]).toMatchObject({
      status: "VERIFIED",
      documentKindId: "document:record",
      subject: { entityId: "entity:item", instanceId: "north" },
      sourceRefs: [{ documentId: DOC, page: "1", excerptId: "F-cover" }],
    });
    const held = bound.unresolved.candidates.find((item) => item.candidateId === "c-link");
    expect(held).toMatchObject({
      kind: "RELATIONSHIP",
      trust: "REVIEW_REQUIRED",
      reasons: ["RELATIONSHIP_SEMANTICS_UNVERIFIED"],
      relationshipId: "relationship:item-other",
      fromEntityId: "entity:item",
      toEntityId: "entity:other",
      fromInstanceId: "north",
      toInstanceId: "south",
      sourceRefs: [{ documentId: DOC, page: "1" }],
      evidence: [{ sourceDocumentId: DOC, page: 1, quote: "North authorizes the review of South." }],
    });
    expectNoComputedDayCount(pack, bound.verified);
    expect(ready.verified.facts).toHaveLength(4);
    expect(ready.verified.relationships).toEqual([]);
  });

  it("keeps the same ids when the same candidates arrive in another order", () => {
    const { plan } = world();
    const candidates = [
      ...validFields(plan),
      linkCandidate(plan),
    ];
    const forward = expectBound(bindWith(candidates).result);
    const backward = expectBound(bindWith([...candidates].reverse()).result);
    expect(backward.digest).toBe(forward.digest);
    expect(backward.verified).toEqual(forward.verified);
    expect(forward.verified.facts.map((item) => item.id)).toEqual([...forward.verified.facts.map((item) => item.id)].sort());
  });

  it("does not verify a candidate with missing, fabricated, or wrong-page evidence", () => {
    const { plan } = world();
    const missing = expectBound(bindWith([
      ...validFields(plan),
      linkCandidate(plan, { candidateId: "c-missing", evidence: [] }),
    ]).result);
    expect(missing.verified.relationships).toHaveLength(0);
    expect(missing.unresolved.candidates).toEqual([
      expect.objectContaining({ candidateId: "c-missing", trust: "UNRESOLVED", reasons: ["MISSING_EVIDENCE"] }),
    ]);

    const fabricatedExtraction = extraction([
      fact("F-label", "North", 1, "This sentence was never written."),
    ]);
    const fabricated = expectBound(bindWith([
      fieldCandidate(plan),
    ], { extractions: [fabricatedExtraction, extraction([], OTHER_DOC)] }).result);
    expect(fabricated.verified.facts).toHaveLength(0);
    expect(fabricated.unresolved.candidates[0].reasons).toContain("QUOTE_NOT_FOUND");
    expect(fabricated.unresolved.candidates[0].trust).not.toBe("VERIFIED");

    const wrongPage = expectBound(bindWith([
      linkCandidate(plan, {
        candidateId: "c-page",
        evidence: [{ sourceDocumentId: DOC, page: 1, quote: "North and South are linked in this record." }],
      }),
    ]).result);
    expect(wrongPage.verified.relationships).toHaveLength(0);
    expect(wrongPage.unresolved.candidates[0].reasons).toContain("QUOTE_ON_OTHER_PAGE");

    const wrongDocument = expectBound(bindWith([
      linkCandidate(plan, {
        candidateId: "c-docid",
        evidence: [{ sourceDocumentId: OTHER_DOC, page: 1, quote: "North authorizes the review of South." }],
      }),
    ]).result);
    expect(wrongDocument.verified.relationships).toHaveLength(0);
    expect(wrongDocument.unresolved.candidates[0].reasons).toContain("WRONG_DOCUMENT");
  });

  it("rejects type mismatch and unsupported coercion without inventing a scalar", () => {
    const { plan } = world();
    const mismatch = expectBound(bindWith([
      fieldCandidate(plan, {
        candidateId: "c-type",
        fieldId: "startDate",
        extractionFactId: "F-start",
        value: { valueType: "TEXT", value: "2024-01-02" },
      }),
    ]).result);
    expect(mismatch.verified.facts).toHaveLength(0);
    expect(mismatch.unresolved.candidates[0].reasons).toContain("TYPE_MISMATCH");

    const coerced = expectBound(bindWith([
      fieldCandidate(plan, {
        candidateId: "c-coerce",
        fieldId: "startDate",
        extractionFactId: "F-prose",
        value: { valueType: "DATE", value: "2024-03-01" },
      }),
      fieldCandidate(plan, {
        candidateId: "c-yes",
        fieldId: "flag",
        extractionFactId: "F-yes",
        value: { valueType: "BOOLEAN", value: "true" },
      }),
    ]).result);
    expect(coerced.verified.facts).toHaveLength(0);
    expect(coerced.unresolved.candidates.every((item) => item.reasons.includes("FIELD_COERCION"))).toBe(true);
    expect(coerced.unresolved.candidates.every((item) => item.trust !== "REVIEW_REQUIRED" || item.reasons.includes("FIELD_COERCION"))).toBe(true);
  });

  it("does not attach one fact to two instances or reuse an instance id across entities", () => {
    const { plan } = world();
    const sharedFact = expectBound(bindWith([
      fieldCandidate(plan, { candidateId: "c-a", instanceId: "north" }),
      fieldCandidate(plan, { candidateId: "c-b", instanceId: "south" }),
    ]).result);
    expect(sharedFact.verified.facts).toHaveLength(0);
    expect(sharedFact.unresolved.candidates.map((item) => item.reasons)).toEqual([
      ["CROSS_INSTANCE"],
      ["CROSS_INSTANCE"],
    ]);

    const sharedId = expectBound(bindWith([
      fieldCandidate(plan, { candidateId: "c-item", instanceId: "shared" }),
      fieldCandidate(plan, {
        candidateId: "c-other",
        taskId: taskId(plan, "entity:other"),
        entityId: "entity:other",
        instanceId: "shared",
        fieldId: "name",
        extractionFactId: "F-name",
        value: { valueType: "TEXT", value: "South" },
      }),
    ]).result);
    expect(sharedId.verified.facts).toHaveLength(0);
    expect(sharedId.unresolved.candidates.every((item) => item.reasons.includes("CROSS_INSTANCE"))).toBe(true);

    const swapped = expectBound(bindWith([
      ...validFields(plan),
      linkCandidate(plan, { candidateId: "c-swap", fromInstanceId: "south", toInstanceId: "north" }),
    ]).result);
    expect(swapped.verified.relationships).toHaveLength(0);
    const swap = swapped.unresolved.candidates.find((item) => item.candidateId === "c-swap");
    expect(swap?.reasons).toContain("DIRECTION_MISMATCH");
    expect(swap?.reasons).not.toContain("RELATIONSHIP_SEMANTICS_UNVERIFIED");
    expect(swap?.fromInstanceId).toBe("south");
    expect(swap?.toInstanceId).toBe("north");
    expect(swap?.trust).toBe("UNRESOLVED");
    expect(swap?.evidence).toEqual([{ sourceDocumentId: DOC, page: 1, quote: "North authorizes the review of South." }]);
  });

  it("does not verify a relationship from endpoint facts, a quote that misses either endpoint, or an unmatched question", () => {
    const { plan } = world();
    const endpointFacts = expectBound(bindWith([
      ...validFields(plan),
      linkCandidate(plan, {
        candidateId: "c-ends",
        evidence: [
          { sourceDocumentId: DOC, page: 1, quote: "Name: North." },
          { sourceDocumentId: DOC, page: 1, quote: "Other name: South." },
        ],
      }),
    ]).result);
    expect(endpointFacts.verified.relationships).toHaveLength(0);
    const ends = endpointFacts.unresolved.candidates.find((item) => item.candidateId === "c-ends");
    expect(ends).toMatchObject({
      trust: "REVIEW_REQUIRED",
      relationshipId: "relationship:item-other",
      fromInstanceId: "north",
      toInstanceId: "south",
      fromEntityId: "entity:item",
      toEntityId: "entity:other",
    });
    expect(ends?.reasons).toContain("ENDPOINT_FACTS_ARE_NOT_A_LINK");
    expect(ends?.evidence).toHaveLength(2);

    const questionOnly = expectBound(bindWith([
      ...validFields(plan),
      linkCandidate(plan, {
        candidateId: "c-question",
        evidence: [{ sourceDocumentId: DOC, page: 1, quote: "The records name one another." }],
      }),
    ]).result);
    const question = questionOnly.unresolved.candidates.find((item) => item.candidateId === "c-question");
    expect(questionOnly.verified.relationships).toHaveLength(0);
    expect(question?.trust).toBe("REVIEW_REQUIRED");
    expect(question?.reasons).toContain("ENDPOINTS_NOT_IDENTIFIED");
    expect(question?.trust).not.toBe("VERIFIED");
  });

  it("keeps two independently sourced relationship candidates unverified", () => {
    const { pack, plan } = world();
    const bound = expectBound(bindWith([
      ...validFields(plan),
      linkCandidate(plan, { candidateId: "c-link-a" }),
      linkCandidate(plan, {
        candidateId: "c-link-b",
        evidence: [{ sourceDocumentId: DOC, page: 2, quote: "North and South are linked in this record." }],
      }),
    ]).result);
    expect(bound.verified.facts).toHaveLength(4);
    expect(bound.verified.relationships).toEqual([]);
    const held = bound.unresolved.candidates.filter((item) => item.kind === "RELATIONSHIP");
    expect(held.map((item) => item.candidateId)).toEqual(["c-link-a", "c-link-b"]);
    expect(held.every((item) => item.trust === "REVIEW_REQUIRED" && item.reasons.includes("RELATIONSHIP_SEMANTICS_UNVERIFIED"))).toBe(true);
    expect(held.map((item) => item.relationshipId)).toEqual(["relationship:item-other", "relationship:item-other"]);
    expect(held.map((item) => item.fromInstanceId + "->" + item.toInstanceId)).toEqual(["north->south", "north->south"]);
    expect(held.map((item) => item.evidence[0]?.quote).sort()).toEqual([
      "North and South are linked in this record.",
      "North authorizes the review of South.",
    ]);
    expect(held.map((item) => item.sourceRefs[0]?.page).sort()).toEqual(["1", "2"]);
    expectNoComputedDayCount(pack, bound.verified);
  });

  it("does not verify an affirmative, negated, unrelated, contradictory, mistyped, or reversed free-text relationship", () => {
    const { pack, plan } = world();
    const fields = validFields(plan);
    const hold = (candidateId: string, evidence: { sourceDocumentId: string; page: number; quote: string }[]) =>
      expectHeldFreeText(pack, bindWith([...fields, linkCandidate(plan, { candidateId, evidence })]).result, candidateId, evidence.map((item) => item.quote));

    hold("c-affirm", [{ sourceDocumentId: DOC, page: 1, quote: "North authorizes the review of South." }]);
    hold("c-negate", [{ sourceDocumentId: DOC, page: 1, quote: "North does not authorize the review of South." }]);
    hold("c-unrelated", [{ sourceDocumentId: DOC, page: 1, quote: "North was present and South was present." }]);
    hold("c-contradict", [
      { sourceDocumentId: DOC, page: 1, quote: "North authorizes the review of South." },
      { sourceDocumentId: DOC, page: 1, quote: "North does not authorize the review of South." },
    ]);
    hold("c-type", [{ sourceDocumentId: DOC, page: 1, quote: "North disputes the record about South." }]);
    hold("c-reversed-words", [{ sourceDocumentId: DOC, page: 1, quote: "South authorizes the review of North." }]);

    const reversedEndpoints = expectBound(bindWith([
      ...fields,
      linkCandidate(plan, {
        candidateId: "c-reversed-ends",
        fromInstanceId: "south",
        toInstanceId: "north",
        evidence: [{ sourceDocumentId: DOC, page: 1, quote: "South authorizes the review of North." }],
      }),
    ]).result);
    expect(reversedEndpoints.verified.relationships).toEqual([]);
    expect(reversedEndpoints.verified.facts).toHaveLength(4);
    const reversed = reversedEndpoints.unresolved.candidates.find((item) => item.candidateId === "c-reversed-ends");
    expect(reversed?.trust).toBe("UNRESOLVED");
    expect(reversed?.reasons).toContain("DIRECTION_MISMATCH");
    expect(reversed?.relationshipId).toBe("relationship:item-other");
    expect(reversed?.fromInstanceId).toBe("south");
    expect(reversed?.toInstanceId).toBe("north");
    expect(reversed?.evidence).toEqual([{ sourceDocumentId: DOC, page: 1, quote: "South authorizes the review of North." }]);
    expectNoComputedDayCount(pack, reversedEndpoints.verified);
  });

  it("rejects unknown definitions, invented facts, unauthorized documents, and digest mismatches", () => {
    const { pack, plan, extractions } = world();
    const unknown = expectBound(bindWith([
      fieldCandidate(plan, { candidateId: "c-unknown", entityId: "entity:missing", taskId: "task:entity:missing" }),
      fieldCandidate(plan, { candidateId: "c-invented", extractionFactId: "F-made-up" }),
      linkCandidate(plan, {
        candidateId: "c-auth",
        evidence: [{ sourceDocumentId: "doc-unknown", page: 1, quote: "North authorizes the review of South." }],
      }),
    ]).result);
    expect(unknown.verified.facts).toHaveLength(0);
    expect(unknown.verified.relationships).toHaveLength(0);
    expect(unknown.unresolved.candidates.find((item) => item.candidateId === "c-unknown")?.reasons).toContain("UNKNOWN_DEFINITION");
    expect(unknown.unresolved.candidates.find((item) => item.candidateId === "c-invented")?.reasons).toContain("INVENTED_FACT");
    expect(unknown.unresolved.candidates.find((item) => item.candidateId === "c-auth")?.reasons).toContain("UNAUTHORIZED_DOCUMENT");

    const mismatched = bindInvestigationCandidates({
      pack,
      plan,
      extractions,
      documents: documents(),
      candidates: { ...envelope(plan, pack, extractions, validFields(plan)), planDigest: "0".repeat(64) },
    });
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) return;
    expect(mismatched.issues.some((item) => item.code === "digest_mismatch")).toBe(true);
    expect(JSON.stringify(mismatched)).not.toContain("\"status\":\"VERIFIED\"");

    const forbidden = bindInvestigationCandidates({
      pack,
      plan,
      extractions,
      documents: documents(),
      candidates: {
        ...envelope(plan, pack, extractions, [linkCandidate(plan)]),
        candidates: [{ ...linkCandidate(plan), outcome: "ESTABLISHED" }],
      },
    });
    expect(forbidden.ok).toBe(false);
    if (forbidden.ok) return;
    expect(forbidden.issues.some((item) => item.code === "forbidden_field")).toBe(true);

    const citedFacts = bindInvestigationCandidates({
      pack,
      plan,
      extractions,
      documents: documents(),
      candidates: {
        ...envelope(plan, pack, extractions, []),
        candidates: [{ ...linkCandidate(plan), extractionFactIds: ["F-label", "F-name"] }],
      },
    });
    expect(citedFacts.ok).toBe(false);
    if (citedFacts.ok) return;
    expect(citedFacts.issues.some((item) => item.code === "forbidden_field")).toBe(true);
    expect(JSON.stringify(citedFacts)).not.toContain("\"status\":\"VERIFIED\"");
  });

  it("does not embed a profession's identifiers in the binder", () => {
    const sourceText = readFileSync(new URL("./domain-investigation-binder.ts", import.meta.url), "utf8");
    expect(sourceText).not.toContain("check:G2");
    expect(sourceText).not.toContain("calculation:C1");
    expect(sourceText).not.toMatch(/\b275\b/);
  });
});
