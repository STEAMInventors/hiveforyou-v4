"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  createServerSupabaseClient,
  requireAuthenticatedUser,
} from "@/server/supabase/server-client";

import {
  clearRecoveryCookies,
  issueRecoveryMarker,
  logAuthFailure,
  logAuthInfo,
  requestAppOrigin,
  requestCorrelationId,
} from "./action-support";
import {
  authEmailRedirectTo,
  passwordRecoveryEmailRedirectTo,
} from "./auth-callback-url";
import type { AuthActionState, AuthOtpPurpose } from "./auth-state";
import {
  classifyAuthError,
  localAuthFailure,
  publicAuthOutcome,
  toAuthErrorInput,
  type AuthErrorContext,
} from "./map-auth-error";
import {
  PASSWORD_UPDATED,
  RESEND_ACCEPTED,
  RESET_REQUEST_ACCEPTED,
} from "./messages";
import { otpTypeForPurpose, verifyEmailOtp } from "./otp";
import {
  RECOVERY_COOKIE_NAME,
  RESET_PASSWORD_PATH,
  isRecoveryCookieValue,
} from "./recovery";
import { safeNextPath } from "./redirects";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  isPlausibleEmail,
  isPlausibleOtpToken,
  newPasswordIssue,
  newPasswordIssueMessage,
  normalizeEmail,
  normalizeOtpToken,
} from "./validation";

function checkEmailPath(next: string, email: string): string {
  const params = new URLSearchParams();
  params.set("checkEmail", "1");
  params.set("next", next);
  if (email) {
    params.set("email", email);
  }
  return `/register?${params.toString()}`;
}

function providerAuthFailure(
  operation: string,
  correlationId: string,
  error: unknown,
  context: AuthErrorContext,
  started: number,
): AuthActionState {
  const mapped = classifyAuthError(toAuthErrorInput(error), context);
  logAuthFailure(operation, correlationId, mapped, Date.now() - started);
  if (
    (context === "recovery_request" || context === "resend") &&
    publicAuthOutcome(context, mapped) === "neutral"
  ) {
    return {
      info: context === "resend" ? RESEND_ACCEPTED : RESET_REQUEST_ACCEPTED,
    };
  }
  return { error: mapped.message };
}

