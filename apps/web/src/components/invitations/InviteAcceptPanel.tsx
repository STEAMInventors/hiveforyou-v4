"use client";

import type { InvitationLookup } from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { PRIMARY_BUTTON_CLASS, QUIET_LINK_CLASS } from "@/components/button-classes";
import { signOutAction } from "@/server/auth/auth-actions";
import { hiveDocumentsPath } from "@/lib/hive-routes";

type InviteAcceptPanelProps =
  | {
      mode: "invalid" | "used" | "revoked" | "expired";
      invitedEmail?: string;
    }
  | {
      mode: "wrong_email";
      invitedEmail: string;
      sessionEmail: string;
      token: string;
      lookup: InvitationLookup;
    }
  | {
      mode: "welcome";
      token: string;
      lookup: InvitationLookup;
    };

export function InviteAcceptPanel(props: InviteAcceptPanelProps) {
  const firstNameId = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [welcome, setWelcome] = useState<{
    inviterDisplayName?: string;
    requestedItemCount?: number;
    documentCount?: number;
    documentsReadLabel?: string;
  } | null>(null);
  const welcomeToken = props.mode === "welcome" ? props.token : null;

  useEffect(() => {
    if (!welcomeToken) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/v1/invitations/welcome-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: welcomeToken }),
      });
      if (!response.ok || cancelled) return;
      const body = (await response.json()) as Record<string, unknown>;
      if (cancelled) return;
      setWelcome({
        inviterDisplayName:
          typeof body.inviterDisplayName === "string" ? body.inviterDisplayName : undefined,
        requestedItemCount:
          typeof body.requestedItemCount === "number" ? body.requestedItemCount : undefined,
        documentCount: typeof body.documentCount === "number" ? body.documentCount : undefined,
        documentsReadLabel:
          typeof body.documentsReadLabel === "string" ? body.documentsReadLabel : undefined,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [welcomeToken]);

  if (props.mode === "invalid" || props.mode === "used" || props.mode === "revoked" || props.mode === "expired") {
    return (
      <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-5 py-16 text-center">
        <h1 className="m-0 font-brand text-[28px] font-semibold text-ink">This link cannot be used</h1>
        <p className="m-0 text-body text-graphite">Ask the person who sent it to send you a new invitation.</p>
        <Link href="/" className={QUIET_LINK_CLASS}>
          Back to HiveForYou
        </Link>
      </div>
    );
  }

  if (props.mode === "wrong_email") {
    return (
      <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-5 py-16 text-center">
        <h1 className="m-0 font-brand text-[28px] font-semibold text-ink">Wrong account</h1>
        <p className="m-0 text-body text-graphite">
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

  if (props.mode !== "welcome") {
    return null;
  }
  const { lookup, token } = props;
  const isClient = lookup.role === "client";

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
      const response = await fetch("/api/v1/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        setError("This invitation could not be accepted. Ask for a new link.");
        return;
      }
      const body = (await response.json()) as {
        hiveId?: string;
        role?: string;
        memberState?: string;
      };
      if (body.role === "client" && body.hiveId) {
        router.push(hiveDocumentsPath(body.hiveId));
        return;
      }
      if (body.hiveId && body.memberState === "pending") {
        router.push("/hives");
        return;
      }
      if (body.hiveId) {
        router.push(`/hives/${body.hiveId}/board`);
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
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-5 px-5 pb-16 pt-[clamp(32px,8vh,80px)]">
      {isClient ? (
        <>
          <p className="m-0 text-center text-body text-graphite">
            {welcome?.inviterDisplayName
              ? `${welcome.inviterDisplayName} invited you to upload documents.`
              : "You were invited to upload documents."}
          </p>
          {typeof welcome?.requestedItemCount === "number" && welcome.requestedItemCount > 0 ? (
            <p className="m-0 text-center text-small text-graphite">
              {welcome.requestedItemCount} requested item{welcome.requestedItemCount === 1 ? "" : "s"}
            </p>
          ) : null}
          <h1 className="m-0 text-center font-brand text-[30px] font-semibold leading-tight text-ink">
            Send what you have from your phone
          </h1>
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-body text-graphite">
            <li>Photos or files you already have</li>
            <li>Old, partial or out of order is fine</li>
            <li>You can stop and come back anytime</li>
          </ul>
          <label htmlFor={firstNameId} className="flex flex-col gap-1.5 text-[14px] font-medium text-ink">
            Your first name <span className="font-normal text-quiet">(optional)</span>
            <input
              id={firstNameId}
              name="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="min-h-11 rounded-control border border-line-strong px-3.5 text-[16px] font-normal text-ink"
            />
          </label>
          <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={busy} onClick={() => void accept()}>
            {busy ? "Starting…" : "Start"}
          </button>
          <p className="m-0 text-center text-small text-quiet">
            Old, partial or out of order is fine. You can stop and come back.
          </p>
        </>
      ) : (
        <>
          <p className="m-0 text-center text-body text-graphite">
            {welcome?.inviterDisplayName
              ? `${welcome.inviterDisplayName} shared ${lookup.hiveName ?? "a hive"} with you`
              : `${lookup.hiveName ?? "A hive"} was shared with you`}
          </p>
          {welcome?.documentsReadLabel ? (
            <p className="m-0 text-center text-small text-graphite">{welcome.documentsReadLabel}</p>
          ) : null}
          <h1 className="m-0 text-center font-brand text-[30px] font-semibold leading-tight text-ink">
            Read the summary when you are ready
          </h1>
          <p className="m-0 text-center text-body text-graphite">
            Reading doesn&apos;t take it on. The owner is told only what you decide.
          </p>
          <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={busy} onClick={() => void accept()}>
            {busy ? "Opening…" : "Read the summary"}
          </button>
        </>
      )}
      {error ? (
        <p className="m-0 text-center text-small text-coral-deep" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}