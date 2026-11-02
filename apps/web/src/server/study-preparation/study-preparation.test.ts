import { PLANNER_CONTRACT_VERSION, type PlannerTask } from "@hiveforyou/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadPromptCatalog } from "./prompt-catalog";
import {
  DOC_1,
  DOC_2,
  domainOutput,
  INTENTS,
  intentOutput,
  planOutput,
  RUN_ID,
  runJson,
  samplePages,
  sourceSnapshot,
} from "./study-preparation.fixtures";
import { processStudyPreparation, type ProcessStudyPreparationDeps } from "./study-preparation";

const loadFrozen = vi.hoisted(() => vi.fn());
vi.mock("./page-sampling", async (importActual) => ({
  ...(await importActual<typeof import("./page-sampling")>()),
  loadFrozenSampleDocuments: loadFrozen,
}));
vi.mock("@/server/observability/logger", () => ({ emitStructuredEvent: vi.fn() }));

type Transition = { from: string; to: string; details: Record<string, unknown> };

/** In-memory stand-in for the V4-004 service RPCs: enforces the status compare-and-set. */
function fakeDatabase(options: {
  status?: string;
  intents?: typeof INTENTS;
  snapshotCurrent?: boolean;
  tamperReadback?: boolean;
  sourceChangedOn?: string;
} = {}) {
  let status = options.status ?? "QUEUED";
  const transitions: Transition[] = [];
  let saved: Record<string, unknown> | null = null;
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    switch (fn) {
      case "transition_processing_run": {
        if (args.p_from_status !== status) {
          return { data: { applied: false, sourceChanged: false, processingRun: runJson(status) }, error: null };
        }
        if (options.sourceChangedOn === args.p_to_status) {
          status = "FAILED";
          return { data: { applied: false, sourceChanged: true, processingRun: runJson(status) }, error: null };
        }
        transitions.push({
          from: String(args.p_from_status),
          to: String(args.p_to_status),
          details: args.p_details as Record<string, unknown>,
        });
        status = String(args.p_to_status);
        return { data: { applied: true, sourceChanged: false, processingRun: runJson(status) }, error: null };
      }
      case "get_study_preparation_inputs":
        return {
          data: {
            processingRun: runJson(status),
            sourceSnapshot: sourceSnapshot(),
            sourceSnapshotDigest: `sha256:${"c".repeat(64)}`,
            intentSnapshotDigest: `sha256:${"d".repeat(64)}`,
            coverageDigest: `sha256:${"e".repeat(64)}`,
            snapshotCurrent: options.snapshotCurrent ?? true,
            intents: options.intents ?? INTENTS,
          },
          error: null,
        };
      case "save_study_prompt_preview":
        saved = args.p_preview as Record<string, unknown>;
        return { data: { saved: true }, error: null };
      case "read_study_prompt_preview":
        return {
          data: {
            found: saved !== null,
            preview: saved && {
              processingRunId: RUN_ID,
              promptText: options.tamperReadback ? `${String(saved.prompt_text)} ` : saved.prompt_text,
              promptDigest: saved.prompt_digest,
              executionManifest: saved.execution_manifest,
            },
          },
          error: null,
        };
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  });
  return { client: { rpc }, transitions, saved: () => saved, status: () => status };
}

function completion(task: PlannerTask, content: unknown) {
  return {
    contract_version: PLANNER_CONTRACT_VERSION,
    task,
    model_alias: "sorter",
    resolved_model: "gpt-4o-mini",
    content_json: content,
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    latency_ms: 900,
    finish_reason: "stop",
  };
}

function fakePlanner(overrides: Partial<Record<PlannerTask, () => Response>> = {}) {
  const outputs: Record<PlannerTask, unknown> = { intent: intentOutput(), domain: domainOutput(), plan: planOutput() };
  const calls: PlannerTask[] = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { task: PlannerTask };
    calls.push(body.task);
    const override = overrides[body.task];
    if (override) return override();
    return new Response(JSON.stringify(completion(body.task, outputs[body.task])), { status: 200 });
  });
  return {
    calls,
    deps: {
      getConfig: () => ({ baseUrl: "https://reader.example.test/planner", serviceToken: "t", timeoutMs: 1000 }),
      fetchFn: fetchFn as unknown as typeof fetch,
    },
  };
}

function deps(db: ReturnType<typeof fakeDatabase>, planner: ReturnType<typeof fakePlanner>): ProcessStudyPreparationDeps {
  return { client: db.client, planner: planner.deps, loadCatalog: () => loadPromptCatalog() };
}

beforeEach(() => {
  loadFrozen.mockReset();
  loadFrozen.mockResolvedValue([samplePages(DOC_1), samplePages(DOC_2)]);
});

