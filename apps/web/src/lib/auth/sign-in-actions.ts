"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import { providerAuthFailure } from "./action-outcome";
import { logAuthFailure, logAuthInfo, requestAppOrigin, requestCorrelationId } from "./action-support";
import type { SignInActionState } from "./auth-state";
import { authEmailRedirectTo } from "./auth-callback-url";
import { classifyAuthError, localAuthFailure, toAuthErrorInput } from "./map-auth-error";
import { resolvePostSignInPath } from "./post-sign-in";
import type { StartingView } from "./profile";
import { safeNextPath } from "./redirects";
import {
  isPlausibleEmail,
  isSignInOtpCode,
  normalizeEmail,
  normalizeOtpToken,
} from "./validation";

export async function requestSignInCodeAction(
  _prev: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const next = safeNextPath(String(formData.get("next") ?? ""), "/hives");
  const correlationId = await requestCorrelationId();
  const route = "auth.request_sign_in_code";

  if (!isPlausibleEmail(email)) {
    const mapped = localAuthFailure("email_invalid", "Enter a valid email address.");
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message, field: "email" };
  }

  const appOrigin = await requestAppOrigin();
  const supabase = await createServerSupabaseClient();
  const started = Date.now();
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: authEmailRedirectTo(appOrigin, next),
      },
    });
    const durationMs = Date.now() - started;
    if (error) {
      const mapped = classifyAuthError(toAuthErrorInput(error), "otp_request");
      logAuthFailure(route, correlationId, mapped, durationMs);
      return { error: mapped.message, field: "email", email, step: "email" };
    }
  } catch (caught) {
    const failure = providerAuthFailure(route, correlationId, caught, "otp_request", started);
    return { ...failure, field: "email", email, step: "email" };
  }

  logAuthInfo(route, correlationId, "sign_in_code_sent", Date.now() - started);
  return { step: "code", email, next };
}

export async function verifySignInCodeAction(
  _prev: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const token = normalizeOtpToken(String(formData.get("token") ?? ""));
  const next = safeNextPath(String(formData.get("next") ?? ""), "/hives");
  const correlationId = await requestCorrelationId();
  const route = "auth.verify_sign_in_code";

  if (!isPlausibleEmail(email)) {
    const mapped = localAuthFailure("email_invalid", "Enter a valid email address.");
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message, field: "email", step: "email" };
  }
  if (!isSignInOtpCode(token)) {
    const mapped = localAuthFailure(
      "email_invalid",
      "Enter the six-digit code from your email.",
    );
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message, field: "code", email, step: "code", next };
  }

  const supabase = await createServerSupabaseClient();
  const started = Date.now();
  try {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    const durationMs = Date.now() - started;
    if (error) {
      const mapped = classifyAuthError(toAuthErrorInput(error), "otp_verify");
      logAuthFailure(route, correlationId, mapped, durationMs);
      return { error: mapped.message, field: "code", email, step: "code", next };
    }
  } catch (caught) {
    const failure = providerAuthFailure(route, correlationId, caught, "otp_verify", started);
    return { ...failure, field: "code", email, step: "code", next };
  }

  logAuthInfo(route, correlationId, "sign_in_code_verified", Date.now() - started);
  redirect(await resolvePostSignInPath(supabase, next));
}

export async function setStartingViewAction(
  _prev: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const view = String(formData.get("startingView") ?? "").trim().toLowerCase() as StartingView;
  const next = safeNextPath(String(formData.get("next") ?? ""), "/hives");
  const correlationId = await requestCorrelationId();
  const route = "auth.set_starting_view";

  if (view !== "own" && view !== "clients") {
    const mapped = localAuthFailure("email_invalid", "Choose one to continue.");
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message, field: "startingView" };
  }

  const supabase = await createServerSupabaseClient();
  const started = Date.now();
  const { error } = await supabase.rpc("set_starting_view", { p_view: view });
  const durationMs = Date.now() - started;
  if (error) {
    const mapped = classifyAuthError(toAuthErrorInput(error), "sign_in");
    logAuthFailure(route, correlationId, mapped, durationMs);
    return { error: mapped.message, field: "startingView" };
  }

  const displayName = String(formData.get("displayName") ?? "").trim();
  if (displayName) {
    const nameStarted = Date.now();
    const { error: nameError } = await supabase.rpc("set_display_name", { p_name: displayName });
    if (nameError) {
      const mapped = classifyAuthError(toAuthErrorInput(nameError), "sign_in");
      logAuthFailure(route, correlationId, mapped, Date.now() - nameStarted);
      return { error: mapped.message, field: "displayName" };
    }
  }

  logAuthInfo(route, correlationId, "starting_view_saved", durationMs);
  redirect(safeNextPath(next, "/hives"));
}

export async function setDisplayNameAction(
  _prev: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const correlationId = await requestCorrelationId();
  const route = "auth.set_display_name";

  if (!displayName || displayName.length > 60) {
    const mapped = localAuthFailure("email_invalid", "Enter a first name between 1 and 60 characters.");
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message, field: "displayName" };
  }

  const supabase = await createServerSupabaseClient();
  const started = Date.now();
  const { error } = await supabase.rpc("set_display_name", { p_name: displayName });
  if (error) {
    const mapped = classifyAuthError(toAuthErrorInput(error), "sign_in");
    logAuthFailure(route, correlationId, mapped, Date.now() - started);
    return { error: mapped.message, field: "displayName" };
  }

  logAuthInfo(route, correlationId, "display_name_saved", Date.now() - started);
  return {};
}

export async function switchStartingViewAction(): Promise<void> {
  const correlationId = await requestCorrelationId();
  const route = "auth.switch_starting_view";
  const supabase = await createServerSupabaseClient();
  const { profile, error: readError } = await (
    await import("./profile")
  ).fetchMyProfile(supabase);
  if (readError || !profile) {
    const mapped = localAuthFailure("session_missing", "Sign in again to continue.");
    logAuthFailure(route, correlationId, mapped);
    redirect("/sign-in?next=%2Fhives");
  }

  const nextView = profile.startingView === "clients" ? "own" : "clients";
  const started = Date.now();
  const { error } = await supabase.rpc("set_starting_view", { p_view: nextView });
  if (error) {
    const mapped = classifyAuthError(toAuthErrorInput(error), "sign_in");
    logAuthFailure(route, correlationId, mapped, Date.now() - started);
    redirect("/hives");
  }
  logAuthInfo(route, correlationId, "starting_view_switched", Date.now() - started);
  redirect("/hives");
}