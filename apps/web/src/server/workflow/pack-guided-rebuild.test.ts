import {
  DOMAIN_PACK_SOURCE_SCHEMA,
  PLANNER_CONTRACT_VERSION,
  type DocExtraction,
  type DomainPackSource,
  type ExtractionFact,
} from "@hiveforyou/contracts";
import { computeSha256Digest } from "@hiveforyou/contracts/document-read";
import {
  PACK_GUIDED_CANONICALIZE_PROMPT_ID,
  PACK_GUIDED_OUTPUT_SCHEMA,
  PACK_GUIDED_STUDY_ENGINE_ID,
  verifyExtractionEvidence,
} from "@hiveforyou/contracts/study-engine";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rebuildStudy } from "@/server/study-preparation/study-preparation";
import {
  CORRELATION_ID,
  DOC_1,
  HIVE_ID,
  INTENTS,
  REQUEST_ID,
  RUN_ID,
  runJson,
  snapshotDocument,
  sourceSnapshot,
} from "@/server/study-preparation/study-preparation.fixtures";

import { processAnalysisRun, type AnalysisWorkflowDeps } from "./analysis-workflow";
import { markPackGuidedRebuild } from "./pack-guided-selection";
import { resolvePublishedDomainPack } from "./domain-pack-selection";

const PAGE = "The meeting date is March 1 2024 and the room is North.";
const QUOTE = "The meeting date is March 1 2024";
const INTENT = "record review of the written date";
const PREVIOUS_REVISION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PREVIOUS_REPORTS = [
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", studyRevisionId: PREVIOUS_REVISION, audience: "CUSTOMER" },
  { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", studyRevisionId: PREVIOUS_REVISION, audience: "PRO" },
];

function fact(): ExtractionFact {
  return {
    id: "F-label",
    modelId: "F-label",
    category: "record",
    subject: "record",
    attribute: "value",
    value: "March 1 2024",
    valueAsWritten: "March 1 2024",
    unit: null,
    per: null,
    timeframe: { from: null, to: null, asWritten: null },
    modality: "stated",
    attributedTo: null,
    aboutPersonRef: null,
    tableContext: null,
    evidence: [{ page: 1, printedPageLabel: null, quote: QUOTE }],
    confidence: "high",
  };
}

function extraction(quote = QUOTE): DocExtraction {
  const row = fact();
  return {
    schema: "hive.doc-extraction/1",
    documentId: DOC_1,
    fileName: "record.txt",
    pageRange: null,
    document: {
      titleAsPrinted: "Record",
      documentType: "record review",
      domain: { label: "written date", confidence: null },
      issuer: null,
      aboutPeople: [],
      keyDates: [],
      summary: "",
    },
    facts: [{ ...row, evidence: [{ page: 1, printedPageLabel: null, quote }] }],
    emptyFields: [],
    referencedDocuments: [],
    glossary: [],
    instructionsIgnored: [],
    coverage: { pageCount: 1, pagesRead: [1], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 1 },
  };
}

function recordDigest(): string {
  const verified = verifyExtractionEvidence({
    extractions: [extraction()],
    pages: [{ documentId: DOC_1, pageNumber: 1, text: PAGE, sourcePageDigest: computeSha256Digest(PAGE) }],
  });
  if (!verified.ok) throw new Error(JSON.stringify(verified.issues));
  const digest = verified.value.index.records.find((record) => record.outcome === "QUOTE_MATCHED")?.recordDigest;
  if (!digest) throw new Error("matched evidence missing");
  return digest;
}

function proposal(kind: string, proposalId: string, clauseId: string, claim: Record<string, string>, digest: string) {
  return {
    proposalId,
    clauseId,
    kind,
    evidenceRecordDigests: [digest],
    claim,
    uncertainty: null,
  };
}

function modelOutput(digest: string, options: { question?: boolean; field?: boolean } = {}) {
  const question = options.question !== false;
  const field = options.field !== false;
  return {
    schema: PACK_GUIDED_OUTPUT_SCHEMA,
    proposals: [
      ...(field
        ? [proposal("FIELD", "proposal:label", "entity:record", {
          entityId: "entity:record",
          instanceId: "record-1",
          fieldId: "label",
        }, digest)]
        : []),
      proposal("DOCUMENT", "proposal:document", "document:record", {
        documentKindId: "document:record",
        role: "ANCHOR",
      }, digest),
      ...(question
        ? [proposal("STATEMENT", "proposal:question", "question:written-date", { questionId: "question:written-date" }, digest)]
        : []),
    ],
  };
}

function source(): DomainPackSource {
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: "synthetic-record", version: "1.0.0", title: "Synthetic record" },
    ownership: { scope: "PLATFORM", ownerId: "platform", authoredBy: "synthetic" },
    applicability: {
      jurisdiction: "US-FEDERAL",
      verification: "REVIEWED",
      intentHints: ["record review", "written date"],
    },
    definitions: [
      {
        id: "entity:record",
        kind: "entity",
        label: "Record",
        fields: [{ id: "label", valueType: "TEXT", required: true }],
      },
      {
        id: "document:record",
        kind: "document",
        label: "Primary record",
        aliases: ["Record"],
        appliesWhen: { op: "REVIEW_REQUIRED" },
        settlesCheckIds: [],
      },
      {
        id: "question:written-date",
        kind: "question",
        label: "Written date",
        audience: "all",
        text: "Which written date is on the primary record?",
        appliesWhen: { op: "REVIEW_REQUIRED" },
      },
    ],
    changes: [],
    review: { status: "REVIEWED", reviewerId: "reviewer", reviewedAt: "2026-11-27" },
  };
}

