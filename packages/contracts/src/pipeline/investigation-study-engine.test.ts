import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import { CoordinatedInvestigationLedger } from "./domain-investigation-agent";
import {
  acceptCanonicalInvestigation,
  assessCanonicalProjection,
  buildFieldMappingRequest,
  fieldMappingRequestLeaksRecordText,
  prepareInvestigationStudy,
  runInvestigationStudyEngine,
  type InvestigationEnginePin,
} from "./investigation-study-engine";
import { DOMAIN_PACK_SOURCE_SCHEMA, type CompiledDomainPack, type DomainPackSource } from "./domain-pack-source";
import type { SupplementalArtifacts } from "./domain-investigation-plan";
import {
  authoredRelationshipDirection,
  RELATIONSHIP_SOURCE_STRUCTURE_SCHEMA,
  relationshipStructureDigest,
} from "./domain-relationship-verification";
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

function companions(pack: CompiledDomainPack, extras?: { ruleIds?: string[]; fields?: Array<{ id: string; valueType: string }> }): SupplementalArtifacts {
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
            ...(extras?.fields ?? []),
          ],
          ruleIds: ["calculation:between", ...(extras?.ruleIds ?? [])],
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
      expect.objectContaining({ label: "Item label is North (page 1)", supportingFactIds: ["F-label"], status: "SUPPORTED" }),
      expect.objectContaining({ label: "Item start date is 2024-01-02 (page 1)", supportingFactIds: ["F-start"], status: "SUPPORTED" }),
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
    expect(JSON.stringify(result.study.outsideSpine)).toContain("Calculation Days between records was not published");
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
        note: `Not assessed. The compiled criterion is review only, so document coverage is not a legal conclusion. pack ${result.packDigest} plan ${result.planDigest}`,
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

  it("keeps a progress claim, a false conflict, and a professional decision out of the findings", () => {
    const input = proposal();
    const result = runInvestigationStudyEngine({
      prepared: input.prepared,
      extractions: extractions(),
      pages,
      proposal: input.proposal,
      studyDate: "2026-11-25",
      investigation: {
        intentText: "Should the family schedule a dentist visit before signing?",
        documentRoles: [],
        measurements: [],
        assessments: [{ statement: "The goal has been met.", factIds: ["F-label"] }],
        determinations: [{ statement: "A professional still has to decide." }],
        conflicts: [{ statement: "North and South disagree.", factIds: ["F-label", "F-name"] }],
        gaps: [],
        answers: [],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.study);
    expect(text).toContain("No subsequent measurement supports a progress conclusion");
    expect(result.study.spine.some((item) => /has been met/i.test(item.label))).toBe(false);
    expect(result.study.conflicts).toEqual([]);
    expect(text).toContain("not two values of the same field");
    expect(text).toContain("Open for a professional");
    expect(text).toContain("dentist");
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

  it("rejects a ledger execution with a missing or invalid schedule", () => {
    const prepared = world();
    const missing = new CoordinatedInvestigationLedger("run-schedule", prepared.pack, extractions(), pages, "");
    const refused = JSON.parse(missing.execute({ id: "finish", name: "finish_investigation", arguments: JSON.stringify({ ready: true }) }).content) as { ok: boolean; error?: string };
    expect(refused).toMatchObject({ ok: false, error: "investigation_incomplete" });
    expect(missing.assemble()).toBeNull();
    expect(missing.armCompletion({ windowCount: 0, documentIds: [DOC, OTHER_DOC] })).toBe(false);
    expect(missing.armCompletion({ windowCount: 1, documentIds: [DOC] })).toBe(false);
    const stillRefused = JSON.parse(missing.execute({ id: "finish-2", name: "propose_field", arguments: "{}" }).content) as { error?: string };
    expect(stillRefused.error).toBe("investigation_incomplete");
  });

  it("refuses acceptance when completeness is not true", () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completeness.complete).toBe(false);
    expect(acceptCanonicalInvestigation(result)).toEqual({ ok: false, code: "INVESTIGATION_INCOMPLETE" });
    expect(result.study.documents.every((document) => document.classification === "UNRESOLVED")).toBe(true);
    expect(JSON.stringify(result.study.gaps)).not.toContain("Missing information");
  });

  it("admits a blank field and a named missing document, and does not invent either", () => {
    const rows = extractions();
    const page = `${PAGE_1} Flag: . See the prior schedule for the review.`;
    rows[0] = {
      ...rows[0]!,
      emptyFields: [{ id: "E-flag", modelId: null, label: "flag", page: 1, quote: "Flag:" }],
      referencedDocuments: [
        { id: "R-unquoted", modelId: null, description: "IEP progress report", date: null, page: 1, quote: "Answer: yes." },
        { id: "R-named", modelId: null, description: "prior schedule", date: null, page: 1, quote: "See the prior schedule for the review." },
      ],
    };
    const drafted = source();
    const item = drafted.definitions.find((definition) => definition.id === "entity:item");
    if (item && item.kind === "entity") {
      const flag = item.fields.find((field) => field.id === "flag");
      if (flag) flag.required = true;
    }
    const prepared = prepareInvestigationStudy({
      packSource: drafted,
      artifacts: companions({ identity: { ...drafted.identity, digest: "pending" } } as CompiledDomainPack),
    });
    if (!prepared.ok) throw new Error(prepared.code);
    const result = runInvestigationStudyEngine({
      prepared: prepared.prepared,
      extractions: rows,
      pages: [
        { documentId: DOC, pages: [{ pageNumber: 1, text: page }] },
        { documentId: OTHER_DOC, pages: [{ pageNumber: 1, text: "Second record cover." }] },
      ],
      proposal: proposal().proposal,
      studyDate: "2026-11-25",
      investigation: {
        intentText: "",
        documentRoles: [],
        measurements: [],
        assessments: [],
        determinations: [],
        conflicts: [],
        gaps: [{ kind: "MISSING_INFORMATION", statement: "The unused note was not mapped.", entityId: "entity:item", fieldId: "label" }],
        answers: [],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.study.gaps.map((gap) => gap.statement)).toEqual([
      "The page shows flag blank.",
      "A verified quote names prior schedule, and that record is not in the authorized inventory.",
    ]);
    expect(JSON.stringify(result.study.outsideSpine)).toContain("Searched and not found: The unused note was not mapped.");
    expect(JSON.stringify(result.study.gaps)).not.toContain("IEP progress report");
    expect(JSON.stringify(result.study.gaps)).not.toContain("Missing information");
  });
});

const PARITY_PAGE = [
  PAGE_1,
  "Baseline value: 42 count.",
  "Baseline date: 2024-01-02.",
  "Target value: 75 count.",
].join(" ");
const LATER_PAGE = [
  "Observed value: 60 count.",
  "Observed date: 2024-06-01.",
  "north->south North South.",
].join(" ");

function paritySource(): DomainPackSource {
  const drafted = source();
  const item = drafted.definitions.find((definition) => definition.id === "entity:item");
  if (item && item.kind === "entity") {
    item.fields.push(
      { id: "baselineValue", valueType: "NUMBER", unit: "count" },
      { id: "baselineDate", valueType: "DATE" },
      { id: "targetValue", valueType: "NUMBER", unit: "count" },
      { id: "observedValue", valueType: "NUMBER", unit: "count" },
      { id: "observedDate", valueType: "DATE" },
    );
  }
  drafted.definitions.push(
    { id: "check:present", kind: "check", label: "Name is recorded", criterion: { op: "FIELD_PRESENT", entityId: "entity:item", fieldId: "label" } },
    { id: "check:absent", kind: "check", label: "Flag is recorded", criterion: { op: "FIELD_PRESENT", entityId: "entity:item", fieldId: "flag" } },
    { id: "question:customer", kind: "question", label: "Customer question", audience: "customer", text: "What name is recorded?", appliesWhen: { op: "FIELD_PRESENT", entityId: "entity:item", fieldId: "label" } },
    { id: "question:professional", kind: "question", label: "Professional question", audience: "professional", text: "What should be reviewed?", appliesWhen: { op: "REVIEW_REQUIRED" } },
    { id: "question:skipped", kind: "question", label: "Skipped question", audience: "customer", text: "What flag is recorded?", appliesWhen: { op: "FIELD_PRESENT", entityId: "entity:item", fieldId: "flag" } },
    { id: "persona:customer", kind: "persona", label: "Customer", audience: "customer", context: "The person asking.", questionIds: ["question:customer", "question:skipped"] },
    { id: "persona:professional", kind: "persona", label: "Professional", audience: "professional", context: "The reviewer.", questionIds: ["question:professional"] },
    { id: "chain:path", kind: "chain", label: "Item path", links: ["Item to other", "2024-01-02"] },
  );
  return drafted;
}

function parityArtifacts(drafted: DomainPackSource): SupplementalArtifacts {
  return companions(
    { identity: { ...drafted.identity, digest: "pending" } } as CompiledDomainPack,
    {
      ruleIds: ["check:present", "check:absent"],
      fields: [
        { id: "baselineValue", valueType: "NUMBER" },
        { id: "baselineDate", valueType: "DATE" },
        { id: "targetValue", valueType: "NUMBER" },
        { id: "observedValue", valueType: "NUMBER" },
        { id: "observedDate", valueType: "DATE" },
      ],
    },
  );
}

function holdingStructure(polarity: "HOLDS" | "DOES_NOT_HOLD" = "HOLDS", from = "North") {
  const body = {
    schema: RELATIONSHIP_SOURCE_STRUCTURE_SCHEMA,
    relationshipId: "relationship:item-other",
    direction: "AUTHORED_FROM_TO" as const,
    polarity,
    slots: [
      { role: "FROM_IDENTITY" as const, value: from },
      { role: "TO_IDENTITY" as const, value: "South" },
      { role: "POLARITY" as const, value: "North" },
      { role: "DIRECTION" as const, value: authoredRelationshipDirection("north", "south") },
    ],
  };
  return { ...body, structureDigest: relationshipStructureDigest(body) };
}

function parityCase(structures?: readonly unknown[]) {
  const drafted = paritySource();
  const prepared = prepareInvestigationStudy({
    packSource: drafted,
    artifacts: parityArtifacts(drafted),
  });
  if (!prepared.ok) throw new Error(prepared.code);
  const first = extraction([
    fact("F-label", "North", 1, "Name: North."),
    fact("F-start", "2024-01-02", 1, "Started 2024-01-02."),
    fact("F-name", "South", 1, "Other name: South."),
    fact("F-when", "2024-02-01", 1, "Ended 2024-02-01."),
    fact("F-base", "42", 1, "Baseline value: 42 count."),
    fact("F-base-date", "2024-01-02", 1, "Baseline date: 2024-01-02."),
    fact("F-target", "75", 1, "Target value: 75 count."),
  ]);
  const later = extraction([
    fact("F-observed", "60", 1, "Observed value: 60 count."),
    fact("F-observed-date", "2024-06-01", 1, "Observed date: 2024-06-01."),
    fact("F-link", "north->south North South.", 1, "north->south North South."),
  ], OTHER_DOC);
  const pages: InvestigationEnginePin["pages"] = [
    { documentId: DOC, pages: [{ pageNumber: 1, text: PARITY_PAGE }] satisfies VerificationPage[] },
    { documentId: OTHER_DOC, pages: [{ pageNumber: 1, text: LATER_PAGE }] },
  ];
  const proposal = {
    schema: "hive.field-mapping-proposal/1",
    mappings: [
      { documentId: DOC, extractionFactId: "F-label", entityId: "entity:item", instanceId: "north", fieldId: "label", valueType: "TEXT", value: "North" },
      { documentId: DOC, extractionFactId: "F-start", entityId: "entity:item", instanceId: "north", fieldId: "startDate", valueType: "DATE", value: "2024-01-02" },
      { documentId: DOC, extractionFactId: "F-name", entityId: "entity:other", instanceId: "south", fieldId: "name", valueType: "TEXT", value: "South" },
      { documentId: DOC, extractionFactId: "F-when", entityId: "entity:other", instanceId: "south", fieldId: "when", valueType: "DATE", value: "2024-02-01" },
      { documentId: DOC, extractionFactId: "F-base", entityId: "entity:item", instanceId: "north", fieldId: "baselineValue", valueType: "NUMBER", value: "42" },
      { documentId: DOC, extractionFactId: "F-base-date", entityId: "entity:item", instanceId: "north", fieldId: "baselineDate", valueType: "DATE", value: "2024-01-02" },
      { documentId: DOC, extractionFactId: "F-target", entityId: "entity:item", instanceId: "north", fieldId: "targetValue", valueType: "NUMBER", value: "75" },
      { documentId: OTHER_DOC, extractionFactId: "F-observed", entityId: "entity:item", instanceId: "north", fieldId: "observedValue", valueType: "NUMBER", value: "60" },
      { documentId: OTHER_DOC, extractionFactId: "F-observed-date", entityId: "entity:item", instanceId: "north", fieldId: "observedDate", valueType: "DATE", value: "2024-06-01" },
    ],
    relationships: [
      { documentId: OTHER_DOC, extractionFactId: "F-link", relationshipId: "relationship:item-other", fromInstanceId: "north", toInstanceId: "south" },
    ],
  };
  return runInvestigationStudyEngine({
    prepared: prepared.prepared,
    extractions: [first, later],
    pages,
    proposal,
    studyDate: "2026-11-25",
    relationshipStructures: structures,
    investigation: {
      intentText: "What name is recorded?",
      documentRoles: [],
      measurements: [],
      assessments: [{ statement: "The goal has been met.", factIds: ["F-base", "F-target", "F-observed"] }],
      determinations: [{ statement: "A professional still has to decide." }],
      conflicts: [{ statement: "The baseline and the target contradict each other.", factIds: ["F-base", "F-target"] }],
      gaps: [],
      answers: [
        { questionId: "question:customer", audience: "customer", factIds: ["F-label"] },
        { questionId: "question:professional", audience: "professional", factIds: [], uncertainty: "Still open." },
      ],
    },
  });
}

describe("investigation quality parity", () => {
  it("decides executable checks, withholds review, and compares later progress without a legal conclusion", () => {
    const result = parityCase();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const checklist = result.study.checklist ?? [];
    expect(checklist.find((item) => item.checkId === "check:present")).toMatchObject({
      verdict: "SHOWN",
      factIds: ["F-label"],
      note: "Established from cited evidence.",
    });
    expect(checklist.find((item) => item.checkId === "check:absent")).toMatchObject({
      verdict: "NOT_SHOWN",
      note: "The saved documents do not show this.",
    });
    expect(checklist.find((item) => item.checkId === "check:review")?.verdict).toBe("NOT_ASSESSED");
    expect(checklist.find((item) => item.checkId === "check:review")?.note).toContain("not a legal conclusion");
    const progress = result.study.spine.find((item) => item.kind === "progress");
    expect(progress?.label).toContain("baseline 42 count");
    expect(progress?.label).toContain("planned target 75 count");
    expect(progress?.label).toContain("observed 60 count");
    expect(progress?.label).toContain("below the planned target");
    expect(progress?.supportingFactIds).toEqual(expect.arrayContaining(["F-base", "F-target", "F-observed"]));
    expect(result.study.spine.some((item) => /has been met/i.test(item.label))).toBe(false);
    expect(JSON.stringify(result.study.outsideSpine)).toContain("The later measurement does not support that progress conclusion");
    expect(result.study.conflicts).toEqual([]);
    expect(JSON.stringify(result.study.outsideSpine)).toContain("not two values of the same field");
    expect(JSON.stringify(result.study.outsideSpine)).toContain("Open for a professional");
    expect(result.study.outsideSpine.some((item) => item.statement.includes("relationship:item-other") && item.statement.includes("RELATIONSHIP_SEMANTICS_UNVERIFIED"))).toBe(true);
    expect(result.study.chains?.[0]?.rows[0]?.links).toEqual([{ unresolved: true }, { unresolved: true }]);
    expect(result.study.spine.some((item) => item.kind === "calculation")).toBe(false);
    expect(JSON.stringify(result.study)).not.toMatch(/\b30 calendar days\b/);
    const coverage = result.study.personaCoverage ?? [];
    expect(coverage.find((item) => item.questionId === "question:customer")).toMatchObject({ audience: "customer", status: "ANSWERABLE", factIds: ["F-label"] });
    expect(coverage.find((item) => item.questionId === "question:professional")).toMatchObject({ status: "NOT_ANSWERABLE", missing: "Still open." });
    expect(coverage.find((item) => item.questionId === "question:skipped")).toMatchObject({
      status: "NOT_ASSESSED",
      factIds: [],
      missing: "",
    });
  });

  it("admits a cross-document relationship and publishes the day count only when the compiled structure matches", () => {
    const admitted = parityCase([holdingStructure()]);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const link = admitted.study.spine.find((item) => item.kind === "relationship");
    expect(link?.supportingFactIds).toContain("F-link");
    expect(link?.label).toContain("supported by the cited record");
    const calculation = admitted.study.spine.find((item) => item.kind === "calculation");
    expect(calculation?.label).toContain("30 calendar days");
    expect(calculation?.label).toContain("start 2024-01-02");
    expect(calculation?.label).toContain("end 2024-02-01");
    expect(calculation?.supportingFactIds).toEqual(expect.arrayContaining(["F-start", "F-when", "F-link"]));
    expect(admitted.study.outsideSpine.some((item) => item.statement.includes("relationship:item-other is not verified"))).toBe(false);
    expect(admitted.study.chains?.[0]?.rows[0]?.links[0]).toEqual({ factIds: ["F-link"] });
    expect(admitted.study.chains?.[0]?.rows[0]?.links[1]).toEqual({ unresolved: true });

    const withheld = parityCase([holdingStructure("HOLDS", "West")]);
    expect(withheld.ok).toBe(true);
    if (!withheld.ok) return;
    expect(withheld.study.spine.some((item) => item.kind === "relationship" || item.kind === "calculation")).toBe(false);
    expect(JSON.stringify(withheld.study.outsideSpine)).toContain("The compiled source structure does not match the quoted text.");
    expect(JSON.stringify(withheld.study)).not.toMatch(/\b30 calendar days\b/);
  });

  it("does not turn an unread page into a shown check", () => {
    const drafted = paritySource();
    const prepared = prepareInvestigationStudy({
      packSource: drafted,
      artifacts: parityArtifacts(drafted),
    });
    if (!prepared.ok) throw new Error(prepared.code);
    const complete = parityCase();
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    const first = extraction([
      fact("F-label", "North", 1, "Name: North."),
      fact("F-start", "2024-01-02", 1, "Started 2024-01-02."),
      fact("F-name", "South", 1, "Other name: South."),
      fact("F-when", "2024-02-01", 1, "Ended 2024-02-01."),
    ]);
    first.coverage = { ...first.coverage, truncated: true };
    const later = extraction([], OTHER_DOC);
    const result = runInvestigationStudyEngine({
      prepared: prepared.prepared,
      extractions: [first, later],
      pages: [
        { documentId: DOC, pages: [{ pageNumber: 1, text: PARITY_PAGE }] },
        { documentId: OTHER_DOC, pages: [{ pageNumber: 1, text: "Second record cover." }] },
      ],
      proposal: {
        schema: "hive.field-mapping-proposal/1",
        mappings: [
          { documentId: DOC, extractionFactId: "F-label", entityId: "entity:item", instanceId: "north", fieldId: "label", valueType: "TEXT", value: "North" },
          { documentId: DOC, extractionFactId: "F-start", entityId: "entity:item", instanceId: "north", fieldId: "startDate", valueType: "DATE", value: "2024-01-02" },
          { documentId: DOC, extractionFactId: "F-name", entityId: "entity:other", instanceId: "south", fieldId: "name", valueType: "TEXT", value: "South" },
          { documentId: DOC, extractionFactId: "F-when", entityId: "entity:other", instanceId: "south", fieldId: "when", valueType: "DATE", value: "2024-02-01" },
        ],
        relationships: [],
      },
      studyDate: "2026-11-25",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.study.spine.some((item) => item.supportingFactIds.includes("F-label"))).toBe(true);
    expect(result.study.checklist?.find((item) => item.checkId === "check:present")?.verdict).toBe("NOT_ASSESSED");
    expect(result.study.checklist?.find((item) => item.checkId === "check:present")?.note).toContain("not sufficient");
    expect(result.study.checklist?.some((item) => item.verdict === "SHOWN")).toBe(false);
  });

  it("keeps a verified field conflict when the model did not propose one", () => {
    const drafted = paritySource();
    const prepared = prepareInvestigationStudy({
      packSource: drafted,
      artifacts: parityArtifacts(drafted),
    });
    if (!prepared.ok) throw new Error(prepared.code);
    const page = `${PARITY_PAGE} Alias: West.`;
    const first = extraction([
      fact("F-label", "North", 1, "Name: North."),
      fact("F-alias", "West", 1, "Alias: West."),
      fact("F-start", "2024-01-02", 1, "Started 2024-01-02."),
      fact("F-name", "South", 1, "Other name: South."),
      fact("F-when", "2024-02-01", 1, "Ended 2024-02-01."),
    ]);
    const result = runInvestigationStudyEngine({
      prepared: prepared.prepared,
      extractions: [first, extraction([], OTHER_DOC)],
      pages: [
        { documentId: DOC, pages: [{ pageNumber: 1, text: page }] },
        { documentId: OTHER_DOC, pages: [{ pageNumber: 1, text: "Second record cover." }] },
      ],
      proposal: {
        schema: "hive.field-mapping-proposal/1",
        mappings: [
          { documentId: DOC, extractionFactId: "F-label", entityId: "entity:item", instanceId: "north", fieldId: "label", valueType: "TEXT", value: "North" },
          { documentId: DOC, extractionFactId: "F-alias", entityId: "entity:item", instanceId: "north", fieldId: "label", valueType: "TEXT", value: "West" },
          { documentId: DOC, extractionFactId: "F-start", entityId: "entity:item", instanceId: "north", fieldId: "startDate", valueType: "DATE", value: "2024-01-02" },
          { documentId: DOC, extractionFactId: "F-name", entityId: "entity:other", instanceId: "south", fieldId: "name", valueType: "TEXT", value: "South" },
          { documentId: DOC, extractionFactId: "F-when", entityId: "entity:other", instanceId: "south", fieldId: "when", valueType: "DATE", value: "2024-02-01" },
        ],
        relationships: [],
      },
      studyDate: "2026-11-25",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.study.conflicts).toEqual([
      expect.objectContaining({ factIds: expect.arrayContaining(["F-label", "F-alias"]) }),
    ]);
    expect(result.study.conflicts[0]?.statement).toContain("more than one saved value");
  });

  it("does not hardcode a profession or a corpus name in the study engine", () => {
    const sourceText = readFileSync(new URL("./investigation-study-engine.ts", import.meta.url), "utf8");
    expect(sourceText).not.toMatch(/\bIEP\b|\bL001\b|\bWCPM\b/);
  });
});
