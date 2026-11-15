import { isValidUuid } from "./hive-contracts";

export type HiveInvitationRole = "client" | "professional";

export type HivePersonRow = {
  userId?: string;
  role: HiveInvitationRole | "owner";
  displayName?: string | null;
  joined: boolean;
  invitationId?: string;
  email?: string;
  state?: string;
};

export type ListHivePeopleResponse = {
  people: HivePersonRow[];
  pendingInvitations: HivePersonRow[];
};

export type InvitationLookupStatus = "valid" | "invalid" | "expired" | "used" | "revoked";

export type InvitationLookup = {
  status: InvitationLookupStatus;
  invitationId?: string;
  hiveId?: string;
  hiveName?: string;
  email?: string;
  role?: HiveInvitationRole;
};

export function normalizeInvitationLookup(raw: unknown): InvitationLookup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
  if (!["valid", "invalid", "expired", "used", "revoked"].includes(status)) {
    return null;
  }
  const hiveId =
    typeof record.hiveId === "string" && isValidUuid(record.hiveId.trim())
      ? record.hiveId.trim()
      : undefined;
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : undefined;
  const roleRaw = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
  const role = roleRaw === "client" || roleRaw === "professional" ? roleRaw : undefined;
  return {
    status: status as InvitationLookupStatus,
    invitationId: typeof record.invitationId === "string" ? record.invitationId : undefined,
    hiveId,
    hiveName: typeof record.hiveName === "string" ? record.hiveName : undefined,
    email,
    role,
  };
}