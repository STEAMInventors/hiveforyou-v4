import {
  parseWriterAgentBudgetDiagnosticField,
  STUDY_AGENT_TURN_CONTRACT_VERSION,
  STUDY_AGENT_TURN_LIMITS,
  type StudyAgentTurnRequest,
  verifyStudyInvestigation,
  WRITER_ALL_TOOL_NAMES,
} from "@hiveforyou/contracts";
import {
  MAYA_DOCS,
  MAYA_FILE_NAMES,
  MAYA_INTENT_ID,
  MAYA_INTENT_TEXT,
  MAYA_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaStudyOutput,
  mayaWriterAgentTurns,
  mayaWriterComposeTurns,
  mayaWriterOutput,
  mayaWriterPresentationPlan,
} from "@hiveforyou/contracts/testing";
import { describe, expect, it, vi } from "vitest";

import { emitStructuredEvent } from "@/server/observability/logger";
import { loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";
import { UNKNOWN_AUDIENCE } from "@/server/study-preparation/study-preparation.fixtures";

import { processReportRun } from "./report-generation";

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
  options: { claimed?: boolean; maxAttempts?: number; nowMs?: () => number } = {},
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
              audienceConfiguration: { ...UNKNOWN_AUDIENCE, customer: { ...UNKNOWN_AUDIENCE.customer, role: "Parent", status: "STATED" } },
              coverageComplete: true,
            },
            domainProposal: { primary: { label: "Special education" }, ambiguous: false, unknownDomain: false },
            sourceSnapshot: {
              documents: Object.values(MAYA_DOCS).map((id) => ({ sourceDocumentId: id, fileName: MAYA_FILE_NAMES[id] })),
              excluded: [],
              coverageComplete: true,
            },
            intents: [{ id: MAYA_INTENT_ID, intentText: MAYA_INTENT_TEXT }],
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

