"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { requestPasswordResetAction } from "@/server/auth/auth-actions";
import type { AuthActionState } from "@/server/auth/auth-state";
import { SIGN_IN_HELP_PATH } from "@/server/auth/recovery";

import {
  AuthCrossLinks,
  AuthField,
  AuthNotice,
  AuthSubmit,
} from "./AuthFrame";
import { EmailOtpForm } from "./EmailOtpForm";

const initialState: AuthActionState = {};

export function ForgotPasswordForm({
  nextPath,
  linkError,
}: {
  nextPath: string;
  linkError?: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    initialState,
  );
  const [email, setEmail] = useState("");
  const showOtp = Boolean(state.otpChallenge) || Boolean(state.info);

  return (
    <>
      {linkError ? <AuthNotice tone="error">{linkError}</AuthNotice> : null}
      {state.error ? <AuthNotice tone="error">{state.error}</AuthNotice> : null}
      {state.info ? <AuthNotice tone="info">{state.info}</AuthNotice> : null}
      {!showOtp ? (
        <form action={formAction} className="form-stack">
          <AuthField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <AuthSubmit
            pending={pending}
            label="Send reset email"
            pendingLabel="Sending…"
          />
        </form>
      ) : null}
      {showOtp ? (
        <EmailOtpForm
          purpose="recovery"
          email={state.otpChallenge?.email ?? email}
          nextPath={nextPath}
          codeLabel="Reset code"
        />
      ) : null}
      <p
        className="muted"
        style={{ margin: 0, textAlign: "center", fontSize: "0.875rem" }}
      >
        <Link href={SIGN_IN_HELP_PATH}>Forgot which email you used?</Link>
      </p>
      <AuthCrossLinks nextPath={nextPath} />
    </>
  );
}
