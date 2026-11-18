import type { HiveMessage } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import {
  bylineRole,
  firstUnreadMessageId,
  mergeMessages,
  messageDayLabel,
  messageTimeLabel,
  participantLine,
  showsAsMine,
} from "./hive-conversation-view";

function message(overrides: Partial<HiveMessage> & Pick<HiveMessage, "id" | "createdAt">): HiveMessage {
  return {
    authorKind: "person",
    authorRole: "client",
    authorUserId: "u",
    authorDisplayName: "Ruth Ortiz",
    authorRoleLabel: "Client",
    isMine: false,
    body: "Hello",
    sourceRefs: [],
    replyToMessageId: null,
    ...overrides,
  };
}

describe("hive conversation view helpers", () => {
  it("merges by id, oldest first, ties by id", () => {
    const a = message({ id: "a", createdAt: "2026-11-18T10:00:00Z" });
    const b = message({ id: "b", createdAt: "2026-11-18T10:00:00Z" });
    const c = message({ id: "c", createdAt: "2026-11-18T11:00:00Z" });
    const updatedA = { ...a, body: "Edited copy from the server" };
    expect(mergeMessages([c, a], [b, updatedA]).map((m) => [m.id, m.body])).toEqual([
      ["a", "Edited copy from the server"],
      ["b", "Hello"],
      ["c", "Hello"],
    ]);
  });

  it("aligns own messages for the viewer and client messages in Preview as Client", () => {
    const staffOwn = message({ id: "s", createdAt: "2026-11-18T10:00:00Z", authorRole: "staff", isMine: true });
    const client = message({ id: "c", createdAt: "2026-11-18T10:01:00Z" });
    expect(showsAsMine(staffOwn, "self")).toBe(true);
    expect(showsAsMine(client, "self")).toBe(false);
    expect(showsAsMine(staffOwn, "client")).toBe(false);
    expect(showsAsMine(client, "client")).toBe(true);
  });

  it("finds the first unread message from someone else", () => {
    const list = [
      message({ id: "1", createdAt: "2026-11-18T09:00:00Z" }),
      message({ id: "2", createdAt: "2026-11-18T10:00:00Z", isMine: true }),
      message({ id: "3", createdAt: "2026-11-18T11:00:00Z" }),
    ];
    expect(firstUnreadMessageId(list, "2026-11-18T09:30:00Z")).toBe("3");
    expect(firstUnreadMessageId(list, null)).toBe("1");
    expect(firstUnreadMessageId(list, "2026-11-18T12:00:00Z")).toBeNull();
  });

  it("labels days as Today, Yesterday or a short date", () => {
    const now = new Date(2026, 10, 18, 15, 0);
    expect(messageDayLabel(new Date(2026, 10, 18, 8, 0).toISOString(), now)).toBe("Today");
    expect(messageDayLabel(new Date(2026, 10, 17, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(messageDayLabel(new Date(2026, 10, 12, 9, 0).toISOString(), now)).toBe("Nov 12");
    expect(messageDayLabel(new Date(2025, 10, 12, 9, 0).toISOString(), now)).toBe("Nov 12, 2025");
  });

  it("formats times like 9:14 AM", () => {
    expect(messageTimeLabel(new Date(2026, 10, 18, 9, 14).toISOString())).toBe("9:14 AM");
    expect(messageTimeLabel(new Date(2026, 10, 18, 15, 5).toISOString())).toBe("3:05 PM");
  });

  it("builds the participant line", () => {
    expect(participantLine(["Client", "Onboarding associate", "Attorney"], 3)).toBe(
      "Client · Onboarding associate · Attorney",
    );
    expect(participantLine(["Owner"], 1)).toBe("Only you so far.");
  });

  it("omits a byline role that repeats the name", () => {
    expect(bylineRole(message({ id: "x", createdAt: "2026-11-18T10:00:00Z" }))).toBe("Client");
    expect(
      bylineRole(
        message({
          id: "y",
          createdAt: "2026-11-18T10:00:00Z",
          authorKind: "assistant",
          authorRole: "assistant",
          authorDisplayName: "HiveForYou",
          authorRoleLabel: "HiveForYou",
        }),
      ),
    ).toBeNull();
  });
});
