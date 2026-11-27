import { describe, expect, it } from "vitest";
import { compileDomainPack } from "./domain-pack-compiler";
import {
  CoordinatedInvestigationLedger,
  formatInvestigationCompletionSummary,
  renderInvestigationWindow,
  selectInvestigationWindows,
} from "./domain-investigation-agent";
import { DOMAIN_PACK_SOURCE_SCHEMA, type DomainPackSource } from "./domain-pack-source";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import { prepareInvestigationStudy } from "./investigation-study-engine";
import type { SupplementalArtifacts } from "./domain-investigation-plan";

const DOC = "doc-1";
const PAGE = "Name: North. Marker alpha stays on the page.";
const BAD_QUOTE = "not on the page";

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
          { id: "name", valueType: "TEXT" },
        ],
      },
      {
        id: "question:label", kind: "question", label: "Label question", audience: "customer",
        text: "What label is written?", appliesWhen: { op: "REVIEW_REQUIRED" },
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
      entities: [{
        id: "entity:item", factClass: "RECORD",
        fields: [
          { id: "label", valueType: "TEXT" },
          { id: "name", valueType: "TEXT" },
        ],
        ruleIds: [],
        documentKinds: [],
        identityKeys: ["label"],
      }],
      relationships: [],
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

function fact(id: string, written: string, quote: string): ExtractionFact {
  return {
    id,
    modelId: id,
    category: "record",
    subject: "record",
    attribute: "label",
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

function extraction(): DocExtraction {
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
    facts: [
      fact("F-label", "North", "Name: North."),
      fact("F-off", "North", BAD_QUOTE),
    ],
    emptyFields: [],
    referencedDocuments: [],
    glossary: [],
    instructionsIgnored: [],
    coverage: { pageCount: 1, pagesRead: [1], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 1 },
  };
}

function call(id: string, name: string, args: unknown) {
  return { id, name, arguments: JSON.stringify(args) };
}

describe("investigation recovery feedback", () => {
  it("separates an invalid extraction quotation from a model citation and can still finish", () => {
    const drafted = source();
    const prepared = prepareInvestigationStudy({
      packSource: drafted,
      artifacts: companions(drafted.identity.packId, drafted.identity.version),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const pages = [{ documentId: DOC, pages: [{ pageNumber: 1, text: PAGE }, { pageNumber: 2, text: "Marker beta stays on the second page." }] }];
    const ledger = new CoordinatedInvestigationLedger(
      "run-recovery",
      prepared.prepared.pack,
      [extraction()],
      pages,
      "What is the label of this record?",
    );
    expect(ledger.armCompletion({ windowCount: 1, documentIds: [DOC] })).toBe(true);
    ledger.presentWindow(0, { questionIds: ["question:label"] });
    ledger.beginTurn();

    const offPage = JSON.parse(ledger.execute(call("off", "propose_field", {
      documentId: DOC, extractionFactId: "F-off", entityId: "entity:item", instanceId: "item-1",
      fieldId: "label", valueType: "TEXT", value: "North",
    })).content) as { error?: string; message?: string };
    expect(offPage.error).toBe("unauthorized_evidence");
    expect(offPage.message).toContain("saved extraction quotation");
    expect(offPage.message).not.toContain(BAD_QUOTE);
    expect(offPage.message).not.toContain("Read the page");

    const cited = JSON.parse(ledger.execute(call("cite", "propose_document_role", {
      documentId: DOC, role: "ANCHOR", page: 1, quote: BAD_QUOTE,
    })).content) as { error?: string; message?: string };
    expect(cited.error).toBe("quote_not_on_page");
    expect(cited.message).toContain("Read the page");
    expect(cited.message).not.toContain("saved extraction");

    const accepted = ledger.execute(call("field", "propose_field", {
      documentId: DOC, extractionFactId: "F-label", entityId: "entity:item", instanceId: "item-1",
      fieldId: "label", valueType: "TEXT", value: "North",
    }));
    expect(JSON.parse(accepted.content).ok).toBe(true);
    const reused = JSON.parse(ledger.execute(call("field-again", "propose_field", {
      documentId: DOC, extractionFactId: "F-label", entityId: "entity:item", instanceId: "item-1",
      fieldId: "label", valueType: "TEXT", value: "North",
    })).content) as { ok?: boolean; reused?: boolean };
    expect(reused).toMatchObject({ ok: true, reused: true });
    expect(ledger.acceptedFieldCount).toBe(1);
    const duplicate = JSON.parse(ledger.execute(call("field-other", "propose_field", {
      documentId: DOC, extractionFactId: "F-label", entityId: "entity:item", instanceId: "item-1",
      fieldId: "name", valueType: "TEXT", value: "North",
    })).content) as { error?: string };
    expect(duplicate.error).toBe("duplicate_fact");

    const feedback = ledger.completionFeedback();
    expect(feedback).toContain(DOC);
    expect(feedback).toContain("question:label");
    expect(feedback).toContain("intent:1");
    expect(feedback).toContain(`${DOC}/F-off`);
    expect(feedback).not.toContain(PAGE);
    expect(feedback).not.toContain(BAD_QUOTE);
    expect(feedback).not.toContain("North");
    const summary = formatInvestigationCompletionSummary(ledger.completionCounts());
    expect(summary).toMatch(/^[a-z][a-z0-9_]{0,63}:[0-9]{1,4}(?:,[a-z][a-z0-9_]{0,63}:[0-9]{1,4})*$/);
    expect(summary).toContain("unverifiable_facts:1");
    expect(summary).toContain("documents_without_role:1");
    expect(summary).not.toContain(PAGE);
    expect(summary).not.toContain(BAD_QUOTE);

    expect(JSON.parse(ledger.execute(call("role", "propose_document_role", {
      documentId: DOC, role: "ANCHOR", page: 1, quote: "Name: North.",
    })).content).ok).toBe(true);
    expect(JSON.parse(ledger.execute(call("read", "read_pages", {
      documentId: DOC, startPage: 1, endPage: 2,
    })).content).ok).toBe(true);
    expect(JSON.parse(ledger.execute(call("shown", "propose_answer", {
      questionId: "question:label", audience: "customer", factIds: ["F-label"],
    })).content).ok).toBe(true);
    expect(JSON.parse(ledger.execute(call("intent", "propose_answer", {
      questionId: "intent:1", audience: "customer", factIds: ["F-label"],
    })).content).ok).toBe(true);
    const ready = ledger.completionFeedback();
    expect(ready).toContain("The completion checks are done.");
    expect(ready).not.toContain("Phase F is still open");
    expect(ready).not.toContain(PAGE);
    expect(ready).not.toContain(BAD_QUOTE);
    expect(JSON.parse(ledger.execute(call("finish", "finish_investigation", { ready: true })).content).ok).toBe(true);
    expect(ledger.finished).toBe(true);
    expect(ledger.acceptedFieldCount).toBe(1);
    expect(ledger.completionCounts().unverifiableFacts).toBe(1);
    expect(compileDomainPack(drafted).ok).toBe(true);
  });

  it("presents a later window when catalog questions exceed the mapping windows", () => {
    const drafted = source();
    drafted.definitions = [
      ...drafted.definitions,
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `question:q${index + 2}`,
        kind: "question" as const,
        label: `Question ${index + 2}`,
        audience: "customer" as const,
        text: `What is item ${index + 2}?`,
        appliesWhen: { op: "REVIEW_REQUIRED" as const },
      })),
    ];
    const prepared = prepareInvestigationStudy({
      packSource: drafted,
      artifacts: companions(drafted.identity.packId, drafted.identity.version),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const windows = selectInvestigationWindows({
      plan: prepared.prepared.plan,
      pack: prepared.prepared.pack,
      extractions: [extraction()],
    });
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.length).toBeGreaterThanOrEqual(Math.ceil(9 / 8));
    const ids = (windowIndex: number) => {
      const rendered = renderInvestigationWindow({
        window: windows[windowIndex]!,
        extractions: [extraction()],
        intentText: "What is the label of this record?",
      });
      const questions = Array.isArray(rendered.questions) ? rendered.questions : [];
      return questions.flatMap((item) => {
        if (!item || typeof item !== "object" || !("id" in item)) return [];
        const id = (item as { id?: unknown }).id;
        return typeof id === "string" ? [id] : [];
      });
    };
    expect(ids(0)).toHaveLength(8);
    expect(ids(0)).not.toContain("question:q9");
    expect(ids(windows.length - 1)).toContain("question:q9");
  });

  it("rejects an ungrounded search claim and keeps the question pending", () => {
    const drafted = source();
    const prepared = prepareInvestigationStudy({
      packSource: drafted,
      artifacts: companions(drafted.identity.packId, drafted.identity.version),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const pages = [{ documentId: DOC, pages: [{ pageNumber: 1, text: PAGE }] }];
    const ledger = new CoordinatedInvestigationLedger(
      "run-search-claim",
      prepared.prepared.pack,
      [extraction()],
      pages,
      "What is the label of this record?",
    );
    expect(ledger.armCompletion({ windowCount: 1, documentIds: [DOC] })).toBe(true);
    ledger.presentWindow(0, { questionIds: ["question:label"] });
    expect(ledger.pendingIntentQuestionIds()).toEqual(["intent:1"]);
    expect(ledger.pendingWindowQuestionIds(0)).toEqual(["question:label"]);
    const claim = "The pages were searched and the value was not found.";
    const refused = JSON.parse(ledger.execute(call("search-claim", "propose_answer", {
      questionId: "question:label",
      audience: "customer",
      factIds: [],
      uncertainty: claim,
    })).content) as { error?: string; message?: string };
    expect(refused.error).toBe("invalid_arguments");
    expect(refused.message).not.toContain(claim);
    expect(refused.message).not.toContain(PAGE);
    expect(ledger.pendingWindowQuestionIds(0)).toEqual(["question:label"]);
    expect(JSON.parse(ledger.execute(call("read", "read_pages", {
      documentId: DOC, startPage: 1, endPage: 1,
    })).content).ok).toBe(true);
    expect(JSON.parse(ledger.execute(call("after-read", "propose_answer", {
      questionId: "question:label",
      audience: "customer",
      factIds: [],
      uncertainty: claim,
    })).content).ok).toBe(true);
    expect(ledger.pendingWindowQuestionIds(0)).toEqual([]);
    expect(ledger.pendingIntentQuestionIds()).toEqual(["intent:1"]);
  });
});
