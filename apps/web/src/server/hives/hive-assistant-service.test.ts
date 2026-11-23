import {
  CANONICAL_STUDY_SCHEMA,
  createHiveError,
  verifyStudyInvestigation,
  type AssistantBriefing,
  type CanonicalStudy,
} from "@hiveforyou/contracts";
import {
  MAYA_DOCS,
  MAYA_REVISION_6_PAGES,
  MAYA_REVISION_6_PLAN_QUESTION_IDS,
  MAYA_RUN_ID,
  mayaRevision6StudyOutput,
} from "@hiveforyou/contracts/testing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VaultAdminConfigError } from "@/server/source-documents/v3-vault/persistence/vault-admin-config-error";

import {
  ASSISTANT_PRE_CLAIM_STAGES,
  maybeScheduleHiveAssistantReply,
  runHiveAssistantReply,
} from "./hive-assistant-service";

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
  loadSupabaseAdminEnvMock,
  createSupabaseAdminClientMock,
  createDefaultAssistantModelRunnerMock,
  shouldTriggerHiveAssistantMock,
  finishRunRpcMock,
  emitStructuredEventMock,
} = vi.hoisted(() => ({
  getStudyPreparationMock: vi.fn(),
  loadHiveOverviewMock: vi.fn(),
  getStudyTabViewMock: vi.fn(),
  loadSupabaseAdminEnvMock: vi.fn(() => ({})),
  createSupabaseAdminClientMock: vi.fn(),
  createDefaultAssistantModelRunnerMock: vi.fn(),
  shouldTriggerHiveAssistantMock: vi.fn(),
  finishRunRpcMock: vi.fn(),
  emitStructuredEventMock: vi.fn(),
}));

vi.mock("@hives/persistence/env", () => ({
  loadSupabaseAdminEnv: (...args: unknown[]) => loadSupabaseAdminEnvMock(...args),
}));
vi.mock("@hives/persistence/storage/supabase-client", () => ({
  createSupabaseAdminClient: (...args: unknown[]) => createSupabaseAdminClientMock(...args),
}));
vi.mock("./hive-assistant-model-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hive-assistant-model-runner")>();
  createDefaultAssistantModelRunnerMock.mockImplementation((...args: Parameters<typeof actual.createDefaultAssistantModelRunner>) =>
    actual.createDefaultAssistantModelRunner(...args),
  );
  return {
    ...actual,
    createDefaultAssistantModelRunner: (...args: Parameters<typeof actual.createDefaultAssistantModelRunner>) =>
      createDefaultAssistantModelRunnerMock(...args),
  };
});
vi.mock("./hive-assistant-trigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hive-assistant-trigger")>();
  shouldTriggerHiveAssistantMock.mockImplementation((...args: Parameters<typeof actual.shouldTriggerHiveAssistant>) =>
    actual.shouldTriggerHiveAssistant(...args),
  );
  return {
    ...actual,
    shouldTriggerHiveAssistant: (...args: Parameters<typeof actual.shouldTriggerHiveAssistant>) =>
      shouldTriggerHiveAssistantMock(...args),
  };
});
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

