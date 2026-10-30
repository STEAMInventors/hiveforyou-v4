"use client";

import { useActionState } from "react";

import {
  backToLoginFromRecoveryAction,
  updatePasswordFromRecoveryAction,
} from "@/server/auth/auth-actions";
import type { AuthActionState } from "@/server/auth/auth-state";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/server/auth/validation";

import { SECONDARY_BUTTON_CLASS } from "@/components/button-classes";

import { AuthField, AuthNotice, AuthSubmit } from "./AuthFrame";

const initialState: AuthActionState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    updatePasswordFromRecoveryAction,
    initialState,
  );
  const hint = `${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`;

  return (
    <>
      {state.error ? <AuthNotice tone="error">{state.error}</AuthNotice> : null}
      <form action={formAction} className="flex flex-col gap-4">
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
          label="Update password"
          pendingLabel="Updating…"
        />
      </form>
      <form action={backToLoginFromRecoveryAction}>
        <button type="submit" className={`${SECONDARY_BUTTON_CLASS} w-full`}>
          Back to log in
        </button>
      </form>
    </>
  );
}
