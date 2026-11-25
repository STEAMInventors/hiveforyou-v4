import {
  DOMAIN_PACK_SOURCE_SCHEMA,
  FIELD_MAPPING_PROMPT_ID,
  PLANNER_CONTRACT_VERSION,
  STUDY_AGENT_TURN_CONTRACT_VERSION,
  type DocExtraction,
  type DomainPackSource,
  type ExtractionFact,
} from "@hiveforyou/contracts";
import {
  type InvestigationEnginePin,
  MAPPING_AGENT_TOOL_NAMES,
  MAPPING_WINDOW_LIMITS,
} from "@hiveforyou/contracts/investigation";
import { computeSha256Digest } from "@hiveforyou/contracts/document-read";
import { describe, expect, it, vi } from "vitest";

import { getStudyTabView } from "@/server/study-preparation/study-preparation";
import { loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";
import {
  CORRELATION_ID,
  DOC_1,
  HIVE_ID,
  INTENTS,
  RUN_ID,
  runJson,
  snapshotDocument,
  sourceSnapshot,
} from "@/server/study-preparation/study-preparation.fixtures";

import { processAnalysisRun, type AnalysisWorkflowDeps } from "./analysis-workflow";
import { loadPinnedDomainPack, PINNED_DOMAIN_PACK } from "./domain-pack-selection";
import { resolveInvestigationEnginePin, runCanonicalizeForRun } from "./v5-pipeline-stages";

const PAGE = "Name: North. Started 2024-01-02.";

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
        id: "check:review", kind: "check", label: "Needs a person", criterion: { op: "REVIEW_REQUIRED" },
      },
      { id: "term:word", kind: "term", label: "Word", meaning: "A defined word." },
    ],
    changes: [],
    review: { status: "DRAFT" },
  };
}

function artifacts(pack: DomainPackSource): InvestigationEnginePin["artifacts"] {
  return {
    ontology: {
      schema: "hive.domain-ontology-spec/1",
      packRef: { packId: pack.identity.packId, version: pack.identity.version },
      entities: [{
        id: "entity:item", factClass: "RECORD",
        fields: [
          { id: "label", valueType: "TEXT" },
          { id: "startDate", valueType: "DATE" },
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
      structuralDefinitions: {
        "term:word": "STRUCTURAL - persona/report/intake definition; makes no domain claim.",
      },
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
    evidence: [{ page: 1, printedPageLabel: null, quote }],
    confidence: "high",
  };
}

function extraction(): DocExtraction {
  return {
    schema: "hive.doc-extraction/1",
    documentId: DOC_1,
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
      fact("F-start", "2024-01-02", "Started 2024-01-02."),
    ],
    emptyFields: [],
    referencedDocuments: [],
    glossary: [],
    instructionsIgnored: [],
    coverage: { pageCount: 1, pagesRead: [1], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 1 },
  };
}

function proposal() {
  return {
    schema: "hive.field-mapping-proposal/1",
    mappings: [
      { documentId: DOC_1, extractionFactId: "F-label", entityId: "entity:item", instanceId: "north", fieldId: "label", valueType: "TEXT", value: "North" },
      { documentId: DOC_1, extractionFactId: "F-start", entityId: "entity:item", instanceId: "north", fieldId: "startDate", valueType: "DATE", value: "2024-01-02" },
    ],
    relationships: [],
  };
}

function planner(content: unknown) {
  const bodies: unknown[] = [];
  const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      contract_version: PLANNER_CONTRACT_VERSION,
      task: "canonicalize",
      model_alias: "sorter",
      resolved_model: "gpt-4o-mini",
      content_json: content,
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      latency_ms: 5,
      finish_reason: "stop",
    }), { status: 200 });
  });
  return { fetchFn, bodies };
}

function mappingCalls(calls: { id: string; name: string; arguments: Record<string, unknown> }[]) {
  const bodies: unknown[] = [];
  const urls: string[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(url);
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION,
      model_alias: "heavy_lifter",
      resolved_model: "claude-synthetic",
      message: {
        content: null,
        tool_calls: calls.map((call) => ({ id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) })),
      },
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      latency_ms: 5,
      finish_reason: "stop",
    }), { status: 200 });
  });
  return { fetchFn, bodies, urls };
}

