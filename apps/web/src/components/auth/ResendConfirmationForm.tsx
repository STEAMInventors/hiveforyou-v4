"use client";

import { useActionState } from "react";

import { resendConfirmationAction } from "@/server/auth/auth-actions";
import type { AuthActionState } from "@/server/auth/auth-state";

import { AuthField, AuthNotice, AuthSubmit } from "./AuthFrame";
import { EmailOtpForm } from "./EmailOtpForm";

const initialState: AuthActionState = {};

export function ResendConfirmationForm({
  email,
  nextPath,
}: {
  email: string;
  nextPath: string;
}) {
  const [state, formAction, pending] = useActionState(
    resendConfirmationAction,
    initialState,
  );

  return (
    <>
      <form action={formAction} className="form-stack">
        <input type="hidden" name="next" value={nextPath} />
        {state.error ? (
          <AuthNotice tone="error">{state.error}</AuthNotice>
        ) : null}
        {state.info ? <AuthNotice tone="info">{state.info}</AuthNotice> : null}
        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={email}
        />
        <AuthSubmit
          pending={pending}
          label="Resend confirmation email"
          pendingLabel="Sending…"
        />
      </form>
      {state.otpChallenge?.purpose === "signup" ? (
        <EmailOtpForm
          purpose="signup"
          email={state.otpChallenge.email}
          nextPath={nextPath}
          codeLabel="Confirmation code"
        />
      ) : null}
    </>
  );
}
