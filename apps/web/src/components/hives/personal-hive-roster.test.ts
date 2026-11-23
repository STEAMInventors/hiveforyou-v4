import { describe, expect, it } from "vitest";

import { personalBoardRole, personalHiveRoster, proConversationClosedReason } from "./personal-hive-roster";

describe("personalHiveRoster", () => {
  it("keeps the shared channel closed until a professional has joined", () => {
    const invited = personalHiveRoster({
      people: [{ role: "owner", displayName: "Maya", state: "active", joined: true }],
      pendingInvitations: [{ email: "pro@example.test", role: "professional" }],
    });
    expect(invited.professionalJoined).toBe(false);
    expect(proConversationClosedReason(invited, "owner")).toMatch(/pro@example.test is invited/);

    const accepted = personalHiveRoster({
      people: [
        { role: "owner", displayName: "Maya", state: "active", joined: true },
        { role: "professional", displayName: "Pat Pro", state: "pending", joined: false },
      ],
      pendingInvitations: [],
    });
    expect(accepted.professionalJoined).toBe(false);
    expect(proConversationClosedReason(accepted, "owner")).toMatch(/Pat Pro accepted the invite/);

    const joined = personalHiveRoster({
      people: [
        { role: "owner", displayName: "Maya", state: "active", joined: true },
        { role: "professional", displayName: "Pat Pro", state: "active", joined: true },
      ],
      pendingInvitations: [],
    });
    expect(joined.professionalJoined).toBe(true);
    expect(proConversationClosedReason(joined, "owner")).toBeNull();
    expect(proConversationClosedReason(invited, "professional")).toBeNull();
    expect(proConversationClosedReason(accepted, "professional", false)).toMatch(/haven't joined/);
  });

  it("reads the signed-in membership even when the hive card has another role", () => {
    const roster = personalHiveRoster(
      {
        people: [
          { userId: "AAA", role: "owner", displayName: "Aryya", state: "active", joined: true },
          { userId: "BBB", role: "professional", displayName: "Pat Pro", state: "pending", joined: false },
        ],
        pendingInvitations: [],
      },
      "aaa",
    );
    expect(roster.viewerRole).toBe("owner");
    expect(roster.viewerJoined).toBe(true);
    expect(roster.ownerName).toBe("Aryya");
    expect(personalBoardRole({ isOwner: false, membershipRole: "firm" }, roster)).toBe("owner");

    const pending = personalHiveRoster(
      {
        people: [
          { userId: "AAA", role: "owner", displayName: "Aryya", state: "active", joined: true },
          { userId: "BBB", role: "professional", displayName: "Pat Pro", state: "pending", joined: false },
        ],
        pendingInvitations: [],
      },
      "bbb",
    );
    expect(personalBoardRole({ isOwner: false, membershipRole: "professional", memberState: "pending" }, pending)).toBe(
      "pending-professional",
    );
    expect(
      personalBoardRole(
        { isOwner: false, membershipRole: "professional", memberState: "active" },
        { ...pending, viewerRole: "professional", viewerJoined: true, professionalJoined: true },
      ),
    ).toBe("professional");
  });
});
