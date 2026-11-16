import { isValidUuid, type HiveStage } from "./hive-contracts";

export type FirmMemberRole = "owner" | "attorney" | "member";

export type FirmInvitationLookupStatus = "valid" | "invalid" | "expired" | "used" | "revoked";

export type FirmInvitationLookup = {
  status: FirmInvitationLookupStatus;
  firmMemberId?: string;
  firmId?: string;
  firmName?: string;
  email?: string;
  role?: FirmMemberRole;
  title?: string;
};

export type FirmMemberRow = {
  userId?: string;
  email: string;
  role: FirmMemberRole;
  title: string;
  state: string;
  displayName?: string | null;
  joined: boolean;
};

export type FirmPendingInvitation = {
  invitationId: string;
  email: string;
  role: FirmMemberRole;
  title: string;
  expiresAt: string;
};

export type FirmSummary = {
  firmId: string;
  name: string;
  assistantName?: string | null;
  callerRole?: FirmMemberRole;
};

export type ListFirmResponse = {
  firm: FirmSummary | null;
  members: FirmMemberRow[];
  pendingInvitations: FirmPendingInvitation[];
};

const FIRM_ROLES = new Set<FirmMemberRole>(["owner", "attorney", "member"]);

export function normalizeFirmInvitationLookup(raw: unknown): FirmInvitationLookup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
  if (!["valid", "invalid", "expired", "used", "revoked"].includes(status)) {
    return null;
  }
  const firmId =
    typeof record.firmId === "string" && isValidUuid(record.firmId.trim()) ? record.firmId.trim() : undefined;
  const roleRaw = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
  const role = FIRM_ROLES.has(roleRaw as FirmMemberRole) ? (roleRaw as FirmMemberRole) : undefined;
  return {
    status: status as FirmInvitationLookupStatus,
    firmMemberId:
      typeof record.firmMemberId === "string" && isValidUuid(record.firmMemberId.trim())
        ? record.firmMemberId.trim()
        : undefined,
    firmId,
    firmName: typeof record.firmName === "string" ? record.firmName : undefined,
    email: typeof record.email === "string" ? record.email.trim().toLowerCase() : undefined,
    role,
    title: typeof record.title === "string" ? record.title.trim() : undefined,
  };
}

export function normalizeListFirmResponse(raw: unknown): ListFirmResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const firmRaw = record.firm;
  const firm =
    firmRaw === null
      ? null
      : firmRaw && typeof firmRaw === "object" && !Array.isArray(firmRaw)
        ? normalizeFirmSummary(firmRaw)
        : undefined;
  if (firm === undefined) {
    return null;
  }
  const members = normalizeFirmMemberRows(record.members);
  const pendingInvitations = normalizeFirmPendingInvitations(record.pendingInvitations);
  if (members === null || pendingInvitations === null) {
    return null;
  }
  return { firm, members, pendingInvitations };
}

function normalizeFirmSummary(raw: unknown): FirmSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const firmId =
    typeof record.firmId === "string" && isValidUuid(record.firmId.trim()) ? record.firmId.trim() : null;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!firmId || !name) {
    return null;
  }
  const callerRoleRaw = typeof record.callerRole === "string" ? record.callerRole.trim().toLowerCase() : "";
  const callerRole = FIRM_ROLES.has(callerRoleRaw as FirmMemberRole)
    ? (callerRoleRaw as FirmMemberRole)
    : undefined;
  const assistantName =
    typeof record.assistantName === "string"
      ? record.assistantName.trim() || null
      : record.assistantName === null
        ? null
        : undefined;
  return { firmId, name, ...(assistantName !== undefined ? { assistantName } : {}), ...(callerRole ? { callerRole } : {}) };
}

function normalizeFirmMemberRows(raw: unknown): FirmMemberRow[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const rows: FirmMemberRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const record = item as Record<string, unknown>;
    const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const roleRaw = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
    const state = typeof record.state === "string" ? record.state.trim().toLowerCase() : "";
    if (!email || !title || !FIRM_ROLES.has(roleRaw as FirmMemberRole) || !state) {
      return null;
    }
    const userId =
      typeof record.userId === "string" && isValidUuid(record.userId.trim()) ? record.userId.trim() : undefined;
    rows.push({
      email,
      title,
      role: roleRaw as FirmMemberRole,
      state,
      joined: record.joined === true,
      ...(userId ? { userId } : {}),
      displayName:
        typeof record.displayName === "string"
          ? record.displayName.trim() || null
          : record.displayName === null
            ? null
            : undefined,
    });
  }
  return rows;
}

function normalizeFirmPendingInvitations(raw: unknown): FirmPendingInvitation[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const rows: FirmPendingInvitation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const record = item as Record<string, unknown>;
    const invitationId =
      typeof record.invitationId === "string" && isValidUuid(record.invitationId.trim())
        ? record.invitationId.trim()
        : null;
    const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const roleRaw = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
    const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt : "";
    if (!invitationId || !email || !title || !FIRM_ROLES.has(roleRaw as FirmMemberRole) || !expiresAt) {
      return null;
    }
    rows.push({
      invitationId,
      email,
      title,
      role: roleRaw as FirmMemberRole,
      expiresAt,
    });
  }
  return rows;
}

export function isHiveStage(value: string): value is HiveStage {
  return value === "open" || value === "review" || value === "closed";
}