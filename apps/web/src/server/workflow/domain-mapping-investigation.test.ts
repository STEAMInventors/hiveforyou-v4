import {
  DOMAIN_PACK_SOURCE_SCHEMA,
  STUDY_AGENT_TURN_CONTRACT_VERSION,
  type DocExtraction,
  type DomainPackSource,
  type ExtractionFact,
} from "@hiveforyou/contracts";
import { prepareInvestigationStudy } from "@hiveforyou/contracts/investigation";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runDomainMappingInvestigation } from "./domain-mapping-investigation";

const DOC = "doc-1";
const PAGE_1 = "Name: North. Marker alpha stays on the page.";
const PAGE_2 = "Marker beta stays on the second page.";
const BAD_QUOTE = "not on the page";
const HIVE_ID = "hive-recovery";
const RUN_ID = "run-recovery";

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

function companions(pack: DomainPackSource) {
  return {
    ontology: {
      schema: "hive.domain-ontology-spec/1",
      packRef: { packId: pack.identity.packId, version: pack.identity.version },
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
  const pads = Array.from({ length: 28 }, (_, index) => fact(`F-pad-${String(index).padStart(2, "0")}`, `Pad ${index}`, "Name: North."));
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
      fact("F-bad-1", "Bad 1", BAD_QUOTE),
      fact("F-bad-2", "Bad 2", BAD_QUOTE),
      fact("F-bad-3", "Bad 3", BAD_QUOTE),
      fact("F-bad-4", "Bad 4", BAD_QUOTE),
      ...pads,
    ],
    emptyFields: [],
    referencedDocuments: [],
    glossary: [],
    instructionsIgnored: [],
    coverage: { pageCount: 2, pagesRead: [1, 2], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 2 },
  };
}

function tool(id: string, name: string, args: Record<string, unknown>) {
  return { id, name, arguments: JSON.stringify(args) };
}

function field(id: string, factId: string, fieldId: string) {
  return tool(id, "propose_field", {
    documentId: DOC,
    extractionFactId: factId,
    entityId: "entity:item",
    instanceId: "item-1",
    fieldId,
    valueType: "TEXT",
    value: factId === "F-label" ? "North" : factId.replace("F-bad-", "Bad "),
  });
}

function response(calls: { id: string; name: string; arguments: string }[]) {
  return new Response(JSON.stringify({
    contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION,
    model_alias: "heavy_lifter",
    resolved_model: "claude-synthetic",
    message: { content: null, tool_calls: calls },
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    latency_ms: 5,
    finish_reason: "stop",
  }), { status: 200 });
}

function lastUser(body: string): string {
  const parsed = JSON.parse(body) as { messages: { role: string; content?: string }[] };
  const users = parsed.messages.filter((message) => message.role === "user");
  return users[users.length - 1]?.content ?? "";
}

