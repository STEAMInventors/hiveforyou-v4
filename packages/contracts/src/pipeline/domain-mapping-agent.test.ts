import { describe, expect, it } from "vitest";
import { compileDomainPack } from "./domain-pack-compiler";
import { DOMAIN_PACK_SOURCE_SCHEMA, type DomainPackSource } from "./domain-pack-source";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import {
  DomainMappingLedger,
  MAPPING_AGENT_TOOL_NAMES,
  MAPPING_WINDOW_LIMITS,
  selectMappingWindows,
} from "./domain-mapping-agent";
import type { AuthorizedDocument } from "./domain-investigation-binder";
import { prepareInvestigationStudy, runInvestigationStudyEngine } from "./investigation-study-engine";
import type { SupplementalArtifacts } from "./domain-investigation-plan";

const DOC = "doc-1";
const PAGE = "Name: North. Started 2024-01-02. North authorizes the review of South.";

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
        ],
      },
      {
        id: "entity:other", kind: "entity", label: "Other",
        fields: [{ id: "name", valueType: "TEXT" }],
      },
      {
        id: "relationship:item-other", kind: "relationship", label: "Item to other",
        fromEntityId: "entity:item", toEntityId: "entity:other", evidenceRequired: true,
      },
      { id: "term:word", kind: "term", label: "Word", meaning: "A defined word." },
    ],
    changes: [],
    review: { status: "DRAFT" },
  };
}

