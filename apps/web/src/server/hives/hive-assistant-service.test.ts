import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { maybeScheduleHiveAssistantReply } from "./hive-assistant-service";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "66666666-6666-4666-8666-666666666666";
const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

const triggerMessage = {
  id: MESSAGE_ID,
  authorKind: "person" as const,
  authorRole: "client" as const,
  authorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  authorDisplayName: "Taylor",
  authorRoleLabel: "Client",
  isMine: false,
  body: "What is in the packet?",
  sourceRefs: [],
  replyToMessageId: null,
  createdAt: "2026-11-18T14:05:00.123456+00:00",
};

const preparationPayload = {
  studyRevision: null,
  processingRun: null,
  reportRuns: [],
  eligibility: { documents: [], excluded: [], coverageComplete: false },
};

const overviewPayload = {
  preparation: preparationPayload,
  reports: null,
  studyView: null,
  studyTab: null,
  canonicalStudy: null,
  referencedDocuments: [],
  summary: { title: "Hive", subtitle: "", chips: [], progressLabel: null, progressPercent: null },
};

const {
  getStudyPreparationMock,
  loadHiveOverviewMock,
  getStudyTabViewMock,
  createSupabaseAdminClientMock,
  finishRunRpcMock,
  emitStructuredEventMock,
} = vi.hoisted(() => ({
  getStudyPreparationMock: vi.fn(),
  loadHiveOverviewMock: vi.fn(),
  getStudyTabViewMock: vi.fn(),
  createSupabaseAdminClientMock: vi.fn(),
  finishRunRpcMock: vi.fn(),
  emitStructuredEventMock: vi.fn(),
}));

vi.mock("@hives/persistence/env", () => ({ loadSupabaseAdminEnv: () => ({}) }));
vi.mock("@hives/persistence/storage/supabase-client", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));
vi.mock("@/server/study-preparation/study-preparation", () => ({
  getStudyPreparation: (...args: unknown[]) => getStudyPreparationMock(...args),
  getStudyTabView: (...args: unknown[]) => getStudyTabViewMock(...args),
}));
vi.mock("./hive-summary", () => ({
  loadHiveOverview: (...args: unknown[]) => loadHiveOverviewMock(...args),
}));
vi.mock("@/server/observability/logger", () => ({
  emitStructuredEvent: (...args: unknown[]) => emitStructuredEventMock(...args),
}));

const loadPackByIdMock = vi.fn();
vi.mock("@/server/pipeline/pack-loader", () => ({
  loadPackById: (...args: unknown[]) => loadPackByIdMock(...args),
}));

const loadHiveAssistantReplyPromptMock = vi.fn();
vi.mock("./hive-assistant-prompt", () => ({
  loadHiveAssistantReplyPrompt: () => loadHiveAssistantReplyPromptMock(),
}));

function chainableHiveRow() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        content_class: "synthetic",
        assistant_replies_on: true,
        name: "Solo Hive",
        stage: null,
        firm_id: null,
      },
      error: null,
    }),
  };
}

function buildAdminClient(): SupabaseClient {
  const assistantRuns = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
  };
  return {
    rpc: finishRunRpcMock,
    schema: vi.fn((name: string) => {
      if (name !== "hive") throw new Error(`unexpected schema ${name}`);
      return {
        from: vi.fn((table: string) => {
          if (table === "hives") return chainableHiveRow();
          if (table === "assistant_runs") return assistantRuns;
          throw new Error(`unexpected table ${table}`);
        }),
      };
    }),
  } as unknown as SupabaseClient;
}

function buildUserClient(rpcImpl?: (name: string) => Promise<{ data: unknown; error: unknown }>): SupabaseClient {
  const rpc = vi.fn(async (name: string) => {
    if (rpcImpl) return rpcImpl(name);
    if (name === "list_requests") return { data: { requests: [] }, error: null };
    if (name === "list_hive_messages") {
      return {
        data: {
          messages: [triggerMessage],
          participantRoleLabels: ["Client"],
          participantCount: 1,
          viewerLastReadAt: null,
          nextCursor: null,
        },
        error: null,
      };
    }
    throw new Error(`unexpected user rpc ${name}`);
  });
  return { rpc } as unknown as SupabaseClient;
}

