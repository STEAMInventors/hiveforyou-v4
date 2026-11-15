"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import { logAuthFailure, logAuthInfo, requestCorrelationId } from "./action-support";
import { classifyAuthError, toAuthErrorInput } from "./map-auth-error";

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
  redirect("/");
}