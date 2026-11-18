import {
  createHiveError,
  normalizeGapTitle,
  normalizeListFirmResponse,
  normalizeListRequestsResponse,
  packChecklistItems,
  toPublicErrorResponse,
  type Hive,
  type PublicErrorBody,
} from "@hiveforyou/contracts";

type PublicErrorDetails = PublicErrorBody["error"];
import type { SupabaseClient } from "@supabase/supabase-js";

import { generateInviteToken } from "@/server/hives/invite-token";
import { sendInvitationEmail } from "@/server/hives/send-invitation-email";
import { loadPackEntries } from "@/server/pipeline/pack-loader";

export type NewClientFlowItem = {
  title: string;
  custom: boolean;
};

export type NewClientFlowInput = {
  name: string;
  email?: string;
  professionalText?: string;
  packId: string | null;
  items: NewClientFlowItem[];
  mode: "invite" | "documents";
  clientRequestId: string;
};

export type NewClientFlowStep = "hive" | "checklist" | "invitation" | "team_note";

export type NewClientFlowSuccess = {
  ok: true;
  hiveId: string;
  hiveName: string;
  mode: "invite" | "documents";
  requestedItemCount: number;
};

export type NewClientFlowPartial = {
  ok: false;
  hiveId: string;
  completed: NewClientFlowStep[];
  failedStep: NewClientFlowStep;
  error: PublicErrorDetails;
};

function isAuthDeniedMessage(message: string): boolean {
  const lowered = message.toLowerCase();
  return lowered.includes("access_denied") || lowered.includes("auth_required");
}

function parseHiveRow(data: unknown): Hive | null {
  if (!data || typeof data !== "object") return null;
  const hive = (data as { hive?: unknown }).hive;
  if (!hive || typeof hive !== "object") return null;
  const row = hive as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  return row as unknown as Hive;
}

async function ensureFirmStaff(client: SupabaseClient, correlationId: string): Promise<{ firmName: string | null }> {
  const { data, error } = await client.rpc("list_firm");
  if (error) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      retryable: true,
      safeMessage: "Could not verify your firm. Try again.",
      correlationId,
      diagnosticReason: "list_firm_failed",
      cause: error,
    });
  }
  const firm = normalizeListFirmResponse(data);
  if (!firm?.firm) {
    throw createHiveError({
      errorCode: "ACCESS_DENIED",
      category: "SECURITY",
      stage: "SHELL",
      retryable: false,
      safeMessage: "Only firm staff can start a client hive this way.",
      correlationId,
      diagnosticReason: "no_active_firm",
    });
  }
  return { firmName: firm.firm.name };
}

function resolvePack(packId: string) {
  const { entries } = loadPackEntries();
  return entries.find((entry) => entry.id === packId)?.pack ?? null;
}

type RpcChecklistItem = { key: string; title: string; detail: string | null; position: number };

export function buildStartChecklistPayload(
  packId: string,
  items: NewClientFlowItem[],
  correlationId: string,
): { packVersion: number; rpcItems: RpcChecklistItem[]; customsForAdd: NewClientFlowItem[] } {
  const pack = resolvePack(packId);
  if (!pack) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: "That matter type is not available.",
      correlationId,
      diagnosticReason: "unknown_pack",
    });
  }
  const packRows = new Map(packChecklistItems(pack).map((row) => [row.key, row]));
  const packItems: RpcChecklistItem[] = [];
  const customsForAdd: NewClientFlowItem[] = [];

  for (const item of items) {
    const title = item.title.replace(/\s+/g, " ").trim();
    if (title === "") continue;
    const derivedKey = normalizeGapTitle(title);
    if (item.custom) {
      customsForAdd.push({ title, custom: true });
      continue;
    }
    const packRow = packRows.get(derivedKey);
    if (!packRow || packRow.title.toLowerCase() !== title.toLowerCase()) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "That checklist item is not in this matter pack.",
        correlationId,
        diagnosticReason: "unknown_pack_item",
      });
    }
    packItems.push({
      key: derivedKey,
      title: packRow.title,
      detail: packRow.detail,
      position: packItems.length + 1,
    });
  }

  if (packItems.length === 0 && customsForAdd.length > 0) {
    const rpcItems = customsForAdd.map((item, index) => ({
      key: normalizeGapTitle(item.title),
      title: item.title.trim(),
      detail: null,
      position: index + 1,
    }));
    return { packVersion: pack.meta.version, rpcItems, customsForAdd: [] };
  }

  return { packVersion: pack.meta.version, rpcItems: packItems, customsForAdd };
}

