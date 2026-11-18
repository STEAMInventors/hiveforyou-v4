import { loadSupabaseAdminEnv } from "@hives/persistence/env";
import { createSupabaseAdminClient } from "@hives/persistence/storage/supabase-client";

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
