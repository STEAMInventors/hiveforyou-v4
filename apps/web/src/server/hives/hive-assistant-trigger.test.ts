import { describe, expect, it } from "vitest";

import { shouldTriggerHiveAssistant, staffMessageAddressesAssistant } from "./hive-assistant-trigger";

const baseMessage = {
  id: "1",
  authorKind: "person" as const,
  authorRole: "client" as const,
  authorUserId: null,
  authorDisplayName: "Client",
  authorRoleLabel: "Client",
  isMine: false,
  body: "Hello",
  sourceRefs: [],
  replyToMessageId: null,
  createdAt: new Date().toISOString(),
};

describe("shouldTriggerHiveAssistant", () => {
  it("triggers for clients on synthetic hives only when replies are on", () => {
    expect(
      shouldTriggerHiveAssistant({
        hive: { contentClass: "synthetic", assistantRepliesOn: true },
        message: baseMessage,
        authorRole: "client",
        assistantName: "Sam",
        runsInLastHour: 0,
      }).trigger,
    ).toBe(true);
    expect(
      shouldTriggerHiveAssistant({
        hive: { contentClass: "real", assistantRepliesOn: true },
        message: baseMessage,
        authorRole: "client",
        assistantName: "Sam",
        runsInLastHour: 0,
      }).trigger,
    ).toBe(false);
  });

  it("requires staff messages to name the assistant and skips when rate limited", () => {
    expect(
      shouldTriggerHiveAssistant({
        hive: { contentClass: "synthetic", assistantRepliesOn: true },
        message: { ...baseMessage, body: "Sam, what is in the notice?" },
        authorRole: "staff",
        assistantName: "Sam",
        runsInLastHour: 0,
      }).trigger,
    ).toBe(true);
    expect(
      shouldTriggerHiveAssistant({
        hive: { contentClass: "synthetic", assistantRepliesOn: true },
        message: { ...baseMessage, body: "What is in the notice?" },
        authorRole: "staff",
        assistantName: "Sam",
        runsInLastHour: 0,
      }).trigger,
    ).toBe(false);
    expect(
      shouldTriggerHiveAssistant({
        hive: { contentClass: "synthetic", assistantRepliesOn: true },
        message: baseMessage,
        authorRole: "client",
        assistantName: "Sam",
        runsInLastHour: 20,
      }).skipReason,
    ).toBe("rate_limited");
  });

  it("never triggers on assistant messages", () => {
    expect(
      shouldTriggerHiveAssistant({
        hive: { contentClass: "synthetic", assistantRepliesOn: true },
        message: { ...baseMessage, authorKind: "assistant", authorRole: "assistant" },
        authorRole: "assistant",
        assistantName: "Sam",
        runsInLastHour: 0,
      }).trigger,
    ).toBe(false);
  });
});

describe("staffMessageAddressesAssistant", () => {
  it("matches at start or after @", () => {
    expect(staffMessageAddressesAssistant("Sam what is this?", "Sam")).toBe(true);
    expect(staffMessageAddressesAssistant("@Sam what is this?", "Sam")).toBe(true);
    expect(staffMessageAddressesAssistant("Please ask Sam later", "Sam")).toBe(false);
  });
});