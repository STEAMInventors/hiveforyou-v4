import { PLANNER_CONTRACT_VERSION, type PlannerTask, type SourceSnapshot } from "@hiveforyou/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadPromptCatalog } from "./prompt-catalog";
import {
  DOC_1,
  DOC_2,
  domainOutput,
  INTENTS,
  intelligenceOutput,
  intentOutput,
  planOutput,
  RUN_ID,
  runJson,
  samplePages,
  snapshotDocument,
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
  intents?: { id: string; intentText: string; audience: string | null }[];
  snapshot?: SourceSnapshot;
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
            sourceSnapshot: options.snapshot ?? sourceSnapshot(),
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

function fakePlanner(
  overrides: Partial<Record<PlannerTask, () => Response>> = {},
  scenario: Partial<Record<PlannerTask, unknown>> = {},
) {
  const outputs: Record<PlannerTask, unknown> = {
    intent: intentOutput(),
    domain: domainOutput(),
    intelligence: intelligenceOutput(),
    plan: planOutput(),
    ...scenario,
  };
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
  it("runs the four planning stages in order, saves the prompt, reads it back and succeeds", async () => {
    const db = fakeDatabase();
    const planner = fakePlanner();

    await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("SUCCEEDED");

    expect(planner.calls).toEqual(["intent", "domain", "intelligence", "plan"]);
    expect(db.transitions.map((t) => t.to)).toEqual([
      "UNDERSTANDING_REQUEST",
      "IDENTIFYING_DOMAIN",
      "DEVELOPING_QUESTIONS",
      "PLANNING_INVESTIGATION",
      "BUILDING_PROMPT",
      "SAVING",
      "SUCCEEDED",
    ]);
    const [, toDomain, toQuestions, toPlan, toBuild] = db.transitions;
    expect(Object.keys(toDomain!.details.stage_outputs as object)).toEqual(["intentDecomposition"]);
    expect(Object.keys(toQuestions!.details.stage_outputs as object).sort()).toEqual([
      "domainProposal",
      "sampleCoverage",
    ]);
    expect(Object.keys(toPlan!.details.stage_outputs as object)).toEqual(["intentIntelligence"]);
    expect(toPlan!.details.stage_metric).toMatchObject({
      stage: "DEVELOPING_QUESTIONS",
      outcome: "SUCCEEDED",
      promptId: "hive-intent-intelligence/1",
      modelAliasRequested: "sorter",
    });
    expect(Object.keys(toBuild!.details.stage_outputs as object)).toEqual(["investigationPlan"]);
    expect(toDomain!.details.stage_metric).toMatchObject({
      stage: "UNDERSTANDING_REQUEST",
      outcome: "SUCCEEDED",
      promptId: "hive.intent-analysis/1",
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
    expect(promptText).toContain("#### P1 [COMPARISON] answers I1, I2");
    expect(promptText).toContain("#### P2");
    expect(promptText).toContain("For: Our finance lead");
    expect(promptText).toContain(`- I2 [needs assessment] ${intelligenceOutput().questions[1]!.question}`);
    expect(saved.execution_manifest).toMatchObject({
      requiredInputs: { intentIntelligence: { schema: "hive.intent-intelligence/1", questionIds: ["I1", "I2", "I3"] } },
    });
  });

  it("sends processingRunId, requests and provisional domainContext to the intent stage", async () => {
    const db = fakeDatabase();
    const planner = fakePlanner();
    await processStudyPreparation(deps(db, planner), RUN_ID);

    const intentBody = (planner.deps.fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    const intentRequest = JSON.parse(String(intentBody.body)) as {
      system_prompt: string;
      user_payload: Record<string, unknown>;
    };
    expect(intentRequest.user_payload).toMatchObject({
      processingRunId: RUN_ID,
      domainContext: { label: "Unknown", glossary: null },
    });
    expect(intentRequest.system_prompt).toContain("Domain label: `Unknown`");
    expect(intentRequest.system_prompt).toContain("(No glossary supplied.)");
  });

  it("gives the intelligence stage the intents with audience, the analysis, the domain and the sample", async () => {
    const db = fakeDatabase();
    const planner = fakePlanner();
    await processStudyPreparation(deps(db, planner), RUN_ID);

    const bodies = (planner.deps.fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      ([, init]) => JSON.parse(String((init as RequestInit).body)) as {
        task: string;
        prompt_id: string;
        max_output_tokens: number;
        user_payload: Record<string, unknown>;
      },
    );
    const intelligence = bodies[2]!;
    expect(intelligence).toMatchObject({ task: "intelligence", prompt_id: "hive-intent-intelligence/1", max_output_tokens: 12000 });
    const payload = intelligence.user_payload;
    expect(payload.task).toBe("intelligence");
    expect(payload.intents).toEqual([
      { intentRequestId: INTENTS[0]!.id, intentText: INTENTS[0]!.intentText, audience: "Our finance lead" },
      { intentRequestId: INTENTS[1]!.id, intentText: INTENTS[1]!.intentText, audience: null },
    ]);
    expect(payload.intentDecomposition).toMatchObject({ schema: "hive.intent-analysis/1" });
    expect(payload.domain).toMatchObject({ primary: { label: "Procurement" } });
    expect((payload.samples as unknown[]).length).toBe(6);
    expect(bodies[3]!.user_payload.intentIntelligence).toMatchObject({ schema: "hive.intent-intelligence/1" });
  });

  it("fails the run at DEVELOPING_QUESTIONS when a decomposed question is not covered", async () => {
    const db = fakeDatabase();
    const partial = intelligenceOutput();
    partial.questions = partial.questions.filter((question) => question.goalId === "G1");
    const planner = fakePlanner({
      intelligence: () => new Response(JSON.stringify(completion("intelligence", partial)), { status: 200 }),
    });

    await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("FAILED");
    expect(planner.calls).toEqual(["intent", "domain", "intelligence"]);
    expect(db.transitions.at(-1)).toMatchObject({
      from: "DEVELOPING_QUESTIONS",
      to: "FAILED",
      details: {
        error_code: "MODEL_OUTPUT_INVALID",
        stage_metric: { stage: "DEVELOPING_QUESTIONS", outcome: "FAILED" },
      },
    });
    expect(db.saved()).toBeNull();
  });

  it("fails the run at planning when the plan drops a specialist question", async () => {
    const db = fakeDatabase();
    const dropping = planOutput();
    dropping.questions[0]!.specialistQuestionIds = ["I1"];
    const planner = fakePlanner({
      plan: () => new Response(JSON.stringify(completion("plan", dropping)), { status: 200 }),
    });

    await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("FAILED");
    expect(db.transitions.at(-1)).toMatchObject({ from: "PLANNING_INVESTIGATION", to: "FAILED" });
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
    expect(planner.calls).toEqual(["intent", "domain", "intelligence"]);
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

// ---------------------------------------------------------------------------
// Regression scenarios (synthetic). The specialist questions are model output supplied by the
// fake planner; the assertions are structural so no domain wording lives in production code.
// ---------------------------------------------------------------------------
type Scenario = {
  intents: { id: string; intentText: string; audience: string | null }[];
  snapshot: SourceSnapshot;
  outputs: Record<PlannerTask, unknown>;
};

type ScenarioQuestion = { id: string; goalId: string; question: string; requiresJudgment: boolean };

function ref(sourceDocumentId: string, pageNumber: number) {
  return { sourceDocumentId, pageNumber };
}

function analysisQuestion(id: string, question: string, answerForm: string, dependsOn: string[] = []) {
  return { questionId: id, question, answerForm, needsJudgment: false, dependsOn };
}

function goal(
  goalId: string,
  intentRequestId: string,
  statedAs: string,
  goalText: string,
  questions: unknown[],
) {
  return { goalId, intentRequestId, statedAs, goal: goalText, questions, unclear: [] };
}

function specialist(
  id: string,
  goalId: string,
  analysisQuestionIds: string[],
  question: string,
  judgmentBasis: string | null = null,
  dependsOn: string[] = [],
) {
  return {
    id,
    goalId,
    analysisQuestionIds,
    question,
    whyItMatters: `Without ${id} the answer would be incomplete.`,
    supportsOutcome: `The decision behind ${goalId}.`,
    dependsOn,
    requiresJudgment: judgmentBasis !== null,
    judgmentBasis,
    contextRefs: [],
  };
}

function review(goalId: string, remainingLimits: string[] = []) {
  return { goalId, wouldFulfilIntent: true, gapsFound: [], revisions: [], remainingLimits };
}

function planItem(
  id: string,
  goalId: string,
  specialistQuestionIds: string[],
  answerType: string,
  logic: { comparison?: string; chronology?: string; calculation?: string; evaluation?: string } = {},
) {
  return {
    id,
    goalId,
    specialistQuestionIds,
    establish: `What the documents show for ${specialistQuestionIds.join(" and ")}.`,
    requiredEvidence: ["The pages that state it"],
    sourceDependencies: ["The source records named in the documents"],
    comparison: logic.comparison ?? null,
    chronology: logic.chronology ?? null,
    calculation: logic.calculation ?? null,
    evaluation: logic.evaluation ?? null,
    missingEvidenceConditions: ["No page states it"],
    answerType,
    deliverable: "A sourced answer with page references.",
    dependsOn: [],
    domainConsiderationRefs: [],
  };
}

function domain(label: string, subdomain: string) {
  return {
    primary: { label, subdomain, confidence: "MEDIUM", reasoning: "Sampled page headings.", supportingRefs: [ref(DOC_1, 1)] },
    alternatives: [],
    unknownDomain: false,
    mixedDomain: false,
    ambiguous: false,
    ambiguityNotes: [],
  };
}

const MAYA_INTENT_1 = "aaaaaaaa-1111-4111-8111-000000000001";
const MAYA_INTENT_2 = "aaaaaaaa-1111-4111-8111-000000000002";
const MAYA_INTENT_3 = "aaaaaaaa-1111-4111-8111-000000000003";

function mayaScenario(): Scenario {
  return {
    intents: [
      {
        id: MAYA_INTENT_1,
        intentText: "Compare the draft plan with last year's plan and tell me what changed in her services and goals.",
        audience: "My husband and me, before the meeting",
      },
      {
        id: MAYA_INTENT_2,
        intentText: "Is cutting her speech therapy supported by her latest evaluation?",
        audience: null,
      },
      {
        id: MAYA_INTENT_3,
        intentText: "What should I ask the school team at the November meeting?",
        audience: "The school team",
      },
    ],
    snapshot: sourceSnapshot({
      documents: [snapshotDocument(DOC_1, "Prior plan.pdf"), snapshotDocument(DOC_2, "Draft plan.pdf")],
    }),
    outputs: {
      intent: {
        schema: "hive.intent-analysis/1",
        processingRunId: RUN_ID,
        subjects: [],
        goals: [
          goal(
            "G1",
            MAYA_INTENT_1,
            "Compare the draft plan with last year's plan and tell me what changed in her services and goals.",
            "Compare draft and prior plan for service and goal changes",
            [
              analysisQuestion("Q1", "Which services changed in minutes, frequency or setting?", "COMPARISON"),
              analysisQuestion("Q2", "Which annual goals were added, removed or rewritten?", "COMPARISON"),
            ],
          ),
          goal(
            "G2",
            MAYA_INTENT_2,
            "Is cutting her speech therapy supported by her latest evaluation?",
            "Determine whether the speech reduction is supported by the evaluation",
            [analysisQuestion("Q3", "What do the evaluation findings say about speech needs?", "EXPLANATION")],
          ),
          goal(
            "G3",
            MAYA_INTENT_3,
            "What should I ask the school team at the November meeting?",
            "Prepare questions for the November school team meeting",
            [
              analysisQuestion("Q4", "Which changes or gaps are unexplained in the documents?", "LIST", ["Q1", "Q2", "Q3"]),
            ],
          ),
        ],
        reservedDecisions: [],
        instructionsIgnored: [],
      },
      domain: domain("Special education", "Annual plan review"),
      intelligence: {
        questions: [
          specialist("I1", "G1", ["Q1"], "For each service, what are the minutes, frequency and setting in each plan, and what is the net change?"),
          specialist("I2", "G1", ["Q2"], "Which goals are carried over unchanged despite progress data showing they were not met?", "Progress reports against each goal's stated measure.", ["I3"]),
          specialist("I3", "G1", ["Q2"], "What progress is reported on each prior goal, and by what measure?"),
          specialist("I4", "G2", ["Q3"], "Which evaluation scores and recommendations concern expressive and receptive language?"),
          specialist("I5", "G2", ["Q3"], "Does the reduction in speech minutes follow from the evaluation's findings and recommendations?", "Consistency between the evaluation recommendation and the draft service minutes.", ["I1", "I4"]),
          specialist("I6", "G3", ["Q4"], "Which changes have no stated reason anywhere in the documents?", null, ["I1", "I2", "I5"]),
          specialist("I7", "G3", ["Q4"], "Which records are referred to but not provided, such as progress reports or evaluations?"),
        ],
        completenessReview: [
          review("G1"),
          review("G2", ["The evaluator's full report may hold reasoning not in the summary."]),
          review("G3"),
        ],
      },
      plan: {
        domainBasis: { primaryDomain: "Special education", uncertain: false, considerations: [] },
        questions: [
          planItem("P1", "G1", ["I1"], "COMPARISON", { comparison: "Prior plan services against draft plan services" }),
          planItem("P2", "G1", ["I2", "I3"], "COMPARISON", {
            comparison: "Prior goals against draft goals",
            evaluation: "Whether unmet goals were carried over, judged against reported progress.",
          }),
          planItem("P3", "G2", ["I4", "I5"], "FACT", {
            evaluation: "Whether the draft minutes follow the evaluation recommendation.",
          }),
          planItem("P4", "G3", ["I6", "I7"], "FACT"),
        ],
      },
    },
  };
}

const NEUTRAL_INTENT_1 = "bbbbbbbb-2222-4222-8222-000000000001";
const NEUTRAL_INTENT_2 = "bbbbbbbb-2222-4222-8222-000000000002";

function neutralScenario(): Scenario {
  return {
    intents: [
      { id: NEUTRAL_INTENT_1, intentText: "Was my water damage claim underpaid?", audience: null },
      { id: NEUTRAL_INTENT_2, intentText: "What do I need to send the insurer, and by when?", audience: "My contractor" },
    ],
    snapshot: sourceSnapshot({
      documents: [snapshotDocument(DOC_1, "Policy.pdf"), snapshotDocument(DOC_2, "Settlement letter.pdf")],
    }),
    outputs: {
      intent: {
        schema: "hive.intent-analysis/1",
        processingRunId: RUN_ID,
        subjects: [],
        goals: [
          goal(
            "G1",
            NEUTRAL_INTENT_1,
            "Was my water damage claim underpaid?",
            "Determine whether the water damage claim was underpaid",
            [analysisQuestion("Q1", "How was the settlement amount calculated?", "VALUE")],
          ),
          goal(
            "G2",
            NEUTRAL_INTENT_2,
            "What do I need to send the insurer, and by when?",
            "Identify required submissions and deadlines for the insurer",
            [analysisQuestion("Q2", "Which documents and dates does the insurer require?", "LIST")],
          ),
        ],
        reservedDecisions: [],
        instructionsIgnored: [],
      },
      domain: domain("Property insurance", "Water damage claim"),
      intelligence: {
        questions: [
          specialist("I1", "G1", ["Q1"], "Which line items, deductible and depreciation make up the settlement amount?"),
          specialist("I2", "G1", ["Q1"], "Do any exclusions or sublimits the insurer cites match the policy wording?", "The policy's exclusion and sublimit clauses as written.", ["I1"]),
          specialist("I3", "G2", ["Q2"], "Which proof-of-loss documents and dates does the letter or policy require?"),
        ],
        completenessReview: [review("G1", ["Repair costs are not in the documents."]), review("G2")],
      },
      plan: {
        domainBasis: { primaryDomain: "Property insurance", uncertain: false, considerations: [] },
        questions: [
          planItem("P1", "G1", ["I1", "I2"], "CALCULATION", {
            calculation: "Sum of line items less deductible and depreciation",
            evaluation: "Whether each cited exclusion matches the policy clause.",
          }),
          planItem("P2", "G2", ["I3"], "CHRONOLOGY", { chronology: "Order each required item by its due date" }),
        ],
      },
    },
  };
}

async function prepareScenario(scenario: Scenario) {
  const db = fakeDatabase({ intents: scenario.intents, snapshot: scenario.snapshot });
  const planner = fakePlanner({}, scenario.outputs);
  await expect(processStudyPreparation(deps(db, planner), RUN_ID)).resolves.toBe("SUCCEEDED");
  return { promptText: String(db.saved()!.prompt_text), saved: db.saved()!, toPlan: db.transitions[3]! };
}

describe.each([
  ["Maya multi-intent plan review", mayaScenario],
  ["domain-neutral insurance claim", neutralScenario],
])("regression: %s", (_name, build) => {
  it("carries every specialist question through planning into the Study Prompt Preview", async () => {
    const scenario = build();
    const { promptText, saved, toPlan } = await prepareScenario(scenario);
    const intelligence = scenario.outputs.intelligence as { questions: ScenarioQuestion[] };
    const plan = scenario.outputs.plan as { questions: { id: string; specialistQuestionIds: string[]; evaluation: string | null }[] };

    expect(toPlan.details.stage_outputs).toMatchObject({ intentIntelligence: { schema: "hive.intent-intelligence/1" } });

    for (const intent of scenario.intents) {
      expect(promptText).toContain(intent.intentText);
      if (intent.audience) expect(promptText).toContain(`For: ${intent.audience}`);
    }
    for (const question of intelligence.questions) {
      expect(promptText).toContain(`- ${question.id}${question.requiresJudgment ? " [needs assessment]" : ""} ${question.question}`);
      const serving = plan.questions.filter((p) => p.specialistQuestionIds.includes(question.id));
      expect(serving.length).toBeGreaterThan(0);
      if (question.requiresJudgment) expect(serving.some((p) => p.evaluation !== null)).toBe(true);
    }
    expect(saved.execution_manifest).toMatchObject({
      requiredInputs: { intentIntelligence: { questionIds: intelligence.questions.map((q) => q.id) } },
    });
    expect(promptText).toContain("What the documents alone may not settle:");
  });
});