describe("maybeScheduleHiveAssistantReply briefing client", () => {
  beforeEach(() => {
    emitStructuredEventMock.mockReset();
    getStudyPreparationMock.mockReset();
    loadHiveOverviewMock.mockReset();
    getStudyTabViewMock.mockReset();
    createSupabaseAdminClientMock.mockReset();
    finishRunRpcMock.mockReset();
    loadPackByIdMock.mockReset();
    loadHiveAssistantReplyPromptMock.mockReset();
    loadHiveAssistantReplyPromptMock.mockReturnValue({
      task: "assistant_reply",
      id: "hive-assistant-reply/3",
      digest: "sha256:00",
      systemPrompt: "system",
    });

    getStudyPreparationMock.mockResolvedValue(preparationPayload);
    loadHiveOverviewMock.mockResolvedValue(overviewPayload);
    getStudyTabViewMock.mockResolvedValue({ canonicalStudy: null });
    finishRunRpcMock.mockImplementation(async (name: string) => {
      if (name === "claim_assistant_run") {
        return { data: { runId: RUN_ID, claimed: true }, error: null };
      }
      if (name === "finish_assistant_run") {
        return { data: null, error: null };
      }
      throw new Error(`unexpected admin rpc ${name}`);
    });
    createSupabaseAdminClientMock.mockReturnValue(buildAdminClient());
  });

  it("builds the briefing with the poster user client while admin RPCs would be auth_required", async () => {
    const userClient = buildUserClient();
    const adminBriefingWouldFail = vi.fn(async (name: string, args: unknown) => {
      if (name === "get_study_preparation" || name === "get_study_tab_view" || name === "list_requests") {
        return { data: null, error: { message: "auth_required" } };
      }
      if (name === "claim_assistant_run") {
        return { data: { runId: RUN_ID, claimed: true }, error: null };
      }
      if (name === "finish_assistant_run") {
        return { data: null, error: null };
      }
      throw new Error(`unexpected admin rpc ${name}: ${String(args)}`);
    });
    createSupabaseAdminClientMock.mockReturnValue({ rpc: adminBriefingWouldFail, schema: buildAdminClient().schema } as SupabaseClient);

    const runModel = vi.fn(async () => ({
      ok: true as const,
      output: { intent: "route_to_team", reply: "", claims: [] },
      modelId: "harvester",
      latencyMs: 12,
    }));

    await maybeScheduleHiveAssistantReply(
      {
        hiveId: HIVE_ID,
        triggerMessage,
        authorRole: "client",
        correlationId: CORRELATION_ID,
        userClient,
      },
      runModel,
    );

    expect(getStudyPreparationMock.mock.calls[0]?.[0]).toBe(userClient);
    expect(loadHiveOverviewMock.mock.calls[0]?.[0]).toBe(userClient);
    expect(getStudyTabViewMock.mock.calls[0]?.[0]).toBe(userClient);
    expect(userClient.rpc).toHaveBeenCalledWith("list_requests", { p_hive_id: HIVE_ID });
    expect(adminBriefingWouldFail.mock.calls.map(([name]) => name)).not.toContain("list_requests");
    expect(runModel).toHaveBeenCalled();
  });

  it("logs flags_unavailable and stops when hive flags cannot be loaded", async () => {
    createSupabaseAdminClientMock.mockReturnValue({
      rpc: finishRunRpcMock,
      schema: vi.fn((name: string) => {
        if (name !== "hive") throw new Error(`unexpected schema ${name}`);
        return {
          from: vi.fn((table: string) => {
            if (table === "hives") {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } }),
              };
            }
            if (table === "assistant_runs") {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        };
      }),
    } as SupabaseClient);

    await maybeScheduleHiveAssistantReply({
      hiveId: HIVE_ID,
      triggerMessage,
      authorRole: "client",
      correlationId: CORRELATION_ID,
      userClient: buildUserClient(),
    });

    expect(finishRunRpcMock).not.toHaveBeenCalled();
    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "hive.assistant.flags_unavailable", hiveId: HIVE_ID }),
    );
  });

  it("finishes failed with briefing_unavailable when a user briefing read fails", async () => {
    const userClient = buildUserClient();
    getStudyPreparationMock.mockRejectedValueOnce(new Error("hive_not_found"));

    await maybeScheduleHiveAssistantReply({
      hiveId: HIVE_ID,
      triggerMessage,
      authorRole: "client",
      correlationId: CORRELATION_ID,
      userClient,
    });

    expect(finishRunRpcMock).toHaveBeenCalledWith(
      "finish_assistant_run",
      expect.objectContaining({
        p_run_id: RUN_ID,
        p_status: "failed",
        p_body: null,
        p_error_code: "briefing_unavailable",
      }),
    );
    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        diagnosticField: "briefing_unavailable:Error",
        errorCode: "briefing_unavailable",
        processingRunId: RUN_ID,
      }),
    );
  });
});

