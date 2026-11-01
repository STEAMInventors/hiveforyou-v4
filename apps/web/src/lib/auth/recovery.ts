export const RECOVERY_COOKIE_NAME = "hfy_recovery_password";
export const RESET_PASSWORD_PATH = "/reset-password";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const ACCOUNT_PASSWORD_PATH = "/account/password";
export const SIGN_IN_HELP_PATH = "/sign-in-help";
export const RECOVERY_COOKIE_MAX_AGE_SECONDS = 15 * 60;

export function isRecoveryCookieValue(value: string | undefined): boolean {
  return value === "1";
}

/** Both session and recovery marker are required to show the reset-password form. */
export function isRecoveryResetSession(signedIn: boolean, recoveryCookieValue: string | undefined): boolean {
  return signedIn && isRecoveryCookieValue(recoveryCookieValue);
}

export function isRecoveryOtpType(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === "recovery";
}

export function recoveryCookieIsSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

export function recoveryCookieOptions(secure: boolean, maxAge = RECOVERY_COOKIE_MAX_AGE_SECONDS) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge,
  };
}
