export const SIGN_UP_CHECK_EMAIL_TITLE = "Check your email";

export const SIGN_UP_CHECK_EMAIL_BODY =
  "If this address can be used for a new account, we sent a confirmation email. Enter the code from that message below, or open the link in this browser, then log in. If you already have an account, log in or reset your password.";

export const RESET_REQUEST_ACCEPTED =
  "If an account exists for that email, we sent a reset message. Enter the verification code from that email below—do not open the link if your mail client previews links. You can also open the link in this browser if you prefer.";

export const EMAIL_CONFIRMED = "Your email is confirmed. Log in to continue.";

export const SIGN_IN_HELP_TITLE = "Forgot which email you used?";

export const SIGN_IN_HELP_BODY =
  "HiveForYou uses your email address as your sign-in ID. There is no separate username. Try the inbox you normally use for health or family records, work versus personal addresses, and any aliases your provider forwards. Check saved logins in your password manager. If you still cannot sign in, use Forgot password with an address you might have used—we will not tell you whether that address is registered.";

export const RESEND_ACCEPTED =
  "If that email is waiting for confirmation, we sent another link. Check your inbox and spam folder, and open it in this browser.";

export const PASSWORD_UPDATED = "Your password is updated.";

export const INVALID_CREDENTIALS_MESSAGE =
  "That email or password is incorrect. Try again, or reset your password.";

export const EMAIL_NOT_CONFIRMED_MESSAGE =
  "Confirm your email before logging in. Check your inbox for the confirmation link, or send it again.";

export const AUTH_LINK_ERROR_CODES = [
  "link_expired",
  "link_reused",
  "link_invalid",
  "link_unavailable",
  "link_rate_limited",
] as const;

export type AuthLinkErrorCode = (typeof AUTH_LINK_ERROR_CODES)[number];

export function isAuthLinkErrorCode(value: string | null | undefined): value is AuthLinkErrorCode {
  return AUTH_LINK_ERROR_CODES.includes(value as AuthLinkErrorCode);
}

export function authInfoMessage(code: string | null | undefined): string | null {
  if (code === "password_updated") {
    return PASSWORD_UPDATED;
  }
  if (code === "email_confirmed") {
    return EMAIL_CONFIRMED;
  }
  return null;
}

export function authLinkErrorMessage(
  code: string | null | undefined,
  surface: "login" | "recovery",
): string | null {
  if (!isAuthLinkErrorCode(code)) {
    return null;
  }
  if (surface === "recovery") {
    switch (code) {
      case "link_expired":
        return "That reset link has expired. Enter your email to send a new one.";
      case "link_reused":
        return "That reset link was already used, or it was opened in a different browser. Request a new one.";
      case "link_unavailable":
        return "We couldn't verify that link because the account service is unavailable. Try again in a few minutes.";
      case "link_rate_limited":
        return "Too many attempts to open that link. Wait a few minutes and try again.";
      case "link_invalid":
        return "That reset link is invalid or expired. Enter your email to send a new one.";
    }
  }
  switch (code) {
    case "link_expired":
      return "That link has expired. Request a new confirmation or password reset email.";
    case "link_reused":
      return "That link was already used, or it was opened in a different browser. Request a new one.";
    case "link_unavailable":
      return "We couldn't verify that link because the account service is unavailable. Try opening it again in a few minutes.";
    case "link_rate_limited":
      return "Too many attempts to open that link. Wait a few minutes and try again.";
    case "link_invalid":
      return "That link is invalid or expired. Request a new one, or log in with your password.";
  }
}
