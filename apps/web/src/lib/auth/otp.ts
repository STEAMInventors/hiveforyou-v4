import type { EmailOtpType, SupabaseClient } from "@supabase/supabase-js";

const VERIFY_OTP_TYPES = new Set<string>([
  "signup",
  "recovery",
  "invite",
  "magiclink",
  "email_change",
  "email",
]);

export type EmailOtpPurpose = "signup" | "recovery";

export function otpTypeForPurpose(purpose: EmailOtpPurpose): EmailOtpType {
  return purpose === "recovery" ? "recovery" : "signup";
}

/** Allowed Supabase email OTP types for token_hash verification (no arbitrary strings). */
export function safeEmailOtpType(value: string | null | undefined): EmailOtpType | null {
  if (!value?.trim()) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!VERIFY_OTP_TYPES.has(normalized)) {
    return null;
  }
  return normalized as EmailOtpType;
}

export type VerifyEmailOtpInput =
  | { token_hash: string; type: EmailOtpType }
  | { email: string; token: string; type: EmailOtpType };

export async function verifyEmailOtp(
  supabase: SupabaseClient,
  input: VerifyEmailOtpInput,
): Promise<{ error: { code?: string; message?: string; status?: number } | null }> {
  if ("token_hash" in input) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: input.token_hash,
      type: input.type,
    });
    return { error: error ?? null };
  }

  const { error } = await supabase.auth.verifyOtp({
    email: input.email,
    token: input.token,
    type: input.type,
  });
  return { error: error ?? null };
}