function writeCatalog(): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "hive-pack-guided-"));
  const directory = path.join(cwd, "packs", "drafts", "synthetic-record", "v1.0.0");
  mkdirSync(directory, { recursive: true });
  mkdirSync(path.join(cwd, "packs", "published"), { recursive: true });
  const pack = source();
  writeFileSync(path.join(directory, "source.json"), JSON.stringify(pack));
  writeFileSync(path.join(directory, "ontology.json"), JSON.stringify({
    schema: "hive.domain-ontology-spec/1",
    packRef: { packId: pack.identity.packId, version: pack.identity.version },
    entities: [{
      id: "entity:record",
      factClass: "RECORD",
      fields: [{ id: "label", valueType: "TEXT" }],
      ruleIds: [],
      documentKinds: [],
      identityKeys: ["label"],
    }],
    relationships: [],
    documents: [{ id: "document:record", entities: [], checksSupported: [] }],
  }));
  writeFileSync(path.join(directory, "authority.json"), JSON.stringify({
    schema: "hive.domain-authority-register/1",
    authorities: [],
    definitionAuthorityMap: {},
    authorityRoles: {},
    structuralDefinitions: {},
    unusedAuthorityDisposition: {},
  }));
  for (const [name, schema] of [
    ["conflicts.json", "hive.domain-conflict-pattern-spec/1"],
    ["overlays.json", "hive.domain-state-overlay-spec/1"],
    ["facts.json", "hive.domain-fact-class-spec/1"],
    ["workflow.json", "hive.domain-workflow-coverage-spec/1"],
    ["operators.json", "hive.domain-unsupported-operator-spec/1"],
  ] as const) {
    writeFileSync(path.join(directory, name), JSON.stringify({
      schema,
      dp1Supported: false,
      ...(name === "facts.json" ? { classes: ["RECORD"] } : name === "conflicts.json" ? { patterns: [] } : name === "overlays.json" ? { overlays: [] } : name === "workflow.json" ? { rows: [] } : { operators: [] }),
    }));
  }
  writeFileSync(path.join(cwd, "packs", "published", "domain-pack-catalog.json"), JSON.stringify({
    schema: "hive.published-domain-pack-catalog/1",
    editions: [{
      domain: "record",
      packId: "synthetic-record",
      version: "1.0.0",
      publication: "PUBLISHED",
      approval: "APPROVED",
      investigationPromptId: "hive.domain-investigation/1",
      directory: "drafts/synthetic-record/v1.0.0",
    }],
  }));
  return cwd;
}