describe("maybeScheduleHiveAssistantReply — P0.5-B legacy investigation-1 and canonical parity", () => {
  const CANONICAL_STUDY_ID = "33333333-3333-4333-8333-333333333333";
  const MAYA_V6_REV_ID = "44444444-4444-4444-8444-444444444446";
  const MAYA_V7_REV_ID = "44444444-4444-4444-8444-444444444447";
  const MAYA_1105_REV_ID = "44444444-4444-4444-8444-444444441105";
  const MAYA_DOC_IDS = [
    MAYA_DOCS.iep2024,
    MAYA_DOCS.iep2025,
    MAYA_DOCS.progressNov,
    MAYA_DOCS.progressJan,
    MAYA_DOCS.serviceLog,
    MAYA_DOCS.evaluation,
    MAYA_DOCS.meetingNotice,
  ] as const;

  function verifiedMayaV6() {
    const verified = verifyStudyInvestigation(mayaRevision6StudyOutput(), {
      processingRunId: MAYA_RUN_ID,
      planQuestionIds: MAYA_REVISION_6_PLAN_QUESTION_IDS,
      pages: new Map(Object.entries(MAYA_REVISION_6_PAGES)),
    });
    if (!verified.ok) throw new Error(verified.message);
    return verified.value;
  }

  function mayaV6Preparation() {
    return {
      studyRevision: {
        id: MAYA_V6_REV_ID,
        canonicalStudyId: CANONICAL_STUDY_ID,
        revisionNumber: 6,
        predecessorRevisionId: null,
        processingRunId: MAYA_RUN_ID,
        format: "investigation-1" as const,
        coverageComplete: true,
        coverageStatus: "COMPLETE",
        coverageGaps: [],
        coverageAcknowledgement: "NOT_REQUIRED",
        createdAt: "2026-11-02T00:00:00.000Z",
      },
      processingRun: null,
      reportRuns: [],
      eligibility: {
        documents: MAYA_DOC_IDS.map((sourceDocumentId, idx) => ({
          sourceDocumentId,
          fileName: `maya-doc-${idx + 1}.pdf`,
          totalPhysicalPages: 1,
          readStatus: "SUCCEEDED",
        })),
        excluded: [],
        coverageComplete: true,
      },
    };
  }

  function buildUserClientWithLegacyTables(
    message: typeof triggerMessage,
    overrides?: {
      currentRevisionId?: string;
      runStatus?: string;
      verification?: unknown;
      investigation?: unknown;
      schemaSpy?: ReturnType<typeof vi.fn>;
    },
  ): SupabaseClient {
    const verified = verifiedMayaV6();
    const fromMock = vi.fn((table: string) => {
      let result: { data: unknown; error: unknown } = { data: null, error: null };
      if (table === "canonical_studies") {
        result = {
          data: {
            id: CANONICAL_STUDY_ID,
            hive_id: HIVE_ID,
            current_revision_id: overrides?.currentRevisionId ?? MAYA_V6_REV_ID,
          },
          error: null,
        };
      } else if (table === "study_revisions") {
        result = {
          data: {
            id: MAYA_V6_REV_ID,
            canonical_study_id: CANONICAL_STUDY_ID,
            hive_id: HIVE_ID,
            revision_number: 6,
            processing_run_id: MAYA_RUN_ID,
            format: "investigation-1",
            investigation: overrides?.investigation !== undefined ? overrides.investigation : verified.investigation,
            verification: overrides?.verification !== undefined ? overrides.verification : verified.verification,
          },
          error: null,
        };
      } else if (table === "processing_runs") {
        result = {
          data: {
            id: MAYA_RUN_ID,
            hive_id: HIVE_ID,
            status: overrides?.runStatus ?? "SUCCEEDED",
            authorized_source_document_ids: [...MAYA_DOC_IDS],
            source_snapshot: {
              documents: MAYA_DOC_IDS.map((id) => ({
                sourceDocumentId: id,
                totalPhysicalPages: 1,
                missingPageNumbers: [],
                emptyPageNumbers: [],
              })),
            },
          },
          error: null,
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(result),
      };
    });

    const schemaFn = overrides?.schemaSpy ?? vi.fn((name: string) => {
      if (name !== "hive") throw new Error(`unexpected schema ${name}`);
      return { from: fromMock };
    });

    const rpc = vi.fn(async (name: string) => {
      if (name === "list_requests") return { data: { requests: [] }, error: null };
      if (name === "list_hive_messages") {
        return {
          data: {
            messages: [message],
            participantRoleLabels: ["Owner"],
            participantCount: 1,
            viewerLastReadAt: null,
            nextCursor: null,
          },
          error: null,
        };
      }
      throw new Error(`unexpected user rpc ${name}`);
    });
    return { rpc, schema: schemaFn } as unknown as SupabaseClient;
  }

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

    finishRunRpcMock.mockImplementation(async (name: string) => {
      if (name === "claim_assistant_run") return { data: { runId: RUN_ID, claimed: true }, error: null };
      if (name === "finish_assistant_run") return { data: null, error: null };
      throw new Error(`unexpected admin rpc ${name}`);
    });
    createSupabaseAdminClientMock.mockReturnValue(buildAdminClient());
  });

  it("answers a supported Maya Study v6 plan question with clickable document/page citations and zero record text in telemetry", async () => {
    const prep = mayaV6Preparation();
    getStudyPreparationMock.mockResolvedValue(prep);
    loadHiveOverviewMock.mockResolvedValue({ ...overviewPayload, preparation: prep });
    getStudyTabViewMock.mockResolvedValue({
      revision: { id: MAYA_V6_REV_ID, revisionNumber: 6, format: "investigation-1" },
      canonicalStudy: null,
      facts: [],
    });

    const questionMessage = {
      ...triggerMessage,
      authorRole: "owner" as const,
      body: "How many speech therapy minutes were delivered?",
    };
    const userClient = buildUserClientWithLegacyTables(questionMessage);

    const runModel = vi.fn(async () => ({
      ok: true as const,
      output: {
        intent: "answer",
        reply: "360 speech therapy minutes were delivered between September and November 2025.",
        claims: [
          {
            text: "360 speech therapy minutes were delivered between September and November 2025.",
            factIds: ["P3.F0"],
          },
        ],
      },
      modelId: "harvester",
      latencyMs: 35,
    }));

    await maybeScheduleHiveAssistantReply(
      {
        hiveId: HIVE_ID,
        triggerMessage: questionMessage,
        authorRole: "owner",
        correlationId: CORRELATION_ID,
        userClient,
      },
      runModel,
    );

    expect(runModel).toHaveBeenCalledTimes(1);
    const sentBriefing = runModel.mock.calls[0]?.[0]?.briefing as unknown as AssistantBriefing;
    expect(sentBriefing.study.facts.length).toBeGreaterThanOrEqual(14);
    expect(sentBriefing.study.facts.some((f) => f.id === "P3.F0")).toBe(true);
    // No raw quotation or .pdf filename transmitted in briefing
    expect(JSON.stringify(sentBriefing)).not.toContain("Speech therapy minutes delivered September to November 2025: 360 minutes.");
    expect(JSON.stringify(sentBriefing).toLowerCase()).not.toContain(".pdf");

    expect(finishRunRpcMock).toHaveBeenCalledWith(
      "finish_assistant_run",
      expect.objectContaining({
        p_run_id: RUN_ID,
        p_status: "answered",
        p_study_revision_id: MAYA_V6_REV_ID,
        p_error_code: null,
        p_source_refs: [
          expect.objectContaining({
            sourceDocumentId: MAYA_DOCS.serviceLog,
            pageNumber: 1,
            factId: "P3.F0",
            studyRevisionId: MAYA_V6_REV_ID,
          }),
        ],
      }),
    );

    // Telemetry must NEVER contain raw record text, quotations, or fact statements
    const telemetryJson = JSON.stringify(emitStructuredEventMock.mock.calls);
    expect(telemetryJson).not.toContain("360 speech therapy minutes");
    expect(telemetryJson).not.toContain("Speech therapy minutes delivered");
    expect(telemetryJson).not.toContain("62 words correct per minute");
    expect(telemetryJson).not.toContain("Individualized Education Program");
  });

  it("refuses factual claims for an unsupported question on Maya Study v6", async () => {
    const prep = mayaV6Preparation();
    getStudyPreparationMock.mockResolvedValue(prep);
    loadHiveOverviewMock.mockResolvedValue({ ...overviewPayload, preparation: prep });
    getStudyTabViewMock.mockResolvedValue({ canonicalStudy: null });

    const questionMessage = {
      ...triggerMessage,
      authorRole: "owner" as const,
      body: "What allergy medication does Maya take?",
    };
    const userClient = buildUserClientWithLegacyTables(questionMessage);

    const runModel = vi.fn(async () => ({
      ok: true as const,
      output: {
        intent: "answer",
        reply: "Maya takes 10 mg daily allergy medication.",
        claims: [{ text: "Maya takes 10 mg daily allergy medication.", factIds: ["P99.F0"] }],
      },
      modelId: "harvester",
      latencyMs: 20,
    }));

    await maybeScheduleHiveAssistantReply(
      {
        hiveId: HIVE_ID,
        triggerMessage: questionMessage,
        authorRole: "owner",
        correlationId: CORRELATION_ID,
        userClient,
      },
      runModel,
    );

    const finishCall = finishRunRpcMock.mock.calls.find(([name]) => name === "finish_assistant_run")?.[1] as {
      p_body: string;
      p_source_refs: unknown[];
    };
    expect(finishCall.p_source_refs).toEqual([]);
    expect(finishCall.p_body).toContain("couldn't find that in the documents");
    expect(finishCall.p_body).not.toContain("10 mg");
  });

  it("does not allow older or rejected revisions to supply facts", async () => {
    const prep = mayaV6Preparation();
    getStudyPreparationMock.mockResolvedValue(prep);
    loadHiveOverviewMock.mockResolvedValue({ ...overviewPayload, preparation: prep });
    getStudyTabViewMock.mockResolvedValue({ canonicalStudy: null });

    const questionMessage = {
      ...triggerMessage,
      authorRole: "owner" as const,
      body: "How many speech therapy minutes were delivered?",
    };
    // Older revision: canonical_studies.current_revision_id points to v7 instead of v6
    const userClient = buildUserClientWithLegacyTables(questionMessage, {
      currentRevisionId: MAYA_V7_REV_ID,
    });

    const runModel = vi.fn(async () => ({
      ok: true as const,
      output: {
        intent: "answer",
        reply: "360 speech therapy minutes were delivered.",
        claims: [{ text: "360 speech therapy minutes were delivered.", factIds: ["P3.F0"] }],
      },
      modelId: "harvester",
      latencyMs: 15,
    }));

    await maybeScheduleHiveAssistantReply(
      {
        hiveId: HIVE_ID,
        triggerMessage: questionMessage,
        authorRole: "owner",
        correlationId: CORRELATION_ID,
        userClient,
      },
      runModel,
    );

    const sentBriefing = runModel.mock.calls[0]?.[0]?.briefing as unknown as AssistantBriefing;
    expect(sentBriefing.study.facts).toEqual([]);
    const finishCall = finishRunRpcMock.mock.calls.find(([name]) => name === "finish_assistant_run")?.[1] as {
      p_source_refs: unknown[];
      p_body: string;
    };
    expect(finishCall.p_source_refs).toEqual([]);
    expect(finishCall.p_body).toContain("couldn't find that in the documents");
    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.legacy_evidence_unavailable",
        errorCode: "revision_not_current",
      }),
    );
  });

  it("keeps canonical Maya's Hive 11/05 strictly canonical without touching legacy investigation tables", async () => {
    const canonical: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "Records review",
      spineSource: "ANCHOR",
      documents: [
        {
          sourceDocumentId: MAYA_DOCS.iep2025,
          role: "ANCHOR",
          typeInPlainWords: "2025 Plan Amendment",
          date: "2025-03-04",
          version: null,
          chainPosition: 1,
        },
      ],
      spine: [],
      outsideSpine: [{ id: "O1", statement: "Annual reading target is 90 words per minute", factIds: ["CF1"] }],
      conflicts: [],
      timeline: [],
      gaps: [],
    };
    const canonicalPrep = {
      studyRevision: {
        id: MAYA_1105_REV_ID,
        canonicalStudyId: CANONICAL_STUDY_ID,
        revisionNumber: 1,
        predecessorRevisionId: null,
        processingRunId: MAYA_RUN_ID,
        format: "canonical-study-1" as const,
        coverageComplete: true,
        coverageStatus: "COMPLETE",
        coverageGaps: [],
        coverageAcknowledgement: "NOT_REQUIRED",
        createdAt: "2026-11-05T00:00:00.000Z",
      },
      processingRun: null,
      reportRuns: [],
      eligibility: {
        documents: [
          {
            sourceDocumentId: MAYA_DOCS.iep2025,
            fileName: "maya-plan-2025.pdf",
            totalPhysicalPages: 1,
            readStatus: "SUCCEEDED",
          },
        ],
        excluded: [],
        coverageComplete: true,
      },
    };
    getStudyPreparationMock.mockResolvedValue(canonicalPrep);
    loadHiveOverviewMock.mockResolvedValue({
      ...overviewPayload,
      preparation: canonicalPrep,
      canonicalStudy: canonical,
      studyTab: {
        view: { schema: "hive.study-view/1", blocks: [], sections: [] },
        sources: {
          documents: {},
          facts: {
            CF1: {
              sourceDocumentId: MAYA_DOCS.iep2025,
              pageNumber: 1,
              quote: "90 words correct per minute",
            },
          },
        },
      },
    });
    getStudyTabViewMock.mockResolvedValue({ canonicalStudy: canonical });

    const schemaSpy = vi.fn(() => {
      throw new Error("canonical hive must not query legacy investigation tables");
    });
    const questionMessage = {
      ...triggerMessage,
      authorRole: "owner" as const,
      body: "What is the annual reading target?",
    };
    const userClient = buildUserClientWithLegacyTables(questionMessage, { schemaSpy });

    const runModel = vi.fn(async () => ({
      ok: true as const,
      output: {
        intent: "answer",
        reply: "The annual reading target is 90 words per minute.",
        claims: [{ text: "The annual reading target is 90 words per minute.", factIds: ["CF1"] }],
      },
      modelId: "harvester",
      latencyMs: 18,
    }));

    await maybeScheduleHiveAssistantReply(
      {
        hiveId: HIVE_ID,
        triggerMessage: questionMessage,
        authorRole: "owner",
        correlationId: CORRELATION_ID,
        userClient,
      },
      runModel,
    );

    expect(schemaSpy).not.toHaveBeenCalled();
    const sentBriefing = runModel.mock.calls[0]?.[0]?.briefing as unknown as AssistantBriefing;
    expect(sentBriefing.study.facts.map((f) => f.id)).toEqual(["CF1"]);
    expect(finishRunRpcMock).toHaveBeenCalledWith(
      "finish_assistant_run",
      expect.objectContaining({
        p_status: "answered",
        p_study_revision_id: MAYA_1105_REV_ID,
        p_source_refs: [
          expect.objectContaining({
            sourceDocumentId: MAYA_DOCS.iep2025,
            pageNumber: 1,
            shortLabel: "2025 Plan Amendment",
            factId: "CF1",
            studyRevisionId: MAYA_1105_REV_ID,
          }),
        ],
      }),
    );
  });

  it("answers navigation questions without citations on legacy Maya Study v6", async () => {
    const prep = mayaV6Preparation();
    getStudyPreparationMock.mockResolvedValue(prep);
    loadHiveOverviewMock.mockResolvedValue({ ...overviewPayload, preparation: prep });
    getStudyTabViewMock.mockResolvedValue({ canonicalStudy: null });

    const navMessage = {
      ...triggerMessage,
      authorRole: "owner" as const,
      body: "Where are my documents?",
    };
    const userClient = buildUserClientWithLegacyTables(navMessage);

    const runModel = vi.fn(async () => ({
      ok: true as const,
      output: { intent: "route_to_team", reply: "", claims: [] },
      modelId: "harvester",
      latencyMs: 10,
    }));

    await maybeScheduleHiveAssistantReply(
      {
        hiveId: HIVE_ID,
        triggerMessage: navMessage,
        authorRole: "owner",
        correlationId: CORRELATION_ID,
        userClient,
      },
      runModel,
    );

    expect(finishRunRpcMock).toHaveBeenCalledWith(
      "finish_assistant_run",
      expect.objectContaining({
        p_status: "answered",
        p_body: expect.stringContaining("Open Documents in the left menu"),
        p_source_refs: [],
      }),
    );
  });

  it("preserves private model-routing policy by skipping non-synthetic legacy hives without calling the model", async () => {
    createSupabaseAdminClientMock.mockReturnValue({
      rpc: finishRunRpcMock,
      schema: vi.fn(() => ({
        from: vi.fn((table: string) => {
          if (table === "hives") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  content_class: "real",
                  assistant_replies_on: true,
                  name: "Private Legacy Hive",
                  stage: null,
                  firm_id: null,
                },
                error: null,
              }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
          };
        }),
      })),
    } as unknown as SupabaseClient);

    const schemaSpy = vi.fn();
    const userClient = buildUserClientWithLegacyTables(triggerMessage, { schemaSpy });
    const runModel = vi.fn();

    await maybeScheduleHiveAssistantReply(
      {
        hiveId: HIVE_ID,
        triggerMessage,
        authorRole: "owner",
        correlationId: CORRELATION_ID,
        userClient,
      },
      runModel,
    );

    expect(runModel).not.toHaveBeenCalled();
    expect(schemaSpy).not.toHaveBeenCalled();
    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.skipped",
        errorCode: "not_synthetic",
      }),
    );
  });
});

