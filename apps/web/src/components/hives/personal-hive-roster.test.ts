import { describe, expect, it } from "vitest";

import { personalHiveRoster, proConversationClosedReason } from "./personal-hive-roster";

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
  });
});
