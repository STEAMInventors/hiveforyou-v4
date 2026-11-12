import {
  CANONICAL_STUDY_SCHEMA,
  type CanonicalStudy,
  parseWriterAgentBudgetDiagnosticField,
  PLANNER_CONTRACT_VERSION,
  STUDY_AGENT_TURN_CONTRACT_VERSION,
  STUDY_AGENT_TURN_LIMITS,
  STUDY_VIEW_SCHEMA,
  StudyAgentLedger,
  type StudyAgentTurnRequest,
  studyClaimCatalog,
  validateDocExtraction,
  verifyStudyInvestigation,
  WRITER_AGENT_BUDGET,
  WRITER_AGENT_TOOLS,
  WRITER_COMPOSE_TOOLS,
  WRITER_EDITORIAL_TOOL_NAMES,
  WRITER_EDITORIAL_TOOLS,
} from "@hiveforyou/contracts";
import {
  L001_INITIAL_IEP_DOC_ID,
  L001_INITIAL_IEP_FILE_NAMES,
  L001_INITIAL_IEP_PAGES,
  L001_INITIAL_IEP_PLAN_QUESTION_IDS,
  l001CustomerEditorialPlan,
  l001InitialIepStudyAgentTurns,
  l001ProEditorialPlan,
  mayaEditorialPlan,
  MAYA_DOCS,
  MAYA_FILE_NAMES,
  MAYA_INTENT_ID,
  MAYA_INTENT_TEXT,
  MAYA_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_REVISION_6_PAGES,
  MAYA_REVISION_6_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaRevision6StudyOutput,
  mayaStudyContextArtifacts,
  mayaStudyOutput,
  mayaWriterAgentTurns,
  mayaWriterComposeTurns,
  mayaWriterEditorialTurns,
  mayaWriterOutput,
  mayaWriterPresentationPlan,
  revision6CustomerEditorialPlan,
} from "@hiveforyou/contracts/testing";
import { describe, expect, it, vi } from "vitest";

import { emitStructuredEvent } from "@/server/observability/logger";
import { loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";
import { UNKNOWN_AUDIENCE } from "@/server/study-preparation/study-preparation.fixtures";

import { buildWriterPayload, processReportRun, type ReportGenerationDeps } from "./report-generation";

vi.mock("@/server/observability/logger", () => ({ emitStructuredEvent: vi.fn() }));

const REPORT_RUN_ID = "cccccccc-0000-4000-8000-000000000001";
const REVISION_ID = "dddddddd-0000-4000-8000-000000000001";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";

function verifiedStudy() {
  const verified = verifyStudyInvestigation(mayaStudyOutput(), {
    processingRunId: MAYA_RUN_ID,
    planQuestionIds: MAYA_PLAN_QUESTION_IDS,
    pages: new Map(Object.entries(MAYA_PAGES)),
  });
  if (!verified.ok) throw new Error(verified.message);
  return verified.value;
}

function reportRunJson(status: string, audience: "CUSTOMER" | "PRO", overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_RUN_ID,
    hiveId: HIVE_ID,
    studyRevisionId: REVISION_ID,
    audience,
    trigger: "STUDY_ACCEPTED",
    status,
    attemptCount: 1,
    maxAttempts: 3,
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: "66666666-6666-4666-8666-666666666666",
    reportId: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

function fakeDatabase(
  audience: "CUSTOMER" | "PRO" = "CUSTOMER",
  options: {
    claimed?: boolean;
    maxAttempts?: number;
    nowMs?: () => number;
    inputsOverrides?: Record<string, unknown>;
  } = {},
) {
  let status = "QUEUED";
  let attemptCount = 0;
  const maxAttempts = options.maxAttempts ?? 3;
  let leaseExpiresAtMs: number | null = null;
  let nextDispatchAtMs: number | null = null;
  const nowMs = options.nowMs ?? (() => Date.now());
  const transitions: { from: string; to: string; details: Record<string, unknown> }[] = [];
  const savedReports: Record<string, unknown>[] = [];
  const study = verifiedStudy();
  const contextArtifacts = mayaStudyContextArtifacts();
  const initialStudySnapshot = JSON.stringify(study);
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    const currentNow = nowMs();
    switch (fn) {
      case "claim_report_run":
        if (
          options.claimed === false ||
          status === "SUCCEEDED" ||
          status === "FAILED" ||
          (status !== "QUEUED" && leaseExpiresAtMs !== null && leaseExpiresAtMs > currentNow) ||
          (status === "QUEUED" && nextDispatchAtMs !== null && nextDispatchAtMs > currentNow && attemptCount > 0)
        ) {
          return {
            data: {
              claimed: false,
              reportRun: reportRunJson(options.claimed === false ? "WRITING" : status, audience, {
                attemptCount: Math.max(1, attemptCount),
                maxAttempts,
              }),
            },
            error: null,
          };
        }
        if (attemptCount >= maxAttempts) {
          status = "FAILED";
          leaseExpiresAtMs = null;
          nextDispatchAtMs = null;
          return {
            data: { claimed: false, reportRun: reportRunJson(status, audience, { attemptCount, maxAttempts }) },
            error: null,
          };
        }
        status = "WRITING";
        attemptCount += 1;
        leaseExpiresAtMs = currentNow + 300_000;
        nextDispatchAtMs = null;
        return {
          data: { claimed: true, reportRun: reportRunJson(status, audience, { attemptCount, maxAttempts }) },
          error: null,
        };
      case "get_pipeline_throughput":
        return {
          data: {
            sampleCount: 0,
            outputTokensPerSecond: args.p_task === "canonicalize" ? 70 : args.p_task === "write" ? 100 : 110,
            outputInputRatio: 1,
            inputTokensPerPage: args.p_task === "extract" ? 400 : null,
          },
          error: null,
        };
      case "get_report_generation_inputs":
        return {
          data: {
            reportRun: reportRunJson(status, audience, { attemptCount, maxAttempts }),
            studyRevision: {
              id: REVISION_ID,
              revisionNumber: 1,
              processingRunId: MAYA_RUN_ID,
              investigation: study.investigation,
              verification: study.verification,
              audienceConfiguration: {
                ...UNKNOWN_AUDIENCE,
                customer: { ...UNKNOWN_AUDIENCE.customer, role: "Parent", status: "STATED" },
                pro: {
                  ...UNKNOWN_AUDIENCE.pro,
                  primaryRole: "Special education advocate",
                  alternativeRoles: ["Special education attorney"],
                  status: "PROVISIONAL",
                },
                studyGuidance: ["Keep every dated measurement, goal and service with its source page."],
                writerGuidance: {
                  customer: ["Explain what the plan says in plain words and end with questions for the meeting."],
                  pro: ["Audit measurements, service delivery logs, criteria, and open determinations."],
                },
              },
              coverageComplete: true,
            },
            intentDecomposition: contextArtifacts.intentDecomposition,
            domainProposal: contextArtifacts.domainProposal,
            intentIntelligence: contextArtifacts.intentIntelligence,
            investigationPlan: contextArtifacts.investigationPlan,
            sourceSnapshot: {
              documents: Object.values(MAYA_DOCS).map((id) => ({ sourceDocumentId: id, fileName: MAYA_FILE_NAMES[id] })),
              excluded: [],
              coverageComplete: true,
            },
            intents: [{ id: MAYA_INTENT_ID, intentText: MAYA_INTENT_TEXT, audience: "Maya's parent" }],
            ...(options.inputsOverrides ?? {}),
          },
          error: null,
        };
      case "transition_report_run": {
        if (args.p_from_status !== status) {
          return { data: { applied: false, reportRun: reportRunJson(status, audience, { attemptCount, maxAttempts }) }, error: null };
        }
        transitions.push({ from: String(args.p_from_status), to: String(args.p_to_status), details: args.p_details as Record<string, unknown> });
        const details = args.p_details as { retryable?: boolean };
        const retrying = args.p_to_status === "FAILED" && details.retryable === true && attemptCount < maxAttempts;
        status = retrying ? "QUEUED" : String(args.p_to_status);
        leaseExpiresAtMs = args.p_to_status === "FAILED" ? null : currentNow + 300_000;
        nextDispatchAtMs = retrying ? currentNow + 30_000 * attemptCount : null;
        return {
          data: { applied: true, retrying, reportRun: reportRunJson(status, audience, { attemptCount, maxAttempts }) },
          error: null,
        };
      }
      case "save_report":
        if (savedReports.length === 0) {
          savedReports.push(args.p_report as Record<string, unknown>);
        }
        status = "SUCCEEDED";
        leaseExpiresAtMs = null;
        nextDispatchAtMs = null;
        return {
          data: {
            created: savedReports.length === 1,
            reportRun: reportRunJson(status, audience, {
              attemptCount,
              maxAttempts,
              reportId: "eeeeeeee-0000-4000-8000-000000000001",
            }),
          },
          error: null,
        };
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  });
  return {
    client: { rpc },
    transitions,
    saved: () => savedReports[0] ?? null,
    savedCount: () => savedReports.length,
    status: () => status,
    attemptCount: () => attemptCount,
    nextDispatchAtMs: () => nextDispatchAtMs,
    studyUnchanged: () => JSON.stringify(study) === initialStudySnapshot,
  };
}

type ToolCall = { id: string; name: string; arguments: string };

function turnResponse(toolCalls: ToolCall[], overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION,
      model_alias: "harvester",
      resolved_model: "synthetic-model",
      message: { content: null, tool_calls: toolCalls },
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      latency_ms: 900,
      finish_reason: "tool_calls",
      ...overrides,
    }),
    { status: 200 },
  );
}

function semanticReviewResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION,
      model_alias: "harvester",
      resolved_model: "synthetic-model",
      message: {
        content: JSON.stringify({ schema: "hive.writer-semantic-review/1", findings: [] }),
        tool_calls: [],
      },
      usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
      latency_ms: 400,
      finish_reason: "stop",
      ...overrides,
    }),
    { status: 200 },
  );
}

const noopSemanticReviewer = vi.fn(async () => []);

function runReport(deps: ReportGenerationDeps, reportRunId: string = REPORT_RUN_ID) {
  return processReportRun({ semanticReviewer: noopSemanticReviewer, ...deps }, reportRunId);
}

function planner(turns: ToolCall[][] = mayaWriterEditorialTurns("CUSTOMER"), status = 200) {
  const bodies: StudyAgentTurnRequest[] = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as StudyAgentTurnRequest;
    bodies.push(body);
    if (status !== 200) {
      return new Response(
        JSON.stringify({ contract_version: "planner-error@1", error_code: "MODEL_TIMEOUT", retryable: true }),
        { status },
      );
    }
    if (body.tools.length === 0) {
      return semanticReviewResponse();
    }
    const turnIndex = body.messages.filter((m) => m.role === "assistant").length;
    return turnResponse(turns[turnIndex] ?? []);
  });
  return {
    bodies,
    deps: {
      getConfig: () => ({ baseUrl: "https://reader.example.test/planner", serviceToken: "t", timeoutMs: 1000 }),
      fetchFn: fetchFn as unknown as typeof fetch,
    },
  };
}