export async function signInAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""), "/hives");
  const correlationId = await requestCorrelationId();
  const operation = "signIn";

  if (!email || !password) {
    const mapped = localAuthFailure(
      "email_or_password_missing",
      "Enter your email and password to log in.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }
  if (!isPlausibleEmail(email)) {
    const mapped = localAuthFailure(
      "email_invalid",
      "Enter a valid email address.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }

  const started = Date.now();
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    const durationMs = Date.now() - started;
    if (error) {
      const mapped = classifyAuthError(toAuthErrorInput(error), "sign_in");
      logAuthFailure(operation, correlationId, mapped, durationMs);
      if (mapped.kind === "email_not_confirmed") {
        return { error: mapped.message, unconfirmedEmail: email };
      }
      return { error: mapped.message };
    }
  } catch (caught) {
    const mapped = classifyAuthError(toAuthErrorInput(caught), "sign_in");
    logAuthFailure(operation, correlationId, mapped, Date.now() - started);
    return { error: mapped.message };
  }

  await clearRecoveryCookies();
  logAuthInfo(operation, correlationId, "sign_in_accepted", Date.now() - started);
  redirect(next);
}

export async function signUpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""), "/hives");
  const correlationId = await requestCorrelationId();
  const operation = "signUp";

  if (!email || !password) {
    const mapped = localAuthFailure(
      "email_or_password_missing",
      "Enter your email and password to create an account.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }
  if (!isPlausibleEmail(email)) {
    const mapped = localAuthFailure(
      "email_invalid",
      "Enter a valid email address.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    const mapped = localAuthFailure(
      "password_policy",
      `Use a password between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }

  const appOrigin = await requestAppOrigin();
  const started = Date.now();
  let outcome: "check_email" | "session" | "error" = "check_email";
  let failure: AuthActionState | null = null;

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: authEmailRedirectTo(appOrigin, next),
        data: name ? { full_name: name } : undefined,
      },
    });
    const durationMs = Date.now() - started;
    if (error) {
      const mapped = classifyAuthError(toAuthErrorInput(error), "sign_up");
      if (publicAuthOutcome("sign_up", mapped) === "neutral") {
        logAuthInfo(operation, correlationId, "sign_up_check_email", durationMs);
        outcome = "check_email";
      } else {
        logAuthFailure(operation, correlationId, mapped, durationMs);
        outcome = "error";
        failure = { error: mapped.message };
      }
    } else if (data.session) {
      logAuthInfo(operation, correlationId, "sign_up_accepted", durationMs);
      outcome = "session";
    } else {
      logAuthInfo(operation, correlationId, "sign_up_check_email", durationMs);
      outcome = "check_email";
    }
  } catch (caught) {
    const mapped = classifyAuthError(toAuthErrorInput(caught), "sign_up");
    if (publicAuthOutcome("sign_up", mapped) === "neutral") {
      logAuthInfo(
        operation,
        correlationId,
        "sign_up_check_email",
        Date.now() - started,
      );
      outcome = "check_email";
    } else {
      logAuthFailure(operation, correlationId, mapped, Date.now() - started);
      outcome = "error";
      failure = { error: mapped.message };
    }
  }

  if (outcome === "error") {
    return failure ?? { error: "Something went wrong. Try again." };
  }
  if (outcome === "session") {
    await clearRecoveryCookies();
    redirect(next);
  }
  redirect(checkEmailPath(next, email));
}

export async function signOutAction(): Promise<void> {
  const correlationId = await requestCorrelationId();
  const operation = "signOut";
  const started = Date.now();
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      const mapped = classifyAuthError(toAuthErrorInput(error), "sign_in");
      logAuthFailure(operation, correlationId, mapped, Date.now() - started);
    } else {
      logAuthInfo(
        operation,
        correlationId,
        "sign_out_accepted",
        Date.now() - started,
      );
    }
  } catch (caught) {
    const mapped = classifyAuthError(toAuthErrorInput(caught), "sign_in");
    logAuthFailure(operation, correlationId, mapped, Date.now() - started);
  }
  await clearRecoveryCookies();
  redirect("/");
}

function parsePurpose(value: string): AuthOtpPurpose | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "signup" || normalized === "recovery") {
    return normalized;
  }
  return null;
}

export async function verifyEmailOtpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const purpose = parsePurpose(String(formData.get("purpose") ?? ""));
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const token = normalizeOtpToken(String(formData.get("token") ?? ""));
  const next = safeNextPath(String(formData.get("next") ?? ""), "/hives");
  const correlationId = await requestCorrelationId();
  const operation =
    purpose === "recovery" ? "verifyRecoveryOtp" : "verifySignupOtp";

  if (!purpose) {
    const mapped = localAuthFailure(
      "email_invalid",
      "Something went wrong. Try again.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }
  if (!isPlausibleEmail(email)) {
    const mapped = localAuthFailure(
      "email_invalid",
      "Enter a valid email address.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }
  if (!isPlausibleOtpToken(token)) {
    const mapped = localAuthFailure(
      "email_invalid",
      "Enter the verification code from your email (usually six digits).",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message, otpChallenge: { purpose, email } };
  }

  const started = Date.now();
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await verifyEmailOtp(supabase, {
      email,
      token,
      type: otpTypeForPurpose(purpose),
    });
    const durationMs = Date.now() - started;
    if (error) {
      const mapped = classifyAuthError(toAuthErrorInput(error), "otp_verify");
      logAuthFailure(operation, correlationId, mapped, durationMs);
      return { error: mapped.message, otpChallenge: { purpose, email } };
    }
  } catch (caught) {
    const failure = providerAuthFailure(
      operation,
      correlationId,
      caught,
      "otp_verify",
      started,
    );
    return { ...failure, otpChallenge: { purpose, email } };
  }

  logAuthInfo(operation, correlationId, "otp_verified", Date.now() - started);

  if (purpose === "recovery") {
    await issueRecoveryMarker();
    redirect(RESET_PASSWORD_PATH);
  }

  redirect(`/login?next=${encodeURIComponent(next)}&info=email_confirmed`);
}

function resetAccepted(email: string): AuthActionState {
  return {
    info: RESET_REQUEST_ACCEPTED,
    otpChallenge: { purpose: "recovery", email },
  };
}

function resendAccepted(email: string): AuthActionState {
  return {
    info: RESEND_ACCEPTED,
    otpChallenge: { purpose: "signup", email },
  };
}

export async function requestPasswordResetAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const correlationId = await requestCorrelationId();
  const operation = "requestPasswordReset";

  if (!isPlausibleEmail(email)) {
    const mapped = localAuthFailure(
      "email_invalid",
      "Enter a valid email address.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }

  const appOrigin = await requestAppOrigin();
  const started = Date.now();
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: passwordRecoveryEmailRedirectTo(appOrigin),
    });
    const durationMs = Date.now() - started;
    if (error) {
      const mapped = classifyAuthError(
        toAuthErrorInput(error),
        "recovery_request",
      );
      if (publicAuthOutcome("recovery_request", mapped) === "neutral") {
        logAuthInfo(
          operation,
          correlationId,
          "reset_email_accepted",
          durationMs,
        );
        return resetAccepted(email);
      }
      logAuthFailure(operation, correlationId, mapped, durationMs);
      return { error: mapped.message };
    }
  } catch (caught) {
    const failure = providerAuthFailure(
      operation,
      correlationId,
      caught,
      "recovery_request",
      started,
    );
    if (failure.info) {
      return resetAccepted(email);
    }
    return failure;
  }

  logAuthInfo(
    operation,
    correlationId,
    "reset_email_accepted",
    Date.now() - started,
  );
  return resetAccepted(email);
}

export async function resendConfirmationAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const next = safeNextPath(String(formData.get("next") ?? ""), "/hives");
  const correlationId = await requestCorrelationId();
  const operation = "resendConfirmation";

  if (!isPlausibleEmail(email)) {
    const mapped = localAuthFailure(
      "email_invalid",
      "Enter a valid email address.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }

  const appOrigin = await requestAppOrigin();
  const started = Date.now();
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: authEmailRedirectTo(appOrigin, next),
      },
    });
    const durationMs = Date.now() - started;
    if (error) {
      const mapped = classifyAuthError(toAuthErrorInput(error), "resend");
      if (publicAuthOutcome("resend", mapped) === "neutral") {
        logAuthInfo(
          operation,
          correlationId,
          "confirmation_resend_accepted",
          durationMs,
        );
        return resendAccepted(email);
      }
      logAuthFailure(operation, correlationId, mapped, durationMs);
      return { error: mapped.message };
    }
  } catch (caught) {
    const failure = providerAuthFailure(
      operation,
      correlationId,
      caught,
      "resend",
      started,
    );
    if (failure.info) {
      return resendAccepted(email);
    }
    return failure;
  }

  logAuthInfo(
    operation,
    correlationId,
    "confirmation_resend_accepted",
    Date.now() - started,
  );
  return resendAccepted(email);
}

export async function updatePasswordFromRecoveryAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const correlationId = await requestCorrelationId();
  const operation = "updatePasswordFromRecovery";
  const cookieStore = await cookies();

  if (!isRecoveryCookieValue(cookieStore.get(RECOVERY_COOKIE_NAME)?.value)) {
    const mapped = localAuthFailure(
      "recovery_cookie_missing",
      "Verify the code from your reset email again, or change your password from your account.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }

  const issue = newPasswordIssue(password, confirm);
  if (issue) {
    const mapped = localAuthFailure(
      issue === "mismatch"
        ? "password_mismatch"
        : issue === "missing"
          ? "password_missing"
          : "password_policy",
      newPasswordIssueMessage(issue),
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }

  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    await clearRecoveryCookies();
    const mapped = localAuthFailure(
      "session_missing",
      "Your session expired. Request a new reset email, or log in again.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }

  const started = Date.now();
  try {
    const { error } = await auth.client.auth.updateUser({ password });
    const durationMs = Date.now() - started;
    if (error) {
      const mapped = classifyAuthError(
        toAuthErrorInput(error),
        "password_update",
      );
      if (mapped.kind === "session_expired") {
        await clearRecoveryCookies();
      }
      logAuthFailure(operation, correlationId, mapped, durationMs);
      return { error: mapped.message };
    }
  } catch (caught) {
    return providerAuthFailure(
      operation,
      correlationId,
      caught,
      "password_update",
      started,
    );
  }

  logAuthInfo(operation, correlationId, "password_updated", Date.now() - started);
  await clearRecoveryCookies();
  try {
    await auth.client.auth.signOut();
  } catch {
    // Ignore post-reset signOut error; session cookies are cleared on redirect.
  }
  redirect("/login?info=password_updated");
}

export async function backToLoginFromRecoveryAction(): Promise<void> {
  const correlationId = await requestCorrelationId();
  const operation = "recoveryBackToLogin";
  const started = Date.now();
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      const mapped = classifyAuthError(toAuthErrorInput(error), "sign_in");
      logAuthFailure(operation, correlationId, mapped, Date.now() - started);
    } else {
      logAuthInfo(
        operation,
        correlationId,
        "recovery_exit_accepted",
        Date.now() - started,
      );
    }
  } catch (caught) {
    const mapped = classifyAuthError(toAuthErrorInput(caught), "sign_in");
    logAuthFailure(operation, correlationId, mapped, Date.now() - started);
  }
  await clearRecoveryCookies();
  redirect("/login");
}

export async function changePasswordAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const currentPassword = String(formData.get("current_password") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const correlationId = await requestCorrelationId();
  const operation = "changePassword";

  if (!currentPassword) {
    const mapped = localAuthFailure(
      "password_missing",
      "Enter your current password.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }

  const issue = newPasswordIssue(password, confirm);
  if (issue) {
    const mapped = localAuthFailure(
      issue === "mismatch"
        ? "password_mismatch"
        : issue === "missing"
          ? "password_missing"
          : "password_policy",
      newPasswordIssueMessage(issue),
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }

  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    const mapped = localAuthFailure(
      "session_missing",
      "Your session expired. Log in again, then change your password.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }

  const email = auth.email ? normalizeEmail(auth.email) : "";
  if (!isPlausibleEmail(email)) {
    const mapped = localAuthFailure(
      "session_missing",
      "Your session expired. Log in again, then change your password.",
    );
    logAuthFailure(operation, correlationId, mapped);
    return { error: mapped.message };
  }

  const started = Date.now();
  try {
    const { error: reauthError } = await auth.client.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (reauthError) {
      const mapped = classifyAuthError(
        toAuthErrorInput(reauthError),
        "password_update",
      );
      logAuthFailure(operation, correlationId, mapped, Date.now() - started);
      return { error: mapped.message };
    }

    if (password === currentPassword) {
      const mapped = classifyAuthError(
        { code: "same_password" },
        "password_update",
      );
      logAuthFailure(operation, correlationId, mapped, Date.now() - started);
      return { error: mapped.message };
    }

    const { error } = await auth.client.auth.updateUser({ password });
    const durationMs = Date.now() - started;
    if (error) {
      const mapped = classifyAuthError(
        toAuthErrorInput(error),
        "password_update",
      );
      logAuthFailure(operation, correlationId, mapped, durationMs);
      return { error: mapped.message };
    }
  } catch (caught) {
    return providerAuthFailure(
      operation,
      correlationId,
      caught,
      "password_update",
      started,
    );
  }

  await clearRecoveryCookies();
  logAuthInfo(operation, correlationId, "password_updated", Date.now() - started);
  return { info: PASSWORD_UPDATED };
}
