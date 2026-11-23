"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useCallback, useEffect, useId, useState } from "react";

import { PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS } from "@/components/button-classes";

type PersonRow = {
  userId?: string;
  role?: string;
  state?: string;
  displayName?: string | null;
  joined?: boolean;
  invitationId?: string;
  email?: string;
  removeUserId?: string;
};

const INVITE_SEND_FAILED = "We couldn't send the invitation. Try again.";

type PeopleResponse = {
  people: PersonRow[];
  pendingInvitations: PersonRow[];
};

type HiveBoardPeopleProps = {
  hive: Hive;
  currentUserId: string | null;
  /** When set, invite and remove follow this flag instead of the hive card. */
  canInvite?: boolean;
  /** Used for the empty "You · …" line before the people list returns. */
  viewerRole?: "owner" | "professional" | "client";
  onRoster?: (data: unknown) => void;
};

function memberRoleLabel(role: string | undefined): string {
  const normalized = role?.trim().toLowerCase();
  if (normalized === "owner" || normalized === "client" || normalized === "professional") {
    return normalized;
  }
  return "member";
}

function personPrimaryName(person: PersonRow, currentUserId: string | null): string {
  if (person.userId && currentUserId && person.userId.toLowerCase() === currentUserId.toLowerCase()) {
    return "You";
  }
  const display = person.displayName?.trim();
  if (display) return display;
  const email = person.email?.trim();
  if (email) return email;
  return "Member";
}

