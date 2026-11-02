import { PLANNER_CONTRACT_VERSION, verifyStudyInvestigation } from "@hiveforyou/contracts";
import {
  MAYA_DOCS,
  MAYA_FILE_NAMES,
  MAYA_INTENT_ID,
  MAYA_INTENT_TEXT,
  MAYA_PAGES,
  MAYA_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaStudyOutput,
  mayaWriterOutput,
} from "@hiveforyou/contracts/testing";
import { describe, expect, it, vi } from "vitest";

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

function fakeDatabase(audience: "CUSTOMER" | "PRO" = "CUSTOMER", options: { claimed?: boolean } = {}) {
  let status = "QUEUED";
  const transitions: { from: string; to: string; details: Record<string, unknown> }[] = [];
  let saved: Record<string, unknown> | null = null;
  const study = verifiedStudy();
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    switch (fn) {
      case "claim_report_run":
        if (options.claimed === false) return { data: { claimed: false, reportRun: reportRunJson("WRITING", audience) }, error: null };
        status = "WRITING";
        return { data: { claimed: true, reportRun: reportRunJson(status, audience) }, error: null };
      case "get_report_generation_inputs":
        return {
          data: {
            reportRun: reportRunJson(status, audience),
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
        if (args.p_from_status !== status) return { data: { applied: false, reportRun: reportRunJson(status, audience) }, error: null };
        transitions.push({ from: String(args.p_from_status), to: String(args.p_to_status), details: args.p_details as Record<string, unknown> });
        const details = args.p_details as { retryable?: boolean };
        status = args.p_to_status === "FAILED" && details.retryable ? "QUEUED" : String(args.p_to_status);
        return {
          data: { applied: true, retrying: status === "QUEUED", reportRun: reportRunJson(status, audience) },
          error: null,
        };
      }
      case "save_report":
        saved = args.p_report as Record<string, unknown>;
        status = "SUCCEEDED";
        return { data: { reportRun: reportRunJson(status, audience, { reportId: "eeeeeeee-0000-4000-8000-000000000001" }) }, error: null };
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  });
  return { client: { rpc }, transitions, saved: () => saved, status: () => status };
}

function planner(content: unknown, status = 200) {
  const bodies: { task: string; prompt_id: string; user_payload: Record<string, unknown> }[] = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (status !== 200) {
      return new Response(JSON.stringify({ contract_version: "planner-error@1", error_code: "MODEL_TIMEOUT", retryable: true }), { status });
    }
    return new Response(
      JSON.stringify({
        contract_version: PLANNER_CONTRACT_VERSION,
        task: "writer",
        model_alias: "harvester",
        resolved_model: "synthetic-model",
        content_json: content,
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        latency_ms: 900,
        finish_reason: "stop",
      }),
      { status: 200 },
    );
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
    const model = planner(mayaWriterOutput(audience));

    await expect(
      processReportRun({ client: db.client, planner: model.deps, loadCatalog: () => loadPromptCatalog() }, REPORT_RUN_ID),
    ).resolves.toBe("SUCCEEDED");

    expect(model.bodies).toHaveLength(1);
    const payload = model.bodies[0]!.user_payload;
    expect(model.bodies[0]!.task).toBe("writer");
    expect(payload).toMatchObject({ task: "writer", audience, coverage: { complete: true } });
    expect(JSON.stringify(payload)).not.toContain(MAYA_PAGES[`${MAYA_DOCS.teacherNotes}:1`]);
    const claims = payload.claims as { id: string; pages?: string[]; numericStatus?: string }[];
    expect(claims.find((claim) => claim.id === "P2.C0")).toMatchObject({ numericStatus: "VERIFIED", pages: ["Speech service log.xlsx p.1"] });

    expect(db.transitions.map((t) => t.to)).toEqual(["VALIDATING", "SAVING"]);
    expect(db.transitions[1]!.details.stage_metric).toMatchObject({ stage: "WRITING", outcome: "SUCCEEDED", modelAliasRequested: "harvester" });
    const saved = db.saved()!;
    expect(saved).toMatchObject({ model_alias: "harvester", view: { audience, schema: "hive-application-view/1" } });
    expect(saved.scenario_analysis).toMatchObject({ scenarios: [{ id: "S1" }] });
  });

  it("fails the Writer run as retryable, saving nothing, when the draft cites an unknown claim", async () => {
    const draft = mayaWriterOutput();
    draft.summary[0]!.claimRefs = ["P9.F0"];
    const db = fakeDatabase();
    const model = planner(draft);

    await expect(processReportRun({ client: db.client, planner: model.deps }, REPORT_RUN_ID)).resolves.toBe("QUEUED");
    expect(db.transitions.at(-1)).toMatchObject({
      from: "VALIDATING",
      to: "FAILED",
      details: { error_code: "MODEL_OUTPUT_INVALID", retryable: true, stage_metric: { stage: "WRITING", outcome: "FAILED" } },
    });
    expect(db.saved()).toBeNull();
  });

  it("fails the Writer run as retryable from WRITING when the model times out", async () => {
    const db = fakeDatabase();
    const model = planner(null, 504);

    await processReportRun({ client: db.client, planner: model.deps }, REPORT_RUN_ID);
    expect(db.transitions).toEqual([
      expect.objectContaining({ from: "WRITING", to: "FAILED", details: expect.objectContaining({ error_code: "MODEL_TIMEOUT", retryable: true }) }),
    ]);
  });

  it("does nothing when another invocation already claimed the run", async () => {
    const db = fakeDatabase("CUSTOMER", { claimed: false });
    const model = planner(mayaWriterOutput());
    await expect(processReportRun({ client: db.client, planner: model.deps }, REPORT_RUN_ID)).resolves.toBe("WRITING");
    expect(model.bodies).toHaveLength(0);
  });
});
