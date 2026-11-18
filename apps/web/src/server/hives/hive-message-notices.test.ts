import { afterEach, describe, expect, it, vi } from "vitest";

import { renderHiveMessageNoticeEmail } from "@/server/email/hive-message-notice-template";

import { sendHiveMessageNotices, type HiveMessageNoticeDeps } from "./hive-message-notices";

const URL = "https://app.example.test/hives/11111111-1111-4111-8111-111111111111/board";

function fakeDeps(addresses: Record<string, string | null>) {
  const send = vi.fn().mockResolvedValue(undefined);
  const deps: HiveMessageNoticeDeps = {
    emailForUser: async (userId) => addresses[userId] ?? null,
    sender: () => ({ send }),
  };
  return { deps, send };
}

describe("renderHiveMessageNoticeEmail", () => {
  it("names the hive, links the board and escapes html", () => {
    const rendered = renderHiveMessageNoticeEmail({ hiveName: "Ortiz <family>", conversationUrl: URL });
    expect(rendered.subject).toBe("New message in your hive");
    expect(rendered.text).toContain("There's a new message in Ortiz <family>.");
    expect(rendered.text).toContain(URL);
    expect(rendered.html).toContain("Ortiz &lt;family&gt;");
    expect(rendered.html).not.toContain("<family>");
    expect(rendered.html).toContain("Open the conversation");
    expect(rendered.html).toContain(`href="${URL}"`);
  });
});

describe("sendHiveMessageNotices", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends one notice per user id and nothing else", async () => {
    const { deps, send } = fakeDeps({ a: "a@example.test", b: "b@example.test", c: "c@example.test" });
    const result = await sendHiveMessageNotices(
      { userIds: ["a", "b"], hiveName: "Ortiz family", conversationUrl: URL, correlationId: "corr" },
      deps,
    );
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(send.mock.calls.map((call) => call[0].to).sort()).toEqual(["a@example.test", "b@example.test"]);
  });

  it("does nothing for an empty list", async () => {
    const { deps, send } = fakeDeps({});
    expect(
      await sendHiveMessageNotices({ userIds: [], hiveName: "x", conversationUrl: URL, correlationId: "c" }, deps),
    ).toEqual({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("counts failures and logs only the count and correlation id", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { deps, send } = fakeDeps({ a: "a@example.test", b: null });
    send.mockRejectedValueOnce(new Error("down"));
    const result = await sendHiveMessageNotices(
      { userIds: ["a", "b"], hiveName: "Ortiz family", conversationUrl: URL, correlationId: "corr-1" },
      deps,
    );
    expect(result).toEqual({ sent: 0, failed: 2 });
    const lines = log.mock.calls.map((call) => String(call[0]));
    const event = JSON.parse(lines.find((line) => line.includes("hive.message.notice_failed"))!);
    expect(event).toMatchObject({ correlationId: "corr-1", totalCount: 2, diagnosticReason: "notice_email_failed" });
    expect(lines.join("\n")).not.toContain("@example.test");
  });
});
