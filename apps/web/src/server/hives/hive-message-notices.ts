import { loadSupabaseAdminEnv } from "@hives/persistence/env";
import { createSupabaseAdminClient } from "@hives/persistence/storage/supabase-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import { hiveHomePath } from "@/lib/hive-routes";
import { resolveEmailSender, type EmailSender } from "@/server/email";
import { renderHiveMessageNoticeEmail } from "@/server/email/hive-message-notice-template";
import { emitStructuredEvent } from "@/server/observability/logger";

export type HiveMessageNoticeDeps = {
  /** Resolves a participant's address on the server. Returns null when there is none. */
  emailForUser: (userId: string) => Promise<string | null>;
  sender: () => EmailSender;
};

export function liveHiveMessageNoticeDeps(): HiveMessageNoticeDeps {
  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  return {
    emailForUser: async (userId) => {
      admin ??= createSupabaseAdminClient(loadSupabaseAdminEnv(process.env));
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error) throw error;
      const email = data.user?.email?.trim();
      return email ? email : null;
    },
    sender: resolveEmailSender,
  };
}

function resolvePublicBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

async function loadHiveName(client: SupabaseClient, hiveId: string): Promise<string> {
  try {
    const { data } = await client.rpc("get_hive", { p_hive_id: hiveId });
    const name = data && typeof data === "object" ? (data as { name?: unknown }).name : undefined;
    return typeof name === "string" && name.trim() ? name.trim() : "your hive";
  } catch {
    return "your hive";
  }
}

/** Hive name and Home link for a people-channel notice. */
export async function hiveMessageNoticeTarget(
  client: SupabaseClient,
  request: NextRequest,
  hiveId: string,
): Promise<{ hiveName: string; conversationUrl: string }> {
  return {
    hiveName: await loadHiveName(client, hiveId),
    conversationUrl: `${resolvePublicBaseUrl(request)}${hiveHomePath(hiveId)}`,
  };
}

/**
 * Sends one notice per user. Failures are counted and logged once; they never reach the caller.
 * The log carries the correlation id and a count only.
 */
export async function sendHiveMessageNotices(
  input: { userIds: readonly string[]; hiveName: string; conversationUrl: string; correlationId: string },
  deps: HiveMessageNoticeDeps = liveHiveMessageNoticeDeps(),
): Promise<{ sent: number; failed: number }> {
  if (input.userIds.length === 0) return { sent: 0, failed: 0 };
  const rendered = renderHiveMessageNoticeEmail({ hiveName: input.hiveName, conversationUrl: input.conversationUrl });

  const results = await Promise.allSettled(
    input.userIds.map(async (userId) => {
      const to = await deps.emailForUser(userId);
      if (!to) throw new Error("no_address");
      await deps.sender().send({ to, subject: rendered.subject, text: rendered.text, html: rendered.html });
    }),
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    emitStructuredEvent({
      eventName: "hive.message.notice_failed",
      severity: "WARN",
      timestamp: new Date().toISOString(),
      component: "hives",
      operation: "hive_message_notice",
      stage: "SHELL",
      correlationId: input.correlationId,
      totalCount: failed,
      diagnosticReason: "notice_email_failed",
    });
  }
  return { sent: results.length - failed, failed };
}
