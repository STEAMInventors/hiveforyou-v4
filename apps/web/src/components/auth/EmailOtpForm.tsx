"use client";

import { useActionState } from "react";

import { verifyEmailOtpAction } from "@/server/auth/auth-actions";
import type { AuthActionState, AuthOtpPurpose } from "@/server/auth/auth-state";

import { AuthField, AuthNotice, AuthSubmit } from "./AuthFrame";

const initialState: AuthActionState = {};

type EmailOtpFormProps = {
  purpose: AuthOtpPurpose;
  email: string;
  nextPath: string;
  codeLabel?: string;
};

export function EmailOtpForm({
  purpose,
  email,
  nextPath,
  codeLabel = "Verification code",
}: EmailOtpFormProps) {
  const [state, formAction, pending] = useActionState(
    verifyEmailOtpAction,
    initialState,
  );
  const resolvedEmail = state.otpChallenge?.email ?? email;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 border-t border-line pt-4"
    >
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="next" value={nextPath} />
      {state.error ? <AuthNotice tone="error">{state.error}</AuthNotice> : null}
      <p className="m-0 text-sm text-ink-muted">
        {purpose === "recovery"
          ? "Enter the code from your reset email. Leave the link unopened if your mail app scans links automatically."
          : "Enter the confirmation code from your email, or open the confirmation link in this browser."}
      </p>
      <AuthField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={resolvedEmail}
      />
      <AuthField
        label={codeLabel}
        name="token"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        minLength={6}
        maxLength={10}
        pattern="[0-9\s]{6,10}"
        hint="Usually six digits from the email body."
      />
      <AuthSubmit
        pending={pending}
        label="Verify code"
        pendingLabel="Verifying…"
      />
    </form>
  );
}
