export type PersonalHiveMemberRole = "owner" | "professional" | "client";

/** What the board may show. Authorization stays on the server. */
export type PersonalBoardRole = "owner" | "professional" | "pending-professional" | "member";

export type PersonalHiveRoster = {
  professionalJoined: boolean;
  professionalName: string | null;
  ownerName: string | null;
  pendingEmail: string | null;
  /** Role of `currentUserId` on `list_hive_people`. Null until that row is known. */
  viewerRole: PersonalHiveMemberRole | null;
  /** False when that membership is still pending. Null when the viewer row is unknown. */
  viewerJoined: boolean | null;
};

export const EMPTY_PERSONAL_ROSTER: PersonalHiveRoster = {
  professionalJoined: false,
  professionalName: null,
  ownerName: null,
  pendingEmail: null,
  viewerRole: null,
  viewerJoined: null,
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

type PersonRecord = {
  userId?: unknown;
  role?: unknown;
  displayName?: unknown;
  state?: unknown;
  joined?: unknown;
  email?: unknown;
};

function memberRole(value: unknown): PersonalHiveMemberRole | null {
  return value === "owner" || value === "professional" || value === "client" ? value : null;
}

function peopleRows(value: unknown): PersonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is PersonRecord => !!row && typeof row === "object");
}

function joinedProfessional(row: PersonRecord): boolean {
  return row.role === "professional" && row.state !== "pending" && row.joined !== false;
}

function viewerMembership(
  people: PersonRecord[],
  currentUserId: string | null | undefined,
): { viewerRole: PersonalHiveMemberRole | null; viewerJoined: boolean | null } {
  if (!currentUserId) return { viewerRole: null, viewerJoined: null };
  const self = people.find(
    (row) => typeof row.userId === "string" && row.userId.toLowerCase() === currentUserId.toLowerCase(),
  );
  if (!self) return { viewerRole: null, viewerJoined: null };
  const viewerRole = memberRole(self.role);
  if (!viewerRole) return { viewerRole: null, viewerJoined: null };
  return { viewerRole, viewerJoined: self.state !== "pending" && self.joined !== false };
}

/** Reads `list_hive_people`. An open invitation and a not-yet-joined acceptance are both pending. */
export function personalHiveRoster(data: unknown, currentUserId?: string | null): PersonalHiveRoster {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const people = peopleRows(record.people);
  const pending = peopleRows(record.pendingInvitations);
  const professional = people.find(joinedProfessional);
  const waiting = people.find((row) => row.role === "professional" && !joinedProfessional(row));
  const owner = people.find((row) => row.role === "owner");
  const invited = pending.find((row) => row.role === "professional") ?? pending[0];
  return {
    professionalJoined: professional != null,
    professionalName: text(professional?.displayName ?? waiting?.displayName),
    ownerName: text(owner?.displayName),
    pendingEmail: professional
      ? null
      : text(waiting?.displayName ?? waiting?.email ?? invited?.email) ?? (waiting ? "Your Pro" : null),
    ...viewerMembership(people, currentUserId),
  };
}

/**
 * Presentation role for a personal Hive. The people row for the signed-in user wins over
 * `hive.membershipRole`, which can be missing when the hive card is loaded without it.
 * This does not grant access; request and message routes still check the membership.
 */
export function personalBoardRole(
  hive: { isOwner?: boolean; membershipRole?: string | null; memberState?: string | null },
  roster: PersonalHiveRoster,
): PersonalBoardRole {
  const hiveOwner = hive.isOwner === true || hive.membershipRole === "owner";
  const role =
    roster.viewerRole ??
    (hiveOwner ? "owner" : hive.membershipRole === "professional" ? "professional" : hive.membershipRole === "client" ? "client" : null);
  const joined = roster.viewerJoined ?? (role === "professional" ? hive.memberState !== "pending" : role === "owner");
  if (role === "owner") return "owner";
  if (role === "professional" && joined === false) return "pending-professional";
  if (role === "professional") return "professional";
  return "member";
}

/** Null when the shared channel is open. A pending professional still has to join. */
export function proConversationClosedReason(
  roster: PersonalHiveRoster,
  viewer: "owner" | "professional",
  viewerJoined = true,
): string | null {
  if (viewer === "professional" && !viewerJoined) {
    return "You accepted the invite and haven't joined. Join this hive to write here.";
  }
  if (viewer === "professional" || roster.professionalJoined) return null;
  if (roster.pendingEmail) {
    const who = roster.pendingEmail;
    const verb = roster.pendingEmail.includes("@") ? "is invited and hasn't joined" : "accepted the invite and hasn't joined";
    return `${who} ${verb}. You can write here once they join.`;
  }
  return "Invite a professional to start this conversation. It stays empty until they join.";
}
