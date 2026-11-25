import { describe, expect, it } from "vitest";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import {
  assessCanonicalProjection,
  buildFieldMappingRequest,
  fieldMappingRequestLeaksRecordText,
  prepareInvestigationStudy,
  runInvestigationStudyEngine,
  type InvestigationEnginePin,
} from "./investigation-study-engine";
import { DOMAIN_PACK_SOURCE_SCHEMA, type CompiledDomainPack, type DomainPackSource } from "./domain-pack-source";
import type { SupplementalArtifacts } from "./domain-investigation-plan";
import type { VerificationPage } from "./verify-quotes";

const DOC = "doc-1";
const OTHER_DOC = "doc-2";
const PAGE_1 = [
  "Name: North.",
  "Started 2024-01-02.",
  "Other name: South.",
  "Ended 2024-02-01.",
  "North authorizes the review of South.",
  "Noted March 1, 2024 in the margin.",
  "Answer: yes.",
].join(" ");

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
      { id: "check:review", kind: "check", label: "Needs a person", criterion: { op: "REVIEW_REQUIRED" } },
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
        checksSupported: ["check:review"],
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
    coverage: { pageCount: 1, pagesRead: [1], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 1 },
  };
}

const pages: InvestigationEnginePin["pages"] = [
  { documentId: DOC, pages: [{ pageNumber: 1, text: PAGE_1 }] satisfies VerificationPage[] },
  { documentId: OTHER_DOC, pages: [{ pageNumber: 1, text: "Second record cover." }] },
];

function world() {
  const drafted = source();
  const compiled = prepareInvestigationStudy({
    packSource: drafted,
    artifacts: companions({
      identity: { ...drafted.identity, digest: "pending" },
    } as CompiledDomainPack),
  });
  if (!compiled.ok) throw new Error(compiled.code);
  return compiled.prepared;
}

function extractions(): DocExtraction[] {
  return [
    extraction([
      fact("F-label", "North", 1, "Name: North."),
      fact("F-start", "2024-01-02", 1, "Started 2024-01-02."),
      fact("F-name", "South", 1, "Other name: South."),
      fact("F-when", "2024-02-01", 1, "Ended 2024-02-01."),
      fact("F-link", "North authorizes the review of South.", 1, "North authorizes the review of South."),
      fact("F-prose", "March 1, 2024", 1, "Noted March 1, 2024 in the margin."),
      fact("F-yes", "yes", 1, "Answer: yes."),
    ]),
    extraction([], OTHER_DOC),
  ];
}

function proposal(overrides?: { mappings?: unknown[]; relationships?: unknown[] }) {
  const prepared = world();
  const mappings = overrides?.mappings ?? [
    { documentId: DOC, extractionFactId: "F-label", entityId: "entity:item", instanceId: "north", fieldId: "label", valueType: "TEXT", value: "North" },
    { documentId: DOC, extractionFactId: "F-start", entityId: "entity:item", instanceId: "north", fieldId: "startDate", valueType: "DATE", value: "2024-01-02" },
    { documentId: DOC, extractionFactId: "F-name", entityId: "entity:other", instanceId: "south", fieldId: "name", valueType: "TEXT", value: "South" },
    { documentId: DOC, extractionFactId: "F-when", entityId: "entity:other", instanceId: "south", fieldId: "when", valueType: "DATE", value: "2024-02-01" },
    { documentId: DOC, extractionFactId: "F-prose", entityId: "entity:item", instanceId: "north", fieldId: "startDate", valueType: "DATE", value: "2024-03-01" },
    { documentId: DOC, extractionFactId: "F-yes", entityId: "entity:item", instanceId: "north", fieldId: "flag", valueType: "BOOLEAN", value: "true" },
  ];
  const relationships = overrides?.relationships ?? [
    { documentId: DOC, extractionFactId: "F-link", relationshipId: "relationship:item-other", fromInstanceId: "north", toInstanceId: "south" },
  ];
  return {
    prepared,
    proposal: { schema: "hive.field-mapping-proposal/1", mappings, relationships },
  };
}

function run(overrides?: { mappings?: unknown[]; relationships?: unknown[]; pages?: InvestigationEnginePin["pages"] }) {
  const input = proposal(overrides);
  return runInvestigationStudyEngine({
    prepared: input.prepared,
    extractions: extractions(),
    pages: overrides?.pages ?? pages,
    proposal: input.proposal,
    studyDate: "2026-11-25",
  });
}

