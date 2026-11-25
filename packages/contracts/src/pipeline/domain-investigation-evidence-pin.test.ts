import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packDigest } from "./domain-pack-compiler";
import { compileDomainPack } from "./domain-pack-compiler";
import {
  authorizedExtractionDigest,
  bindInvestigationCandidates,
  INVESTIGATION_CANDIDATES_SCHEMA,
} from "./domain-investigation-binder";
import { compileInvestigationPlan, type SupplementalArtifacts } from "./domain-investigation-plan";
import { investigationEvidenceDigest } from "./domain-investigation-ledger";
import { evaluateDomainRules } from "./domain-pack-rules";
import {
  DOMAIN_PACK_SOURCE_SCHEMA,
  type CompiledDomainPack,
  type DomainPackSource,
} from "./domain-pack-source";
import {
  compiledPackArtifact,
  investigationPlanArtifact,
  INVESTIGATION_EVIDENCE_PIN_SCHEMA,
  prepareInvestigationEvidencePin,
  type PrepareInvestigationEvidencePinResult,
  type SourcePageGeneration,
} from "./domain-investigation-evidence-pin";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import {
  computePageSetDigest,
  computeReadFingerprint,
  computeSha256Digest,
  computeSha256Hex,
} from "../source-documents/document-read-contracts";

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

function source(title = "Example review"): DomainPackSource {
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: "example-review", version: "1.0.0", title },
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