async function saveProfessionalTeamNote(
  client: SupabaseClient,
  hiveId: string,
  body: string,
  clientRequestId: string,
): Promise<void> {
  const { error } = await client.rpc("add_team_note", {
    p_hive_id: hiveId,
    p_body: body,
    p_client_request_id: clientRequestId,
  });
  if (error) throw error;
}

async function addCustomItems(
  client: SupabaseClient,
  hiveId: string,
  customItems: NewClientFlowItem[],
): Promise<void> {
  if (customItems.length === 0) return;
  const listed = await client.rpc("list_requests", { p_hive_id: hiveId });
  const existing = normalizeListRequestsResponse(listed.data);
  const titles = new Set((existing?.requests ?? []).map((row) => row.title.trim().toLowerCase()));
  for (const item of customItems) {
    const title = item.title.trim();
    if (titles.has(title.toLowerCase())) continue;
    const { error } = await client.rpc("add_request", { p_hive_id: hiveId, p_title: title, p_detail: null });
    if (error) throw error;
    titles.add(title.toLowerCase());
  }
}

async function runInvitationStep(
  client: SupabaseClient,
  input: {
    hiveId: string;
    email: string;
    hiveName: string;
    inviterName: string;
    firmName: string | null;
    requestedItemCount: number;
    inviteBaseUrl: string;
    correlationId: string;
  },
): Promise<void> {
  const { token, tokenHash } = generateInviteToken();
  const { data, error } = await client.rpc("create_invitation", {
    p_hive_id: input.hiveId,
    p_email: input.email,
    p_role: "client",
    p_token_hash: tokenHash,
  });
  if (error) {
    const message = String(error.message ?? "");
    const lowered = message.toLowerCase();
    if (lowered.includes("invitation_already_open")) {
      return;
    }
    throw error;
  }
  const inviteUrl = `${input.inviteBaseUrl.replace(/\/$/, "")}/invite/${token}`;
  const displayName = input.firmName?.trim() || input.inviterName;
  try {
    await sendInvitationEmail({
      role: "client",
      toEmail: input.email,
      inviteUrl,
      ownerOrProfessionalName: displayName,
      hiveName: input.hiveName,
      requestedItemCount: input.requestedItemCount,
    });
  } catch (sendError) {
    const invitationId =
      data && typeof data === "object" && !Array.isArray(data) && typeof (data as { invitationId?: unknown }).invitationId === "string"
        ? String((data as { invitationId: string }).invitationId)
        : null;
    if (invitationId) {
      try {
        await client.rpc("revoke_invitation", { p_invitation_id: invitationId });
      } catch {
        // keep send failure
      }
    }
    throw sendError;
  }
}