describe("investigation study engine", () => {
  it("projects verified text and date facts with their evidence ids and pages", () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.study.schema).toBe("hive.canonical-study/1");
    expect(result.study.spine).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "label: North (page 1)", supportingFactIds: ["F-label"], status: "SUPPORTED" }),
      expect.objectContaining({ label: "startDate: 2024-01-02 (page 1)", supportingFactIds: ["F-start"], status: "SUPPORTED" }),
    ]));
    expect(result.study.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: "2024-01-02", asWritten: "2024-01-02", factIds: ["F-start"] }),
    ]));
    expect(result.study.questionOrder).toEqual([
      `pack-digest:${result.packDigest}`,
      `plan-digest:${result.planDigest}`,
    ]);
    expect(result.study.documents.map((document) => document.sourceDocumentId).sort()).toEqual([DOC, OTHER_DOC]);
  });

  it("keeps an unsupported date or boolean conversion out of the study", () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.study);
    expect(serialized).toContain("March 1, 2024");
    expect(serialized).not.toContain("2024-03-01");
    expect(serialized).toContain("Written value was not converted: March 1, 2024.");
    expect(serialized).toContain("Written value was not converted: yes.");
    expect(result.study.outsideSpine.find((item) => item.statement.includes("March 1, 2024"))?.factIds).toEqual(["F-prose"]);
    expect(result.study.spine.some((item) => item.supportingFactIds.includes("F-prose") || item.supportingFactIds.includes("F-yes"))).toBe(false);
  });

  it("leaves a relationship unverified and does not publish a day count", () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const link = result.study.outsideSpine.find((item) => item.statement.includes("relationship:item-other"));
    expect(link).toMatchObject({
      statement: expect.stringContaining("is not verified"),
      factIds: ["F-link"],
    });
    expect(JSON.stringify(result.study)).not.toContain("daysBetween");
    expect(JSON.stringify(result.study)).not.toMatch(/\b30\b/);
  });

  it("keeps a review-only check unassessed and records the pack and plan digests", () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.study.checklist).toEqual([
      expect.objectContaining({
        checkId: "check:review",
        verdict: "NOT_ASSESSED",
        factIds: [],
        note: `Review required. pack ${result.packDigest} plan ${result.planDigest}`,
      }),
    ]);
    expect(result.study.checklist?.some((item) => item.verdict === "SHOWN" || item.verdict === "NOT_SHOWN")).toBe(false);
  });

  it("rejects a quotation that is not on the authorized page", () => {
    const result = run({
      pages: [
        { documentId: DOC, pages: [{ pageNumber: 1, text: "Name: North. Started 2024-01-02. Other name: South. Ended 2024-02-01." }] },
        { documentId: OTHER_DOC, pages: [{ pageNumber: 1, text: "Second record cover." }] },
      ],
    });
    expect(result).toEqual({ ok: false, code: "INVALID_EVIDENCE" });
  });

  it("rejects an empty candidate envelope and a study-shaped model answer", () => {
    expect(run({ mappings: [], relationships: [] })).toEqual({ ok: false, code: "EMPTY_CANDIDATES" });
    const input = proposal();
    expect(runInvestigationStudyEngine({
      prepared: input.prepared,
      extractions: extractions(),
      pages,
      proposal: { schema: "hive.canonical-study/1", documents: [], spine: [] },
      studyDate: "2026-11-25",
    })).toEqual({ ok: false, code: "MAPPING_INVALID" });
  });

  it("rejects an incomplete document list and a fact id the extraction does not contain", () => {
    const result = run({ relationships: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dropped = { ...result.study, documents: result.study.documents.filter((document) => document.sourceDocumentId !== OTHER_DOC) };
    expect(assessCanonicalProjection(dropped, extractions())).toEqual({ ok: false, code: "INCOMPLETE_DOCUMENTS" });
    const invented = {
      ...result.study,
      spine: result.study.spine.map((item, index) => index === 0 ? { ...item, supportingFactIds: ["F-missing"] } : item),
    };
    expect(assessCanonicalProjection(invented, extractions())).toEqual({ ok: false, code: "VERIFICATION_FAILED" });
  });

  it("sends written fact values to the mapping request and withholds page text", () => {
    const prepared = world();
    const request = buildFieldMappingRequest(prepared.pack, extractions());
    expect(request.schema).toBe("hive.field-mapping-request/1");
    expect(JSON.stringify(request)).toContain("North");
    expect(JSON.stringify(request)).toContain("2024-01-02");
    expect(JSON.stringify(request)).not.toContain(PAGE_1);
    expect(fieldMappingRequestLeaksRecordText(request, [{ text: PAGE_1 }])).toBe(false);
    expect(fieldMappingRequestLeaksRecordText({ ...request, facts: [...request.facts, { valueAsWritten: PAGE_1 }] }, [{ text: PAGE_1 }])).toBe(false);
    expect(fieldMappingRequestLeaksRecordText({ ...request, quote: PAGE_1 }, [{ text: PAGE_1 }])).toBe(true);
  });
});