function planner(turns: ToolCall[][] = mayaWriterAgentTurns("CUSTOMER"), status = 200) {
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
    const model = planner(mayaWriterAgentTurns(audience));

    await expect(
      processReportRun({ client: db.client, planner: model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");

    expect(model.bodies).toHaveLength(1);
    expect(model.bodies[0]!.task).toBe("writer");
    expect(model.bodies[0]!.prompt_id).toBe("hive-writer/1");
    expect(model.bodies[0]!.tools.map((t) => t.function.name)).toEqual([
      "compose_writer_report",
      "apply_writer_correction",
      "set_report_outline",
      "record_section",
      "record_scenario",
      "record_view_component",
      "finish_report",
    ]);

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
    expect(assessment?.quotes).not.toContain("The baseline was 62 words correct per minute.");

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

    await expect(processReportRun({ client: db.client, planner: model.deps }, REPORT_RUN_ID)).resolves.toBe("SUCCEEDED");
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

  it("fails closed without automatic retries, saving nothing, when invalid tool calls exhaust the Writer budget", async () => {
    const db = fakeDatabase("CUSTOMER");
    const dispatch = vi.fn(async () => true);
    const badDraft = mayaWriterOutput("CUSTOMER");
    badDraft.summary[0]!.claimRefs = ["P9.F0"];
    const [badTurn] = mayaWriterAgentTurns("CUSTOMER", badDraft);
    // Repeat invalid calls across turns until the 8-rejected-call budget is exhausted.
    const turns = Array.from({ length: 5 }, (_, t) =>
      badTurn!.map((call, i) => ({ ...call, id: `bad_${t}_${i}` })),
    );
    const model = planner(turns);

    await expect(processReportRun({ client: db.client, planner: model.deps, dispatch }, REPORT_RUN_ID)).resolves.toBe("FAILED");
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
      dimension: "invalid_calls",
      roundsUsed: 4,
      roundsAllowed: 5,
      invalidCalls: 8,
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(db.saved()).toBeNull();
    expect(db.studyUnchanged()).toBe(true);
  });

  it("fails the Writer run as retryable from WRITING when the model times out", async () => {
    const db = fakeDatabase();
    const model = planner(undefined, 504);

    await processReportRun({ client: db.client, planner: model.deps }, REPORT_RUN_ID);
    expect(db.transitions).toEqual([
      expect.objectContaining({ from: "WRITING", to: "FAILED", details: expect.objectContaining({ error_code: "MODEL_TIMEOUT", retryable: true }) }),
    ]);
  });

  it("does nothing when another invocation already claimed the run", async () => {
    const db = fakeDatabase("CUSTOMER", { claimed: false });
    const model = planner(mayaWriterAgentTurns("CUSTOMER"));
    await expect(processReportRun({ client: db.client, planner: model.deps }, REPORT_RUN_ID)).resolves.toBe("WRITING");
    expect(model.bodies).toHaveLength(0);
  });

  it("runs Customer and Pro Writer loops independently from the same accepted Study", async () => {
    const customerDb = fakeDatabase("CUSTOMER");
    const proDb = fakeDatabase("PRO");
    const customerModel = planner(mayaWriterAgentTurns("CUSTOMER"));
    const proModel = planner(mayaWriterAgentTurns("PRO"));

    await expect(processReportRun({ client: customerDb.client, planner: customerModel.deps }, REPORT_RUN_ID)).resolves.toBe(
      "SUCCEEDED",
    );
    await expect(processReportRun({ client: proDb.client, planner: proModel.deps }, REPORT_RUN_ID)).resolves.toBe("SUCCEEDED");

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
    await expect(processReportRun({ client: db.client, planner: model.deps, dispatch, clock: () => clock }, REPORT_RUN_ID)).resolves.toBe("QUEUED");
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
    await expect(processReportRun({ client: db.client, planner: model.deps, dispatch, clock: () => clock }, REPORT_RUN_ID)).resolves.toBe("QUEUED");
    expect(model.bodies).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);

    // At next_dispatch_at (30s elapsed), attempt 2 runs and fails -> QUEUED + 60s backoff dispatch.
    clock += 20_000;
    await expect(processReportRun({ client: db.client, planner: model.deps, dispatch, clock: () => clock }, REPORT_RUN_ID)).resolves.toBe("QUEUED");
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
    await expect(processReportRun({ client: db.client, planner: model.deps, dispatch, clock: () => clock }, REPORT_RUN_ID)).resolves.toBe("FAILED");
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

    await expect(processReportRun({ client: db.client, planner: nonRetryablePlanner, dispatch }, REPORT_RUN_ID)).resolves.toBe("FAILED");
    expect(dispatch).not.toHaveBeenCalled();
    expect(db.saved()).toBeNull();
  });

  it("prevents duplicate dispatches from producing duplicate reports", async () => {
    const db = fakeDatabase("CUSTOMER");
    const dispatch = vi.fn(async () => true);
    const model = planner(mayaWriterAgentTurns("CUSTOMER"));

    const [first, second] = await Promise.all([
      processReportRun({ client: db.client, planner: model.deps, dispatch }, REPORT_RUN_ID),
      processReportRun({ client: db.client, planner: model.deps, dispatch }, REPORT_RUN_ID),
    ]);
    expect([first, second]).toContain("SUCCEEDED");
    await expect(processReportRun({ client: db.client, planner: model.deps, dispatch }, REPORT_RUN_ID)).resolves.toBe("SUCCEEDED");

    expect(model.bodies).toHaveLength(1);
    expect(db.savedCount()).toBe(1);
    expect(db.studyUnchanged()).toBe(true);
  });

  it.each(["CUSTOMER", "PRO"] as const)(
    "serializes a valid study-agent-turn@1 Writer request when the claim catalog exceeds 32,000 characters (%s)",
    async (audience) => {
      const baseStudy = verifiedStudy();
      const extraFacts = Array.from({ length: 45 }, (_, index) => ({
        statement: `Documented progress observation ${index + 1}: In November 2025 Maya read 74 words correct per minute against the 90-word target (${"detail ".repeat(25).trim()}).`,
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

      const model = planner(mayaWriterAgentTurns(audience));
      await expect(
        processReportRun({ client: db.client, planner: model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
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
      expect(req.tools.map((t) => t.function.name)).toEqual([...WRITER_ALL_TOOL_NAMES]);
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
        processReportRun({ client: db.client, planner: model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
      ).resolves.toBe("SUCCEEDED");

      expect(model.bodies).toHaveLength(2);
      const expectedSavedOutput = {
        ...base,
        view: [
          base.view[0],
          base.view[1],
          base.view[2],
          base.view[3],
          base.view[4],
          base.view[5],
          base.view[7],
          base.view[6],
        ],
      };
      expect(db.saved()).toMatchObject({
        writer_output: expectedSavedOutput,
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
        rounds: 2,
      });
      const serializedEvents = JSON.stringify(events);
      expect(serializedEvents).not.toContain(MAYA_INTENT_TEXT);
      expect(serializedEvents).not.toContain("Baseline: 62 words correct per minute.");
    },
  );
});
