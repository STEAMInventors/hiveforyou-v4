"use client";

import { useActionState, useEffect, useId, useState } from "react";

import { PRIMARY_BUTTON_CLASS, QUIET_LINK_CLASS } from "@/components/button-classes";
import {
  requestSignInCodeAction,
  verifySignInCodeAction,
} from "@/server/auth/auth-actions";
import type { SignInActionState } from "@/server/auth/auth-actions";
import { safeNextPath } from "@/server/auth/redirects";

import { SignInField, SignInHeading, SignInShell } from "./SignInShell";

const initialState: SignInActionState = { step: "email" };

const RESEND_SECONDS = 60;

const EMAIL_STEP_LEDE =
  "Use your email. New here? We'll set up your account. No password needed.";

type SignInFlowProps = {
  nextPath: string;
  startClients: boolean;
  createAccount: boolean;
  linkError?: string | null;
  initialEmail?: string;
  lockEmail?: boolean;
};

function AuthFlowQueryFields({
  startClients,
  createAccount,
}: {
  startClients: boolean;
  createAccount: boolean;
}) {
  return (
    <>
      {startClients ? <input type="hidden" name="start" value="clients" /> : null}
      {createAccount ? <input type="hidden" name="new" value="1" /> : null}
    </>
  );
}

export function SignInFlow({
  nextPath,
  startClients,
  createAccount,
  linkError,
  initialEmail,
  lockEmail,
}: SignInFlowProps) {
  const safeNext = safeNextPath(nextPath, "/hives");
  const emailStepTitle = createAccount ? "Create your account" : "Sign in or create your account";
  const [requestState, requestAction, requestPending] = useActionState(
    requestSignInCodeAction,
    initialState,
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifySignInCodeAction,
    initialState,
  );

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(initialEmail?.trim().toLowerCase() ?? "");
  const [resendReadyIn, setResendReadyIn] = useState(0);
  const emailId = useId();
  const codeId = useId();

  useEffect(() => {
    if (requestState.step === "code" && requestState.email) {
      setStep("code");
      setEmail(requestState.email);
      setResendReadyIn(RESEND_SECONDS);
    }
  }, [requestState.step, requestState.email]);

  useEffect(() => {
    if (resendReadyIn <= 0) return;
    const timer = window.setInterval(() => {
      setResendReadyIn((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendReadyIn]);

  const emailError =
    requestState.field === "email" ? requestState.error : verifyState.field === "email" ? verifyState.error : null;
  const codeError = verifyState.field === "code" ? verifyState.error : null;
  const bannerError = linkError ?? (step === "email" && !emailError ? requestState.error : null);

  const body =
    step === "code" ? (
      <>
        <SignInHeading
          title="Check your email"
          lede={`We sent a 6-digit code to ${email}. It works once, for one hour.`}
        />
        <form action={verifyAction} className="flex flex-col gap-4">
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={safeNext} />
          <AuthFlowQueryFields startClients={startClients} createAccount={createAccount} />
          <SignInField
            id={codeId}
            label="Sign-in code"
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            error={codeError}
          />
          <button type="submit" disabled={verifyPending} className={PRIMARY_BUTTON_CLASS}>
            {verifyPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <button
          type="button"
          className={QUIET_LINK_CLASS}
          onClick={() => {
            setStep("email");
          }}
        >
          Use a different email
        </button>
        <form action={requestAction} className="m-0">
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={safeNext} />
          <AuthFlowQueryFields startClients={startClients} createAccount={createAccount} />
          <button
            type="submit"
            className={QUIET_LINK_CLASS}
            disabled={requestPending || resendReadyIn > 0}
          >
            {resendReadyIn > 0 ? `Send a new code (${resendReadyIn}s)` : "Send a new code"}
          </button>
        </form>
      </>
    ) : (
      <>
        {bannerError ? (
          <p role="alert" className="m-0 text-sm text-coral-deep">
            {bannerError}
          </p>
        ) : null}
        <SignInHeading title={emailStepTitle} lede={EMAIL_STEP_LEDE} />
        <form action={requestAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={safeNext} />
          <AuthFlowQueryFields startClients={startClients} createAccount={createAccount} />
          <SignInField
            id={emailId}
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            readOnly={lockEmail === true}
            onChange={lockEmail ? undefined : (event) => setEmail(event.target.value)}
            error={emailError}
          />
          <button type="submit" disabled={requestPending} className={PRIMARY_BUTTON_CLASS}>
            {requestPending ? "Sending…" : "Next"}
          </button>
        </form>
      </>
    );

  return <SignInShell>{body}</SignInShell>;
}