function acceptanceHarness(input: { pageText?: string; quote?: string; content?: unknown; intentText?: string }) {
  const pageText = input.pageText ?? PAGE;
  const document = snapshotDocument(DOC_1, "record.txt", { verifiedPageCount: 1, totalPhysicalPages: 1 });
  const row = extraction(input.quote ?? QUOTE);
  let status = "CANONICALIZING";
  let leased = false;
  const stageOutputs: Record<string, unknown> = {};
  const metrics: unknown[] = [];
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
  const run = () => runJson(status, { preparationMode: "REBUILD", stageAttempt: 1, snapshotFrozen: true, stageMetrics: metrics });
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
          intents: [{ id: INTENTS[0]!.id, intentText: input.intentText ?? INTENT, audience: null }],
        },
        error: null,
      };
    }
    if (fn === "get_doc_extractions_for_run") {
      return { data: { extractions: [{ sourceDocumentId: DOC_1, contentDigest: document.pageSetDigest, extraction: row }] }, error: null };
    }
    if (fn === "get_domain_pack_selection") return { data: null, error: null };
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
            page_text: pageText,
            page_text_sha256: computeSha256Digest(pageText),
            page_byte_length: Buffer.byteLength(pageText, "utf8"),
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
    if (fn === "patch_processing_run_workflow_state") {
      Object.assign(stageOutputs, args.p_patch ?? {});
      return { data: { applied: true }, error: null };
    }
    if (fn === "transition_processing_run") {
      if (args.p_from_status !== status) return { data: { applied: false, processingRun: run() }, error: null };
      const details = (args.p_details ?? {}) as Record<string, unknown>;
      Object.assign(stageOutputs, (details.stage_outputs ?? {}) as Record<string, unknown>);
      if (details.stage_metric) metrics.push(details.stage_metric);
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
      current.revisionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      current.revisionNumber = 2;
      current.investigation = (accepted.investigation ?? current.investigation) as typeof current.investigation;
      status = "SUCCEEDED";
      leased = false;
      return { data: { created: true, processingRun: run(), reportRuns: [] }, error: null };
    }
    if (fn === "get_study_tab_view") {
      return { data: { revisionId: current.revisionId, revisionNumber: current.revisionNumber, investigation: current.investigation, reports: current.reports }, error: null };
    }
    if (fn === "load_pipeline_throughput") return { data: { outputInputRatio: 1, latencyPerTokenMs: 1 }, error: null };
    return { data: null, error: null };
  });
  const bodies: unknown[] = [];
  const urls: string[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    const request = JSON.parse(String(init?.body));
    bodies.push(request);
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
    now: () => new Date("2026-11-27T12:00:00.000Z"),
  } as unknown as AnalysisWorkflowDeps;
  return { workflowDeps, calls, bodies, urls, dispatches, accepted: () => accepted, failure: () => failure, current };
}

const catalogs: string[] = [];

afterEach(() => {
  catalogs.splice(0);
});