function companions(packId: string, version: string): SupplementalArtifacts {
  return {
    ontology: {
      schema: "hive.domain-ontology-spec/1",
      packRef: { packId, version },
      entities: [
        {
          id: "entity:item", factClass: "RECORD",
          fields: [
            { id: "label", valueType: "TEXT" },
            { id: "startDate", valueType: "DATE" },
          ],
          ruleIds: [],
          documentKinds: [],
          identityKeys: ["label"],
        },
        {
          id: "entity:other", factClass: "RECORD",
          fields: [{ id: "name", valueType: "TEXT" }],
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
      documents: [],
      calculations: [],
    },
    authorityRegister: {
      schema: "hive.domain-authority-register/1",
      authorities: [],
      definitionAuthorityMap: {},
      authorityRoles: {},
      structuralDefinitions: { "term:word": "STRUCTURAL - persona/report/intake definition; makes no domain claim." },
      unusedAuthorityDisposition: {},
    },
    conflictPatterns: { schema: "hive.domain-conflict-pattern-spec/1", dp1Supported: false, patterns: [] },
    stateOverlays: { schema: "hive.domain-state-overlay-spec/1", dp1Supported: false, overlays: [] },
    factClasses: { schema: "hive.domain-fact-class-spec/1", dp1Supported: false, classes: ["RECORD"] },
    workflowCoverage: { schema: "hive.domain-workflow-coverage-spec/1", dp1Supported: false, rows: [] },
    unsupportedOperators: { schema: "hive.domain-unsupported-operator-spec/1", dp1Supported: false, operators: [] },
  };
}

function fact(id: string, attribute: string, written: string, quote: string): ExtractionFact {
  return {
    id,
    modelId: id,
    category: "record",
    subject: "record",
    attribute,
    value: written,
    valueAsWritten: written,
    unit: null,
    per: null,
    timeframe: { from: null, to: null, asWritten: null },
    modality: "stated",
    attributedTo: null,
    aboutPersonRef: null,
    tableContext: null,
    evidence: [{ page: 1, printedPageLabel: null, quote }],
    confidence: "high",
  };
}

function extraction(facts: ExtractionFact[]): DocExtraction {
  return {
    schema: "hive.doc-extraction/1",
    documentId: DOC,
    fileName: "record.txt",
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

const pages: AuthorizedDocument[] = [{ documentId: DOC, pages: [{ pageNumber: 1, text: PAGE }] }];

function world() {
  const drafted = source();
  const prepared = prepareInvestigationStudy({
    packSource: drafted,
    artifacts: companions(drafted.identity.packId, drafted.identity.version),
  });
  if (!prepared.ok) throw new Error(prepared.code);
  const row = extraction([
    fact("F-label", "label", "North", "Name: North."),
    fact("F-start", "startDate", "2024-01-02", "Started 2024-01-02."),
    fact("F-link", "link", "North authorizes the review of South.", "North authorizes the review of South."),
  ]);
  return { prepared: prepared.prepared, row };
}

function call(id: string, name: string, args: unknown) {
  return { id, name, arguments: JSON.stringify(args) };
}

describe("domain mapping ledger", () => {
  it("accepts exact catalog rows in order and rejects invented, duplicate, and unauthorized calls", () => {
    const { prepared, row } = world();
    const ledger = new DomainMappingLedger("run-1", prepared.pack, [row], pages);
    const unknown = ledger.execute(call("t0", "record_fact", {}));
    expect(JSON.parse(unknown.content).error).toBe("unknown_tool");
    expect(ledger.acceptedFieldCount).toBe(0);

    const invented = ledger.execute(call("t1", "propose_field", {
      documentId: DOC, extractionFactId: "F-start", entityId: "entity:item", instanceId: "north",
      fieldId: "startDate", valueType: "DATE", value: "2024-03-01",
    }));
    expect(JSON.parse(invented.content).error).toBe("invented_value");
    expect(ledger.acceptedFieldCount).toBe(0);

    const missing = ledger.execute(call("t2", "propose_field", {
      documentId: DOC, extractionFactId: "F-label", entityId: "entity:missing", instanceId: "north",
      fieldId: "label", valueType: "TEXT", value: "North",
    }));
    expect(JSON.parse(missing.content).error).toBe("unknown_catalog_id");

    const foreign = ledger.execute(call("t3", "propose_field", {
      documentId: "other-doc", extractionFactId: "F-label", entityId: "entity:item", instanceId: "north",
      fieldId: "label", valueType: "TEXT", value: "North",
    }));
    expect(JSON.parse(foreign.content).error).toBe("unknown_fact");

    const early = ledger.execute(call("t4", "finish_mapping", { ready: true }));
    expect(JSON.parse(early.content).error).toBe("mapping_incomplete");
    expect(ledger.finished).toBe(false);

    const label = ledger.execute(call("t5", "propose_field", {
      documentId: DOC, extractionFactId: "F-label", entityId: "entity:item", instanceId: "north",
      fieldId: "label", valueType: "TEXT", value: "North",
    }));
    expect(JSON.parse(label.content).ok).toBe(true);
    const replay = ledger.execute(call("t5", "propose_field", {
      documentId: DOC, extractionFactId: "F-label", entityId: "entity:item", instanceId: "north",
      fieldId: "label", valueType: "TEXT", value: "North",
    }));
    expect(replay).toEqual(label);
    const conflict = ledger.execute(call("t5", "propose_field", {
      documentId: DOC, extractionFactId: "F-start", entityId: "entity:item", instanceId: "north",
      fieldId: "startDate", valueType: "DATE", value: "2024-01-02",
    }));
    expect(JSON.parse(conflict.content).error).toBe("tool_call_conflict");

    const duplicate = ledger.execute(call("t6", "propose_field", {
      documentId: DOC, extractionFactId: "F-label", entityId: "entity:other", instanceId: "south",
      fieldId: "name", valueType: "TEXT", value: "North",
    }));
    expect(JSON.parse(duplicate.content).error).toBe("duplicate_fact");

    const started = ledger.execute(call("t7", "propose_field", {
      documentId: DOC, extractionFactId: "F-start", entityId: "entity:item", instanceId: "north",
      fieldId: "startDate", valueType: "DATE", value: "2024-01-02",
    }));
    expect(JSON.parse(started.content).ok).toBe(true);
    const crossed = ledger.execute(call("t8", "propose_relationship", {
      documentId: DOC, extractionFactId: "F-link", relationshipId: "relationship:item-other",
      fromInstanceId: "item-2", toInstanceId: "north",
    }));
    expect(JSON.parse(crossed.content).error).toBe("instance_entity_conflict");

    const linked = ledger.execute(call("t9", "propose_relationship", {
      documentId: DOC, extractionFactId: "F-link", relationshipId: "relationship:item-other",
      fromInstanceId: "north", toInstanceId: "other-1",
    }));
    expect(JSON.parse(linked.content).ok).toBe(true);
    expect(ledger.execute(call("t10", "finish_mapping", { ready: true })).content).toContain("\"ok\":true");
    const proposal = ledger.assemble();
    expect(proposal).toMatchObject({
      schema: "hive.field-mapping-proposal/1",
      mappings: [
        expect.objectContaining({ extractionFactId: "F-label", value: "North", fieldId: "label" }),
        expect.objectContaining({ extractionFactId: "F-start", value: "2024-01-02", fieldId: "startDate" }),
      ],
      relationships: [expect.objectContaining({ extractionFactId: "F-link", relationshipId: "relationship:item-other" })],
    });
    expect(JSON.stringify(proposal)).not.toContain("quote");
    expect(ledger.execute(call("t11", "propose_field", {
      documentId: DOC, extractionFactId: "F-start", entityId: "entity:item", instanceId: "north",
      fieldId: "startDate", valueType: "DATE", value: "2024-01-02",
    })).content).toContain("mapping_finished");
  });

  it("assembles a proposal the investigation engine accepts", () => {
    const { prepared, row } = world();
    const ledger = new DomainMappingLedger("run-2", prepared.pack, [row], pages);
    ledger.execute(call("a", "propose_field", {
      documentId: DOC, extractionFactId: "F-label", entityId: "entity:item", instanceId: "north",
      fieldId: "label", valueType: "TEXT", value: "North",
    }));
    ledger.execute(call("b", "propose_field", {
      documentId: DOC, extractionFactId: "F-start", entityId: "entity:item", instanceId: "north",
      fieldId: "startDate", valueType: "DATE", value: "2024-01-02",
    }));
    ledger.execute(call("c", "propose_relationship", {
      documentId: DOC, extractionFactId: "F-link", relationshipId: "relationship:item-other",
      fromInstanceId: "north", toInstanceId: "other-1",
    }));
    ledger.execute(call("d", "finish_mapping", { ready: true }));
    const engine = runInvestigationStudyEngine({
      prepared,
      extractions: [row],
      pages,
      proposal: ledger.assemble(),
      studyDate: "2026-11-25",
    });
    expect(engine.ok).toBe(true);
    if (!engine.ok) return;
    expect(engine.study.spine).toEqual(expect.arrayContaining([
      expect.objectContaining({ supportingFactIds: ["F-label"], status: "SUPPORTED" }),
      expect.objectContaining({ supportingFactIds: ["F-start"] }),
    ]));
    expect(engine.study.documents.map((document) => document.sourceDocumentId)).toEqual([DOC]);
    expect(engine.study.questionOrder?.[0]).toMatch(/^pack-digest:/);
  });

  it("keeps each model window inside the catalog cap and prefers matching plan tasks", () => {
    const drafted = source();
    const extraFields = Array.from({ length: 40 }, (_, index) => ({
      id: `entity:extra-${index}`,
      kind: "entity" as const,
      label: `Extra ${index}`,
      fields: [{ id: `unused${index}`, valueType: "TEXT" as const }],
    }));
    const compiled = compileDomainPack({ ...drafted, definitions: [...drafted.definitions, ...extraFields] });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const prepared = prepareInvestigationStudy({
      packSource: { ...drafted, definitions: [...drafted.definitions, ...extraFields] },
      artifacts: companions(drafted.identity.packId, drafted.identity.version),
    });
    expect(prepared.ok).toBe(false);

    const tasks = compiled.value.definitions
      .filter((definition) => definition.kind === "entity" || definition.kind === "relationship")
      .map((definition) => ({
        taskId: `task-${definition.id}`,
        definitionId: definition.id,
        taskKind: definition.kind === "entity" ? "BIND_ENTITY" as const : "BIND_RELATIONSHIP" as const,
      }));
    const row = extraction([fact("F-label", "label", "North", "Name: North.")]);
    const windows = selectMappingWindows({ plan: { tasks } as never, pack: compiled.value, extractions: [row] });
    expect(windows.every((window) => window.fields.length <= MAPPING_WINDOW_LIMITS.maxFields)).toBe(true);
    expect(windows.every((window) => window.relationships.length <= MAPPING_WINDOW_LIMITS.maxRelationships)).toBe(true);
    expect(windows[0]?.fields.some((field) => field.fieldId === "label")).toBe(true);
    expect(windows[0]?.fields.length).toBeLessThan(40);
    expect(windows.flatMap((window) => window.fields).some((field) => field.fieldId.startsWith("unused"))).toBe(false);
    expect(MAPPING_AGENT_TOOL_NAMES).toEqual(["propose_field", "propose_relationship", "finish_mapping"]);
  });
});