function compilePack(title?: string): CompiledDomainPack {
  const compiled = compileDomainPack(source(title));
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

function generation(sourceDocumentId: string, pages: { pageNumber: number; text: string }[]): SourcePageGeneration {
  const sourceSha256 = computeSha256Hex(sourceDocumentId);
  const withHashes = pages.map((page) => ({ ...page, pageTextSha256: computeSha256Digest(page.text) }));
  return {
    sourceDocumentId,
    sourceSha256,
    readFingerprint: computeReadFingerprint({ sourceSha256 }),
    pageSetDigest: computePageSetDigest({
      sourceSha256,
      pageCount: withHashes.length,
      pages: withHashes.map((page) => ({ pageNumber: page.pageNumber, textSha256: page.pageTextSha256 })),
    }),
    pages: withHashes,
  };
}

function generations(): SourcePageGeneration[] {
  return [
    generation(DOC, [{ pageNumber: 1, text: PAGE_1 }, { pageNumber: 2, text: PAGE_2 }]),
    generation(OTHER_DOC, [{ pageNumber: 1, text: OTHER_PAGE }]),
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

function envelope(
  plan: ReturnType<typeof compilePlan>,
  pack: CompiledDomainPack,
  extractions: readonly DocExtraction[],
  candidates: unknown[],
) {
  return {
    schema: INVESTIGATION_CANDIDATES_SCHEMA,
    planDigest: plan.digest,
    packDigest: pack.identity.digest,
    extractionDigest: authorizedExtractionDigest(extractions),
    candidates,
  };
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

function documentCandidate(plan: ReturnType<typeof compilePlan>) {
  return {
    candidateId: "c-doc",
    taskId: taskId(plan, "document:record"),
    kind: "DOCUMENT",
    documentKindId: "document:record",
    documentId: DOC,
    extractionFactId: "F-cover",
    subject: { entityId: "entity:item", instanceId: "north" },
    evidence: [{ sourceDocumentId: DOC, page: 1, quote: "Record cover: North." }],
  };
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

function expectPin(result: PrepareInvestigationEvidencePinResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code + " " + result.path);
  return result;
}

function expectRefused(result: PrepareInvestigationEvidencePinResult, code: string) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("pin was produced");
  expect(result.code).toBe(code);
  expect(result).not.toHaveProperty("pin");
  expect(result).not.toHaveProperty("retrieval");
}

describe("prepareInvestigationEvidencePin", () => {
  it("creates a pin from the binder output and content-addressed pack and plan artifacts", () => {
    const { pack, plan, extractions } = world();
    const candidates = [...validFields(plan), documentCandidate(plan)];
    const prepared = expectPin(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: generations(),
      candidates: envelope(plan, pack, extractions, candidates),
    }));
    const again = expectPin(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: generations(),
      candidates: envelope(plan, pack, extractions, candidates),
    }));
    const bound = bindInvestigationCandidates({
      pack,
      plan,
      extractions,
      documents: generations().map((item) => ({
        documentId: item.sourceDocumentId,
        pages: item.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
      })),
      candidates: envelope(plan, pack, extractions, candidates),
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    expect(prepared.pin.schema).toBe(INVESTIGATION_EVIDENCE_PIN_SCHEMA);
    expect(prepared.pin.pinId).toBe(again.pin.pinId);
    expect(prepared.pin.pinId).toMatch(/^[0-9a-f]{64}$/);
    const { pinId, ...body } = prepared.pin;
    expect(packDigest(body)).toBe(pinId);
    expect(prepared.pin.verified).toEqual(bound.verified);
    expect(prepared.pin.unresolved).toEqual(bound.unresolved);
    expect(prepared.pin.verified.coverage).toBe("INCOMPLETE");
    expect(prepared.pin.verified.facts).toHaveLength(4);
    expect(prepared.pin.verified.documents).toHaveLength(1);
    expect(prepared.pin.verified.relationships).toEqual([]);
    expect(prepared.pin.binderDigest).toBe(bound.digest);
    expect(prepared.pin.binderDigest).toBe(packDigest({ verified: bound.verified, unresolved: bound.unresolved }));
    expect(prepared.pin.evidenceDigest).toBe(investigationEvidenceDigest(bound.verified, bound.unresolved));
    expect(prepared.pin.extractionDigest).toBe(authorizedExtractionDigest(extractions));
    expect(prepared.pin.artifacts.pack).toEqual({
      retrieval: "CONTENT_DIGEST",
      schema: "hive.domain-pack-runtime/1",
      packId: pack.identity.packId,
      version: pack.identity.version,
      digest: pack.identity.digest,
    });
    expect(prepared.pin.artifacts.plan).toEqual({
      retrieval: "CONTENT_DIGEST",
      schema: "hive.domain-investigation-plan/1",
      digest: plan.digest,
    });
    expect(prepared.retrieval.pack.digest).toBe(compiledPackArtifact(pack).digest);
    expect(prepared.retrieval.plan.digest).toBe(investigationPlanArtifact(plan).digest);
    expect(packDigest(JSON.parse(prepared.retrieval.pack.canonicalJson))).toBe(prepared.retrieval.pack.digest);
    expect(packDigest(JSON.parse(prepared.retrieval.plan.canonicalJson))).toBe(prepared.retrieval.plan.digest);
    expect(prepared.pin.artifacts.pack.digest).toBe(prepared.retrieval.pack.digest);
    expect(prepared.pin.artifacts.plan.digest).toBe(prepared.retrieval.plan.digest);
    expect(JSON.stringify(prepared.pin.artifacts)).not.toMatch(/"(path|storagePath|filePath|filesystemPath|uri|location)"/);
    expect(prepared.pin.sourceGenerations).toHaveLength(2);
    expect(prepared.pin.sourceGenerations.map((item) => item.sourceDocumentId)).toEqual([DOC, OTHER_DOC]);
    const doc = prepared.pin.sourceGenerations[0];
    expect(doc?.pageCount).toBe(2);
    expect(doc?.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(doc?.pages[0]?.pageTextSha256).toBe(computeSha256Digest(PAGE_1));
    expect(doc?.pages[1]?.pageTextSha256).toBe(computeSha256Digest(PAGE_2));
    expect(doc?.pageSetDigest).toBe(computePageSetDigest({
      sourceSha256: doc?.sourceSha256 ?? "",
      pageCount: 2,
      pages: doc?.pages.map((page) => ({ pageNumber: page.pageNumber, textSha256: page.pageTextSha256 })) ?? [],
    }));
    expect(prepared.pin.sourceGenerationsDigest).toBe(packDigest(prepared.pin.sourceGenerations));
    expect(JSON.stringify(prepared.pin)).not.toContain("Noted March 1, 2024 in the margin.");
    expect(JSON.stringify(prepared.pin)).not.toContain(PAGE_1);
  });

  it("pins a completed investigation with zero candidates and incomplete coverage", () => {
    const { pack, plan, extractions } = world();
    const prepared = expectPin(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: generations(),
      candidates: envelope(plan, pack, extractions, []),
    }));
    expect(prepared.pin.verified.coverage).toBe("INCOMPLETE");
    expect(prepared.pin.verified.facts).toEqual([]);
    expect(prepared.pin.verified.documents).toEqual([]);
    expect(prepared.pin.verified.relationships).toEqual([]);
    expect(prepared.pin.unresolved.candidates).toEqual([]);
    expect(prepared.pin.sourceGenerations).toHaveLength(2);
    expect(prepared.pin.sourceGenerations.reduce((count, item) => count + item.pageCount, 0)).toBe(3);
  });

  it("keeps the same pin id when candidate, document, and page order change", () => {
    const { pack, plan, extractions } = world();
    const candidates = [...validFields(plan), documentCandidate(plan)];
    const forward = expectPin(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: generations(),
      candidates: envelope(plan, pack, extractions, candidates),
    }));
    const backward = expectPin(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions: [...extractions].reverse(),
      sourceGenerations: [...generations()].reverse().map((item) => ({ ...item, pages: [...item.pages].reverse() })),
      candidates: envelope(plan, pack, extractions, [...candidates].reverse()),
    }));
    expect(backward.pin.pinId).toBe(forward.pin.pinId);
    expect(backward.pin.binderDigest).toBe(forward.pin.binderDigest);
    expect(backward.pin.evidenceDigest).toBe(forward.pin.evidenceDigest);
    expect(backward.pin.extractionDigest).toBe(forward.pin.extractionDigest);
    expect(backward.pin.sourceGenerationsDigest).toBe(forward.pin.sourceGenerationsDigest);
  });

  it("refuses an altered document generation", () => {
    const { pack, plan, extractions } = world();
    const altered = generations();
    altered[0] = { ...altered[0]!, sourceSha256: "ab".repeat(32) };
    expectRefused(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: altered,
      candidates: envelope(plan, pack, extractions, []),
    }), "SOURCE_GENERATION_MISMATCH");
  });

  it("refuses an altered page and binds a consistently replaced page to a different pin", () => {
    const { pack, plan, extractions } = world();
    const altered = generations();
    const first = altered[0]!;
    altered[0] = {
      ...first,
      pages: first.pages.map((page) => page.pageNumber === 1 ? { ...page, text: page.text + " Added later." } : page),
    };
    expectRefused(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: altered,
      candidates: envelope(plan, pack, extractions, []),
    }), "PAGE_GENERATION_MISMATCH");

    const replaced = generations();
    replaced[0] = generation(DOC, [
      { pageNumber: 1, text: PAGE_1 + " Added later." },
      { pageNumber: 2, text: PAGE_2 },
    ]);
    const original = expectPin(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: generations(),
      candidates: envelope(plan, pack, extractions, []),
    }));
    const next = expectPin(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: replaced,
      candidates: envelope(plan, pack, extractions, []),
    }));
    expect(next.pin.pinId).not.toBe(original.pin.pinId);
    expect(next.pin.sourceGenerations[0]?.pages[0]?.pageTextSha256).toBe(computeSha256Digest(PAGE_1 + " Added later."));
    expect(next.pin.sourceGenerationsDigest).not.toBe(original.pin.sourceGenerationsDigest);
  });

  it("refuses an extraction digest that does not match the authorized payloads", () => {
    const { pack, plan, extractions } = world();
    expectRefused(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: generations(),
      candidates: { ...envelope(plan, pack, extractions, []), extractionDigest: "0".repeat(64) },
    }), "EXTRACTION_DIGEST_MISMATCH");
  });

  it("refuses a pack or plan mismatch", () => {
    const { pack, plan, extractions } = world();
    const input = {
      pack,
      plan,
      extractions,
      sourceGenerations: generations(),
    };
    expectRefused(prepareInvestigationEvidencePin({
      ...input,
      candidates: { ...envelope(plan, pack, extractions, []), packDigest: "1".repeat(64) },
    }), "PACK_DIGEST_MISMATCH");
    expectRefused(prepareInvestigationEvidencePin({
      ...input,
      candidates: { ...envelope(plan, pack, extractions, []), planDigest: "2".repeat(64) },
    }), "PLAN_DIGEST_MISMATCH");

    const otherPack = compilePack("Another review");
    const otherPlan = compilePlan(otherPack);
    expect(otherPlan.digest).not.toBe(plan.digest);
    expectRefused(prepareInvestigationEvidencePin({
      ...input,
      plan: otherPlan,
      candidates: envelope(otherPlan, otherPack, extractions, []),
    }), "PACK_PLAN_MISMATCH");

    const tampered = structuredClone(pack);
    const definition = tampered.definitions.find((item) => item.id === "entity:item");
    if (!definition || definition.kind !== "entity") throw new Error("missing entity");
    definition.label = "Changed";
    expectRefused(prepareInvestigationEvidencePin({
      ...input,
      pack: tampered,
      candidates: envelope(plan, pack, extractions, []),
    }), "PACK_DIGEST_MISMATCH");

    const tamperedPlan = structuredClone(plan);
    tamperedPlan.digest = "ab".repeat(32);
    expectRefused(prepareInvestigationEvidencePin({
      ...input,
      plan: tamperedPlan,
      candidates: envelope(plan, pack, extractions, []),
    }), "PLAN_DIGEST_MISMATCH");
  });

  it("preserves an unresolved relationship candidate without promoting it", () => {
    const { pack, plan, extractions } = world();
    const candidates = [...validFields(plan), linkCandidate(plan)];
    const prepared = expectPin(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: generations(),
      candidates: envelope(plan, pack, extractions, candidates),
    }));
    expect(prepared.pin.verified.relationships).toEqual([]);
    expect(JSON.stringify(prepared.pin.verified)).not.toContain("relationship:item-other");
    const held = prepared.pin.unresolved.candidates.find((item) => item.candidateId === "c-link");
    expect(held).toMatchObject({
      kind: "RELATIONSHIP",
      trust: "REVIEW_REQUIRED",
      reasons: ["RELATIONSHIP_SEMANTICS_UNVERIFIED"],
      relationshipId: "relationship:item-other",
      fromInstanceId: "north",
      toInstanceId: "south",
      evidence: [{ sourceDocumentId: DOC, page: 1, quote: "North authorizes the review of South." }],
    });
    expect(held?.trust).not.toBe("VERIFIED");
    const evaluation = evaluateDomainRules(pack, prepared.pin.verified);
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const between = evaluation.results.find((item) => item.ruleId === "calculation:between");
    expect(between).toMatchObject({ outcome: "NOT_EVALUATED" });
    expect(between?.daysBetween).toBeUndefined();
  });

  it("refuses missing, failed, and invalid investigation input", () => {
    const { pack, plan, extractions } = world();
    const ready = {
      pack,
      plan,
      extractions,
      sourceGenerations: generations(),
    };
    expectRefused(prepareInvestigationEvidencePin({ ...ready, candidates: null }), "MISSING_INVESTIGATION");
    expectRefused(prepareInvestigationEvidencePin({ ...ready, candidates: undefined }), "MISSING_INVESTIGATION");
    expectRefused(prepareInvestigationEvidencePin({
      ...ready,
      candidates: { status: "FAILED" },
    }), "INVALID_INVESTIGATION");
    expectRefused(prepareInvestigationEvidencePin({
      ...ready,
      candidates: { ...envelope(plan, pack, extractions, []), schema: "hive.investigation-candidates/0" },
    }), "INVALID_INVESTIGATION");
    expectRefused(prepareInvestigationEvidencePin({
      ...ready,
      candidates: { ...envelope(plan, pack, extractions, []), candidates: "not-a-list" },
    }), "INVALID_INVESTIGATION");

    const duplicated = envelope(plan, pack, extractions, [fieldCandidate(plan), fieldCandidate(plan)]);
    expectRefused(prepareInvestigationEvidencePin({ ...ready, candidates: duplicated }), "INVESTIGATION_FAILED");
    const forbidden = envelope(plan, pack, extractions, [{ ...linkCandidate(plan), outcome: "ESTABLISHED" }]);
    expectRefused(prepareInvestigationEvidencePin({ ...ready, candidates: forbidden }), "INVESTIGATION_FAILED");
    expectRefused(prepareInvestigationEvidencePin({
      ...ready,
      sourceGenerations: generations().map((item) => ({ ...item, path: "C:\\packs\\mutable.json" })),
      candidates: envelope(plan, pack, extractions, []),
    }), "INVALID_BINDING");
  });

  it("refuses an unauthorized source and evidence that cites a page outside its generation", () => {
    const { pack, plan, extractions } = world();
    const unauthorized = prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: generations(),
      candidates: envelope(plan, pack, extractions, [
        linkCandidate(plan, {
          candidateId: "c-auth",
          evidence: [{ sourceDocumentId: "doc-unknown", page: 1, quote: "North authorizes the review of South." }],
        }),
      ]),
    });
    expectRefused(unauthorized, "UNAUTHORIZED_SOURCE");

    const pageOnly = generation(DOC, [{ pageNumber: 2, text: PAGE_2 }]);
    const missingPage = prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions,
      sourceGenerations: [pageOnly, generation(OTHER_DOC, [{ pageNumber: 1, text: OTHER_PAGE }])],
      candidates: envelope(plan, pack, extractions, []),
    });
    expectRefused(missingPage, "MISSING_REFERENCED_EVIDENCE");

    const foreign = extraction(baseFacts, "doc-unknown");
    expectRefused(prepareInvestigationEvidencePin({
      pack,
      plan,
      extractions: [foreign],
      sourceGenerations: generations(),
      candidates: envelope(plan, pack, [foreign], []),
    }), "UNAUTHORIZED_SOURCE");
  });

  it("stays domain-agnostic and addresses artifacts by content digest", () => {
    const sourceText = readFileSync(new URL("./domain-investigation-evidence-pin.ts", import.meta.url), "utf8");
    expect(sourceText.toLowerCase()).not.toContain("iep");
    expect(sourceText).toContain("CONTENT_DIGEST");
    expect(sourceText).not.toContain("writeInvestigationEvidencePin(");
  });
});
