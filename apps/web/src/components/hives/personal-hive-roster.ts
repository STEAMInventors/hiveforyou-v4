export type PersonalHiveRoster = {
  professionalJoined: boolean;
  professionalName: string | null;
  ownerName: string | null;
  pendingEmail: string | null;
};

export const EMPTY_PERSONAL_ROSTER: PersonalHiveRoster = {
  professionalJoined: false,
  professionalName: null,
  ownerName: null,
  pendingEmail: null,
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

type PersonRecord = {
  role?: unknown;
  displayName?: unknown;
  state?: unknown;
  joined?: unknown;
  email?: unknown;
};

function peopleRows(value: unknown): PersonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is PersonRecord => !!row && typeof row === "object");
}

function joinedProfessional(row: PersonRecord): boolean {
  return row.role === "professional" && row.state !== "pending" && row.joined !== false;
}

/** Reads `list_hive_people`. An open invitation and a not-yet-joined acceptance are both pending. */
export function personalHiveRoster(data: unknown): PersonalHiveRoster {
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
  };
}

/** Null when the shared channel is open. The owner and an accepted Pro can both write then. */
export function proConversationClosedReason(
  roster: PersonalHiveRoster,
  viewer: "owner" | "professional",
): string | null {
  if (viewer === "professional" || roster.professionalJoined) return null;
  if (roster.pendingEmail) {
    const who = roster.pendingEmail.includes("@") ? roster.pendingEmail : roster.pendingEmail;
    const verb = roster.pendingEmail.includes("@") ? "is invited and hasn't joined" : "accepted the invite and hasn't joined";
    return `${who} ${verb}. You can write here once they join.`;
  }
  return "Invite a professional to start this conversation. It stays empty until they join.";
}