describe("domain mapping investigation recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays on a rejected window, reuses an accepted fact, and finishes the remaining work inside the budget", async () => {
    const drafted = source();
    const prepared = prepareInvestigationStudy({ packSource: drafted, artifacts: companions(drafted) });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const bodies: string[] = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body);
      bodies.push(body);
      const last = lastUser(body);
      if (last.includes("\"windowIndex\":1")) {
        return response([
          field("reuse", "F-label", "label"),
          field("other", "F-label", "name"),
          tool("role", "propose_document_role", { documentId: DOC, role: "ANCHOR", page: 1, quote: "Name: North." }),
          tool("read", "read_pages", { documentId: DOC, startPage: 1, endPage: 2 }),
        ]);
      }
      if (last.includes("Answer the request questions first") || last.includes("questions are still open")) {
        return response([
          tool("shown", "propose_answer", { questionId: "question:label", audience: "customer", factIds: ["F-label"] }),
          tool("intent", "propose_answer", { questionId: "intent:1", audience: "customer", factIds: ["F-label"] }),
        ]);
      }
      if (last.includes("saved extraction quotation did not verify")) {
        return response([field("mapped", "F-label", "label")]);
      }
      if (last.includes("Phase F is still open") || last.includes("The completion checks are done.")) {
        return response([tool("finish", "finish_investigation", { ready: true })]);
      }
      return response([1, 2, 3, 4].map((index) => field(`bad-${index}`, `F-bad-${index}`, "label")));
    });
    const result = await runDomainMappingInvestigation({
      planner: {
        getConfig: () => ({ baseUrl: "https://planner.test", serviceToken: "token", timeoutMs: 1000 }),
        fetchFn: fetchFn as unknown as typeof fetch,
      },
      runId: RUN_ID,
      hiveId: HIVE_ID,
      correlationId: "corr-recovery",
      prompt: { id: "hive.domain-investigation/2", digest: "sha256:test", systemPrompt: "Investigate the record." },
      plan: prepared.prepared.plan,
      pack: prepared.prepared.pack,
      extractions: [extraction()],
      pages: [{ documentId: DOC, pages: [{ pageNumber: 1, text: PAGE_1 }, { pageNumber: 2, text: PAGE_2 }] }],
      intentText: "What is the label of this record?",
      clock: () => 1_700_000_000_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totals.windowCount).toBe(2);
    expect(result.totals.rounds).toBeLessThanOrEqual(result.totals.roundsAllowed);
    expect(result.totals.acceptedFields).toBe(1);
    expect(result.proposal.mappings).toEqual([
      expect.objectContaining({ extractionFactId: "F-label", fieldId: "label", value: "North" }),
    ]);
    expect(lastUser(bodies[1] ?? "")).toContain("saved extraction quotation did not verify");
    expect(lastUser(bodies[1] ?? "")).not.toContain("\"windowIndex\":1");
    expect(lastUser(bodies[1] ?? "")).not.toContain(BAD_QUOTE);
    expect(lastUser(bodies[1] ?? "")).not.toContain("Marker alpha");
    expect(lastUser(bodies[1] ?? "")).not.toContain("Marker beta");
    expect(lastUser(bodies[2] ?? "")).toContain("Answer the request questions first: intent:1");
    expect(lastUser(bodies[2] ?? "")).toContain("questions are still open: question:label");
    expect(lastUser(bodies[2] ?? "")).toContain("Cite these accepted fact ids when they support the answer: F-label");
    expect(lastUser(bodies[2] ?? "")).not.toContain("\"windowIndex\":1");
    expect(lastUser(bodies[2] ?? "")).not.toContain(BAD_QUOTE);
    expect(lastUser(bodies[2] ?? "")).not.toContain("Marker alpha");
    expect(lastUser(bodies[3] ?? "")).toContain("\"windowIndex\":1");
    const followUp = bodies[4] ?? "";
    expect(followUp).toContain("duplicate_fact");
    expect(followUp).toContain("\\\"reused\\\":true");
    expect(lastUser(followUp)).toContain("The completion checks are done.");
    expect(lastUser(followUp)).not.toContain(BAD_QUOTE);
    expect(lastUser(followUp)).not.toContain("Marker alpha");
    expect(lastUser(followUp)).not.toContain("Marker beta");
  });

  it("records completion blockers when rejected calls consume the existing round budget", async () => {
    const drafted = source();
    const prepared = prepareInvestigationStudy({ packSource: drafted, artifacts: companions(drafted) });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      if (typeof line === "string") logs.push(line);
    });
    let turn = 0;
    const fetchFn = vi.fn(async () => {
      turn += 1;
      return response([1, 2, 3, 4].map((index) => field(`bad-${turn}-${index}`, `F-bad-${index}`, "label")));
    });
    const result = await runDomainMappingInvestigation({
      planner: {
        getConfig: () => ({ baseUrl: "https://planner.test", serviceToken: "token", timeoutMs: 1000 }),
        fetchFn: fetchFn as unknown as typeof fetch,
      },
      runId: RUN_ID,
      hiveId: HIVE_ID,
      correlationId: "corr-blocked",
      prompt: { id: "hive.domain-investigation/2", digest: "sha256:test", systemPrompt: "Investigate the record." },
      plan: prepared.prepared.plan,
      pack: prepared.prepared.pack,
      extractions: [extraction()],
      pages: [{ documentId: DOC, pages: [{ pageNumber: 1, text: PAGE_1 }, { pageNumber: 2, text: PAGE_2 }] }],
      intentText: "What is the label of this record?",
      clock: () => 1_700_000_000_000,
    });
    spy.mockRestore();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.diagnosticReason).toBe("mapping_agent_budget_exhausted");
    expect(result.totals.rounds).toBe(result.totals.roundsAllowed);
    expect(result.totals.acceptedFields).toBe(0);
    const incomplete = logs.map((line) => JSON.parse(line) as { eventName?: string; rejectionSummary?: string }).find((record) => record.eventName === "mapping.investigation.incomplete");
    expect(incomplete?.rejectionSummary).toContain("unverifiable_facts:4");
    expect(incomplete?.rejectionSummary).toContain("documents_without_role:1");
    expect(incomplete?.rejectionSummary).toMatch(/^[a-z][a-z0-9_]{0,63}:[0-9]{1,4}(?:,[a-z][a-z0-9_]{0,63}:[0-9]{1,4})*$/);
    const serialized = logs.join("\n");
    expect(serialized).not.toContain(BAD_QUOTE);
    expect(serialized).not.toContain("Marker alpha");
    expect(serialized).not.toContain("Marker beta");
    expect(serialized).not.toContain("What is the label");
  });

  it("reports a capacity failure before any model call when mapping and question work exceed the round ceiling", async () => {
    const drafted = source();
    const prepared = prepareInvestigationStudy({ packSource: drafted, artifacts: companions(drafted) });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const fetchFn = vi.fn(async () => {
      throw new Error("model called");
    });
    const result = await runDomainMappingInvestigation({
      planner: {
        getConfig: () => ({ baseUrl: "https://planner.test", serviceToken: "token", timeoutMs: 1000 }),
        fetchFn: fetchFn as unknown as typeof fetch,
      },
      runId: RUN_ID,
      hiveId: HIVE_ID,
      correlationId: "corr-capacity",
      prompt: { id: "hive.domain-investigation/2", digest: "sha256:test", systemPrompt: "Investigate the record." },
      plan: prepared.prepared.plan,
      pack: prepared.prepared.pack,
      extractions: [extraction()],
      pages: [{
        documentId: DOC,
        pages: Array.from({ length: 200 }, (_, index) => ({ pageNumber: index + 1, text: "Marker capacity page." })),
      }],
      intentText: "What is the label of this record?",
      clock: () => 1_700_000_000_000,
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.totals.rounds).toBe(0);
    expect(result.error.diagnosticReason).toBe("investigation_capacity");
    expect(result.error.safeMessage).toContain("earlier study is unchanged");
    const match = /^budget\.rounds:r(\d+)\/32:tc(\d+):inv0:q0\/2$/.exec(result.error.diagnosticField ?? "");
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThan(32);
    expect(JSON.stringify(result.error)).not.toContain("Marker capacity");
    expect(result.error.diagnosticField).not.toContain("Marker capacity");
  });
});
