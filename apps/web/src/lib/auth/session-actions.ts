"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import { clearRecoveryCookies, logAuthFailure, logAuthInfo, requestAppOrigin, requestCorrelationId } from "./action-support";
import type { AuthActionState } from "./auth-state";
import { classifyAuthError, localAuthFailure, publicAuthOutcome, toAuthErrorInput } from "./map-auth-error";
import { authEmailRedirectTo } from "./auth-callback-url";
import { safeNextPath } from "./redirects";
import { isPlausibleEmail, normalizeEmail, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "./validation";

function checkEmailPath(next: string, email: string): string {
  const params = new URLSearchParams();
  params.set("checkEmail", "1");
  params.set("next", next);
  if (email) {
    params.set("email", email);
  }
  return `/register?${params.toString()}`;
}

export async function signInAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""), "/hives");
  const correlationId = await requestCorrelationId();
  const route = "auth.sign_in";

  if (!email || !password) {
    const mapped = localAuthFailure("email_or_password_missing", "Enter your email and password to log in.");
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message };
  }
  if (!isPlausibleEmail(email)) {
    const mapped = localAuthFailure("email_invalid", "Enter a valid email address.");
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message };
  }

  const supabase = await createServerSupabaseClient();
  const started = Date.now();
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    const durationMs = Date.now() - started;
    if (error) {
      const mapped = classifyAuthError(toAuthErrorInput(error), "sign_in");
      logAuthFailure(route, correlationId, mapped, durationMs);
      if (mapped.kind === "email_not_confirmed") {
        return { error: mapped.message, unconfirmedEmail: email };
      }
      return { error: mapped.message };
    }
  } catch (caught) {
    const mapped = classifyAuthError(toAuthErrorInput(caught), "sign_in");
    logAuthFailure(route, correlationId, mapped, Date.now() - started);
    return { error: mapped.message };
  }

  await clearRecoveryCookies();
  logAuthInfo(route, correlationId, "sign_in_accepted", Date.now() - started);
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
  const route = "auth.sign_up";

  if (!email || !password) {
    const mapped = localAuthFailure(
      "email_or_password_missing",
      "Enter your email and password to create an account.",
    );
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message };
  }
  if (!isPlausibleEmail(email)) {
    const mapped = localAuthFailure("email_invalid", "Enter a valid email address.");
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message };
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    const mapped = localAuthFailure(
      "password_policy",
      `Use a password between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    );
    logAuthFailure(route, correlationId, mapped);
    return { error: mapped.message };
  }

  const appOrigin = await requestAppOrigin();
  const supabase = await createServerSupabaseClient();
  const started = Date.now();
  let outcome: "check_email" | "session" | "error" = "check_email";
  let failure: AuthActionState | null = null;
  try {
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
        logAuthInfo(route, correlationId, "sign_up_check_email", durationMs);
        outcome = "check_email";
      } else {
        logAuthFailure(route, correlationId, mapped, durationMs);
        outcome = "error";
        failure = { error: mapped.message };
      }
    } else if (data.session) {
      logAuthInfo(route, correlationId, "sign_up_accepted", durationMs);
      outcome = "session";
    } else {
      logAuthInfo(route, correlationId, "sign_up_check_email", durationMs);
      outcome = "check_email";
    }
  } catch (caught) {
    const mapped = classifyAuthError(toAuthErrorInput(caught), "sign_up");
    if (publicAuthOutcome("sign_up", mapped) === "neutral") {
      logAuthInfo(route, correlationId, "sign_up_check_email", Date.now() - started);
      outcome = "check_email";
    } else {
      logAuthFailure(route, correlationId, mapped, Date.now() - started);
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
  const supabase = await createServerSupabaseClient();
  const started = Date.now();
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      const mapped = classifyAuthError(toAuthErrorInput(error), "sign_in");
      logAuthFailure("auth.sign_out", correlationId, mapped, Date.now() - started);
    } else {
      logAuthInfo("auth.sign_out", correlationId, "sign_out_accepted", Date.now() - started);
    }
  } catch (caught) {
    const mapped = classifyAuthError(toAuthErrorInput(caught), "sign_in");
    logAuthFailure("auth.sign_out", correlationId, mapped, Date.now() - started);
  }
  await clearRecoveryCookies();
  redirect("/");
}
