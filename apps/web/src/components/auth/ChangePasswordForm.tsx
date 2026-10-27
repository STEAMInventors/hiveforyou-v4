"use client";

import { useActionState } from "react";

import { changePasswordAction } from "@/server/auth/auth-actions";
import type { AuthActionState } from "@/server/auth/auth-state";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/server/auth/validation";

import { AuthField, AuthNotice, AuthSubmit } from "./AuthFrame";

const initialState: AuthActionState = {};

export function ChangePasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    initialState,
  );
  const hint = `${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`;

  return (
    <>
      {state.error ? <AuthNotice tone="error">{state.error}</AuthNotice> : null}
      {state.info ? <AuthNotice tone="info">{state.info}</AuthNotice> : null}
      <form action={formAction} className="form-stack">
        <input
          type="hidden"
          name="username"
          autoComplete="username"
          value={email}
          readOnly
        />
        <AuthField
          label="Current password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
        />
        <AuthField
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          hint={hint}
        />
        <AuthField
          label="Confirm new password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
        />
        <AuthSubmit
          pending={pending}
          label="Change password"
          pendingLabel="Updating…"
        />
      </form>
    </>
  );
}
