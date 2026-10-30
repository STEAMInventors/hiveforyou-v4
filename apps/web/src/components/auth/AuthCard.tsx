"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { signInAction, signUpAction } from "@/server/auth/auth-actions";
import type { AuthActionState } from "@/server/auth/auth-state";
import {
  SIGN_UP_CHECK_EMAIL_BODY,
  SIGN_UP_CHECK_EMAIL_TITLE,
} from "@/server/auth/messages";
import { safeNextPath } from "@/server/auth/redirects";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/server/auth/validation";

import { TEXT_LINK_CLASS } from "@/components/button-classes";

import {
  AuthCrossLinks,
  AuthField,
  AuthFrame,
  AuthHeading,
  AuthNotice,
  AuthSubmit,
} from "./AuthFrame";
import { EmailOtpForm } from "./EmailOtpForm";
import { ResendConfirmationForm } from "./ResendConfirmationForm";

type AuthMode = "login" | "register";

type AuthCardProps = {
  mode: AuthMode;
  nextPath: string;
  checkEmail?: boolean;
  initialEmail?: string;
  linkError?: string | null;
  linkInfo?: string | null;
};

const initialState: AuthActionState = {};

export function AuthCard({
  mode,
  nextPath,
  checkEmail = false,
  initialEmail = "",
  linkError = null,
  linkInfo = null,
}: AuthCardProps) {
  const action = mode === "login" ? signInAction : signUpAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [email, setEmail] = useState(initialEmail);
  const safeNext = safeNextPath(nextPath, "/hives");
  const passwordHint = `${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`;

  if (checkEmail) {
    return (
      <AuthFrame>
        <AuthHeading
          title={SIGN_UP_CHECK_EMAIL_TITLE}
          lede={SIGN_UP_CHECK_EMAIL_BODY}
        />
        {initialEmail ? (
          <EmailOtpForm
            purpose="signup"
            email={initialEmail}
            nextPath={safeNext}
            codeLabel="Confirmation code"
          />
        ) : null}
        <ResendConfirmationForm email={initialEmail} nextPath={safeNext} />
        <AuthCrossLinks nextPath={safeNext} showForgot />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      {linkError ? <AuthNotice tone="error">{linkError}</AuthNotice> : null}
      {linkInfo ? <AuthNotice tone="info">{linkInfo}</AuthNotice> : null}
      {state.error ? <AuthNotice tone="error">{state.error}</AuthNotice> : null}
      {state.info ? <AuthNotice tone="info">{state.info}</AuthNotice> : null}

      {mode === "login" ? (
        <>
          <AuthHeading title="Welcome back" lede="Log in to your Hives." />
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={safeNext} />
            <AuthField
              label="Email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <AuthField
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <div className="flex justify-end gap-3 text-sm">
              <Link href="/sign-in-help" className={TEXT_LINK_CLASS}>
                Forgot email?
              </Link>
              <Link
                href={`/forgot-password?next=${encodeURIComponent(safeNext)}`}
                className={TEXT_LINK_CLASS}
              >
                Forgot password?
              </Link>
            </div>
            <AuthSubmit
              pending={pending}
              label="Log in"
              pendingLabel="Logging in…"
            />
          </form>
          {state.unconfirmedEmail ? (
            <div className="flex flex-col gap-4 border-t border-line pt-4">
              <p className="m-0 text-sm text-ink-muted">
                Send the confirmation email again.
              </p>
              <ResendConfirmationForm
                email={state.unconfirmedEmail}
                nextPath={safeNext}
              />
            </div>
          ) : null}
          <p className="m-0 text-center text-sm text-ink-muted">
            <Link
              href={`/register?next=${encodeURIComponent(safeNext)}`}
              className={TEXT_LINK_CLASS}
            >
              Create an account
            </Link>
          </p>
        </>
      ) : (
        <>
          <AuthHeading
            title="Create your account"
            lede="It takes a minute. You can create a Hive right after."
          />
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={safeNext} />
            <AuthField
              label="Your name"
              name="name"
              type="text"
              autoComplete="name"
            />
            <AuthField
              label="Email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <AuthField
              label="Password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              hint={passwordHint}
            />
            <AuthSubmit
              pending={pending}
              label="Create account"
              pendingLabel="Creating…"
            />
          </form>
          <p className="m-0 text-center text-sm text-ink-muted">
            Already have an account?{" "}
            <Link
              href={`/login?next=${encodeURIComponent(safeNext)}`}
              className={TEXT_LINK_CLASS}
            >
              Log in
            </Link>
            <span aria-hidden> · </span>
            <Link
              href={`/forgot-password?next=${encodeURIComponent(safeNext)}`}
              className={TEXT_LINK_CLASS}
            >
              Forgot password?
            </Link>
          </p>
        </>
      )}
    </AuthFrame>
  );
}