describe("maybeScheduleHiveAssistantReply pack and prompt", () => {
  beforeEach(() => {
    emitStructuredEventMock.mockReset();
    getStudyPreparationMock.mockReset();
    loadHiveOverviewMock.mockReset();
    getStudyTabViewMock.mockReset();
    createSupabaseAdminClientMock.mockReset();
    finishRunRpcMock.mockReset();
    loadPackByIdMock.mockReset();
    loadHiveAssistantReplyPromptMock.mockReset();
    loadHiveAssistantReplyPromptMock.mockReturnValue({
      task: "assistant_reply",
      id: "hive-assistant-reply/3",
      digest: "sha256:00",
      systemPrompt: "system",
    });

    getStudyPreparationMock.mockResolvedValue(preparationPayload);
    loadHiveOverviewMock.mockResolvedValue(overviewPayload);
    getStudyTabViewMock.mockResolvedValue({
      canonicalStudy: { packRef: { id: "widget-review", version: 1 } },
    });
    finishRunRpcMock.mockImplementation(async (name: string) => {
      if (name === "claim_assistant_run") {
        return { data: { runId: RUN_ID, claimed: true }, error: null };
      }
      if (name === "finish_assistant_run") {
        return { data: null, error: null };
      }
      throw new Error(`unexpected admin rpc ${name}`);
    });
    createSupabaseAdminClientMock.mockReturnValue(buildAdminClient());
  });

  it("still replies when pack load throws, using pack null in the briefing", async () => {
    loadPackByIdMock.mockImplementation(() => {
      throw new Error("ENOENT pack");
    });
    const runModel = vi.fn(async () => ({
      ok: true as const,
      output: { intent: "route_to_team", reply: "", claims: [] },
      modelId: "harvester",
      latencyMs: 12,
    }));

    await maybeScheduleHiveAssistantReply(
      {
        hiveId: HIVE_ID,
        triggerMessage,
        authorRole: "owner",
        correlationId: CORRELATION_ID,
        userClient: buildUserClient(),
      },
      runModel,
    );

    expect(runModel).toHaveBeenCalled();
    const briefing = runModel.mock.calls[0]?.[0]?.briefing as { matterType?: string | null };
    expect(briefing?.matterType ?? null).toBeNull();
    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "hive.assistant.pack_unavailable", errorCode: "pack_unavailable" }),
    );
    expect(finishRunRpcMock).toHaveBeenCalledWith(
      "finish_assistant_run",
      expect.objectContaining({ p_status: "routed", p_error_code: null }),
    );
  });

  it("finishes failed with prompt_unavailable when the prompt file cannot load", async () => {
    loadHiveAssistantReplyPromptMock.mockImplementation(() => {
      throw new Error("ENOENT prompt");
    });

    await maybeScheduleHiveAssistantReply({
      hiveId: HIVE_ID,
      triggerMessage,
      authorRole: "owner",
      correlationId: CORRELATION_ID,
      userClient: buildUserClient(),
    });

    expect(finishRunRpcMock).toHaveBeenCalledWith(
      "finish_assistant_run",
      expect.objectContaining({
        p_run_id: RUN_ID,
        p_status: "failed",
        p_error_code: "prompt_unavailable",
      }),
    );
    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        errorCode: "prompt_unavailable",
        diagnosticField: "prompt_unavailable:Error",
      }),
    );
  });
});