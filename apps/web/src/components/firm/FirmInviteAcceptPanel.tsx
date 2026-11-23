"use client";

import type { FirmInvitationLookup } from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { PRIMARY_BUTTON_CLASS, QUIET_LINK_CLASS } from "@/components/button-classes";
import { signOutAction } from "@/server/auth/auth-actions";

type FirmInviteAcceptPanelProps =
  | { mode: "invalid" | "used" | "revoked" | "expired" }
  | { mode: "wrong_email"; invitedEmail: string; sessionEmail: string }
  | { mode: "welcome"; token: string; lookup: FirmInvitationLookup };

export function FirmInviteAcceptPanel(props: FirmInviteAcceptPanelProps) {
  const firstNameId = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");

  if (props.mode !== "welcome") {
    if (props.mode === "wrong_email") {
      return (
        <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-5 py-16 text-center" data-testid="firm-invite-wrong-email">
          <h1 className="m-0 font-brand text-[28px] font-semibold text-ink">Wrong account</h1>
          <p className="m-0 text-body text-ink-2">
            This invitation is for <strong>{props.invitedEmail}</strong>. You are signed in as {props.sessionEmail}.
          </p>
          <form action={signOutAction} className="m-0">
            <button type="submit" className={PRIMARY_BUTTON_CLASS}>
              Sign out
            </button>
          </form>
        </div>
      );
    }
    return (
      <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-5 py-16 text-center" data-testid={`firm-invite-${props.mode}`}>
        <h1 className="m-0 font-brand text-[28px] font-semibold text-ink">This link cannot be used</h1>
        <p className="m-0 text-body text-ink-2">Ask the person who sent it to send you a new invitation.</p>
        <Link href="/" className={QUIET_LINK_CLASS}>
          Back to HiveForYou
        </Link>
      </div>
    );
  }

  const { lookup, token } = props;
  const firmName = lookup.firmName?.trim() || "the firm";

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmedName = firstName.trim();
      if (trimmedName.length > 0) {
        await fetch("/api/v1/profile/display-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: trimmedName }),
        });
      }
      const response = await fetch("/api/v1/firm-invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        setError("This invitation could not be accepted. Ask for a new link.");
        return;
      }
      router.push("/hives");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-5 px-5 pb-16 pt-[clamp(32px,8vh,80px)]" data-testid="firm-invite-welcome">
      <h1 className="m-0 text-center font-brand text-[30px] font-semibold leading-tight text-ink">
        You were added to {firmName}
      </h1>
      <p className="m-0 text-center text-body text-ink-2">
        {lookup.title ? `${lookup.title} on HiveForYou.` : "Join the team on HiveForYou."} No password.
      </p>
      <label htmlFor={firstNameId} className="flex flex-col gap-1.5 text-[14px] font-medium text-ink">
        Your first name <span className="font-normal text-ink-3">(optional)</span>
        <input
          id={firstNameId}
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          className="min-h-11 rounded-control border border-line-strong px-3.5 text-[16px] font-normal text-ink outline-none transition-[border-color,box-shadow] focus:border-blue focus:shadow-focus"
        />
      </label>
      {error ? <p className="m-0 text-sm text-coral-deep">{error}</p> : null}
      <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={busy} onClick={() => void accept()}>
        {busy ? "Joining…" : "Join the team"}
      </button>
    </div>
  );
}