describe("pack-guided rebuild", () => {
  it("publishes a canonical study when validation passes and leaves the earlier reports in place", async () => {
    const cwd = writeCatalog();
    catalogs.push(cwd);
    const resolved = resolvePublishedDomainPack({ intentText: INTENT, documents: ["record.txt"] }, cwd);
    expect(resolved.status).toBe("selected");
    markPackGuidedRebuild(RUN_ID);
    const harness = acceptanceHarness({ content: modelOutput(recordDigest()) });
    harness.workflowDeps = { ...harness.workflowDeps, packsCwd: cwd };
    const canonicalizing = await processAnalysisRun(harness.workflowDeps, RUN_ID);
    expect(canonicalizing).toBe("ACCEPTING_STUDY");
    const body = harness.bodies[0] as { task: string; prompt_id: string; user_payload: unknown };
    expect(harness.urls[0]).toMatch(/\/v1\/plan-completion$/);
    expect(body.task).toBe("canonicalize");
    expect(body.prompt_id).toBe(PACK_GUIDED_CANONICALIZE_PROMPT_ID);
    expect(JSON.stringify(body.user_payload)).not.toContain(QUOTE);
    const published = await processAnalysisRun(harness.workflowDeps, RUN_ID);
    expect(published).toBe("SUCCEEDED");
    const revision = harness.accepted();
    expect(revision?.format).toBe("canonical-study-1");
    const verification = revision?.verification as { counts: Record<string, string> };
    expect(verification.counts.investigationEngine).toBe(PACK_GUIDED_STUDY_ENGINE_ID);
    expect(verification.counts.domainPackDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(verification.counts.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(harness.dispatches.some((item) => item.kind === "report")).toBe(false);
    expect(harness.current.reports).toEqual(PREVIOUS_REPORTS);
    expect(JSON.stringify(revision)).not.toContain(PAGE);
  });

  it("rejects evidence that is not a synthetic fixture and keeps the previous revision", async () => {
    const cwd = writeCatalog();
    markPackGuidedRebuild(RUN_ID);
    const harness = acceptanceHarness({ pageText: "This page is not a registered synthetic record.", content: modelOutput("a".repeat(64)) });
    harness.workflowDeps = { ...harness.workflowDeps, packsCwd: cwd };
    const status = await processAnalysisRun(harness.workflowDeps, RUN_ID);
    expect(status).toBe("FAILED");
    expect(harness.bodies).toEqual([]);
    expect(harness.calls).not.toContain("accept_study_revision");
    expect(harness.current.revisionNumber).toBe(1);
    expect(harness.current.reports).toEqual(PREVIOUS_REPORTS);
    expect(JSON.stringify(harness.failure())).toContain("privacy_denied");
    expect(JSON.stringify(harness.failure())).not.toContain("This page is not");
  });

  it("preserves the prior revision when the model answer is incomplete", async () => {
    const cwd = writeCatalog();
    markPackGuidedRebuild(RUN_ID);
    const harness = acceptanceHarness({ content: modelOutput(recordDigest(), { field: false }) });
    harness.workflowDeps = { ...harness.workflowDeps, packsCwd: cwd };
    const status = await processAnalysisRun(harness.workflowDeps, RUN_ID);
    expect(status).toBe("FAILED");
    expect(harness.bodies.every((item) => (item as { prompt_id?: string }).prompt_id === PACK_GUIDED_CANONICALIZE_PROMPT_ID)).toBe(true);
    expect(harness.bodies.some((item) => (item as { task?: string }).task === "investigation")).toBe(false);
    expect(harness.calls).not.toContain("accept_study_revision");
    expect(harness.current.revisionNumber).toBe(1);
    expect(harness.current.reports).toEqual(PREVIOUS_REPORTS);
    expect(JSON.stringify(harness.failure())).toContain("incomplete_evidence");
  });

  it("does not fall back to the investigation engine when the published pack is selected", async () => {
    markPackGuidedRebuild(RUN_ID);
    const harness = acceptanceHarness({
      intentText: "I want to understand Maya's IEP and prepare for the evaluation",
      content: { schema: "not-a-study" },
    });
    const status = await processAnalysisRun(harness.workflowDeps, RUN_ID);
    expect(status).toBe("FAILED");
    expect(harness.calls).not.toContain("accept_study_revision");
    expect(harness.bodies.every((item) => (item as { task?: string; prompt_id?: string }).task !== "investigation")).toBe(true);
    expect(harness.bodies.every((item) => (item as { prompt_id?: string }).prompt_id !== "hive-canonicalize/1")).toBe(true);
    expect(harness.current.revisionNumber).toBe(1);
    expect(harness.current.reports).toEqual(PREVIOUS_REPORTS);
  });

  it("accepts an explicit pack-guided rebuild without an environment gate, including production NODE_ENV and VERCEL_ENV", async () => {
    const previousNode = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    delete process.env.HIVE_SYNTHETIC_STUDY_ENGINE;
    const rpc = vi.fn(async () => ({
      data: {
        processingRun: runJson("QUEUED", { preparationMode: "REBUILD" }),
        created: true,
      },
      error: null,
    }));
    const guided = {
      hiveId: HIVE_ID,
      correlationId: CORRELATION_ID,
      rawBody: { clientRequestId: REQUEST_ID, studyEngine: "pack-guided" },
    };
    try {
      const started = await rebuildStudy({ rpc } as never, guided);
      expect(started.packGuided).toBe(true);
      expect(rpc).toHaveBeenCalledWith(
        "rebuild_study",
        expect.objectContaining({ p_hive_id: HIVE_ID, p_request_id: REQUEST_ID }),
      );
      const legacy = await rebuildStudy({ rpc } as never, {
        ...guided,
        rawBody: { clientRequestId: REQUEST_ID },
      });
      expect(legacy.packGuided).toBe(false);
    } finally {
      process.env.NODE_ENV = previousNode;
      delete process.env.VERCEL_ENV;
      delete process.env.HIVE_SYNTHETIC_STUDY_ENGINE;
    }
  });
});
