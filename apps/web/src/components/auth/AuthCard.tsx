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
          <form action={formAction} className="form-stack">
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
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.75rem",
                fontSize: "0.875rem",
              }}
            >
              <Link href="/sign-in-help">Forgot email?</Link>
              <Link
                href={`/forgot-password?next=${encodeURIComponent(safeNext)}`}
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
            <div
              className="form-stack"
              style={{ borderTop: "1px solid #e1e4e8", paddingTop: "1rem" }}
            >
              <p className="muted" style={{ margin: 0, fontSize: "0.875rem" }}>
                Send the confirmation email again.
              </p>
              <ResendConfirmationForm
                email={state.unconfirmedEmail}
                nextPath={safeNext}
              />
            </div>
          ) : null}
          <p
            className="muted"
            style={{ margin: 0, textAlign: "center", fontSize: "0.875rem" }}
          >
            <Link href={`/register?next=${encodeURIComponent(safeNext)}`}>
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
          <form action={formAction} className="form-stack">
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
          <p
            className="muted"
            style={{ margin: 0, textAlign: "center", fontSize: "0.875rem" }}
          >
            Already have an account?{" "}
            <Link href={`/login?next=${encodeURIComponent(safeNext)}`}>
              Log in
            </Link>
            <span aria-hidden> · </span>
            <Link
              href={`/forgot-password?next=${encodeURIComponent(safeNext)}`}
            >
              Forgot password?
            </Link>
          </p>
        </>
      )}
    </AuthFrame>
  );
}
