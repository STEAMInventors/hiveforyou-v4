export const SIGN_IN_HELP_TITLE = "Forgot which email you used?";

export const SIGN_IN_HELP_BODY =
  "HiveForYou uses your email address to sign in. There is no separate username. Try the inbox you normally use for health or family records, work versus personal addresses, and any aliases your provider forwards. Check saved logins in your password manager.";

export const OTP_LINK_USED_OR_EXPIRED =
  "That link has already been used or has expired. Enter the code from the email, or send a new one.";

export const AUTH_LINK_ERROR_CODES = [
  "link_expired",
  "link_reused",
  "link_invalid",
  "link_unavailable",
  "link_rate_limited",
  "otp_expired",
] as const;

export type AuthLinkErrorCode = (typeof AUTH_LINK_ERROR_CODES)[number];

export function isAuthLinkErrorCode(value: string | null | undefined): value is AuthLinkErrorCode {
  return AUTH_LINK_ERROR_CODES.includes(value as AuthLinkErrorCode);
}

export function authLinkErrorMessage(code: string | null | undefined): string | null {
  if (!isAuthLinkErrorCode(code)) {
    return null;
  }
  if (code === "otp_expired") {
    return OTP_LINK_USED_OR_EXPIRED;
  }
  switch (code) {
    case "link_expired":
    case "link_reused":
    case "link_invalid":
      return OTP_LINK_USED_OR_EXPIRED;
    case "link_unavailable":
      return "We couldn't verify that link because the account service is unavailable. Try again in a few minutes.";
    case "link_rate_limited":
      return "Too many attempts to open that link. Wait a few minutes and try again.";
  }
}