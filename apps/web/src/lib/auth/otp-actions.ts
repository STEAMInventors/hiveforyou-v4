"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import { providerAuthFailure } from "./action-outcome";
import { issueRecoveryMarker, logAuthFailure, logAuthInfo, requestCorrelationId } from "./action-support";
import type { AuthActionState, AuthOtpPurpose } from "./auth-state";
import { classifyAuthError, localAuthFailure, toAuthErrorInput } from "./map-auth-error";
import { otpTypeForPurpose, verifyEmailOtp } from "./otp";
import { RESET_PASSWORD_PATH } from "./recovery";
import { safeNextPath } from "./redirects";
import { isPlausibleEmail, isPlausibleOtpToken, normalizeEmail, normalizeOtpToken } from "./validation";

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
  const route = purpose === "recovery" ? "auth.verify_recovery_code" : "auth.verify_signup_code";

  if (!purpose) {
    const mapped = localAuthFailure("email_invalid", "Something went wrong. Try again.");
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message };
  }
  if (!isPlausibleEmail(email)) {
    const mapped = localAuthFailure("email_invalid", "Enter a valid email address.");
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message };
  }
  if (!isPlausibleOtpToken(token)) {
    const mapped = localAuthFailure(
      "email_invalid",
      "Enter the verification code from your email (usually six digits).",
    );
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message, otpChallenge: { purpose, email } };
  }

  const supabase = await createServerSupabaseClient();
  const started = Date.now();
  try {
    const { error } = await verifyEmailOtp(supabase, {
      email,
      token,
      type: otpTypeForPurpose(purpose),
    });
    const durationMs = Date.now() - started;
    if (error) {
      const mapped = classifyAuthError(toAuthErrorInput(error), "otp_verify");
      logAuthFailure(route, correlationId, mapped, durationMs);
      return { error: mapped.message, otpChallenge: { purpose, email } };
    }
  } catch (caught) {
    const failure = providerAuthFailure(route, correlationId, caught, "otp_verify", started);
    return { ...failure, otpChallenge: { purpose, email } };
  }

  logAuthInfo(route, correlationId, "otp_verified", Date.now() - started);

  if (purpose === "recovery") {
    await issueRecoveryMarker();
    redirect(RESET_PASSWORD_PATH);
  }

  redirect(`/login?next=${encodeURIComponent(next)}&info=email_confirmed`);
}