describe("processStudyPreparation", () => {
  it("runs the three planning stages in order, saves the prompt, reads it back and succeeds", async () => {
    const db = fakeDatabase();
    const planner = fakePlanner();

    await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("SUCCEEDED");

    expect(planner.calls).toEqual(["intent", "domain", "plan"]);
    expect(db.transitions.map((t) => t.to)).toEqual([
      "UNDERSTANDING_REQUEST",
      "IDENTIFYING_DOMAIN",
      "PLANNING_INVESTIGATION",
      "BUILDING_PROMPT",
      "SAVING",
      "SUCCEEDED",
    ]);
    const [, toDomain, toPlan, toBuild] = db.transitions;
    expect(Object.keys(toDomain!.details.stage_outputs as object)).toEqual(["intentDecomposition"]);
    expect(Object.keys(toPlan!.details.stage_outputs as object).sort()).toEqual(["domainProposal", "sampleCoverage"]);
    expect(Object.keys(toBuild!.details.stage_outputs as object)).toEqual(["investigationPlan"]);
    expect(toDomain!.details.stage_metric).toMatchObject({
      stage: "UNDERSTANDING_REQUEST",
      outcome: "SUCCEEDED",
      promptId: "hive-intent/1",
      modelAliasRequested: "sorter",
      resolvedModel: "gpt-4o-mini",
      totalTokens: 150,
    });

    const saved = db.saved()!;
    const promptText = String(saved.prompt_text);
    expect(db.transitions.at(-1)!.details).toEqual({ prompt_digest: saved.prompt_digest });
    expect(promptText).toContain(INTENTS[0]!.intentText);
    expect(promptText).toContain(INTENTS[1]!.intentText);
    expect(promptText).toContain("Procurement");
    expect(promptText).toContain("#### P1");
    expect(promptText).toContain("#### P2");
  });

  it("sends the domain stage only sampled page text, and the intent stage no document text", async () => {
    const db = fakeDatabase();
    const planner = fakePlanner();
    await processStudyPreparation(deps(db, planner), RUN_ID);

    const bodies = (planner.deps.fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      ([, init]) => JSON.parse(String((init as RequestInit).body)) as { user_payload: Record<string, unknown> },
    );
    expect(JSON.stringify(bodies[0]!.user_payload)).not.toContain("Supplier quotation");
    const samples = bodies[1]!.user_payload.samples as { sourceDocumentId: string; pageNumber: number }[];
    expect(samples.map((s) => `${s.sourceDocumentId}:${s.pageNumber}`)).toEqual([
      `${DOC_1}:1`,
      `${DOC_2}:1`,
      `${DOC_1}:3`,
      `${DOC_2}:3`,
      `${DOC_1}:2`,
      `${DOC_2}:2`,
    ]);
  });

  it("fails the run with MODEL_OUTPUT_INVALID when the plan restates the request", async () => {
    const db = fakeDatabase();
    const restating = planOutput();
    restating.questions[0]!.establish = INTENTS[0]!.intentText;
    const planner = fakePlanner({
      plan: () => new Response(JSON.stringify(completion("plan", restating)), { status: 200 }),
    });

    await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("FAILED");
    const failed = db.transitions.at(-1)!;
    expect(failed).toMatchObject({ from: "PLANNING_INVESTIGATION", to: "FAILED" });
    expect(failed.details).toMatchObject({
      error_code: "MODEL_OUTPUT_INVALID",
      retryable: true,
      stage_metric: { stage: "PLANNING_INVESTIGATION", outcome: "FAILED" },
    });
    expect(db.saved()).toBeNull();
  });

  it("fails with MODEL_TIMEOUT when the planner times out, without later stages", async () => {
    const db = fakeDatabase();
    const planner = fakePlanner({
      domain: () =>
        new Response(JSON.stringify({ contract_version: "planner-error@1", error_code: "MODEL_TIMEOUT", retryable: true }), {
          status: 504,
        }),
    });

    await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("FAILED");
    expect(planner.calls).toEqual(["intent", "domain"]);
    expect(db.transitions.at(-1)).toMatchObject({
      from: "IDENTIFYING_DOMAIN",
      to: "FAILED",
      details: { error_code: "MODEL_TIMEOUT", stage_metric: { stage: "IDENTIFYING_DOMAIN", outcome: "FAILED" } },
    });
  });

  it("fails with SOURCE_CHANGED before any model call when the frozen snapshot is stale", async () => {
    const db = fakeDatabase({ snapshotCurrent: false });
    const planner = fakePlanner();

    await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("FAILED");
    expect(planner.calls).toEqual([]);
    expect(db.transitions.at(-1)).toMatchObject({ to: "FAILED", details: { error_code: "SOURCE_CHANGED" } });
  });

  it("stops without its own FAILED transition when the database already failed the run as SOURCE_CHANGED", async () => {
    const db = fakeDatabase({ sourceChangedOn: "PLANNING_INVESTIGATION" });
    const planner = fakePlanner();

    await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("FAILED");
    expect(planner.calls).toEqual(["intent", "domain"]);
    expect(db.transitions.some((t) => t.to === "FAILED")).toBe(false);
  });

  it("makes no model call when the run has no stored request", async () => {
    const db = fakeDatabase({ intents: [] });
    const planner = fakePlanner();

    await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("FAILED");
    expect(planner.calls).toEqual([]);
    expect(db.transitions.at(-1)!.details).toMatchObject({ error_code: "INVALID_REQUEST", retryable: false });
  });

  it("does nothing when another worker already claimed the run", async () => {
    const db = fakeDatabase({ status: "UNDERSTANDING_REQUEST" });
    const planner = fakePlanner();

    await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("UNDERSTANDING_REQUEST");
    expect(planner.calls).toEqual([]);
    expect(db.transitions).toEqual([]);
  });

  it("never succeeds when the saved prompt does not read back identically", async () => {
    const db = fakeDatabase({ tamperReadback: true });
    const planner = fakePlanner();

    await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("FAILED");
    expect(db.transitions.at(-1)).toMatchObject({
      from: "SAVING",
      to: "FAILED",
      details: { error_code: "PERSISTENCE_FAILED" },
    });
    expect(db.transitions.some((t) => t.to === "SUCCEEDED")).toBe(false);
  });
});
