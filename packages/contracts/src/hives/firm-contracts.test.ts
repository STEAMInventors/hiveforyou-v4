import { describe, expect, it } from "vitest";

import {
  normalizeFirmInvitationLookup,
  normalizeListFirmResponse,
  isHiveStage,
} from "./firm-contracts";

const FIRM_ID = "f1100010-0000-4000-8000-0000000000ab";
const MEMBER_ID = "f1100010-0000-4000-8000-0000000000cd";

describe("firm-contracts", () => {
  it("normalizes a valid firm invitation lookup", () => {
    expect(
      normalizeFirmInvitationLookup({
        status: "valid",
        firmMemberId: MEMBER_ID,
        firmId: FIRM_ID,
        firmName: "Rivera Law",
        email: "member@example.test",
        role: "member",
        title: "Paralegal",
      }),
    ).toEqual({
      status: "valid",
      firmMemberId: MEMBER_ID,
      firmId: FIRM_ID,
      firmName: "Rivera Law",
      email: "member@example.test",
      role: "member",
      title: "Paralegal",
    });
  });

  it("rejects lookup payloads that expose token fields", () => {
    expect(
      normalizeFirmInvitationLookup({
        status: "valid",
        token_hash: "secret",
      }),
    ).toEqual({
      status: "valid",
    });
  });

  it("normalizes list_firm", () => {
    expect(
      normalizeListFirmResponse({
        firm: { firmId: FIRM_ID, name: "Rivera Law", callerRole: "owner" },
        members: [
          {
            userId: "f1100010-0000-4000-8000-0000000000aa",
            email: "owner@example.test",
            role: "owner",
            title: "Attorney",
            state: "active",
            joined: true,
          },
        ],
        pendingInvitations: [
          {
            invitationId: "f1100020-0000-4000-8000-000000000011",
            email: "pending@example.test",
            role: "member",
            title: "Paralegal",
            expiresAt: "2026-12-01T00:00:00.000Z",
          },
        ],
      }),
    ).toMatchObject({
      firm: { firmId: FIRM_ID, name: "Rivera Law", callerRole: "owner" },
      members: [{ joined: true, role: "owner" }],
      pendingInvitations: [{ email: "pending@example.test" }],
    });
  });

  it("recognizes hive stages", () => {
    expect(isHiveStage("review")).toBe(true);
    expect(isHiveStage("archived")).toBe(false);
  });
});