describe("processReportRun", () => {
  it.each(["CUSTOMER", "PRO"] as const)("writes, validates and saves one %s report from the accepted Study", async (audience) => {
    const db = fakeDatabase(audience);
    const model = planner(mayaWriterEditorialTurns(audience));

    await expect(
      runReport({ client: db.client, planner: model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");

    expect(model.bodies).toHaveLength(1);
    expect(model.bodies[0]!.task).toBe("writer");
    expect(model.bodies[0]!.prompt_id).toBe("hive-writer/1");
    expect(model.bodies[0]!.tools.map((t) => t.function.name)).toEqual([...WRITER_EDITORIAL_TOOL_NAMES]);

    const payload = JSON.parse(model.bodies[0]!.messages[0]!.content ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({ task: "writer", audience, coverage: { complete: true } });
    expect(JSON.stringify(payload)).not.toContain(MAYA_PAGES[`${MAYA_DOCS.teacherNotes}:1`]);
    const claims = payload.claims as {
      id: string;
      pages?: string[];
      quotes?: string[];
      numericStatus?: string;
      criterion?: string;
      criterionSource?: string;
    }[];
    expect(claims.find((claim) => claim.id === "P2.C0")).toMatchObject({ numericStatus: "VERIFIED", pages: ["Speech service log.xlsx p.1"] });
    const assessment = claims.find((claim) => claim.id === "P1.A0");
    expect(assessment).toMatchObject({
      criterion: "Compare the latest measurement with the baseline and the goal.",
      criterionSource: "GENERAL_KNOWLEDGE",
    });
    expect(claims.every((claim) => !("quotes" in claim))).toBe(true);

    expect(db.transitions.map((t) => t.to)).toEqual(["VALIDATING", "SAVING"]);
    expect(db.transitions[1]!.details.stage_metric).toMatchObject({ stage: "WRITING", outcome: "SUCCEEDED", modelAliasRequested: "harvester" });
    const saved = db.saved()!;
    expect(saved).toMatchObject({ model_alias: "harvester", view: { audience, schema: "hive-application-view/1" } });
    expect(saved.scenario_analysis).toMatchObject({ scenarios: [{ id: "S1" }] });
  });

  it("recovers in Turn 2 when Turn 1 has a writer_claim_kind or writer_number_ungrounded block error, without re-sending accepted sections", async () => {
    const db = fakeDatabase("CUSTOMER");
    const base = mayaWriterOutput("CUSTOMER");
    const badDraft = mayaWriterOutput("CUSTOMER");
    badDraft.sections[2]!.blocks.push({
      type: "UNCERTAINTY",
      text: "Maya is improving at 74 words per minute but has not reached the goal yet.",
      claimRefs: ["P1.A0"],
    });
    const [turn1] = mayaWriterAgentTurns("CUSTOMER", badDraft);
    const turn2: ToolCall[] = [
      {
        id: "toolu_fix_s3",
        name: "record_section",
        arguments: JSON.stringify(base.sections[2]),
      },
      {
        id: "toolu_fix_view_s3",
        name: "record_view_component",
        arguments: JSON.stringify({ component: "Narrative", props: { sectionId: "s3" } }),
      },
      {
        id: "toolu_fix_finish",
        name: "finish_report",
        arguments: "{}",
      },
    ];
    const model = planner([turn1!, turn2]);

    await expect(runReport({ client: db.client, planner: model.deps }, REPORT_RUN_ID)).resolves.toBe("SUCCEEDED");
    expect(model.bodies).toHaveLength(2);
    expect(db.attemptCount()).toBe(1);
    expect(db.saved()).toMatchObject({
      writer_output: {
        schema: "hive.writer-report/1",
        audience: "CUSTOMER",
        title: base.title,
        summary: base.summary,
        sections: base.sections,
        scenarios: base.scenarios,
      },
      view: { audience: "CUSTOMER", schema: "hive-application-view/1" },
    });
  });

  it("fails closed without automatic retries, saving nothing, when invalid turns exhaust the Writer round budget while recording rejectedUnits", async () => {
    const db = fakeDatabase("CUSTOMER");
    const dispatch = vi.fn(async () => true);
    const badDraft = mayaWriterOutput("CUSTOMER");
    badDraft.summary[0]!.claimRefs = ["P9.F0"];
    const [badTurn] = mayaWriterAgentTurns("CUSTOMER", badDraft);
    // Repeat invalid calls across all 5 rounds; rejectedUnits are counted for observability while maxRounds terminates bounded execution.
    const turns = Array.from({ length: 5 }, (_, t) =>
      badTurn!.map((call, i) => ({ ...call, id: `bad_${t}_${i}` })),
    );
    const model = planner(turns);

    await expect(runReport({ client: db.client, planner: model.deps, dispatch }, REPORT_RUN_ID)).resolves.toBe("FAILED");
    const lastTransition = db.transitions.at(-1)!;
    expect(lastTransition).toMatchObject({
      from: "WRITING",
      to: "FAILED",
      details: {
        error_code: "MODEL_OUTPUT_INVALID",
        retryable: false,
        stage_metric: { stage: "WRITING", outcome: "FAILED", retryable: false },
        failure_diagnostic: {
          component: "writer",
          operation: "write_report",
          task: "writer",
          diagnosticReason: "writer_agent_budget_exhausted",
          retryable: false,
        },
      },
    });
    const diag = lastTransition.details.failure_diagnostic as { diagnosticField?: string };
    expect(parseWriterAgentBudgetDiagnosticField(diag.diagnosticField)).toMatchObject({
      dimension: "rounds",
      roundsUsed: 5,
      roundsAllowed: 5,
      rejectedUnits: 14,
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(db.saved()).toBeNull();
    expect(db.studyUnchanged()).toBe(true);
  });

  it("completes a Customer report when Turn 1 and Turn 2 exceed 8 rejected units (r2/5:tc20:inv9:s5:v10 scenario) and finishes in Turn 3", async () => {
    const db = fakeDatabase("CUSTOMER");
    const base = mayaWriterOutput("CUSTOMER");

    const sectionsTurn1 = [
      base.sections[0]!,
      {
        id: "s2",
        heading: "Speech services",
        blocks: [{ type: "DOCUMENTED", text: "Maya received 999 of 480 required speech minutes.", claimRefs: ["P2.F0", "P2.F1"] }],
      },
      base.sections[2]!,
      {
        id: "s4",
        heading: "Progress interpretation",
        blocks: [{ type: "UNCERTAINTY", text: "Maya is improving toward the fluency goal.", claimRefs: ["P1.A0"] }],
      },
      {
        id: "s5",
        heading: "Questions for the IEP team",
        blocks: [
          {
            type: "QUESTION",
            text: "Whether the gain from 62 to 74 words correct per minute is sufficient is decided by the IEP team.",
            claimRefs: ["P1.D0", "P1.F0", "P1.F2"],
          },
        ],
      },
    ];
    const viewTurn1 = [
      { component: "Narrative", props: { sectionId: "summary" } },
      { component: "Metric", props: { label: "Reading gain", binding: "{{calc:P1.C0}}", unit: "words per minute" } },
      { component: "Narrative", props: { sectionId: "s1" } },
      {
        component: "Timeline",
        props: {
          title: "Key dates",
          events: [{ date: "March 4, 2025", text: "Reading goal of 90 words correct per minute set", claimRefs: ["P1"] }],
        },
      },
      { component: "Narrative", props: { sectionId: "s2" } },
      {
        component: "Checklist",
        props: {
          title: "Meeting preparation",
          items: [{ text: "Bring progress monitoring records.", claimRefs: ["P1.U0"] }],
        },
      },
      { component: "ScenarioExplorer", props: { scenarioId: "S1" } },
      {
        component: "Comparison",
        props: {
          title: "Speech minutes",
          leftLabel: "Delivered",
          rightLabel: "Required",
          items: [{ label: "Minutes", left: "360", right: "888", claimRefs: ["P2.F0", "P2.F1"] }],
        },
      },
      { component: "Narrative", props: { sectionId: "s4" } },
      {
        component: "EvidencePanel",
        props: {
          title: "Supporting quotes",
          claimIds: ["P1.U0"],
        },
      },
    ];

    const turn1: ToolCall[] = [
      {
        id: "toolu_cust_compose_1",
        name: "compose_writer_report",
        arguments: JSON.stringify({
          presentationPlan: mayaWriterPresentationPlan("CUSTOMER"),
          title: base.title,
          summary: base.summary,
          sections: sectionsTurn1,
          scenarios: base.scenarios,
          view: viewTurn1,
        }),
      },
    ];
    const turn2: ToolCall[] = [
      {
        id: "toolu_cust_patch_2",
        name: "apply_writer_correction",
        arguments: JSON.stringify({
          sections: [
            base.sections[1]!,
            {
              id: "s4",
              heading: "Progress interpretation",
              blocks: [{ type: "INTERPRETATION", text: "Maya is improving toward the fluency goal.", claimRefs: ["P1.A0"] }],
            },
          ],
          view: [
            {
              index: 3,
              component: "Timeline",
              props: {
                title: "Key dates",
                events: [{ date: "March 4, 2025", text: "Reading goal of 90 words correct per minute set", claimRefs: ["P1.F1"] }],
              },
            },
            { index: 5, ...viewTurn1[5]! },
            { index: 7, ...viewTurn1[7]! },
            { index: 9, ...viewTurn1[9]! },
          ],
        }),
      },
    ];
    const turn3: ToolCall[] = [
      {
        id: "toolu_cust_patch_3",
        name: "apply_writer_correction",
        arguments: JSON.stringify({
          view: [
            {
              index: 5,
              component: "Checklist",
              props: {
                title: "Meeting preparation",
                items: [{ text: "Bring the November 2025 progress report showing 74 words correct per minute.", claimRefs: ["P1.F2"] }],
              },
            },
            {
              index: 7,
              component: "Comparison",
              props: {
                title: "Speech minutes",
                leftLabel: "Delivered",
                rightLabel: "Required",
                items: [{ label: "Minutes", left: "360", right: "480", claimRefs: ["P2.F0", "P2.F1"] }],
              },
            },
            {
              index: 9,
              component: "EvidencePanel",
              props: {
                title: "Supporting quotes",
                claimIds: ["P1.F2", "P2.F0"],
              },
            },
          ],
        }),
      },
    ];

    const model = planner([turn1, turn2, turn3]);
    await expect(
      runReport({ client: db.client, planner: model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");
    expect(model.bodies).toHaveLength(3);
    expect(db.saved()).toMatchObject({
      writer_output: {
        schema: "hive.writer-report/1",
        audience: "CUSTOMER",
        sections: expect.arrayContaining([
          expect.objectContaining({ id: "s1" }),
          expect.objectContaining({ id: "s2" }),
          expect.objectContaining({ id: "s3" }),
          expect.objectContaining({ id: "s4" }),
          expect.objectContaining({ id: "s5" }),
        ]),
      },
      view: { audience: "CUSTOMER", schema: "hive-application-view/1" },
    });
  });

  it("fails the Writer run as retryable from WRITING when the model times out", async () => {
    const db = fakeDatabase();
    const model = planner(undefined, 504);

    await runReport({ client: db.client, planner: model.deps }, REPORT_RUN_ID);
    expect(db.transitions).toEqual([
      expect.objectContaining({ from: "WRITING", to: "FAILED", details: expect.objectContaining({ error_code: "MODEL_TIMEOUT", retryable: true }) }),
    ]);
  });

  it("does nothing when another invocation already claimed the run", async () => {
    const db = fakeDatabase("CUSTOMER", { claimed: false });
    const model = planner(mayaWriterAgentTurns("CUSTOMER"));
    await expect(runReport({ client: db.client, planner: model.deps }, REPORT_RUN_ID)).resolves.toBe("WRITING");
    expect(model.bodies).toHaveLength(0);
  });

  it("runs Customer and Pro Writer loops independently from the same accepted Study", async () => {
    const customerDb = fakeDatabase("CUSTOMER");
    const proDb = fakeDatabase("PRO");
    const customerModel = planner(mayaWriterAgentTurns("CUSTOMER"));
    const proModel = planner(mayaWriterAgentTurns("PRO"));

    await expect(runReport({ client: customerDb.client, planner: customerModel.deps }, REPORT_RUN_ID)).resolves.toBe(
      "SUCCEEDED",
    );
    await expect(runReport({ client: proDb.client, planner: proModel.deps }, REPORT_RUN_ID)).resolves.toBe("SUCCEEDED");

    expect(customerModel.bodies).toHaveLength(1);
    expect(proModel.bodies).toHaveLength(1);
    expect(JSON.parse(customerModel.bodies[0]!.messages[0]!.content ?? "{}").audience).toBe("CUSTOMER");
    expect(JSON.parse(proModel.bodies[0]!.messages[0]!.content ?? "{}").audience).toBe("PRO");
  });

  it("schedules delayed retry dispatch with backoff on transient model timeouts, blocks execution before next_dispatch_at, and respects maxAttempts", async () => {
    let clock = 1_000_000;
    const db = fakeDatabase("CUSTOMER", { maxAttempts: 3, nowMs: () => clock });
    const dispatch = vi.fn(async () => true);
    const model = planner(undefined, 504);

    // Attempt 1 fails with MODEL_TIMEOUT -> QUEUED + 30s backoff dispatch.
    await expect(runReport({ client: db.client, planner: model.deps, dispatch, clock: () => clock }, REPORT_RUN_ID)).resolves.toBe("QUEUED");
    expect(db.attemptCount()).toBe(1);
    expect(db.transitions.at(-1)?.details.failure_diagnostic).toMatchObject({
      component: "planner",
      operation: "study_agent_turn",
      task: "writer",
      errorCode: "MODEL_TIMEOUT",
      diagnosticReason: "planner_timeout",
      attempt: 1,
      retryable: true,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenLastCalledWith(
      { kind: "report", id: REPORT_RUN_ID },
      "66666666-6666-4666-8666-666666666666",
      { delaySeconds: 30 },
    );

    // Before next_dispatch_at (10s elapsed < 30s), claim_report_run refuses to claim and no model call runs.
    clock += 10_000;
    await expect(runReport({ client: db.client, planner: model.deps, dispatch, clock: () => clock }, REPORT_RUN_ID)).resolves.toBe("QUEUED");
    expect(model.bodies).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);

    // At next_dispatch_at (30s elapsed), attempt 2 runs and fails -> QUEUED + 60s backoff dispatch.
    clock += 20_000;
    await expect(runReport({ client: db.client, planner: model.deps, dispatch, clock: () => clock }, REPORT_RUN_ID)).resolves.toBe("QUEUED");
    expect(db.attemptCount()).toBe(2);
    expect(model.bodies).toHaveLength(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith(
      { kind: "report", id: REPORT_RUN_ID },
      "66666666-6666-4666-8666-666666666666",
      { delaySeconds: 60 },
    );

    // At attempt 3 (after 60s), maxAttempts (3) is reached -> terminal FAILED and no further dispatch.
    clock += 60_000;
    await expect(runReport({ client: db.client, planner: model.deps, dispatch, clock: () => clock }, REPORT_RUN_ID)).resolves.toBe("FAILED");
    expect(db.attemptCount()).toBe(3);
    expect(model.bodies).toHaveLength(3);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(db.studyUnchanged()).toBe(true);
  });

  it("does not schedule a retry when a failure is non-retryable", async () => {
    const db = fakeDatabase("CUSTOMER");
    const dispatch = vi.fn(async () => true);
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          contract_version: "planner-error@1",
          error_code: "INVALID_REQUEST",
          retryable: false,
          diagnostic_reason: "planner_invalid_request",
        }),
        { status: 400 },
      ),
    );
    const nonRetryablePlanner = {
      getConfig: () => ({ baseUrl: "https://reader.example.test/planner", serviceToken: "t", timeoutMs: 1000 }),
      fetchFn: fetchFn as unknown as typeof fetch,
    };

    await expect(runReport({ client: db.client, planner: nonRetryablePlanner, dispatch }, REPORT_RUN_ID)).resolves.toBe("FAILED");
    expect(dispatch).not.toHaveBeenCalled();
    expect(db.saved()).toBeNull();
  });

  it("prevents duplicate dispatches from producing duplicate reports", async () => {
    const db = fakeDatabase("CUSTOMER");
    const dispatch = vi.fn(async () => true);
    const model = planner(mayaWriterAgentTurns("CUSTOMER"));

    const [first, second] = await Promise.all([
      runReport({ client: db.client, planner: model.deps, dispatch }, REPORT_RUN_ID),
      runReport({ client: db.client, planner: model.deps, dispatch }, REPORT_RUN_ID),
    ]);
    expect([first, second]).toContain("SUCCEEDED");
    await expect(runReport({ client: db.client, planner: model.deps, dispatch }, REPORT_RUN_ID)).resolves.toBe("SUCCEEDED");

    expect(model.bodies).toHaveLength(1);
    expect(db.savedCount()).toBe(1);
    expect(db.studyUnchanged()).toBe(true);
  });

  it.each(["CUSTOMER", "PRO"] as const)(
    "serializes a valid study-agent-turn@1 Writer request when the claim catalog exceeds 32,000 characters (%s)",
    async (audience) => {
      const baseStudy = verifiedStudy();
      const extraFacts = Array.from({ length: 45 }, (_, index) => ({
        statement: `Documented progress observation ${index + 1}: In November 2025 Maya read 74 words correct per minute against the 90-word target (${"detail ".repeat(90).trim()}).`,
        evidence: [
          {
            sourceDocumentId: MAYA_DOCS.progressNov,
            pageNumber: 1,
            quote: `Goal 1 reading fluency: 74 words correct per minute. Progress: making adequate progress (${"context ".repeat(35).trim()}).`,
          },
          {
            sourceDocumentId: MAYA_DOCS.iep2025,
            pageNumber: 1,
            quote: `Maya will read 90 words correct per minute by March 2026 (${"baseline ".repeat(35).trim()}).`,
          },
        ],
      }));
      const largeInvestigation = structuredClone(baseStudy.investigation);
      largeInvestigation.answers[0]!.facts.push(...extraFacts);
      const db = fakeDatabase(audience);
      const baseRpc = db.client.rpc;
      db.client.rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
        const res = await baseRpc(fn, args);
        if (fn === "get_report_generation_inputs" && res.data && "studyRevision" in res.data) {
          res.data.studyRevision.investigation = largeInvestigation;
        }
        return res;
      }) as typeof db.client.rpc;

      const model = planner(mayaWriterEditorialTurns(audience));
      await expect(
        runReport({ client: db.client, planner: model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
      ).resolves.toBe("SUCCEEDED");

      expect(model.bodies).toHaveLength(1);
      const req = model.bodies[0]!;
      expect(req.contract_version).toBe("study-agent-turn@1");
      expect(req.task).toBe("writer");
      expect(req.prompt_id).toBe("hive-writer/1");
      expect(req.prompt_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(req.system_prompt.length).toBeGreaterThan(100);
      expect(req.system_prompt.length).toBeLessThanOrEqual(200_000);
      expect(req.max_output_tokens).toBe(8000);
      expect(req.timeout_seconds).toBeGreaterThanOrEqual(5);
      expect(req.timeout_seconds).toBeLessThanOrEqual(240);
      expect(req.tools.map((t) => t.function.name)).toEqual([...WRITER_EDITORIAL_TOOL_NAMES]);
      for (const tool of req.tools) {
        expect(tool.type).toBe("function");
        expect(tool.function.description.length).toBeGreaterThan(0);
        expect(tool.function.description.length).toBeLessThanOrEqual(2000);
        expect(tool.function.parameters).toMatchObject({
          type: "object",
          additionalProperties: false,
        });
      }
      const userContent = req.messages[0]!.content ?? "";
      expect(userContent.length).toBeGreaterThan(STUDY_AGENT_TURN_LIMITS.maxContentChars);
      expect(userContent.length).toBeLessThanOrEqual(STUDY_AGENT_TURN_LIMITS.maxUserContentChars);
    },
  );

  it.each(["CUSTOMER", "PRO"] as const)(
    "composes a %s report via single-turn compose_writer_report with presentation planning, recovers via apply_writer_correction, and emits privacy-safe runtime observability events",
    async (audience) => {
      vi.mocked(emitStructuredEvent).mockClear();
      const db = fakeDatabase(audience);
      const base = mayaWriterOutput(audience);
      const badDraft = structuredClone(base);
      badDraft.sections[2]!.blocks.push({
        type: "UNCERTAINTY",
        text: "Maya is improving at 74 words per minute but has not reached the goal yet.",
        claimRefs: ["P1.A0"],
      });

      const [turn1] = mayaWriterComposeTurns(audience, badDraft, mayaWriterPresentationPlan(audience));
      const turn2: ToolCall[] = [
        {
          id: `toolu_patch_${audience.toLowerCase()}_1`,
          name: "apply_writer_correction",
          arguments: JSON.stringify({
            sections: [base.sections[2]!],
            view: [{ component: "Narrative", props: { sectionId: "s3" } }],
          }),
        },
      ];
      const model = planner([turn1!, turn2]);

      await expect(
        runReport({ client: db.client, planner: model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
      ).resolves.toBe("SUCCEEDED");

      expect(model.bodies).toHaveLength(2);
      expect(db.saved()).toMatchObject({
        writer_output: base,
        view: { audience, schema: "hive-application-view/1" },
      });

      const events = vi.mocked(emitStructuredEvent).mock.calls.map((c) => c[0] as Record<string, unknown>);
      const eventNames = events.map((e) => e.eventName);
      expect(eventNames).toEqual(
        expect.arrayContaining([
          "writer.start",
          "writer.model.completed",
          "writer.correction.requested",
          "writer.validation.completed",
          "writer.publication.completed",
        ]),
      );
      const correctionEvent = events.find((e) => e.eventName === "writer.correction.requested")!;
      expect(correctionEvent).toMatchObject({
        audience,
        diagnosticReason: "writer_claim_kind",
        diagnosticField: "sections[2].blocks[3]",
        rejectedUnits: 1,
      });
      const publicationEvent = events.find((e) => e.eventName === "writer.publication.completed")!;
      expect(publicationEvent).toMatchObject({
        audience,
        inputCount: 200,
        outputCount: 100,
        totalCount: 300,
        componentCount: 9,
        sectionCount: 3,
        scenarioCount: 1,
        rejectedUnits: 1,
        rounds: 2,
      });
      const serializedEvents = JSON.stringify(events);
      expect(serializedEvents).not.toContain(MAYA_INTENT_TEXT);
      expect(serializedEvents).not.toContain("Baseline: 62 words correct per minute.");
    },
  );

  it("passes persisted intent goals, specialist whyItMatters/supportsOutcome, investigation deliverables, domain context, and audience guidance to Writer (V4-004G)", async () => {
    const customerDb = fakeDatabase("CUSTOMER");
    const proDb = fakeDatabase("PRO");
    const customerModel = planner(mayaWriterComposeTurns("CUSTOMER"));
    const proModel = planner(mayaWriterComposeTurns("PRO"));

    await expect(
      runReport({ client: customerDb.client, planner: customerModel.deps }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");
    await expect(
      runReport({ client: proDb.client, planner: proModel.deps }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");

    const customerPayload = JSON.parse(customerModel.bodies[0]!.messages[0]!.content ?? "{}") as Record<string, unknown>;
    const proPayload = JSON.parse(proModel.bodies[0]!.messages[0]!.content ?? "{}") as Record<string, unknown>;

    expect(customerPayload.audienceProfile).toMatchObject({
      role: "Parent",
      status: "STATED",
      guidance: ["Explain what the plan says in plain words and end with questions for the meeting."],
      studyGuidance: ["Keep every dated measurement, goal and service with its source page."],
    });
    expect(proPayload.audienceProfile).toMatchObject({
      role: "Special education advocate",
      alternativeRoles: ["Special education attorney"],
      status: "PROVISIONAL",
      guidance: ["Audit measurements, service delivery logs, criteria, and open determinations."],
    });

    expect(customerPayload.requests).toEqual([
      {
        intentRequestId: MAYA_INTENT_ID,
        text: MAYA_INTENT_TEXT,
        statedAudience: "Maya's parent",
      },
    ]);
    expect(customerPayload.domain).toMatchObject({
      label: "Special education",
      subdomain: "Individualized Education Program (IEP) & progress monitoring",
      uncertain: false,
      reasoning: expect.stringContaining("dated IEPs"),
      considerations: [expect.stringContaining("Compare baseline measurements")],
    });

    const studyContext = customerPayload.studyContext as {
      subjects: { name: string }[];
      goals: { goalId: string; goal: string; unclear?: { askThePerson: string }[]; remainingLimits?: string[] }[];
      reservedDecisions: { questionId: string; decision: string; decidedBy: string | null }[];
      specialistQuestions: { id: string; goalId: string; whyItMatters: string; supportsOutcome: string; judgmentBasis?: string }[];
      investigationQuestions: { id: string; goalId: string; establish: string; answerType: string; deliverable: string }[];
    };
    expect(studyContext.subjects).toEqual([{ name: "Maya", statedAs: "Maya's IEP", intentRequestId: MAYA_INTENT_ID }]);
    expect(studyContext.goals.map((g) => g.goalId)).toEqual(["G1", "G2", "G3"]);
    expect(studyContext.goals[1]?.unclear?.[0]?.askThePerson).toContain("Which IEP meeting");
    expect(studyContext.goals[0]?.remainingLimits).toContain("Classroom work samples outside the uploaded records are not available.");
    expect(studyContext.reservedDecisions).toEqual([
      {
        questionId: "Q3",
        decision: "Whether Maya's progress is sufficient or requires IEP revision",
        decidedBy: "The IEP team",
      },
    ]);
    expect(studyContext.specialistQuestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "I1",
          goalId: "G3",
          whyItMatters: expect.stringContaining("moving in the right direction"),
          supportsOutcome: expect.stringContaining("IEP meeting"),
          judgmentBasis: "Compare the latest measurement with the baseline and the goal.",
        }),
        expect.objectContaining({
          id: "I2",
          goalId: "G1",
          whyItMatters: expect.stringContaining("shortfall between mandated and delivered"),
          supportsOutcome: expect.stringContaining("missed service minutes"),
        }),
      ]),
    );
    expect(studyContext.investigationQuestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "P1",
          goalId: "G3",
          answerType: "COMPARISON",
          deliverable: expect.stringContaining("comparison and chronology"),
        }),
        expect.objectContaining({
          id: "P2",
          goalId: "G1",
          answerType: "CALCULATION",
          deliverable: expect.stringContaining("numeric result"),
        }),
      ]),
    );

    // Ensure no raw page text leaked into studyContext
    expect(JSON.stringify(customerPayload)).not.toContain(MAYA_PAGES[`${MAYA_DOCS.teacherNotes}:1`]);
  });

  it("handles missing or older study preparation context payloads gracefully without failing or inventing objectives (V4-004G)", async () => {
    const db = fakeDatabase("CUSTOMER", {
      inputsOverrides: {
        intentDecomposition: null,
        domainProposal: null,
        intentIntelligence: null,
        investigationPlan: null,
        intents: [{ id: MAYA_INTENT_ID, intentText: MAYA_INTENT_TEXT }],
      },
    });
    const model = planner(mayaWriterComposeTurns("CUSTOMER"));

    await expect(
      runReport({ client: db.client, planner: model.deps }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");

    const payload = JSON.parse(model.bodies[0]!.messages[0]!.content ?? "{}") as Record<string, unknown>;
    expect(payload.domain).toEqual({ label: "Unknown", uncertain: true });
    expect(payload.studyContext).toEqual({
      goals: [],
      specialistQuestions: [],
      investigationQuestions: [],
    });

    const study = verifiedStudy();
    const directPayload = buildWriterPayload(
      "PRO",
      {
        verified: study,
        audienceConfiguration: UNKNOWN_AUDIENCE as never,
        coverageComplete: true,
        domainProposal: null,
        sourceSnapshot: null,
        intents: [],
      },
      studyClaimCatalog(study),
    );
    expect(directPayload.studyContext).toEqual({
      goals: [],
      specialistQuestions: [],
      investigationQuestions: [],
    });
  });

  it("integrates Canonical Finding Resolution into buildWriterPayload and processReportRun with reportRun.createdAt as asOf and enforces temporal/editorial checks (V4-004H Gate 2)", async () => {
    const rev6Verified = verifyStudyInvestigation(mayaRevision6StudyOutput(), {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
      pages: new Map(Object.entries(MAYA_REVISION_6_PAGES)),
    });
    if (!rev6Verified.ok) throw new Error(rev6Verified.message);
    const rev6Study = rev6Verified.value;
    const rev6Claims = studyClaimCatalog(rev6Study);

    const db = fakeDatabase("CUSTOMER", {
      inputsOverrides: {
        reportRun: reportRunJson("WRITING", "CUSTOMER", {
          attemptCount: 1,
          maxAttempts: 3,
          createdAt: "2026-11-04T14:30:00.000Z",
        }),
        studyRevision: {
          id: REVISION_ID,
          revisionNumber: 6,
          processingRunId: MAYA_RUN_ID,
          investigation: rev6Study.investigation,
          verification: rev6Study.verification,
          audienceConfiguration: {
            ...UNKNOWN_AUDIENCE,
            customer: { ...UNKNOWN_AUDIENCE.customer, role: "Parent", status: "STATED" },
          },
          coverageComplete: true,
        },
      },
    });

    // Turn 1: has duplicate priorityFindings (P1.F0 and P2.F0 in same CF group) AND calls the 2024-2025 IEP "the current IEP" in summary[0]
    const turn1: ToolCall[] = [
      {
        id: "toolu_rev6_turn1",
        name: "compose_writer_report",
        arguments: JSON.stringify({
          presentationPlan: {
            audienceObjective: "Understand Maya's reading progress and prepare for the March 3, 2026 meeting.",
            summaryDetailLevel: "BALANCED",
            insights: [
              {
                id: "INS1",
                meaning: "Baseline 62 wcpm and progress to 74 wcpm (+12 wcpm).",
                claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0"],
                questionIds: ["P1", "P2", "P5", "P7"],
                role: "CENTRAL",
                reuseReason: "Used in summary and section s1.",
              },
            ],
            priorityFindings: [
              { claimId: "P1.F0", priority: "HIGH", insightId: "INS1" },
              { claimId: "P2.F0", priority: "HIGH", insightId: "INS1" }, // Duplicate canonical group!
            ],
            sections: [
              {
                id: "s1",
                heading: "Reading progress and open questions",
                priority: "HIGH",
                insightIds: ["INS1"],
                purpose: "Explain reading fluency progress, plan conflict, and missing comprehension data.",
                claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0", "P1.K0", "P1", "P1.U0", "P6.U0", "P6"],
              },
            ],
            components: [
              { component: "Narrative", sectionId: "summary", claimIds: ["P1.F4", "P1.F0", "P1.F2", "P1.C0"], purpose: "Overview." },
              { component: "Narrative", sectionId: "s1", claimIds: ["P1.K0", "P1.U0", "P6.U0", "P6"], purpose: "Details." },
            ],
          },
          title: "Maya's IEP review",
          summary: [
            {
              type: "DOCUMENTED",
              text: "Under Maya's current IEP (2024-11-12 to 2025-11-11), reading fluency rose from 62 to 74 words correct per minute ({{calc:P1.C0}} words gained).",
              claimRefs: ["P1.F4", "P1.F0", "P2.F0", "P7.F0", "P1.F2", "P1.C0"],
            },
          ],
          sections: [
            {
              id: "s1",
              heading: "Reading progress and open questions",
              blocks: [
                {
                  type: "DOCUMENTED",
                  text: "The 2024 and 2025 plans state different reading goals of 60 vs 90 words correct per minute.",
                  claimRefs: ["P1.F3", "P2.F1", "P1.K0", "P1"],
                },
                {
                  type: "UNCERTAINTY",
                  text: "Comprehension probe data after November 2025 was not available, and the evaluation reported no comprehension score.",
                  claimRefs: ["P1.U0", "P6.U0", "P6"],
                },
              ],
            },
          ],
          scenarios: [],
          view: [
            { component: "Narrative", props: { sectionId: "summary" } },
            { component: "Narrative", props: { sectionId: "s1" } },
          ],
        }),
      },
    ];

    // Turn 2: repairs presentationPlan (deduplicated priorityFindings) and summary (explicit historical framing as of 2026-11-04)
    const turn2: ToolCall[] = [
      {
        id: "toolu_rev6_turn2",
        name: "apply_writer_correction",
        arguments: JSON.stringify({
          presentationPlan: {
            audienceObjective: "Understand Maya's reading progress and prepare for the March 3, 2026 meeting.",
            summaryDetailLevel: "BALANCED",
            insights: [
              {
                id: "INS1",
                meaning: "Baseline 62 wcpm and progress to 74 wcpm (+12 wcpm).",
                claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0"],
                questionIds: ["P1", "P2", "P5", "P7"],
                role: "CENTRAL",
                reuseReason: "Used in summary and section s1.",
              },
            ],
            priorityFindings: [
              { claimId: "P1.F0", priority: "HIGH", insightId: "INS1" },
              { claimId: "P1.C0", priority: "HIGH", insightId: "INS1" },
            ],
            sections: [
              {
                id: "s1",
                heading: "Reading progress and open questions",
                priority: "HIGH",
                insightIds: ["INS1"],
                purpose: "Explain reading fluency progress, plan conflict, and missing comprehension data.",
                claimIds: ["P1.F0", "P2.F0", "P7.F0", "P1.F2", "P5.F0", "P1.C0", "P1.K0", "P1", "P1.U0", "P6.U0", "P6"],
              },
            ],
            components: [
              { component: "Narrative", sectionId: "summary", claimIds: ["P1.F4", "P1.F0", "P1.F2", "P1.C0"], purpose: "Overview." },
              { component: "Narrative", sectionId: "s1", claimIds: ["P1.K0", "P1.U0", "P6.U0", "P6"], purpose: "Details." },
            ],
          },
          summary: [
            {
              type: "DOCUMENTED",
              text: "The documented 2024 IEP effective period of 2024-11-12 to 2025-11-11 ended before the 2026-11-04 report date without establishing current plan status; reading fluency rose from a baseline of 62 to 74 words correct per minute ({{calc:P1.C0}} words gained).",
              claimRefs: ["P1.F4", "P1.F0", "P2.F0", "P7.F0", "P1.F2", "P1.C0"],
            },
          ],
          view: [{ index: 0, component: "Narrative", props: { sectionId: "summary" } }],
        }),
      },
    ];

    const model = planner([turn1, turn2]);
    await expect(
      runReport({ client: db.client, planner: model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");

    expect(model.bodies).toHaveLength(2);
    const sentPayload = JSON.parse(model.bodies[0]!.messages[0]!.content ?? "{}") as Record<string, unknown>;
    const canonicalFindings = sentPayload.canonicalFindings as {
      schema: string;
      advisoryOnly: boolean;
      asOfDate: string;
      counts: Record<string, number>;
      groups: {
        id: string;
        originalClaimIds: string[];
        questionIds: string[];
        exactEquivalence: string;
        atomicity: { status: string };
        temporal: { status: string; startDate?: string; endDate?: string; asOfDate: string | null };
        ambiguousWithClaimIds?: string[];
        conflictingWithClaimIds?: string[];
      }[];
    };

    expect(canonicalFindings.schema).toBe("hive.canonical-findings/1");
    expect(canonicalFindings.advisoryOnly).toBe(true);
    expect(canonicalFindings.asOfDate).toBe("2026-11-04");
    expect(canonicalFindings.counts.mergedGroups).toBeGreaterThanOrEqual(2);

    const baselineGroup = canonicalFindings.groups.find((g) => g.originalClaimIds.includes("P1.F0"));
    expect(baselineGroup).toMatchObject({
      originalClaimIds: ["P1.F0", "P2.F0", "P7.F0"],
      questionIds: ["P1", "P2", "P7"],
      exactEquivalence: "EXACT_DUPLICATE_GROUP",
    });

    const historicalGroup = canonicalFindings.groups.find((g) => g.originalClaimIds.includes("P1.F4"));
    expect(historicalGroup?.temporal).toMatchObject({
      status: "HISTORICAL_AS_OF_REPORT_DATE",
      asOfDate: "2026-11-04",
      startDate: "2024-11-12",
      endDate: "2025-11-11",
    });

    const compoundGroup = canonicalFindings.groups.find((g) => g.originalClaimIds.includes("P4.F0"));
    expect(compoundGroup?.atomicity.status).toBe("REQUIRES_SEMANTIC_ATOMIZATION");

    // Original claims array is retained unchanged
    const payloadClaims = sentPayload.claims as { id: string }[];
    expect(payloadClaims.map((c) => c.id)).toEqual(rev6Claims.map((c) => c.id));
    expect(sentPayload.documents).toEqual([]);
  });

  it("propagates document records, roles, temporal status, coverage, and 37 DF findings to Writer and generates validated CUSTOMER and PRO reports on the independent L001 Maya Carter golden (V4-004I Gate 3)", async () => {
    const l001Corpus = Object.entries(L001_INITIAL_IEP_PAGES).map(([key, text]) => {
      const [sourceDocumentId, page] = key.split(":");
      return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
    });
    const studyLedger = new StudyAgentLedger({
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: L001_INITIAL_IEP_PLAN_QUESTION_IDS,
      pages: l001Corpus,
    });
    for (const turn of l001InitialIepStudyAgentTurns()) {
      for (const call of turn) {
        const res = studyLedger.execute(call);
        if (!res.ok) throw new Error(`L001 ledger call failed: ${res.content}`);
      }
    }
    const verifiedL001 = verifyStudyInvestigation(studyLedger.assemble(), {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: [...L001_INITIAL_IEP_PLAN_QUESTION_IDS],
      pages: new Map(Object.entries(L001_INITIAL_IEP_PAGES)),
    });
    if (!verifiedL001.ok) throw new Error(verifiedL001.message);
    const l001Study = verifiedL001.value;

    const makeL001Db = (audience: "CUSTOMER" | "PRO") =>
      fakeDatabase(audience, {
        inputsOverrides: {
          reportRun: reportRunJson("WRITING", audience, {
            attemptCount: 1,
            maxAttempts: 3,
            createdAt: "2026-11-04T14:30:00.000Z",
          }),
          studyRevision: {
            id: REVISION_ID,
            revisionNumber: 7,
            processingRunId: MAYA_RUN_ID,
            investigation: l001Study.investigation,
            verification: l001Study.verification,
            audienceConfiguration: {
              ...UNKNOWN_AUDIENCE,
              customer: { ...UNKNOWN_AUDIENCE.customer, role: "Parent", status: "STATED" },
              pro: {
                ...UNKNOWN_AUDIENCE.pro,
                primaryRole: "Special education advocate",
                alternativeRoles: ["Special education attorney"],
                status: "PROVISIONAL",
              },
            },
            coverageComplete: true,
          },
          sourceSnapshot: {
            documents: [
              {
                sourceDocumentId: L001_INITIAL_IEP_DOC_ID,
                fileName: L001_INITIAL_IEP_FILE_NAMES[L001_INITIAL_IEP_DOC_ID]!,
              },
            ],
            excluded: [],
            coverageComplete: true,
          },
        },
      });

    const customerEditorialTurn: ToolCall[] = [
      {
        id: "toolu_l001_customer_editorial",
        name: "submit_editorial_plan",
        arguments: JSON.stringify(l001CustomerEditorialPlan()),
      },
    ];

    const proEditorialTurn: ToolCall[] = [
      {
        id: "toolu_l001_pro_editorial",
        name: "submit_editorial_plan",
        arguments: JSON.stringify(l001ProEditorialPlan()),
      },
    ];

    const customerDb = makeL001Db("CUSTOMER");
    const proDb = makeL001Db("PRO");
    const customerModel = planner([customerEditorialTurn]);
    const proModel = planner([proEditorialTurn]);

    await expect(
      runReport({ client: customerDb.client, planner: customerModel.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");
    await expect(
      runReport({ client: proDb.client, planner: proModel.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");

    expect(customerModel.bodies).toHaveLength(1);
    expect(proModel.bodies).toHaveLength(1);
    expect(customerModel.bodies[0]!.tools.map((t) => t.function.name)).toEqual([...WRITER_EDITORIAL_TOOL_NAMES]);
    expect(proModel.bodies[0]!.tools.map((t) => t.function.name)).toEqual([...WRITER_EDITORIAL_TOOL_NAMES]);

    const customerPayload = JSON.parse(customerModel.bodies[0]!.messages[0]!.content ?? "{}") as Record<string, unknown>;
    const proPayload = JSON.parse(proModel.bodies[0]!.messages[0]!.content ?? "{}") as Record<string, unknown>;

    // Proof of end-to-end DF and document metadata propagation to Writer (without redundant page lists or duplicated coverage)
    expect(customerPayload.documents).toEqual([
      expect.objectContaining({
        sourceDocumentId: L001_INITIAL_IEP_DOC_ID,
        fileName: "08_initial_iep.pdf",
        role: "PRIMARY",
        temporalStatus: "HISTORICAL",
        declaredReadCoverage: "FULL_DOCUMENT_READ",
        readCoverageStatus: "ALL_AUTHORIZED_PAGES_READ",
        extractionCompletenessStatus: "UNVERIFIED_BY_READ_COVERAGE",
        pagesRead: [1, 2, 3],
        pagesCited: [1, 2, 3],
        findingCount: 37,
        effectivePeriod: {
          startDate: "2024-11-12",
          endDate: "2025-11-11",
          asWritten: "2024-11-12 through 2025-11-11",
        },
      }),
    ]);
    const docEntry = (customerPayload.documents as Record<string, unknown>[])[0]!;
    expect("authorizedPageNumbers" in docEntry).toBe(false);
    expect("authorizedNonEmptyPageNumbers" in docEntry).toBe(false);
    expect("pages" in docEntry).toBe(false);
    expect(customerPayload.coverage).toEqual({
      complete: true,
      notes: [],
      studyCoverageNotes: ["All 3 pages of L001 08_initial_iep.pdf were read."],
    });

    const payloadClaims = customerPayload.claims as {
      id: string;
      kind: string;
      planQuestionId?: string;
      questionIds?: string[];
      findingIds?: string[];
      documentFinding?: {
        sourceDocumentId: string;
        fileName: string;
        category: string;
        subject: string;
        attribute: string;
        valueAsWritten: string;
        modality: string;
        section?: string;
      };
      pages?: string[];
      quotes?: string[];
    }[];
    const dfClaimsInPayload = payloadClaims.filter((c) => c.id.startsWith("DF"));
    expect(dfClaimsInPayload).toHaveLength(37);
    expect(payloadClaims.every((c) => !("quotes" in c))).toBe(true);
    expect(dfClaimsInPayload.find((c) => c.id === "DF19")).toMatchObject({
      id: "DF19",
      kind: "FACT",
      questionIds: ["P2", "P4", "P6"],
      pages: ["08_initial_iep.pdf p.2"],
      documentFinding: {
        sourceDocumentId: L001_INITIAL_IEP_DOC_ID,
        fileName: "08_initial_iep.pdf",
        category: "annual_goal",
        subject: "GOAL_READING_FLUENCY",
        attribute: "baseline",
        valueAsWritten: "42 WCPM",
        modality: "MEASURED",
        section: "5. Annual Goal",
      },
    });
    expect(payloadClaims.find((c) => c.id === "P2")).toMatchObject({
      id: "P2",
      kind: "ANSWER",
      planQuestionId: "P2",
      findingIds: expect.arrayContaining(["DF19", "DF20", "DF21"]),
    });

    // Verify saved reports and bound A2UI views for both audiences
    const savedCustomer = customerDb.saved()!;
    const savedPro = proDb.saved()!;
    expect(savedCustomer.view).toMatchObject({
      schema: "hive-application-view/1",
      audience: "CUSTOMER",
      layout: "PROPOSED",
    });
    expect(savedPro.view).toMatchObject({
      schema: "hive-application-view/1",
      audience: "PRO",
      layout: "PROPOSED",
    });
    const proComponents = (savedPro.view as { components: { component: string; rows?: { refs: { fileName: string; pageNumber: number }[] }[] }[] }).components;
    const recordTable = proComponents.find((c) => c.component === "RecordTable")!;
    expect(recordTable.rows).toHaveLength(5);
    expect(recordTable.rows![0]!.refs).toEqual([
      {
        sourceDocumentId: L001_INITIAL_IEP_DOC_ID,
        pageNumber: 1,
        fileName: "08_initial_iep.pdf",
      },
    ]);
    expect(proPayload.documents).toEqual(customerPayload.documents);
  });

  it("completes a PRO report via two-turn staged generation and recovers in-loop if Turn 1 hits model_output_truncated without triggering a second report-run attempt (V4-004J)", async () => {
    vi.mocked(emitStructuredEvent).mockClear();
    const db = fakeDatabase("PRO");
    const dispatch = vi.fn(async () => true);
    const base = mayaWriterOutput("PRO");
    const plan = mayaWriterPresentationPlan("PRO");

    // Turn 1: model attempts a single giant call and hits 8000-token truncation (HTTP 422 model_output_truncated).
    // Turn 2: following the in-loop truncation recovery prompt, model calls compose_writer_report with ONLY presentationPlan, title, summary, and sections.
    // Turn 3: model calls apply_writer_correction with scenarios and view to complete the PRO report in attempt 1.
    const stagedTurn2: ToolCall[] = [
      {
        id: "toolu_pro_stage1",
        name: "compose_writer_report",
        arguments: JSON.stringify({
          presentationPlan: plan,
          title: base.title,
          summary: base.summary,
          sections: base.sections,
        }),
      },
    ];
    const stagedTurn3: ToolCall[] = [
      {
        id: "toolu_pro_stage2",
        name: "apply_writer_correction",
        arguments: JSON.stringify({
          scenarios: base.scenarios,
          view: base.view,
        }),
      },
    ];

    const bodies: StudyAgentTurnRequest[] = [];
    let callCount = 0;
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as StudyAgentTurnRequest;
      bodies.push(body);
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            contract_version: "planner-error@1",
            error_code: "MODEL_OUTPUT_INVALID",
            category: "model",
            retryable: false,
            message_safe: "The planning answer was cut off.",
            correlation_id: "66666666-6666-4666-8666-666666666666",
            processing_run_id: REPORT_RUN_ID,
            task: "writer",
            component: "planner",
            operation: "study_agent_turn",
            diagnostic_reason: "model_output_truncated",
          }),
          {
            status: 422,
            headers: {
              "Content-Type": "application/json",
              "x-planner-error-code": "MODEL_OUTPUT_INVALID",
              "x-planner-diagnostic-reason": "model_output_truncated",
              "x-planner-retryable": "false",
            },
          },
        );
      }
      if (callCount === 2) return turnResponse(stagedTurn2);
      return turnResponse(stagedTurn3);
    });

    await expect(
      runReport(
        {
          client: db.client,
          planner: {
            getConfig: () => ({ baseUrl: "https://reader.example.test/planner", serviceToken: "t", timeoutMs: 1000 }),
            fetchFn: fetchFn as unknown as typeof fetch,
          },
          dispatch,
          loadCatalog: () => loadPromptCatalog(),
        },
        REPORT_RUN_ID,
      ),
    ).resolves.toBe("SUCCEEDED");

    expect(db.attemptCount()).toBe(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(bodies).toHaveLength(3);
    // Verify Turn 2 received the truncation recovery prompt instructing compact EditorialPlan submission
    const turn2LastMessage = bodies[1]!.messages.at(-1)!;
    expect(turn2LastMessage).toMatchObject({
      role: "user",
      content: expect.stringContaining("submit_editorial_plan"),
    });
    // Verify Turn 3 received awaitingView: true from Turn 2
    const turn3ToolMessage = bodies[2]!.messages.at(-1)!;
    expect(turn3ToolMessage.role).toBe("tool");
    expect(JSON.parse(turn3ToolMessage.content)).toMatchObject({
      ok: true,
      finished: false,
      awaitingView: true,
      acceptedSectionIds: ["s1", "s2", "s3"],
    });
    expect(db.saved()).toMatchObject({
      writer_output: base,
      view: { audience: "PRO", schema: "hive-application-view/1" },
    });
  });

  it("recovers from a Turn-1 presentationPlan.insights[1].questionIds rejection with 7 accepted sections, compacts accepted narrative JSON in Turn-2 history, and completes with A2UI view within budgets (V4-004J.1)", async () => {
    const l001Corpus = Object.entries(L001_INITIAL_IEP_PAGES).map(([key, text]) => {
      const [sourceDocumentId, page] = key.split(":");
      return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
    });
    const studyLedger = new StudyAgentLedger({
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: L001_INITIAL_IEP_PLAN_QUESTION_IDS,
      pages: l001Corpus,
    });
    for (const turn of l001InitialIepStudyAgentTurns()) {
      for (const call of turn) {
        const res = studyLedger.execute(call);
        if (!res.ok) throw new Error(`L001 ledger call failed: ${res.content}`);
      }
    }
    const verifiedL001 = verifyStudyInvestigation(studyLedger.assemble(), {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: [...L001_INITIAL_IEP_PLAN_QUESTION_IDS],
      pages: new Map(Object.entries(L001_INITIAL_IEP_PAGES)),
    });
    if (!verifiedL001.ok) throw new Error(verifiedL001.message);
    const l001Study = verifiedL001.value;

    const db = fakeDatabase("PRO", {
      inputsOverrides: {
        reportRun: reportRunJson("WRITING", "PRO", {
          attemptCount: 1,
          maxAttempts: 3,
          createdAt: "2026-11-04T14:30:00.000Z",
        }),
        studyRevision: {
          id: REVISION_ID,
          revisionNumber: 7,
          processingRunId: MAYA_RUN_ID,
          investigation: l001Study.investigation,
          verification: l001Study.verification,
          audienceConfiguration: {
            ...UNKNOWN_AUDIENCE,
            pro: {
              ...UNKNOWN_AUDIENCE.pro,
              primaryRole: "Special education advocate",
              status: "PROVISIONAL",
            },
          },
          coverageComplete: true,
        },
        sourceSnapshot: {
          documents: [
            {
              sourceDocumentId: L001_INITIAL_IEP_DOC_ID,
              fileName: L001_INITIAL_IEP_FILE_NAMES[L001_INITIAL_IEP_DOC_ID]!,
            },
          ],
          excluded: [],
          coverageComplete: true,
        },
      },
    });

    const sevenSections = [
      {
        id: "s1",
        heading: "Student Profile and Historical IEP Period",
        blocks: [
          {
            type: "DOCUMENTED" as const,
            text: "Maya Carter (born 2017-04-18, Grade 2, Synthetic Elementary School, Synthetic District) has an Initial IEP dated 2024-11-12 for 2024-11-12 through 2025-11-11, which ended before the 2026-11-04 report date.",
            claimRefs: ["DF1", "DF2", "DF3", "DF4", "DF5", "DF6", "DF7", "DF8"],
          },
        ],
      },
      {
        id: "s2",
        heading: "Eligibility Determination",
        blocks: [
          {
            type: "DOCUMENTED" as const,
            text: "On 2024-11-01, Maya Carter was found eligible under Specific Learning Disability (SLD) - Reading with Reading Fluency as her primary educational need.",
            claimRefs: ["DF9", "DF10", "DF11"],
          },
        ],
      },
      {
        id: "s3",
        heading: "Present Levels and Baseline Evaluation",
        blocks: [
          {
            type: "DOCUMENTED" as const,
            text: "The 2024-10-18 academic evaluation documents a reading fluency baseline of 42 WCPM and 86% oral reading accuracy.",
            claimRefs: ["DF12", "DF13", "DF14", "DF15", "DF16"],
          },
        ],
      },
      {
        id: "s4",
        heading: "Annual Goal Criteria and Quantitative Gain",
        blocks: [
          {
            type: "INTERPRETATION" as const,
            text: "GOAL_READING_FLUENCY requires a {{calc:P2.C0}} WCPM increase (from 42 WCPM to 75 WCPM) and a {{calc:P2.C1}} percentage-point accuracy increase (from 86% to 95%) across three consecutive probes from 2024-11-12 to 2025-11-11.",
            claimRefs: ["P2.A0", "DF17", "DF18", "DF19", "DF20", "DF21", "DF22", "DF23", "DF24", "DF25", "P2.C0", "P2.C1"],
          },
        ],
      },
      {
        id: "s5",
        heading: "Special Education Services and Accommodations",
        blocks: [
          {
            type: "DOCUMENTED" as const,
            text: "Specialized reading instruction is provided Weekly for 150 minutes in the special education setting starting 2024-11-12, with extended time and read-aloud directions.",
            claimRefs: ["DF26", "DF27", "DF28", "DF29", "DF30", "DF31"],
          },
        ],
      },
      {
        id: "s6",
        heading: "Progress Reporting and Team Participation",
        blocks: [
          {
            type: "DOCUMENTED" as const,
            text: "Progress is measured with oral-reading-fluency probes and reported quarterly; Parent/Guardian, General Education Teacher, Special Education Teacher, and District Representative participated on 2024-11-12.",
            claimRefs: ["DF32", "DF33", "DF34", "DF35", "DF36", "DF37"],
          },
        ],
      },
      {
        id: "s7",
        heading: "Evidentiary Gaps and Reserved Determinations",
        blocks: [
          {
            type: "UNCERTAINTY" as const,
            text: "The documented 2024-11-12 through 2025-11-11 IEP period ended before the 2026-11-04 report date without establishing current plan status; no post-2024-11-12 quarterly oral-reading-fluency probe results or 2024-10-18 evaluation reports are attached, and the IEP team decides whether the 75 WCPM and 95% accuracy goal was met.",
            claimRefs: ["DF7", "DF8", "DF12", "DF20", "DF21", "P6", "P6.U0", "P6.L0", "P6.D0"],
          },
        ],
      },
    ];

    const turn1: ToolCall[] = [
      {
        id: "toolu_j1_turn1",
        name: "compose_writer_report",
        arguments: JSON.stringify({
          presentationPlan: {
            audienceObjective: "Deliver a 7-section professional IEP audit.",
            summaryDetailLevel: "COMPREHENSIVE",
            insights: [
              {
                id: "INS1",
                meaning: "Baseline 42 WCPM (86% accuracy) to target 75 WCPM (95% accuracy).",
                claimIds: ["DF13", "DF14", "DF19", "DF20", "DF21", "P2.C0", "P2.C1"],
                questionIds: ["P2", "P4"],
                role: "CENTRAL",
              },
              {
                id: "INS2",
                meaning: "150 minutes weekly reading instruction and accommodations.",
                claimIds: ["DF26", "DF27", "DF30", "DF31"],
                questionIds: ["P1"], // Unsupported question for DF26/DF27/DF30/DF31 (which only link to P3/P6)
                role: "CENTRAL",
              },
            ],
            priorityFindings: [
              { claimId: "DF19", priority: "HIGH", insightId: "INS1" },
              { claimId: "DF27", priority: "HIGH", insightId: "INS2" },
            ],
            sections: sevenSections.map((s) => ({
              id: s.id,
              heading: s.heading,
              priority: "HIGH" as const,
              claimIds: s.blocks[0]!.claimRefs,
            })),
            components: [
              { component: "Narrative", sectionId: "summary", claimIds: ["DF1", "DF8", "DF19", "DF20", "P2.C0"] },
              { component: "Comparison", claimIds: ["DF13", "DF14", "DF19", "DF20", "DF21"] },
              ...sevenSections.map((s) => ({
                component: "Narrative" as const,
                sectionId: s.id,
                claimIds: s.blocks[0]!.claimRefs,
              })),
            ],
          },
          title: "Comprehensive Professional Audit: Maya Carter Initial IEP",
          summary: [
            {
              type: "DOCUMENTED",
              text: "Maya Carter (born 2017-04-18, Grade 2) has an Initial IEP for 2024-11-12 through 2025-11-11 (ended before the 2026-11-04 report date) targeting a {{calc:P2.C0}} WCPM fluency gain (42 WCPM to 75 WCPM) and {{calc:P2.C1}}% accuracy gain (86% to 95%) with 150 minutes weekly specialized reading instruction.",
              claimRefs: ["DF1", "DF2", "DF3", "DF8", "DF13", "DF14", "DF19", "DF20", "DF21", "DF27", "P2.C0", "P2.C1"],
            },
          ],
          sections: sevenSections,
        }),
      },
    ];

    const turn2: ToolCall[] = [
      {
        id: "toolu_j1_turn2",
        name: "apply_writer_correction",
        arguments: JSON.stringify({
          presentationPlan: {
            audienceObjective: "Deliver a 7-section professional IEP audit.",
            summaryDetailLevel: "COMPREHENSIVE",
            insights: [
              {
                id: "INS1",
                meaning: "Baseline 42 WCPM (86% accuracy) to target 75 WCPM (95% accuracy).",
                claimIds: ["DF13", "DF14", "DF19", "DF20", "DF21", "P2.C0", "P2.C1"],
                questionIds: ["P2", "P4"],
                role: "CENTRAL",
              },
              {
                id: "INS2",
                meaning: "150 minutes weekly reading instruction and accommodations.",
                claimIds: ["DF26", "DF27", "DF30", "DF31"],
                questionIds: ["P3"], // Repaired to thematic subset ["P3"]!
                role: "CENTRAL",
              },
            ],
            priorityFindings: [
              { claimId: "DF19", priority: "HIGH", insightId: "INS1" },
              { claimId: "DF27", priority: "HIGH", insightId: "INS2" },
            ],
            sections: sevenSections.map((s) => ({
              id: s.id,
              heading: s.heading,
              priority: "HIGH" as const,
              claimIds: s.blocks[0]!.claimRefs,
            })),
            components: [
              { component: "Narrative", sectionId: "summary", claimIds: ["DF1", "DF8", "DF19", "DF20", "P2.C0"] },
              { component: "Comparison", claimIds: ["DF13", "DF14", "DF19", "DF20", "DF21"] },
              ...sevenSections.map((s) => ({
                component: "Narrative" as const,
                sectionId: s.id,
                claimIds: s.blocks[0]!.claimRefs,
              })),
            ],
          },
          view: [
            { component: "Narrative", props: { sectionId: "summary" } },
            {
              component: "Comparison",
              props: {
                title: "Reading Fluency Baseline vs. Annual Goal Criterion",
                leftLabel: "Baseline (2024-10-18)",
                rightLabel: "Annual Target (2025-11-11)",
                items: [
                  { label: "Fluency Rate", left: "42 WCPM", right: "75 WCPM", claimRefs: ["DF13", "DF19", "DF20"] },
                  { label: "Accuracy", left: "86%", right: "at least 95% accuracy", claimRefs: ["DF14", "DF21"] },
                ],
              },
            },
            ...sevenSections.map((s) => ({ component: "Narrative" as const, props: { sectionId: s.id } })),
          ],
        }),
      },
    ];

    const model = planner([turn1, turn2]);
    await expect(
      runReport({ client: db.client, planner: model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");

    expect(model.bodies).toHaveLength(2);
    // Validate the actual serialized Turn-2 StudyAgentTurnRequest against the declared closed tool schemas
    // and Oracle Planner's assistant->tool pairing invariant.
    const validateAgainstClosedSchema = (
      value: unknown,
      schema: Record<string, unknown>,
      path = "$",
    ): void => {
      const schemaType = schema.type;
      const allowedTypes = Array.isArray(schemaType) ? schemaType : [schemaType];
      if (value === null) {
        expect(allowedTypes, `${path} nullability`).toContain("null");
        return;
      }
      if (allowedTypes.includes("string") && typeof value === "string") {
        if (typeof schema.maxLength === "number") {
          expect(value.length, `${path} maxLength`).toBeLessThanOrEqual(schema.maxLength);
        }
        if (Array.isArray(schema.enum)) {
          expect(schema.enum, `${path} enum`).toContain(value);
        }
        return;
      }
      if (allowedTypes.includes("integer") && typeof value === "number") {
        expect(Number.isInteger(value), `${path} integer`).toBe(true);
        if (typeof schema.minimum === "number") {
          expect(value, `${path} minimum`).toBeGreaterThanOrEqual(schema.minimum);
        }
        return;
      }
      if (allowedTypes.includes("array") && Array.isArray(value)) {
        if (typeof schema.maxItems === "number") {
          expect(value.length, `${path} maxItems`).toBeLessThanOrEqual(schema.maxItems);
        }
        if (schema.items && typeof schema.items === "object") {
          value.forEach((item, idx) =>
            validateAgainstClosedSchema(item, schema.items as Record<string, unknown>, `${path}[${idx}]`),
          );
        }
        return;
      }
      if (allowedTypes.includes("object") && typeof value === "object" && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
        const req = (schema.required ?? []) as string[];
        for (const reqKey of req) {
          expect(obj, `${path} missing required ${reqKey}`).toHaveProperty(reqKey);
        }
        if (schema.additionalProperties === false) {
          for (const key of Object.keys(obj)) {
            expect(props, `${path} unexpected property ${key}`).toHaveProperty(key);
          }
        }
        for (const [key, val] of Object.entries(obj)) {
          if (val !== undefined && props[key]) {
            validateAgainstClosedSchema(val, props[key], `${path}.${key}`);
          }
        }
        return;
      }
      throw new Error(`Value at ${path} did not match schema type ${JSON.stringify(schemaType)}`);
    };

    const turn2Body = model.bodies[1]!;
    const toolSchemasByName = new Map(
      [...WRITER_EDITORIAL_TOOLS, ...WRITER_COMPOSE_TOOLS, ...WRITER_AGENT_TOOLS].map((t) => [
        t.function.name,
        t.function.parameters as Record<string, unknown>,
      ]),
    );
    // Verify exact message sequence: [user, assistant(toolu_j1_turn1), tool(toolu_j1_turn1)]
    expect(turn2Body.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    const turn2AssistantMsg = turn2Body.messages[1]!;
    const turn2ToolMsg = turn2Body.messages[2]!;
    expect(turn2AssistantMsg.role).toBe("assistant");
    expect(turn2ToolMsg.role).toBe("tool");
    if (turn2AssistantMsg.role === "assistant" && turn2ToolMsg.role === "tool") {
      expect(turn2AssistantMsg.tool_calls).toHaveLength(1);
      const tc = turn2AssistantMsg.tool_calls[0]!;
      expect(tc.id).toBe("toolu_j1_turn1");
      expect(turn2ToolMsg.tool_call_id).toBe("toolu_j1_turn1");
      expect(tc.function.arguments.length).toBeLessThan(turn1[0]!.arguments.length);
      expect(tc.function.arguments).not.toContain('"accepted"');
      const compactedArgs = JSON.parse(tc.function.arguments) as {
        summary: { type: string; text: string; claimRefs: string[] }[];
        sections: {
          id: string;
          heading: string;
          accepted?: unknown;
          claimRefs?: unknown;
          blocks: { type: string; text: string; claimRefs: string[] }[];
        }[];
      };
      validateAgainstClosedSchema(compactedArgs, toolSchemasByName.get(tc.function.name)!);
      expect(compactedArgs.summary[0]?.text).toBe("[accepted]");
      expect(compactedArgs.sections).toHaveLength(7);
      expect(
        compactedArgs.sections.every(
          (s, idx) =>
            s.id === sevenSections[idx]!.id &&
            s.heading === sevenSections[idx]!.heading &&
            s.accepted === undefined &&
            s.claimRefs === undefined &&
            s.blocks.length === 1 &&
            s.blocks[0]!.text === "[accepted]" &&
            JSON.stringify(s.blocks[0]!.claimRefs) === JSON.stringify(sevenSections[idx]!.blocks[0]!.claimRefs),
        ),
      ).toBe(true);
      expect(JSON.parse(turn2ToolMsg.content)).toMatchObject({
        ok: false,
        awaitingView: true,
        field: "presentationPlan.insights[1].questionIds",
        acceptedSectionIds: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"],
        nextStep: expect.stringContaining("do NOT resend accepted sections"),
      });
    }
    const saved = db.saved()!;
    expect(saved).toMatchObject({
      writer_output: {
        audience: "PRO",
        sections: sevenSections,
      },
      view: {
        schema: "hive-application-view/1",
        audience: "PRO",
      },
    });
    expect(db.studyUnchanged()).toBe(true);
  });

  it("activates Claim-Driven Writer in runtime with WRITER_EDITORIAL_TOOLS only, focused patch_editorial_plan recovery, legacy Revision 6 compatibility, and measured payload/plan sizes (V4-004K.3)", async () => {
    // 1. Verify WRITER_AGENT_BUDGET is unchanged (no unapproved model budget increases)
    expect(WRITER_AGENT_BUDGET).toEqual({
      wallClockMs: 235_000,
      maxTurnMs: 150_000,
      minTurnMs: 20_000,
      turnAbortMarginMs: 5_000,
      maxRounds: 5,
      maxSemanticReviewRepairs: 2,
      maxToolCalls: 48,
      maxCallsPerTurn: 32,
      maxInputTokens: 200_000,
      maxOutputTokens: 24_000,
      turnOutputTokens: 8_000,
      minTurnOutputTokens: 1_000,
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
      maxEstimatedUsd: 1.5,
      maxRequestBytes: 768 * 1024,
    });

    // 2. Build L001 37-DF verified Study
    const l001Corpus = Object.entries(L001_INITIAL_IEP_PAGES).map(([key, text]) => {
      const [sourceDocumentId, page] = key.split(":");
      return { sourceDocumentId: sourceDocumentId!, pageNumber: Number(page), text };
    });
    const studyLedger = new StudyAgentLedger({
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: L001_INITIAL_IEP_PLAN_QUESTION_IDS,
      pages: l001Corpus,
    });
    for (const turn of l001InitialIepStudyAgentTurns()) {
      for (const call of turn) {
        const res = studyLedger.execute(call);
        if (!res.ok) throw new Error(`L001 ledger call failed: ${res.content}`);
      }
    }
    const verifiedL001 = verifyStudyInvestigation(studyLedger.assemble(), {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: [...L001_INITIAL_IEP_PLAN_QUESTION_IDS],
      pages: new Map(Object.entries(L001_INITIAL_IEP_PAGES)),
    });
    if (!verifiedL001.ok) throw new Error(verifiedL001.message);
    const l001Study = verifiedL001.value;

    const makeL001Db = (audience: "CUSTOMER" | "PRO") =>
      fakeDatabase(audience, {
        inputsOverrides: {
          reportRun: reportRunJson("WRITING", audience, {
            attemptCount: 1,
            maxAttempts: 3,
            createdAt: "2026-11-04T14:30:00.000Z",
          }),
          studyRevision: {
            id: REVISION_ID,
            revisionNumber: 7,
            processingRunId: MAYA_RUN_ID,
            investigation: l001Study.investigation,
            verification: l001Study.verification,
            audienceConfiguration: {
              ...UNKNOWN_AUDIENCE,
              customer: { ...UNKNOWN_AUDIENCE.customer, role: "Parent", status: "STATED" },
              pro: {
                ...UNKNOWN_AUDIENCE.pro,
                primaryRole: "Special education advocate",
                alternativeRoles: ["Special education attorney"],
                status: "PROVISIONAL",
              },
            },
            coverageComplete: true,
          },
          sourceSnapshot: {
            documents: [
              {
                sourceDocumentId: L001_INITIAL_IEP_DOC_ID,
                fileName: L001_INITIAL_IEP_FILE_NAMES[L001_INITIAL_IEP_DOC_ID]!,
              },
            ],
            excluded: [],
            coverageComplete: true,
          },
        },
      });

    // 3. L001 CUSTOMER and PRO runs use editorial tools only and complete in 1 round / 1 tool call
    const custPlan = l001CustomerEditorialPlan();
    const proPlan = l001ProEditorialPlan();
    const custPlanBytes = Buffer.byteLength(JSON.stringify(custPlan), "utf8");
    const proPlanBytes = Buffer.byteLength(JSON.stringify(proPlan), "utf8");
    expect(custPlanBytes).toBeLessThan(3500);
    expect(proPlanBytes).toBeLessThan(8000);
    expect(proPlanBytes).toBeLessThan(STUDY_AGENT_TURN_LIMITS.maxArgumentChars);

    const custDb = makeL001Db("CUSTOMER");
    const proDb = makeL001Db("PRO");
    const custModel = planner([[{ id: "toolu_k3_cust", name: "submit_editorial_plan", arguments: JSON.stringify(custPlan) }]]);
    const proModel = planner([[{ id: "toolu_k3_pro", name: "submit_editorial_plan", arguments: JSON.stringify(proPlan) }]]);

    await expect(
      runReport({ client: custDb.client, planner: custModel.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");
    await expect(
      runReport({ client: proDb.client, planner: proModel.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");

    expect(custModel.bodies).toHaveLength(1);
    expect(proModel.bodies).toHaveLength(1);
    expect(custModel.bodies[0]!.tools.map((t) => t.function.name)).toEqual(["submit_editorial_plan", "patch_editorial_plan"]);
    expect(proModel.bodies[0]!.tools.map((t) => t.function.name)).toEqual(["submit_editorial_plan", "patch_editorial_plan"]);

    const custPromptBytes = Buffer.byteLength(custModel.bodies[0]!.messages[0]!.content ?? "", "utf8");
    const proPromptBytes = Buffer.byteLength(proModel.bodies[0]!.messages[0]!.content ?? "", "utf8");
    const custWireBytes = Buffer.byteLength(JSON.stringify(custModel.bodies[0]!), "utf8");
    const proWireBytes = Buffer.byteLength(JSON.stringify(proModel.bodies[0]!), "utf8");
    const custCompiledWriterBytes = Buffer.byteLength(JSON.stringify(custDb.saved()!.writer_output), "utf8");
    const proCompiledWriterBytes = Buffer.byteLength(JSON.stringify(proDb.saved()!.writer_output), "utf8");
    const custBoundViewBytes = Buffer.byteLength(JSON.stringify(custDb.saved()!.view), "utf8");
    const proBoundViewBytes = Buffer.byteLength(JSON.stringify(proDb.saved()!.view), "utf8");
    expect(custPlanBytes).toBe(3473);
    expect(proPlanBytes).toBe(6513);
    expect(custCompiledWriterBytes).toBe(2657);
    expect(proCompiledWriterBytes).toBe(6335);
    expect(custBoundViewBytes).toBe(4566);
    expect(proBoundViewBytes).toBe(13968);
    expect(custPromptBytes).toBe(52480);
    expect(proPromptBytes).toBe(52563);
    expect(custWireBytes).toBe(108760);
    expect(proWireBytes).toBe(108847);

    // 4. Invalid editorial content (unsupported A2UI component + ungrounded number) triggers focused patch_editorial_plan recovery without partial persistence
    const patchDb = makeL001Db("PRO");
    const badProPlan = {
      ...proPlan,
      sections: [
        {
          ...proPlan.sections[0]!,
          interpretation: {
            text: "Achieving GOAL_READING_FLUENCY requires 999 WCPM by tomorrow.",
            claimRefs: ["P2.A0", "DF19"],
          },
        },
      ],
    };
    const patchModel = planner([
      [{ id: "toolu_k3_bad_1", name: "submit_editorial_plan", arguments: JSON.stringify(badProPlan) }],
      [
        {
          id: "toolu_k3_patch_2",
          name: "patch_editorial_plan",
          arguments: JSON.stringify({ sections: [proPlan.sections[0]!] }),
        },
      ],
    ]);
    await expect(
      runReport({ client: patchDb.client, planner: patchModel.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");
    expect(patchModel.bodies).toHaveLength(2);
    const turn2ToolMsg = patchModel.bodies[1]!.messages.at(-1)!;
    expect(turn2ToolMsg.role).toBe("tool");
    if (turn2ToolMsg.role === "tool") {
      expect(JSON.parse(turn2ToolMsg.content)).toMatchObject({
        ok: false,
        finished: false,
        compileFailed: true,
        error: "writer_number_ungrounded",
      });
    }
    expect(patchDb.savedCount()).toBe(1);

    // 5. Legacy revision 6 report generation remains valid via revision6CustomerEditorialPlan()
    const rev6Verified = verifyStudyInvestigation(mayaRevision6StudyOutput(), {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
      pages: new Map(Object.entries(MAYA_REVISION_6_PAGES)),
    });
    if (!rev6Verified.ok) throw new Error(rev6Verified.message);
    const rev6Db = fakeDatabase("CUSTOMER", {
      inputsOverrides: {
        reportRun: reportRunJson("WRITING", "CUSTOMER", {
          attemptCount: 1,
          maxAttempts: 3,
          createdAt: "2026-11-04T14:30:00.000Z",
        }),
        studyRevision: {
          id: REVISION_ID,
          revisionNumber: 6,
          processingRunId: MAYA_RUN_ID,
          investigation: rev6Verified.value.investigation,
          verification: rev6Verified.value.verification,
          audienceConfiguration: {
            ...UNKNOWN_AUDIENCE,
            customer: { ...UNKNOWN_AUDIENCE.customer, role: "Parent", status: "STATED" },
          },
          coverageComplete: true,
        },
      },
    });
    const rev6Model = planner([
      [{ id: "toolu_k3_rev6", name: "submit_editorial_plan", arguments: JSON.stringify(revision6CustomerEditorialPlan()) }],
    ]);
    await expect(
      runReport({ client: rev6Db.client, planner: rev6Model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");
    expect(rev6Model.bodies).toHaveLength(1);
    expect(rev6Db.saved()).toMatchObject({
      view: { schema: "hive-application-view/1", audience: "CUSTOMER" },
    });

    // 6. Missing or un-rebuilt Oracle deployment fails closed with a clear diagnostic instead of falling back to legacy mode (V4-004K.4)
    const staleOracleDb = makeL001Db("PRO");
    const staleOracleDispatch = vi.fn(async () => true);
    const staleOracleBodies: StudyAgentTurnRequest[] = [];
    const staleOracleFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      staleOracleBodies.push(JSON.parse(String(init?.body)) as StudyAgentTurnRequest);
      return new Response(
        JSON.stringify({
          contract_version: "planner-error@1",
          error_code: "INVALID_REQUEST",
          category: "validation",
          retryable: false,
          message_safe: "Tools do not match the writer tool set.",
          correlation_id: "66666666-6666-4666-8666-666666666666",
          processing_run_id: REPORT_RUN_ID,
          task: "writer",
          component: "planner",
          operation: "study_agent_turn",
          diagnostic_reason: "planner_invalid_request",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "x-planner-error-code": "INVALID_REQUEST",
            "x-planner-diagnostic-reason": "planner_invalid_request",
            "x-planner-retryable": "false",
          },
        },
      );
    });
    await expect(
      runReport(
        {
          client: staleOracleDb.client,
          planner: {
            getConfig: () => ({ baseUrl: "https://reader.example.test/planner", serviceToken: "t", timeoutMs: 1000 }),
            fetchFn: staleOracleFetch as unknown as typeof fetch,
          },
          dispatch: staleOracleDispatch,
          loadCatalog: () => loadPromptCatalog(),
        },
        REPORT_RUN_ID,
      ),
    ).resolves.toBe("FAILED");
    // Exactly 1 call was made with WRITER_EDITORIAL_TOOLS; no silent fallback to legacy tools or retry
    expect(staleOracleBodies).toHaveLength(1);
    expect(staleOracleBodies[0]!.tools.map((t) => t.function.name)).toEqual(["submit_editorial_plan", "patch_editorial_plan"]);
    expect(staleOracleDispatch).not.toHaveBeenCalled();
    expect(staleOracleDb.saved()).toBeNull();
    expect(staleOracleDb.transitions.at(-1)).toMatchObject({
      from: "WRITING",
      to: "FAILED",
      details: {
        error_code: "MODEL_UNAVAILABLE",
        retryable: false,
        failure_diagnostic: {
          component: "planner",
          operation: "study_agent_turn",
          task: "writer",
          diagnosticReason: "planner_invalid_request",
          retryable: false,
        },
      },
    });
  });

  it("recovers a CUSTOMER editorial plan with patch_editorial_plan after semantic review instead of exhausting rounds on writer_output_shape field plan", async () => {
    const db = fakeDatabase("CUSTOMER");
    const plan = mayaEditorialPlan("CUSTOMER");
    const patchedTitle = "Maya's reading and services for the meeting";
    const model = planner([
      [{ id: "toolu_live_submit", name: "submit_editorial_plan", arguments: JSON.stringify(plan) }],
      [{ id: "toolu_live_patch", name: "patch_editorial_plan", arguments: JSON.stringify({ title: patchedTitle }) }],
    ]);
    let reviews = 0;
    const semanticReviewer = vi.fn(async () => {
      reviews += 1;
      if (reviews === 1) {
        return [
          {
            field: "sections[0].blocks[1]",
            error: "writer_semantic_unsupported" as const,
            impact: "HIGH" as const,
            message: "One assertion is not supported by the cited claims.",
            hint: "Restate only what the cited claims say.",
            citedClaimIds: ["P1.A0"],
          },
        ];
      }
      return [];
    });

    await expect(
      runReport(
        {
          client: db.client,
          planner: model.deps,
          loadCatalog: () => loadPromptCatalog(),
          semanticReviewer,
        },
        REPORT_RUN_ID,
      ),
    ).resolves.toBe("SUCCEEDED");

    expect(semanticReviewer).toHaveBeenCalledTimes(2);
    expect(model.bodies).toHaveLength(2);
    expect(model.bodies[0]!.tools.map((tool) => tool.function.name)).toEqual([
      "submit_editorial_plan",
      "patch_editorial_plan",
    ]);
    const repairMessage = model.bodies[1]!.messages.filter((message) => message.role === "user").at(-1);
    expect(repairMessage?.content).toContain("patch_editorial_plan");
    expect(repairMessage?.content).toContain("sections[0].blocks[1]");
    expect(repairMessage?.content).not.toContain("apply_writer_correction");
    expect(repairMessage?.content).not.toContain("Cannot mix segmented Writer tools");
    const saved = db.saved()!;
    expect(saved.writer_output).toMatchObject({
      audience: "CUSTOMER",
      title: patchedTitle,
    });
    expect((saved.writer_output as { sections: unknown[]; view: unknown[] }).sections).toHaveLength(3);
    expect((saved.writer_output as { view: unknown[] }).view).toHaveLength(8);
    expect(db.transitions.at(-1)?.to).toBe("SAVING");
  });

  it("tells a truncated editorial repair to call patch_editorial_plan", async () => {
    const db = fakeDatabase("CUSTOMER");
    const plan = mayaEditorialPlan("CUSTOMER");
    const patchedTitle = "Maya's reading and services for the meeting";
    const bodies: StudyAgentTurnRequest[] = [];
    let callCount = 0;
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as StudyAgentTurnRequest;
      bodies.push(body);
      callCount += 1;
      if (callCount === 2) {
        return new Response(
          JSON.stringify({
            contract_version: "planner-error@1",
            error_code: "MODEL_OUTPUT_INVALID",
            category: "model",
            retryable: false,
            message_safe: "The planning answer was cut off.",
            correlation_id: "66666666-6666-4666-8666-666666666666",
            processing_run_id: REPORT_RUN_ID,
            task: "writer",
            component: "planner",
            operation: "study_agent_turn",
            diagnostic_reason: "model_output_truncated",
          }),
          {
            status: 422,
            headers: {
              "Content-Type": "application/json",
              "x-planner-error-code": "MODEL_OUTPUT_INVALID",
              "x-planner-diagnostic-reason": "model_output_truncated",
              "x-planner-retryable": "false",
            },
          },
        );
      }
      if (callCount === 1) {
        return turnResponse([{ id: "toolu_trunc_submit", name: "submit_editorial_plan", arguments: JSON.stringify(plan) }]);
      }
      return turnResponse([
        { id: "toolu_trunc_patch", name: "patch_editorial_plan", arguments: JSON.stringify({ title: patchedTitle }) },
      ]);
    });
    let reviews = 0;
    const semanticReviewer = vi.fn(async () => {
      reviews += 1;
      if (reviews === 1) {
        return [
          {
            field: "sections[0].blocks[1]",
            error: "writer_semantic_unsupported" as const,
            impact: "HIGH" as const,
            message: "One assertion is not supported by the cited claims.",
            hint: "Restate only what the cited claims say.",
            citedClaimIds: ["P1.A0"],
          },
        ];
      }
      return [];
    });

    await expect(
      runReport(
        {
          client: db.client,
          planner: {
            getConfig: () => ({ baseUrl: "https://reader.example.test/planner", serviceToken: "t", timeoutMs: 1000 }),
            fetchFn: fetchFn as unknown as typeof fetch,
          },
          loadCatalog: () => loadPromptCatalog(),
          semanticReviewer,
        },
        REPORT_RUN_ID,
      ),
    ).resolves.toBe("SUCCEEDED");

    const recovery = bodies[2]!.messages.at(-1)!;
    expect(recovery).toMatchObject({
      role: "user",
      content: expect.stringContaining("patch_editorial_plan"),
    });
    expect(recovery.role === "user" ? recovery.content : "").toContain("s1");
    expect(recovery.role === "user" ? recovery.content : "").not.toContain("apply_writer_correction");
    expect(db.saved()).toMatchObject({ writer_output: { title: patchedTitle, audience: "CUSTOMER" } });
  });
});

// ---------------------------------------------------------------------------
// V5 (D-052): `canonical-study-1` revisions are written by hive-write/1 into a hive.study-view/1.
// ---------------------------------------------------------------------------
const V5_DOC = "aaaa0001-0000-4000-8000-000000000001";
const V5_FACT = "F-aaaa0001-001";

const v5Study: CanonicalStudy = {
  schema: CANONICAL_STUDY_SCHEMA,
  domainLabel: "Example",
  spineSource: "ANCHOR",
  documents: [{ sourceDocumentId: V5_DOC, role: "ANCHOR", typeInPlainWords: "Notice", date: null, version: null, chainPosition: null }],
  spine: [
    {
      id: "S1",
      label: "Fee",
      kind: "figure",
      status: "SUPPORTED",
      supportingFactIds: [V5_FACT],
      contradictingFactIds: [],
      updatingFactIds: [],
      missing: [],
    },
  ],
  outsideSpine: [],
  conflicts: [],
  timeline: [],
  gaps: [],
};

function v5Extraction() {
  const validated = validateDocExtraction(
    {
      document: { titleAsPrinted: "Notice", documentType: "notice", issuer: { name: "Office" }, summary: "A notice." },
      facts: [
        {
          id: V5_FACT,
          subject: "Fee",
          attribute: "amount",
          valueAsWritten: "$10.00",
          modality: "stated",
          evidence: [{ page: 2, quote: "The fee is $10.00." }],
        },
      ],
      emptyFields: [],
      referencedDocuments: [],
    },
    { documentId: V5_DOC, fileName: "notice.pdf", pageRange: null },
  );
  if (!validated.ok) throw new Error("fixture");
  return validated.value;
}

function v5Inputs() {
  return {
    studyRevision: {
      id: REVISION_ID,
      revisionNumber: 2,
      processingRunId: MAYA_RUN_ID,
      format: "canonical-study-1",
      investigation: v5Study,
      verification: { schema: "hive.study-verification/1", counts: { documentFindings: 0, claims: 0 }, findings: [], documentCoverage: [] },
      audienceConfiguration: UNKNOWN_AUDIENCE,
      coverageComplete: true,
    },
    intentDecomposition: null,
    domainProposal: null,
    intentIntelligence: null,
    investigationPlan: null,
    sourceSnapshot: { documents: [{ sourceDocumentId: V5_DOC, fileName: "notice.pdf" }], excluded: [], coverageComplete: true },
    intents: [{ id: MAYA_INTENT_ID, intentText: "What do I have to pay?", audience: "A first-time reader" }],
    extractions: [v5Extraction()],
  };
}

const WRITE_ANSWER = {
  sections: [{ heading: "Overview", paragraphs: [{ sentences: [{ text: "The notice states a fee.", factIds: [V5_FACT] }] }] }],
  blocks: ["documents", "spine_table"],
};

function writePlanner() {
  const requests: { url: string; body: { task: string; prompt_id: string; user_payload: Record<string, unknown> } }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(
      JSON.stringify({
        contract_version: PLANNER_CONTRACT_VERSION,
        task: "write",
        model_alias: "harvester",
        resolved_model: "model-w",
        content_json: WRITE_ANSWER,
        usage: { prompt_tokens: 4000, completion_tokens: 800, total_tokens: 4800 },
        latency_ms: 12000,
        finish_reason: "stop",
      }),
      { status: 200 },
    );
  });
  return {
    requests,
    deps: {
      getConfig: () => ({ baseUrl: "https://reader.example.test/planner", serviceToken: "t", timeoutMs: 1000 }),
      fetchFn: fetchFn as unknown as typeof fetch,
    },
  };
}

describe("processReportRun: revision formats", () => {
  it("writes a canonical-study-1 revision with hive-write/1 and saves a hive.study-view/1 with metrics, drops and sources", async () => {
    const db = fakeDatabase("CUSTOMER", { nowMs: () => 1_000, inputsOverrides: v5Inputs() });
    const model = writePlanner();
    const semanticReviewer = vi.fn(async () => []);

    const status = await processReportRun(
      {
        client: db.client,
        planner: model.deps,
        semanticReviewer,
        clock: () => 1_000,
        invocationStartedAt: 0,
        loadCatalog: () => loadPromptCatalog(),
      },
      REPORT_RUN_ID,
    );
    expect(status, JSON.stringify(db.transitions, null, 2)).toBe("SUCCEEDED");
    expect(model.requests).toHaveLength(1);

    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]!.url).not.toContain("study-agent-turn");
    expect(model.requests[0]!.body).toMatchObject({
      task: "write",
      prompt_id: "hive-write/1",
      user_payload: {
        intent: "What do I have to pay?",
        reportRole: "CUSTOMER",
        audience:
          "the person this case concerns or their family; plain language; what it means and what to do next; A first-time reader",
        canonicalStudy: v5Study,
        facts: [{ id: V5_FACT, subject: "Fee", attribute: "amount", valueAsWritten: "$10.00", quote: "The fee is $10.00." }],
      },
    });
    expect(semanticReviewer).not.toHaveBeenCalled();

    expect(db.transitions.map((t) => t.to)).toEqual(["VALIDATING", "SAVING"]);
    expect(db.transitions[1]!.details.stage_metric).toMatchObject({
      stage: "WRITING",
      outcome: "SUCCEEDED",
      promptId: "hive-write/1",
      modelAliasRequested: "harvester",
      resolvedModel: "model-w",
      promptTokens: 4000,
      completionTokens: 800,
      latencyMs: 12000,
      finishReason: "stop",
    });

    const saved = db.saved()!;
    expect(saved).toMatchObject({
      title: "Overview",
      view: {
        schema: STUDY_VIEW_SCHEMA,
        sections: [{ heading: "Overview" }],
        blocks: [
          { name: "documents", rows: [expect.objectContaining({ id: V5_DOC })] },
          { name: "spine_table" },
          { name: "conflicts" },
          { name: "timeline" },
          { name: "outside_spine" },
        ],
      },
      writer_output: {
        schema: "hive.write-run/1",
        audience: "CUSTOMER",
        promptId: "hive-write/1",
        calls: [
          expect.objectContaining({
            attempt: 1,
            outcome: "ok",
            inputTokens: 4000,
            outputTokens: 800,
            latencyMs: 12000,
            finishReason: "stop",
            resolvedModel: "model-w",
          }),
        ],
        drops: expect.objectContaining({ sentencesDropped: 0, unknownFactIdsStripped: 0 }),
        sources: {
          documents: { [V5_DOC]: { fileName: "notice.pdf" } },
          facts: { [V5_FACT]: { sourceDocumentId: V5_DOC, pageNumber: 2, quote: "The fee is $10.00." } },
        },
      },
      scenario_analysis: {},
      resolved_model: "model-w",
    });
    const spineRow = (saved.view as { blocks: { name: string; rows: { values: unknown[] }[] }[] }).blocks[1]!.rows[0]!;
    expect(spineRow.values).toEqual([
      {
        factId: V5_FACT,
        valueAsWritten: "$10.00",
        relation: "supporting",
        sourceRef: { sourceDocumentId: V5_DOC, pageNumber: 2, quote: "The fee is $10.00." },
      },
    ]);
    expect(saved.view).toMatchObject({ intent: "What do I have to pay?" });
  });

  it("puts intent on the study view and attaches gap references from verified extractions", async () => {
    const studyWithGap: CanonicalStudy = {
      ...v5Study,
      gaps: [
        {
          id: "X1",
          statement: "The prior year income filing is not among the documents.",
          relatedSpineIds: [],
          kind: "REQUESTABLE_DOCUMENT",
          title: "Prior year income filing",
          why: "The prior year income filing is not among the documents.",
          holder: "",
          holderType: null,
          when: null,
          basisType: "MENTIONED",
          relatedFactIds: [],
        },
      ],
    };
    const extractionWithRef = validateDocExtraction(
      {
        document: { titleAsPrinted: "Notice", documentType: "notice", issuer: { name: "Office" }, summary: "A notice." },
        facts: [
          {
            id: V5_FACT,
            subject: "Fee",
            attribute: "amount",
            valueAsWritten: "$10.00",
            modality: "stated",
            evidence: [{ page: 2, quote: "The fee is $10.00." }],
          },
        ],
        emptyFields: [],
        referencedDocuments: [{ description: "prior year income filing", page: 2, quote: "See prior filing." }],
      },
      { documentId: V5_DOC, fileName: "notice.pdf", pageRange: null },
    );
    if (!extractionWithRef.ok) throw new Error("fixture");
    const inputs = { ...v5Inputs(), studyRevision: { ...v5Inputs().studyRevision, investigation: studyWithGap }, extractions: [extractionWithRef.value] };
    const db = fakeDatabase("CUSTOMER", { nowMs: () => 1_000, inputsOverrides: inputs });
    const model = writePlanner();
    const status = await processReportRun(
      {
        client: db.client,
        planner: model.deps,
        semanticReviewer: vi.fn(async () => []),
        clock: () => 1_000,
        invocationStartedAt: 0,
        loadCatalog: () => loadPromptCatalog(),
      },
      REPORT_RUN_ID,
    );
    expect(status).toBe("SUCCEEDED");
    const saved = db.saved()!;
    expect(saved.view).toMatchObject({ intent: "What do I have to pay?" });
    const list = (saved.view as { components: { items: { id: string; basis: { type: string; sourceRefs?: unknown[] } }[] }[] }).components[0]!;
    expect(list.items[0]).toMatchObject({
      id: "X1",
      basis: {
        type: "MENTIONED",
        sourceRefs: [{ sourceDocumentId: V5_DOC, pageNumber: 2, quote: "See prior filing." }],
      },
    });
  });

  it("sends the canonical study and only the facts that study cites", async () => {
    const citedOnConflict = "F-aaaa0001-002";
    const uncited = "F-aaaa0001-003";
    const extraction = v5Extraction();
    const inputs = v5Inputs();
    const citedFact = {
      ...extraction.facts[0]!,
      id: citedOnConflict,
      attribute: "other",
      valueAsWritten: "$12.00",
      evidence: [{ page: 3, quote: "Other fee $12.00." }],
    };
    const unusedFact = {
      ...extraction.facts[0]!,
      id: uncited,
      attribute: "note",
      valueAsWritten: "unused",
      evidence: [{ page: 4, quote: "Not cited by the study." }],
    };
    const study: CanonicalStudy = {
      ...v5Study,
      conflicts: [{ id: "C1", statement: "Two fees", factIds: [V5_FACT, citedOnConflict] }],
    };
    const db = fakeDatabase("CUSTOMER", {
      nowMs: () => 1_000,
      inputsOverrides: {
        ...inputs,
        studyRevision: { ...inputs.studyRevision, investigation: study },
        extractions: [{ ...extraction, facts: [...extraction.facts, citedFact, unusedFact] }],
      },
    });
    const model = writePlanner();
    await expect(
      processReportRun(
        {
          client: db.client,
          planner: model.deps,
          clock: () => 1_000,
          invocationStartedAt: 0,
          loadCatalog: () => loadPromptCatalog(),
        },
        REPORT_RUN_ID,
      ),
    ).resolves.toBe("SUCCEEDED");
    const payload = model.requests[0]!.body.user_payload;
    expect(payload.canonicalStudy).toEqual(study);
    expect((payload.facts as { id: string }[]).map((fact) => fact.id)).toEqual([V5_FACT, citedOnConflict]);
  });

  it("records a retryable MODEL_TIMEOUT when the write cannot finish 30s before the function limit", async () => {
    const db = fakeDatabase("CUSTOMER", { nowMs: () => 300_000, inputsOverrides: v5Inputs() });
    const fetchFn = vi.fn();
    await expect(
      processReportRun(
        {
          client: db.client,
          planner: {
            getConfig: () => ({ baseUrl: "https://reader.example.test/planner", serviceToken: "t", timeoutMs: 1000 }),
            fetchFn: fetchFn as unknown as typeof fetch,
          },
          clock: () => 300_000,
          invocationStartedAt: 0,
          loadCatalog: () => loadPromptCatalog(),
        },
        REPORT_RUN_ID,
      ),
    ).resolves.toBe("QUEUED");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(db.transitions.at(-1)).toMatchObject({
      from: "WRITING",
      to: "FAILED",
      details: expect.objectContaining({
        error_code: "MODEL_TIMEOUT",
        retryable: true,
        stage_metric: expect.objectContaining({
          stage: "WRITING",
          outcome: "FAILED",
          errorCode: "MODEL_TIMEOUT",
          retryable: true,
        }),
      }),
    });
  });

  it("aborts the write HTTP call at least 30s before the 300s route limit", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const longText = "The notice states a fee of $10.00. ".repeat(1_500);
    const largeInputs = {
      ...v5Inputs(),
      intents: [{ id: MAYA_INTENT_ID, intentText: longText, audience: "A first-time reader" }],
    };
    const db = fakeDatabase("CUSTOMER", { nowMs: () => 1_000, inputsOverrides: largeInputs });
    const model = writePlanner();
    try {
      await processReportRun(
        {
          client: db.client,
          planner: model.deps,
          clock: () => 1_000,
          invocationStartedAt: 0,
          loadCatalog: () => loadPromptCatalog(),
        },
        REPORT_RUN_ID,
      );
      const budgets = timeoutSpy.mock.calls.map((call) => Number(call[0]));
      expect(budgets.length).toBeGreaterThan(0);
      expect(Math.max(...budgets)).toBeLessThanOrEqual(270_000);
      expect(Math.max(...budgets)).toBeGreaterThan(200_000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("falls back to a default audience description per report audience when no intent states one", async () => {
    const inputs = v5Inputs();
    const db = fakeDatabase("PRO", {
      nowMs: () => 1_000,
      inputsOverrides: { ...inputs, intents: [{ id: MAYA_INTENT_ID, intentText: "What do I have to pay?", audience: null }] },
    });
    const model = writePlanner();
    await expect(
      processReportRun(
        { client: db.client, planner: model.deps, clock: () => 1_000, invocationStartedAt: 0 },
        REPORT_RUN_ID,
      ),
    ).resolves.toBe("SUCCEEDED");
    expect(model.requests[0]!.body.user_payload.audience).toBe(
      "a professional reviewing this case on the person's behalf; precise; lead with conflicts, gaps and unsupported items",
    );
  });

  it("sends different hive-write/1 audience inputs for Customer and Pro report runs", async () => {
    const inputs = v5Inputs();
    const customerDb = fakeDatabase("CUSTOMER", { nowMs: () => 1_000, inputsOverrides: inputs });
    const customerModel = writePlanner();
    await processReportRun(
      { client: customerDb.client, planner: customerModel.deps, clock: () => 1_000, invocationStartedAt: 0 },
      REPORT_RUN_ID,
    );

    const proDb = fakeDatabase("PRO", { nowMs: () => 1_000, inputsOverrides: inputs });
    const proModel = writePlanner();
    await processReportRun(
      { client: proDb.client, planner: proModel.deps, clock: () => 1_000, invocationStartedAt: 0 },
      REPORT_RUN_ID,
    );

    const customerAudience = customerModel.requests[0]!.body.user_payload.audience as string;
    const proAudience = proModel.requests[0]!.body.user_payload.audience as string;
    expect(customerModel.requests[0]!.body.user_payload.reportRole).toBe("CUSTOMER");
    expect(proModel.requests[0]!.body.user_payload.reportRole).toBe("PRO");
    expect(customerAudience).toContain("plain language");
    expect(proAudience).toContain("conflicts, gaps and unsupported items");
    expect(customerAudience).not.toBe(proAudience);
  });

  it("still writes an investigation-1 revision with the agentic Writer", async () => {
    const db = fakeDatabase("CUSTOMER");
    const baseRpc = db.client.rpc;
    db.client.rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      const res = await baseRpc(fn, args);
      if (fn === "get_report_generation_inputs" && res.data && "studyRevision" in res.data) {
        res.data.studyRevision = { ...res.data.studyRevision, format: "investigation-1" };
      }
      return res;
    }) as typeof db.client.rpc;
    const model = planner(mayaWriterEditorialTurns("CUSTOMER"));

    await expect(
      runReport({ client: db.client, planner: model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");
    expect(model.bodies).toHaveLength(1);
    expect(model.bodies[0]!.task).toBe("writer");
    expect(model.bodies[0]!.prompt_id).toBe("hive-writer/1");
    expect(db.saved()).toMatchObject({
      view: { schema: "hive-application-view/1", audience: "CUSTOMER" },
      writer_output: { schema: "hive.writer-report/1" },
    });
  });
});