export async function runNewClientFlow(
  client: SupabaseClient,
  flow: NewClientFlowInput,
  context: { correlationId: string; inviterName: string; inviteBaseUrl: string },
): Promise<NewClientFlowSuccess | NewClientFlowPartial> {
  const completed: NewClientFlowStep[] = [];
  let hiveId = "";
  let hiveName = flow.name.trim();
  let activeStep: NewClientFlowStep = "hive";
  let packTitleForConflict: string | null = null;

  try {
    const { firmName } = await ensureFirmStaff(client, context.correlationId);

    const { data: hiveData, error: hiveError } = await client.rpc("create_hive", {
      p_name: flow.name.trim(),
      p_description: null,
      p_client_request_id: flow.clientRequestId,
      p_kind: "client",
    });

    if (hiveError) {
      const message = String(hiveError.message ?? "");
      throw createHiveError({
        errorCode: isAuthDeniedMessage(message) ? "ACCESS_DENIED" : "PERSISTENCE_FAILED",
        category: isAuthDeniedMessage(message) ? "SECURITY" : "PERSISTENCE",
        stage: "SHELL",
        retryable: !isAuthDeniedMessage(message),
        safeMessage: isAuthDeniedMessage(message)
          ? "Only firm staff can start a client hive this way."
          : "Could not create this hive. Try again.",
        correlationId: context.correlationId,
        diagnosticReason: "create_hive_failed",
        cause: hiveError,
      });
    }

    const hive = parseHiveRow(hiveData);
    if (!hive) {
      throw createHiveError({
        errorCode: "PERSISTENCE_FAILED",
        category: "PERSISTENCE",
        stage: "SHELL",
        retryable: true,
        safeMessage: "Could not create this hive. Try again.",
        correlationId: context.correlationId,
        diagnosticReason: "create_hive_invalid_response",
      });
    }
    hiveId = hive.id;
    hiveName = hive.name;
    completed.push("hive");

    const professionalText = flow.professionalText?.replace(/\s+/g, " ").trim();
    if (professionalText && firmName) {
      activeStep = "team_note";
      await saveProfessionalTeamNote(client, hiveId, professionalText, flow.clientRequestId);
      completed.push("team_note");
    }

    const ticked = flow.items;
    const requestedItemCount = ticked.length;

    if (flow.packId) {
      activeStep = "checklist";
      const chosen = resolvePack(flow.packId);
      if (!chosen) {
        throw createHiveError({
          errorCode: "INVALID_REQUEST",
          category: "VALIDATION",
          stage: "SHELL",
          retryable: false,
          safeMessage: "That matter type is not available.",
          correlationId: context.correlationId,
          diagnosticReason: "unknown_pack",
        });
      }
      packTitleForConflict = chosen.meta.title;
      const { packVersion, rpcItems, customsForAdd } = buildStartChecklistPayload(
        flow.packId,
        ticked,
        context.correlationId,
      );
      if (rpcItems.length > 0) {
        const { error: checklistError } = await client.rpc("start_checklist", {
          p_hive_id: hiveId,
          p_pack_id: flow.packId,
          p_pack_version: packVersion,
          p_items: rpcItems,
        });
        if (checklistError) {
          const message = String(checklistError.message ?? "");
          if (message.toLowerCase().includes("pack_conflict")) {
            throw createHiveError({
              errorCode: "INVALID_REQUEST",
              category: "VALIDATION",
              stage: "SHELL",
              retryable: false,
              safeMessage: `This hive already has a checklist for ${packTitleForConflict}.`,
              correlationId: context.correlationId,
              diagnosticReason: "pack_conflict",
              cause: checklistError,
            });
          }
          throw checklistError;
        }
      }
      await addCustomItems(client, hiveId, customsForAdd);
      completed.push("checklist");
    }

    if (flow.mode === "invite") {
      activeStep = "invitation";
      const email = flow.email?.trim().toLowerCase();
      if (!email) {
        throw createHiveError({
          errorCode: "INVALID_REQUEST",
          category: "VALIDATION",
          stage: "SHELL",
          retryable: false,
          safeMessage: "Enter a valid email address.",
          correlationId: context.correlationId,
          diagnosticReason: "missing_email",
        });
      }
      await runInvitationStep(client, {
        hiveId,
        email,
        hiveName,
        inviterName: context.inviterName,
        firmName,
        requestedItemCount,
        inviteBaseUrl: context.inviteBaseUrl,
        correlationId: context.correlationId,
      });
      completed.push("invitation");
    }

    return { ok: true, hiveId, hiveName, mode: flow.mode, requestedItemCount };
  } catch (error) {
    const hiveError = error && typeof error === "object" && "errorCode" in error ? (error as ReturnType<typeof createHiveError>) : null;
    const publicBody = toPublicErrorResponse(
      hiveError ??
        createHiveError({
          errorCode: "INTERNAL_ERROR",
          category: "INTERNAL",
          stage: "SHELL",
          retryable: true,
          safeMessage: "Something went wrong.",
          correlationId: context.correlationId,
          diagnosticReason: "new_client_flow_failed",
          cause: error,
        }),
    );
    const failedStep = activeStep;
    if (!hiveId && completed.length === 0) {
      return {
        ok: false,
        hiveId: "",
        completed,
        failedStep: "hive",
        error: publicBody.error,
      };
    }
    return { ok: false, hiveId, completed, failedStep, error: publicBody.error };
  }
}