function client(extractionRow: DocExtraction) {
  const calls: string[] = [];
  const document = snapshotDocument(DOC_1, "record.txt", { verifiedPageCount: 1, totalPhysicalPages: 1 });
  const rpc = vi.fn(async (fn: string) => {
    calls.push(fn);
    if (fn === "get_doc_extractions_for_run") {
      return {
        data: {
          extractions: [{
            sourceDocumentId: DOC_1,
            contentDigest: document.pageSetDigest,
            extraction: extractionRow,
          }],
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  return { rpc, calls, document };
}

function deps(fetchFn: ReturnType<typeof vi.fn>, rpc: ReturnType<typeof vi.fn>): AnalysisWorkflowDeps {
  return {
    client: { rpc },
    planner: {
      getConfig: () => ({ baseUrl: "https://planner.test", serviceToken: "token", timeoutMs: 1000 }),
      fetchFn: fetchFn as unknown as typeof fetch,
    },
    dispatch: vi.fn(async () => undefined),
  } as unknown as AnalysisWorkflowDeps;
}

describe("rebuild study investigation engine", () => {
  it("does not select an investigation pin when the hive has no stored selection", async () => {
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "get_domain_pack_selection") return { data: null, error: null };
      throw new Error(fn);
    });
    const resolved = await resolveInvestigationEnginePin({
      client: { rpc } as never,
      run: runJson("CANONICALIZING", { preparationMode: "REBUILD" }) as never,
      sourceSnapshot: sourceSnapshot(),
      correlationId: "corr",
    });
    expect(resolved).toEqual({ ok: true, pin: null });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps every hive on the legacy path when the selection function is not installed", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "Could not find the function public.get_domain_pack_selection in the schema cache" },
    }));
    const resolved = await resolveInvestigationEnginePin({
      client: { rpc } as never,
      run: runJson("CANONICALIZING", { preparationMode: "REBUILD", hiveId: "another-hive" }) as never,
      sourceSnapshot: sourceSnapshot(),
      correlationId: "corr",
    });
    expect(resolved).toEqual({ ok: true, pin: null });
  });

  it("runs the investigation engine for an explicitly pinned rebuild and does not fall back", async () => {
    const row = extraction();
    const drafted = source();
    const { fetchFn, bodies, urls } = mappingCalls([
      { id: "c1", name: "propose_field", arguments: { documentId: DOC_1, extractionFactId: "F-label", entityId: "entity:item", instanceId: "north", fieldId: "label", valueType: "TEXT", value: "North" } },
      { id: "c2", name: "propose_field", arguments: { documentId: DOC_1, extractionFactId: "F-start", entityId: "entity:item", instanceId: "north", fieldId: "startDate", valueType: "DATE", value: "2024-01-02" } },
      { id: "c3", name: "finish_mapping", arguments: { ready: true } },
    ]);
    const { rpc, calls, document } = client(row);
    const result = await runCanonicalizeForRun({
      deps: deps(fetchFn, rpc),
      run: runJson("CANONICALIZING", { preparationMode: "REBUILD" }) as never,
      extractions: [row],
      sourceSnapshot: sourceSnapshot({ documents: [document] }),
      catalog: loadPromptCatalog(),
      correlationId: "corr",
      stageAttempt: 1,
      now: () => new Date("2026-11-25T12:00:00.000Z"),
      rebuildMode: true,
      investigationEngine: {
        hiveId: HIVE_ID,
        packSource: drafted,
        artifacts: artifacts(drafted),
        pages: [{ documentId: DOC_1, pages: [{ pageNumber: 1, text: PAGE }] }],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.study.spine).toEqual(expect.arrayContaining([
      expect.objectContaining({ supportingFactIds: ["F-label"], status: "SUPPORTED" }),
      expect.objectContaining({ supportingFactIds: ["F-start"], label: expect.stringContaining("page 1") }),
    ]));
    expect(result.study.checklist?.[0]).toMatchObject({ checkId: "check:review", verdict: "NOT_ASSESSED" });
    expect(result.study.questionOrder?.[0]).toMatch(/^pack-digest:[0-9a-f]{64}$/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(urls[0]).toBe("https://planner.test/v1/study-agent-turn");
    const body = bodies[0] as {
      task: string;
      hive_id: string;
      prompt_id: string;
      tools: { function: { name: string } }[];
      messages: { content: string }[];
    };
    expect(body.task).toBe("mapping");
    expect(body.hive_id).toBe(HIVE_ID);
    expect(body).not.toHaveProperty("synthetic");
    expect(body).not.toHaveProperty("content_class");
    expect(body.prompt_id).toBe(FIELD_MAPPING_PROMPT_ID);
    expect(body.tools.map((tool) => tool.function.name)).toEqual([...MAPPING_AGENT_TOOL_NAMES]);
    const window = JSON.parse(body.messages[0]?.content ?? "{}") as { schema: string; fields: unknown[] };
    expect(window.schema).toBe("hive.field-mapping-window/1");
    expect(window.fields.length).toBeLessThanOrEqual(MAPPING_WINDOW_LIMITS.maxFields);
    expect(JSON.stringify(body)).not.toContain(PAGE);
    expect(calls).not.toContain("get_hive_chosen_pack");
    expect(calls).not.toContain("accept_study_revision");
  });

  it("keeps the earlier study when a pinned rebuild fails and does not call legacy canonicalization", async () => {
    const row = extraction();
    const drafted = source();
    const { fetchFn, bodies } = mappingCalls([
      { id: "c1", name: "finish_mapping", arguments: { ready: true } },
    ]);
    const { rpc, calls, document } = client(row);
    const result = await runCanonicalizeForRun({
      deps: deps(fetchFn, rpc),
      run: runJson("CANONICALIZING", { preparationMode: "REBUILD" }) as never,
      extractions: [row],
      sourceSnapshot: sourceSnapshot({ documents: [document] }),
      catalog: loadPromptCatalog(),
      correlationId: "corr",
      stageAttempt: 1,
      now: () => new Date("2026-11-25T12:00:00.000Z"),
      rebuildMode: true,
      investigationEngine: {
        hiveId: HIVE_ID,
        packSource: drafted,
        artifacts: artifacts(drafted),
        pages: [{ documentId: DOC_1, pages: [{ pageNumber: 1, text: PAGE }] }],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.diagnosticReason).toBe("mapping_incomplete");
    expect(fetchFn).toHaveBeenCalled();
    expect((bodies[0] as { task: string }).task).toBe("mapping");
    expect(bodies.every((body) => (body as { task: string }).task === "mapping")).toBe(true);
    expect(calls).not.toContain("get_hive_chosen_pack");
    expect(calls).not.toContain("accept_study_revision");
  });

  it("rejects a pin for a different hive before calling the model", async () => {
    const row = extraction();
    const drafted = source();
    const fetchFn = vi.fn(async () => {
      throw new Error("planner should not be called");
    });
    const { rpc, calls, document } = client(row);
    const result = await runCanonicalizeForRun({
      deps: deps(fetchFn, rpc),
      run: runJson("CANONICALIZING", { preparationMode: "REBUILD" }) as never,
      extractions: [row],
      sourceSnapshot: sourceSnapshot({ documents: [document] }),
      catalog: loadPromptCatalog(),
      correlationId: "corr",
      stageAttempt: 1,
      now: () => new Date("2026-11-25T12:00:00.000Z"),
      rebuildMode: true,
      investigationEngine: {
        hiveId: "99999999-9999-4999-8999-999999999999",
        packSource: drafted,
        artifacts: artifacts(drafted),
        pages: [{ documentId: DOC_1, pages: [{ pageNumber: 1, text: PAGE }] }],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.diagnosticReason).toBe("investigation_hive_mismatch");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(calls).not.toContain("get_hive_chosen_pack");
  });

  it("keeps an unpinned hive on legacy canonicalization", async () => {
    const row = extraction();
    const { fetchFn, bodies } = planner({ schema: "not-a-study" });
    const { rpc, calls, document } = client(row);
    const result = await runCanonicalizeForRun({
      deps: deps(fetchFn, rpc),
      run: runJson("CANONICALIZING", { preparationMode: "REBUILD" }) as never,
      extractions: [row],
      sourceSnapshot: sourceSnapshot({ documents: [document] }),
      catalog: loadPromptCatalog(),
      correlationId: "corr",
      stageAttempt: 1,
      now: () => new Date("2026-11-25T12:00:00.000Z"),
      rebuildMode: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.study.questionOrder ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/^pack-digest:/)]));
    expect(calls).toContain("get_hive_chosen_pack");
    expect(fetchFn).toHaveBeenCalled();
    const body = bodies[0] as { prompt_id: string; user_payload: { schema?: string; documents?: unknown } };
    expect(body.prompt_id).toBe("hive-canonicalize/1");
    expect(body.user_payload.schema).not.toBe("hive.field-mapping-request/1");
    expect(body.user_payload.documents).toBeDefined();
  });
});

const RECORD = "Name: North. Born March 1, 2024. North is named in the referral.";
const PREVIOUS_REVISION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEXT_REVISION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PREVIOUS_REPORTS = [
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", studyRevisionId: PREVIOUS_REVISION, audience: "CUSTOMER" },
  { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", studyRevisionId: PREVIOUS_REVISION, audience: "PRO" },
];

function recordExtraction(): DocExtraction {
  const row = extraction();
  return {
    ...row,
    facts: [
      fact("F-name", "North", "Name: North."),
      fact("F-birth", "March 1, 2024", "Born March 1, 2024."),
      fact("F-link", "North is named in the referral.", "North is named in the referral."),
    ],
  };
}

function fieldProposal() {
  return {
    schema: "hive.field-mapping-proposal/1",
    mappings: [
      { documentId: DOC_1, extractionFactId: "F-name", entityId: "entity:student", instanceId: "north", fieldId: "displayName", valueType: "TEXT", value: "North" },
      { documentId: DOC_1, extractionFactId: "F-birth", entityId: "entity:student", instanceId: "north", fieldId: "dateOfBirth", valueType: "DATE", value: "2024-03-01" },
    ],
    relationships: [
      { documentId: DOC_1, extractionFactId: "F-link", relationshipId: "relationship:concern-addressed-by-referral", fromInstanceId: "north", toInstanceId: "referral" },
    ],
  };
}

function acceptanceHarness(input: { selection: unknown; content: unknown; selectionError?: string; mapping?: "accept" | "incomplete" }) {
  const document = snapshotDocument(DOC_1, "record.txt", { verifiedPageCount: 1, totalPhysicalPages: 1 });
  const row = recordExtraction();
  let status = "CANONICALIZING";
  let leased = false;
  const stageOutputs: Record<string, unknown> = {};
  const calls: string[] = [];
  const dispatches: { kind: string; id: string }[] = [];
  let accepted: Record<string, unknown> | null = null;
  let failure: Record<string, unknown> | null = null;
  const current = {
    revisionId: PREVIOUS_REVISION,
    revisionNumber: 1,
    investigation: { schema: "hive.canonical-study/1", marker: "previous" },
    reports: PREVIOUS_REPORTS.map((report) => ({ ...report })),
  };
  const run = () => runJson(status, { preparationMode: "REBUILD", stageAttempt: 1, snapshotFrozen: true });
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push(fn);
    if (fn === "claim_processing_run") {
      if (leased || status === "FAILED" || status === "SUCCEEDED") return { data: { claimed: false, processingRun: run() }, error: null };
      leased = true;
      return { data: { claimed: true, processingRun: run() }, error: null };
    }
    if (fn === "get_study_preparation_inputs") {
      return {
        data: {
          processingRun: run(),
          sourceSnapshot: sourceSnapshot({ documents: [document] }),
          sourceSnapshotDigest: `sha256:${"c".repeat(64)}`,
          intentSnapshotDigest: `sha256:${"d".repeat(64)}`,
          coverageDigest: `sha256:${"e".repeat(64)}`,
          snapshotCurrent: true,
          stageOutputs: { ...stageOutputs },
          intents: INTENTS,
        },
        error: null,
      };
    }
    if (fn === "get_doc_extractions_for_run") {
      return { data: { extractions: [{ sourceDocumentId: DOC_1, contentDigest: document.pageSetDigest, extraction: row }] }, error: null };
    }
    if (fn === "get_domain_pack_selection") {
      if (input.selectionError) return { data: null, error: { message: input.selectionError } };
      return { data: input.selection, error: null };
    }
    if (fn === "get_study_source_pages") return { data: { snapshotCurrent: true, pages: [] }, error: null };
    if (fn === "list_document_pages") {
      return {
        data: {
          found: true,
          source_document_id: document.sourceDocumentId,
          hive_id: HIVE_ID,
          source_sha256: document.sha256,
          read_fingerprint: document.readFingerprint,
          page_set_digest: document.pageSetDigest,
          read_status: "SUCCEEDED",
          total_physical_pages: 1,
          pages: [{
            page_number: 1,
            page_count: 1,
            page_text: RECORD,
            page_text_sha256: computeSha256Digest(RECORD),
            page_byte_length: Buffer.byteLength(RECORD, "utf8"),
            source_document_id: document.sourceDocumentId,
            hive_id: HIVE_ID,
            source_sha256: document.sha256,
            read_fingerprint: document.readFingerprint,
            page_set_digest: document.pageSetDigest,
          }],
        },
        error: null,
      };
    }
    if (fn === "transition_processing_run") {
      if (args.p_from_status !== status) return { data: { applied: false, processingRun: run() }, error: null };
      const details = (args.p_details ?? {}) as Record<string, unknown>;
      Object.assign(stageOutputs, (details.stage_outputs ?? {}) as Record<string, unknown>);
      status = String(args.p_to_status);
      if (status === "FAILED") failure = details;
      leased = false;
      return { data: { applied: true, processingRun: run() }, error: null };
    }
    if (fn === "reserve_processing_run_handoff" || fn === "release_processing_run" || fn === "record_pipeline_model_call") {
      if (fn === "release_processing_run") leased = false;
      return { data: { released: true }, error: null };
    }
    if (fn === "accept_study_revision") {
      accepted = args.p_revision as Record<string, unknown>;
      current.revisionId = NEXT_REVISION;
      current.revisionNumber = 2;
      current.investigation = (accepted.investigation ?? current.investigation) as typeof current.investigation;
      status = "SUCCEEDED";
      leased = false;
      return { data: { created: true, processingRun: run(), reportRuns: [] }, error: null };
    }
    if (fn === "get_study_tab_view") {
      return {
        data: {
          revisionId: current.revisionId,
          revisionNumber: current.revisionNumber,
          investigation: current.investigation,
          reports: current.reports,
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const bodies: unknown[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    bodies.push(request);
    if (String(url).endsWith("/v1/study-agent-turn") || request.task === "mapping") {
      return new Response(JSON.stringify({
        contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION,
        model_alias: "heavy_lifter",
        resolved_model: "claude-synthetic",
        message: {
          content: null,
          tool_calls: input.mapping === "incomplete"
            ? [{ id: "done", name: "finish_mapping", arguments: JSON.stringify({ ready: true }) }]
            : [
                { id: "bad-date", name: "propose_field", arguments: JSON.stringify({ documentId: DOC_1, extractionFactId: "F-birth", entityId: "entity:student", instanceId: "north", fieldId: "dateOfBirth", valueType: "DATE", value: "2024-03-01" }) },
                { id: "name", name: "propose_field", arguments: JSON.stringify({ documentId: DOC_1, extractionFactId: "F-name", entityId: "entity:student", instanceId: "north", fieldId: "displayName", valueType: "TEXT", value: "North" }) },
                { id: "link", name: "propose_relationship", arguments: JSON.stringify({ documentId: DOC_1, extractionFactId: "F-link", relationshipId: "relationship:concern-addressed-by-referral", fromInstanceId: "concern-1", toInstanceId: "referral-1" }) },
                { id: "done", name: "finish_mapping", arguments: JSON.stringify({ ready: true }) },
              ],
        },
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        latency_ms: 5,
        finish_reason: "stop",
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      contract_version: PLANNER_CONTRACT_VERSION,
      task: "canonicalize",
      model_alias: "heavy_lifter",
      resolved_model: "private-local",
      content_json: input.content,
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      latency_ms: 5,
      finish_reason: "stop",
    }), { status: 200 });
  });
  const workflowDeps = {
    client: { rpc },
    planner: {
      getConfig: () => ({ baseUrl: "https://planner.test", serviceToken: "token", timeoutMs: 1000 }),
      fetchFn: fetchFn as unknown as typeof fetch,
    },
    dispatch: vi.fn(async (work: { kind: string; id: string }) => {
      dispatches.push(work);
    }),
    now: () => new Date("2026-11-25T12:00:00.000Z"),
  } as unknown as AnalysisWorkflowDeps;
  return { workflowDeps, calls, bodies, dispatches, accepted: () => accepted, failure: () => failure, current, document };
}

describe("pinned rebuild acceptance", () => {
  it("pins only the compiled iep-us-federal 0.4.0 digest", () => {
    const pinned = loadPinnedDomainPack();
    expect(pinned.source.identity).toMatchObject(PINNED_DOMAIN_PACK);
    expect(pinned.compiledDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a new revision and retrieves it without replacing earlier reports", async () => {
    const pinned = loadPinnedDomainPack();
    const harness = acceptanceHarness({
      selection: { packId: PINNED_DOMAIN_PACK.packId, version: PINNED_DOMAIN_PACK.version, compiledDigest: pinned.compiledDigest },
      content: fieldProposal(),
    });
    const canonicalizing = await processAnalysisRun(harness.workflowDeps, RUN_ID);
    expect(canonicalizing).toBe("ACCEPTING_STUDY");
    const body = harness.bodies[0] as {
      task: string;
      hive_id: string;
      prompt_id: string;
      tools: { function: { name: string } }[];
      messages: { content: string }[];
    };
    expect(body.task).toBe("mapping");
    expect(body.hive_id).toBe(HIVE_ID);
    expect(body).not.toHaveProperty("synthetic");
    expect(body).not.toHaveProperty("content_class");
    expect(body.prompt_id).toBe(FIELD_MAPPING_PROMPT_ID);
    expect(body.tools.map((tool) => tool.function.name)).toEqual([...MAPPING_AGENT_TOOL_NAMES]);
    const window = JSON.parse(body.messages[0]?.content ?? "{}") as { fields: unknown[]; relationships: unknown[] };
    expect(window.fields.length).toBeLessThanOrEqual(MAPPING_WINDOW_LIMITS.maxFields);
    expect(window.relationships.length).toBeLessThanOrEqual(MAPPING_WINDOW_LIMITS.maxRelationships);
    expect(JSON.stringify(body)).not.toContain(RECORD);
    expect(harness.calls).not.toContain("get_hive_chosen_pack");
    expect(harness.calls).not.toContain("accept_study_revision");

    const accepted = await processAnalysisRun(harness.workflowDeps, RUN_ID);
    expect(accepted).toBe("SUCCEEDED");
    const revision = harness.accepted();
    expect(revision).toMatchObject({ format: "canonical-study-1" });
    const study = revision?.investigation as {
      questionOrder?: string[];
      checklist?: { verdict: string }[];
      spine?: { supportingFactIds: string[]; label: string }[];
      outsideSpine?: { statement: string; factIds: string[] }[];
    };
    expect(study.questionOrder?.[0]).toBe(`pack-digest:${pinned.compiledDigest}`);
    expect(study.checklist?.length).toBeGreaterThan(0);
    expect(study.checklist?.every((item) => item.verdict === "NOT_ASSESSED")).toBe(true);
    expect(study.spine).toEqual(expect.arrayContaining([
      expect.objectContaining({ supportingFactIds: ["F-name"], label: expect.stringContaining("page 1") }),
    ]));
    expect(study.outsideSpine).toEqual(expect.arrayContaining([
      expect.objectContaining({ statement: expect.stringContaining("is not verified"), factIds: ["F-link"] }),
    ]));
    expect(study.spine?.some((item) => item.supportingFactIds.includes("F-birth"))).toBe(false);
    expect(JSON.stringify(study)).not.toContain("daysBetween");
    expect(JSON.stringify(study)).not.toContain("2024-03-01");
    expect(harness.dispatches.every((work) => work.kind !== "report")).toBe(true);

    const view = await getStudyTabView(harness.workflowDeps.client, { hiveId: HIVE_ID, correlationId: CORRELATION_ID }) as {
      revisionNumber: number;
      revisionId: string;
      investigation: typeof study;
      reports: { studyRevisionId: string }[];
    };
    expect(view.revisionNumber).toBe(2);
    expect(view.revisionId).toBe(NEXT_REVISION);
    expect(view.investigation).toEqual(study);
    expect(view.reports).toEqual(PREVIOUS_REPORTS);
    expect(view.reports.every((report) => report.studyRevisionId === PREVIOUS_REVISION)).toBe(true);
  });

  it("keeps the previous revision and reports when a pinned rebuild fails", async () => {
    const pinned = loadPinnedDomainPack();
    const harness = acceptanceHarness({
      selection: { packId: PINNED_DOMAIN_PACK.packId, version: PINNED_DOMAIN_PACK.version, compiledDigest: pinned.compiledDigest },
      content: { schema: "hive.canonical-study/1", documents: [] },
      mapping: "incomplete",
    });
    const status = await processAnalysisRun(harness.workflowDeps, RUN_ID);
    expect(status).toBe("FAILED");
    expect(harness.accepted()).toBeNull();
    expect(harness.failure()?.error_code).toBe("MODEL_OUTPUT_INVALID");
    expect(harness.calls).not.toContain("accept_study_revision");
    const view = await getStudyTabView(harness.workflowDeps.client, { hiveId: HIVE_ID, correlationId: CORRELATION_ID }) as {
      revisionNumber: number;
      revisionId: string;
      reports: typeof PREVIOUS_REPORTS;
    };
    expect(view).toMatchObject({ revisionNumber: 1, revisionId: PREVIOUS_REVISION, reports: PREVIOUS_REPORTS });
  });

  it("refuses a selection whose digest is not the compiled pack and does not call the model", async () => {
    const harness = acceptanceHarness({
      selection: { packId: PINNED_DOMAIN_PACK.packId, version: PINNED_DOMAIN_PACK.version, compiledDigest: "0".repeat(64) },
      content: fieldProposal(),
    });
    const status = await processAnalysisRun(harness.workflowDeps, RUN_ID);
    expect(status).toBe("FAILED");
    expect(harness.bodies).toEqual([]);
    expect(harness.failure()?.failure_diagnostic).toMatchObject({ diagnosticReason: "investigation_pack_pin_mismatch" });
    expect(harness.calls).not.toContain("accept_study_revision");
    expect(harness.calls).not.toContain("get_hive_chosen_pack");
    expect(harness.current.revisionNumber).toBe(1);
  });

  it("keeps an unpinned hive on the legacy canonicalize prompt", async () => {
    const harness = acceptanceHarness({ selection: null, content: { schema: "not-a-study" } });
    const status = await processAnalysisRun(harness.workflowDeps, RUN_ID);
    expect(status).toBe("ACCEPTING_STUDY");
    const body = harness.bodies[0] as { prompt_id: string; user_payload: { schema?: string; documents?: unknown } };
    expect(body.prompt_id).toBe("hive-canonicalize/1");
    expect(body.user_payload.schema).not.toBe("hive.field-mapping-request/1");
    expect(body.user_payload.documents).toBeDefined();
    expect(harness.calls).toContain("get_hive_chosen_pack");
    expect(harness.calls).toContain("get_domain_pack_selection");
    expect(harness.calls).not.toContain("accept_study_revision");
  });
});