export function HiveBoardPeople({ hive, currentUserId, canInvite, viewerRole, onRoster }: HiveBoardPeopleProps) {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [pending, setPending] = useState<PersonRow[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; label: string } | null>(null);
  const nameId = useId();
  const emailId = useId();
  const isOwner = canInvite ?? Boolean(hive.isOwner ?? hive.membershipRole === "owner");
  const inviteRole = hive.kind === "client" ? "client" : "professional";
  const inviteTitle = hive.kind === "client" ? "Invite your client" : "Share with a professional";

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/hives/${hive.id}/people`);
    if (!res.ok) return;
    const data = (await res.json()) as PeopleResponse;
    setPeople(data.people ?? []);
    setPending(data.pendingInvitations ?? []);
    onRoster?.(data);
  }, [hive.id, onRoster]);

  useEffect(() => {
    void load();
  }, [load]);

  const readInviteError = async (res: Response): Promise<string> => {
    try {
      const body = (await res.json()) as { error?: { message?: unknown } };
      if (typeof body.error?.message === "string" && body.error.message.trim()) {
        return body.error.message;
      }
    } catch {
      // The response was not the public error JSON.
    }
    return INVITE_SEND_FAILED;
  };

  const inviterDisplayName = (): string => {
    const self = people.find(
      (person) =>
        person.userId &&
        currentUserId &&
        person.userId.toLowerCase() === currentUserId.toLowerCase(),
    );
    return self?.displayName?.trim() ?? "";
  };

  const sendInvite = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedName || !trimmedEmail.includes("@")) {
      setErr("Enter a name and an email address.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/hives/${hive.id}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          role: inviteRole,
          hiveName: hive.name,
          inviterName: trimmedName,
        }),
      });
      if (!res.ok) {
        setErr(await readInviteError(res));
        return;
      }
      setOpen(false);
      setName("");
      setEmail("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invitationId: string) => {
    await fetch(`/api/v1/hives/${hive.id}/invitations/${invitationId}/revoke`, { method: "POST" });
    await load();
  };

  const sendAgain = async (invitationId: string, invitedEmail: string, invitedRole: string | undefined) => {
    const role = invitedRole === "client" || invitedRole === "professional" ? invitedRole : inviteRole;
    setBusy(true);
    setErr(null);
    try {
      const revoked = await fetch(`/api/v1/hives/${hive.id}/invitations/${invitationId}/revoke`, {
        method: "POST",
      });
      if (!revoked.ok) {
        setErr(INVITE_SEND_FAILED);
        return;
      }
      const res = await fetch(`/api/v1/hives/${hive.id}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: invitedEmail,
          role,
          hiveName: hive.name,
          inviterName: inviterDisplayName(),
        }),
      });
      if (!res.ok) {
        setErr(await readInviteError(res));
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/hives/${hive.id}/people/${userId}/remove`, { method: "POST" });
      if (!res.ok) {
        setErr("Could not remove this person.");
        return;
      }
      setRemoveTarget(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  type PeopleRow = {
    key: string;
    line: string;
    invitationId?: string;
    email?: string;
    role?: string;
    removeUserId?: string;
    removeLabel: string;
  };

  const viewerRoleLabel = memberRoleLabel(viewerRole ?? hive.membershipRole ?? (hive.isOwner ? "owner" : undefined));

  const rows: PeopleRow[] = [
    ...people.map((p) => {
      const name = personPrimaryName(p, currentUserId);
      const role = memberRoleLabel(p.role);
      const line =
        p.role === "professional" && p.state === "pending"
          ? `${name} · accepted the invite, not joined yet`
          : role === "professional"
            ? `${name} · professional · accepted`
            : `${name} · ${role}`;
      return {
        key: p.userId ?? p.email ?? "member",
        line,
        removeUserId: p.role !== "owner" && p.userId ? p.userId : undefined,
        removeLabel: name,
      };
    }),
    ...pending.map((p) => ({
      key: p.invitationId ?? p.email ?? "pending",
      line: `${p.email?.trim() || "Invited"} · invited, not joined yet`,
      invitationId: p.invitationId,
      email: p.email?.trim().toLowerCase(),
      role: p.role,
      removeLabel: p.email?.trim() || "Invited",
    })),
  ];

  return (
    <div className="border-t border-line pt-4">
      <p className="m-0 text-caption text-ink-2">People in this hive</p>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {rows.length === 0 ? (
          <li className="text-body text-ink-2">{`You · ${viewerRoleLabel}`}</li>
        ) : (
          rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-2 text-body text-ink-2">
              <span className="text-body">{row.line}</span>
              {isOwner && row.invitationId ? (
                <span className="flex shrink-0 items-center gap-3">
                  {row.email ? (
                    <button
                      type="button"
                      className="min-h-11 text-small text-blue-deep underline"
                      disabled={busy}
                      onClick={() => void sendAgain(row.invitationId!, row.email!, row.role)}
                    >
                      Send again
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="min-h-11 text-small text-blue-deep underline"
                    disabled={busy}
                    onClick={() => void revoke(row.invitationId!)}
                  >
                    Revoke
                  </button>
                </span>
              ) : isOwner && row.removeUserId ? (
                <button
                  type="button"
                  className="min-h-11 text-small text-coral-deep underline"
                  onClick={() => setRemoveTarget({ userId: row.removeUserId!, label: row.removeLabel })}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))
        )}
        </ul>
      {err && !open && !removeTarget ? (
        <p className="mt-2 text-small text-coral-deep" role="alert">
          {err}
        </p>
      ) : null}
      {isOwner ? (
        <button
          type="button"
          className={`${QUIET_BUTTON_CLASS} mt-3 min-h-11`}
          onClick={() => {
            setErr(null);
            setOpen(true);
          }}
        >
          {hive.kind === "client" ? "Invite your client" : "Share with a professional"}
        </button>
      ) : null}
      {removeTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-paper/80 px-5"
        >
          <div className="w-full max-w-[400px] rounded-input border border-line bg-paper p-6 shadow-lg">
            <h2 className="m-0 font-brand text-[22px] font-semibold text-ink">Remove from this hive?</h2>
            <p className="mt-2 text-small text-ink-2">
              <strong>{removeTarget.label}</strong> will lose access immediately. You can invite them again later.
            </p>
            {err ? (
              <p className="mt-2 text-small text-coral-deep" role="alert">
                {err}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                className={PRIMARY_BUTTON_CLASS}
                disabled={busy}
                onClick={() => void removeMember(removeTarget.userId)}
              >
                Remove person
              </button>
              <button type="button" className={QUIET_BUTTON_CLASS} disabled={busy} onClick={() => setRemoveTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-paper/80 px-5"
        >
          <div className="w-full max-w-[400px] rounded-input border border-line bg-paper p-6 shadow-lg">
            <h2 className="m-0 font-brand text-[22px] font-semibold text-ink">{inviteTitle}</h2>
            <p className="mt-2 text-small text-ink-2">
              {hive.kind === "client"
                ? "They get a sign-in link by email and see what you ask for. No password."
                : "They get a link to join this hive. Once they accept, you can write to each other and they can ask you for documents."}
            </p>
            <label htmlFor={nameId} className="mt-4 flex flex-col gap-1 text-[14px] font-medium">
              Name
              <input
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-11 rounded-control border border-line-strong px-3 text-[16px]"
              />
            </label>
            <label htmlFor={emailId} className="mt-3 flex flex-col gap-1 text-[14px] font-medium">
              Email
              <input
                id={emailId}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-h-11 rounded-control border border-line-strong px-3 text-[16px]"
              />
            </label>
            {err ? (
              <p className="mt-2 text-small text-coral-deep" role="alert">
                {err}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={busy} onClick={() => void sendInvite()}>
                Send invitation
              </button>
              <button type="button" className={QUIET_BUTTON_CLASS} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}