describe("runHiveAssistantReply — P0.7-C1 pre-claim stage diagnostics", () => {
  const FIRM_ID = "22222222-2222-4222-8222-222222222222";
  const SECRET_MESSAGE_TEXT = "Confidential question about Maya's service delivery minutes";
  const SECRET_DOC_TEXT = "Verbatim document excerpt: Service minutes delivered 360";
  const SECRET_ENV_VALUE = "sbp_live_super_secret_env_value_99999";

  function buildPreClaimAdminClient(overrides?: {
    firmId?: string | null;
    hivesError?: unknown;
    firmsError?: unknown;
    rateLimitError?: unknown;
    runsCount?: number;
    claimError?: unknown;
    finishError?: unknown;
  }): SupabaseClient {
    const firmId = overrides?.firmId ?? FIRM_ID;
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_assistant_run") {
        if (overrides?.claimError !== undefined) throw overrides.claimError;
        return { data: { runId: RUN_ID, claimed: true }, error: null };
      }
      if (name === "finish_assistant_run") {
        if (overrides?.finishError !== undefined) throw overrides.finishError;
        return { data: null, error: null };
      }
      throw new Error(`unexpected admin rpc ${name}`);
    });

    return {
      rpc,
      schema: vi.fn((name: string) => {
        if (name !== "hive") throw new Error(`unexpected schema ${name}`);
        return {
          from: vi.fn((table: string) => {
            if (table === "hives") {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle:
                  overrides?.hivesError !== undefined
                    ? vi.fn().mockRejectedValue(overrides.hivesError)
                    : vi.fn().mockResolvedValue({
                        data: {
                          content_class: "synthetic",
                          assistant_replies_on: true,
                          name: "Maya's Hive",
                          stage: null,
                          firm_id: firmId,
                        },
                        error: null,
                      }),
              };
            }
            if (table === "firms") {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle:
                  overrides?.firmsError !== undefined
                    ? vi.fn().mockRejectedValue(overrides.firmsError)
                    : vi.fn().mockResolvedValue({ data: { assistant_name: "Maya Helper" }, error: null }),
              };
            }
            if (table === "assistant_runs") {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                gte:
                  overrides?.rateLimitError !== undefined
                    ? vi.fn().mockRejectedValue(overrides.rateLimitError)
                    : vi.fn().mockResolvedValue({ count: overrides?.runsCount ?? 0, error: null }),
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        };
      }),
    } as unknown as SupabaseClient;
  }

  function runInput(userClient = buildUserClient()) {
    return {
      hiveId: HIVE_ID,
      triggerMessage: { ...triggerMessage, body: SECRET_MESSAGE_TEXT },
      authorRole: "owner",
      correlationId: CORRELATION_ID,
      userClient,
    };
  }

  beforeEach(async () => {
    const actualRunner = await vi.importActual<typeof import("./hive-assistant-model-runner")>(
      "./hive-assistant-model-runner",
    );
    const actualTrigger = await vi.importActual<typeof import("./hive-assistant-trigger")>("./hive-assistant-trigger");

    emitStructuredEventMock.mockReset();
    loadSupabaseAdminEnvMock.mockReset();
    loadSupabaseAdminEnvMock.mockReturnValue({});
    createSupabaseAdminClientMock.mockReset();
    createSupabaseAdminClientMock.mockReturnValue(buildPreClaimAdminClient());
    createDefaultAssistantModelRunnerMock.mockReset();
    createDefaultAssistantModelRunnerMock.mockImplementation((...args) =>
      actualRunner.createDefaultAssistantModelRunner(...args),
    );
    shouldTriggerHiveAssistantMock.mockReset();
    shouldTriggerHiveAssistantMock.mockImplementation((...args) => actualTrigger.shouldTriggerHiveAssistant(...args));
  });

  it("distinguishes model runner initialization failure", async () => {
    createDefaultAssistantModelRunnerMock.mockImplementationOnce(() => {
      throw createHiveError({
        errorCode: "MODEL_UNAVAILABLE",
        category: "DEPENDENCY",
        stage: "ANALYZE",
        retryable: false,
        safeMessage: "Unavailable",
        correlationId: CORRELATION_ID,
        diagnosticReason: "planner_unconfigured",
      });
    });

    await runHiveAssistantReply(runInput());

    expect(loadSupabaseAdminEnvMock).not.toHaveBeenCalled();
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        severity: "ERROR",
        status: "FAILED",
        errorCode: "unexpected",
        diagnosticReason: "unexpected_exception",
        exceptionType: "HiveError",
        diagnosticField: "model_runner_init:HiveError:planner_unconfigured",
      }),
    );
  });

  it("distinguishes Supabase environment loading failure for missing secret or URL without logging env values", async () => {
    loadSupabaseAdminEnvMock.mockImplementationOnce(() => {
      throw new VaultAdminConfigError("vault_admin_secret_missing");
    });

    await runHiveAssistantReply(runInput());

    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        severity: "ERROR",
        status: "FAILED",
        errorCode: "unexpected",
        diagnosticReason: "vault_admin_secret_missing",
        exceptionType: "VaultAdminConfigError",
        diagnosticField: "supabase_env_load:VaultAdminConfigError:vault_admin_secret_missing",
      }),
    );

    emitStructuredEventMock.mockReset();
    loadSupabaseAdminEnvMock.mockImplementationOnce(() => {
      throw new VaultAdminConfigError("vault_admin_url_missing");
    });

    await runHiveAssistantReply(runInput());

    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        errorCode: "unexpected",
        diagnosticReason: "vault_admin_url_missing",
        exceptionType: "VaultAdminConfigError",
        diagnosticField: "supabase_env_load:VaultAdminConfigError:vault_admin_url_missing",
      }),
    );
  });

  it("distinguishes admin client creation failure without logging secrets or URLs", async () => {
    const err = Object.assign(
      new TypeError(`Invalid URL https://secret-project.supabase.co key=${SECRET_ENV_VALUE}`),
      { code: "ERR_INVALID_URL" },
    );
    createSupabaseAdminClientMock.mockImplementationOnce(() => {
      throw err;
    });

    await runHiveAssistantReply(runInput());

    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        errorCode: "unexpected",
        diagnosticReason: "unexpected_exception",
        exceptionType: "TypeError",
        diagnosticField: "admin_client_create:TypeError:ERR_INVALID_URL",
      }),
    );
    const serialized = JSON.stringify(emitStructuredEventMock.mock.calls);
    expect(serialized).not.toContain(SECRET_ENV_VALUE);
    expect(serialized).not.toContain("secret-project.supabase.co");
    expect(serialized).not.toContain(SECRET_MESSAGE_TEXT);
  });

  it("distinguishes hive flags query failure and captures sanitized nested cause code", async () => {
    const networkErr = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error(`getaddrinfo ENOTFOUND secret.internal ${SECRET_DOC_TEXT}`), {
        code: "ENOTFOUND",
      }),
    });
    createSupabaseAdminClientMock.mockReturnValue(buildPreClaimAdminClient({ hivesError: networkErr }));

    await runHiveAssistantReply(runInput());

    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        errorCode: "unexpected",
        exceptionType: "TypeError",
        diagnosticField: "hive_flags_query:TypeError:ENOTFOUND",
      }),
    );
    const serialized = JSON.stringify(emitStructuredEventMock.mock.calls);
    expect(serialized).not.toContain(SECRET_DOC_TEXT);
    expect(serialized).not.toContain("secret.internal");
  });

  it("distinguishes assistant name lookup failure", async () => {
    const err = Object.assign(new Error(`Connection reset while reading ${SECRET_MESSAGE_TEXT}`), {
      code: "ECONNRESET",
    });
    createSupabaseAdminClientMock.mockReturnValue(buildPreClaimAdminClient({ firmsError: err }));

    await runHiveAssistantReply(runInput());

    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        errorCode: "unexpected",
        exceptionType: "Error",
        diagnosticField: "assistant_name_lookup:Error:ECONNRESET",
      }),
    );
    expect(JSON.stringify(emitStructuredEventMock.mock.calls)).not.toContain(SECRET_MESSAGE_TEXT);
  });

  it("distinguishes rate-limit lookup failure", async () => {
    const timeoutErr = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    });
    createSupabaseAdminClientMock.mockReturnValue(buildPreClaimAdminClient({ rateLimitError: timeoutErr }));

    await runHiveAssistantReply(runInput());

    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        errorCode: "unexpected",
        exceptionType: "TypeError",
        diagnosticField: "rate_limit_lookup:TypeError:UND_ERR_CONNECT_TIMEOUT",
      }),
    );
  });

  it("distinguishes trigger evaluation failure", async () => {
    shouldTriggerHiveAssistantMock.mockImplementationOnce(() => {
      throw new RangeError(`trigger evaluation crashed on: ${SECRET_MESSAGE_TEXT}`);
    });

    await runHiveAssistantReply(runInput());

    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        errorCode: "unexpected",
        exceptionType: "RangeError",
        diagnosticField: "trigger_eval:RangeError",
      }),
    );
    expect(JSON.stringify(emitStructuredEventMock.mock.calls)).not.toContain(SECRET_MESSAGE_TEXT);
  });

  it("distinguishes assistant run claim failure for both Postgres error objects and AbortError", async () => {
    createSupabaseAdminClientMock.mockReturnValue(
      buildPreClaimAdminClient({
        claimError: {
          code: "42501",
          message: `permission denied for claim_assistant_run: ${SECRET_MESSAGE_TEXT}`,
          details: `Bearer ${SECRET_ENV_VALUE}`,
        },
      }),
    );

    await runHiveAssistantReply(runInput());

    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        errorCode: "unexpected",
        exceptionType: "Unknown",
        diagnosticField: "assistant_run_claim:Unknown:42501",
      }),
    );
    const firstSerialized = JSON.stringify(emitStructuredEventMock.mock.calls);
    expect(firstSerialized).not.toContain(SECRET_MESSAGE_TEXT);
    expect(firstSerialized).not.toContain(SECRET_ENV_VALUE);

    emitStructuredEventMock.mockReset();
    createSupabaseAdminClientMock.mockReturnValue(
      buildPreClaimAdminClient({
        claimError: new DOMException(`aborted: ${SECRET_DOC_TEXT}`, "AbortError"),
      }),
    );

    await runHiveAssistantReply(runInput());

    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        errorCode: "unexpected",
        exceptionType: "AbortError",
        diagnosticField: "assistant_run_claim:AbortError",
      }),
    );
    expect(JSON.stringify(emitStructuredEventMock.mock.calls)).not.toContain(SECRET_DOC_TEXT);
  });

  it("keeps post-claim uncaught failures labeled as finish rather than a pre-claim stage", async () => {
    createSupabaseAdminClientMock.mockReturnValue(
      buildPreClaimAdminClient({
        runsCount: 25,
        finishError: Object.assign(new Error("connection dropped"), { code: "08006" }),
      }),
    );

    await runHiveAssistantReply(runInput());

    expect(emitStructuredEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "hive.assistant.failed",
        errorCode: "unexpected",
        exceptionType: "Error",
        diagnosticField: "finish:Error:08006",
      }),
    );
  });

  it("sanitizes sensitive exception names/codes and passes real structured logger validation without leaking secrets", async () => {
    const actualLogger = await vi.importActual<typeof import("@/server/observability/logger")>(
      "@/server/observability/logger",
    );

    const poisonedError = Object.assign(
      new Error(`SUPABASE_SECRET_KEY=${SECRET_ENV_VALUE} body=${SECRET_MESSAGE_TEXT} doc=${SECRET_DOC_TEXT}`),
      {
        name: "SecretTokenError",
        code: "invalid_token_secret",
      },
    );
    createSupabaseAdminClientMock.mockImplementationOnce(() => {
      throw poisonedError;
    });

    await runHiveAssistantReply(runInput());

    const emittedEvent = emitStructuredEventMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(emittedEvent).toBeDefined();
    expect(emittedEvent.diagnosticField).toBe("admin_client_create:Error");
    expect(emittedEvent.exceptionType).toBe("Error");
    expect(emittedEvent).not.toHaveProperty("errorDetail");

    // Verify the exact event passes the real structured logger without throwing and without leaks.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(() => actualLogger.emitStructuredEvent(emittedEvent)).not.toThrow();
      const line = String(logSpy.mock.calls[0]?.[0]);
      expect(line).toContain("admin_client_create:Error");
      expect(line).not.toContain(SECRET_ENV_VALUE);
      expect(line).not.toContain(SECRET_MESSAGE_TEXT);
      expect(line).not.toContain(SECRET_DOC_TEXT);
      expect(line.toLowerCase()).not.toContain("token");
      expect(line.toLowerCase()).not.toContain("secret");
    } finally {
      logSpy.mockRestore();
    }

    // Also verify VaultAdminConfigError events pass the real structured logger cleanly.
    emitStructuredEventMock.mockReset();
    loadSupabaseAdminEnvMock.mockImplementationOnce(() => {
      throw new VaultAdminConfigError("vault_admin_secret_missing");
    });
    await runHiveAssistantReply(runInput());
    const vaultEvent = emitStructuredEventMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const vaultLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(() => actualLogger.emitStructuredEvent(vaultEvent)).not.toThrow();
      const parsed = JSON.parse(String(vaultLogSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(parsed.diagnosticField).toBe("supabase_env_load:VaultAdminConfigError:vault_admin_secret_missing");
      expect(parsed.exceptionType).toBe("VaultAdminConfigError");
      expect(parsed.diagnosticReason).toBe("vault_admin_secret_missing");
    } finally {
      vaultLogSpy.mockRestore();
    }

    expect(ASSISTANT_PRE_CLAIM_STAGES).toEqual([
      "model_runner_init",
      "supabase_env_load",
      "admin_client_create",
      "hive_flags_query",
      "assistant_name_lookup",
      "rate_limit_lookup",
      "trigger_eval",
      "assistant_run_claim",
    ]);
  });
});