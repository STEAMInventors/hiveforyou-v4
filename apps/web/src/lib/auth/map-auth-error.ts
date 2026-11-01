import { ErrorCode } from "@hiveforyou/contracts/errors/v1";

import {
  EMAIL_NOT_CONFIRMED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  RESEND_ACCEPTED,
  RESET_REQUEST_ACCEPTED,
  SIGN_UP_CHECK_EMAIL_BODY,
  type AuthLinkErrorCode,
} from "./messages";

export type AuthErrorContext =
  | "sign_in"
  | "sign_up"
  | "recovery_request"
  | "resend"
  | "password_update"
  | "callback"
  | "otp_verify";

export type AuthFailureKind =
  | "invalid_email"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "conceal_account"
  | "weak_password"
  | "same_password"
  | "rate_limited"
  | "unavailable"
  | "session_expired"
  | "signup_disabled"
  | "user_banned"
  | "email_not_authorized"
  | "link_expired"
  | "link_reused"
  | "link_invalid"
  | "unknown";

export type MappedAuthError = {
  kind: AuthFailureKind;
  message: string;
  errorCode: (typeof ErrorCode)[keyof typeof ErrorCode];
  retryable: boolean;
  diagnostic: string;
};

export type AuthErrorInput = {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
};

const KIND_BY_CODE: Record<string, AuthFailureKind> = {
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  provider_email_needs_verification: "email_not_confirmed",
  weak_password: "weak_password",
  same_password: "same_password",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "rate_limited",
  over_sms_send_rate_limit: "rate_limited",
  otp_expired: "link_expired",
  invalid_otp: "link_invalid",
  flow_state_expired: "link_expired",
  flow_state_not_found: "link_reused",
  bad_code_verifier: "link_reused",
  session_expired: "session_expired",
  session_not_found: "session_expired",
  refresh_token_not_found: "session_expired",
  refresh_token_already_used: "session_expired",
  request_timeout: "unavailable",
  hook_timeout: "unavailable",
  hook_timeout_after_retry: "unavailable",
  signup_disabled: "signup_disabled",
  email_provider_disabled: "signup_disabled",
  user_banned: "user_banned",
  email_address_invalid: "invalid_email",
  email_address_not_authorized: "email_not_authorized",
};

export function sanitizeDiagnostic(value: string | undefined): string {
  if (value && /^[a-z0-9_]{1,64}$/.test(value)) {
    return value;
  }
  return "unclassified";
}

export function toAuthErrorInput(error: unknown): AuthErrorInput {
  if (!error || typeof error !== "object") {
    return {};
  }
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    name?: unknown;
    message?: unknown;
  };
  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    status: typeof candidate.status === "number" ? candidate.status : undefined,
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    message: typeof candidate.message === "string" ? candidate.message : undefined,
  };
}

function safeCode(code: string | undefined): string | undefined {
  if (!code) {
    return undefined;
  }
  const normalized = code.trim().toLowerCase();
  return /^[a-z0-9_]{1,64}$/.test(normalized) ? normalized : undefined;
}

function isAccountSignal(code: string | undefined, message: string): boolean {
  return (
    code === "user_not_found" ||
    code === "email_exists" ||
    code === "user_already_exists" ||
    message === "user already registered"
  );
}

function diagnosticFor(code: string | undefined, status: number | undefined, fallback: string): string {
  if (code) {
    return code;
  }
  if (typeof status === "number" && status >= 400 && status <= 599) {
    return `http_${status}`;
  }
  return fallback;
}

type ResolvedKind = {
  kind: AuthFailureKind;
  diagnostic: string;
};

function resolveKind(input: AuthErrorInput, context: AuthErrorContext): ResolvedKind {
  const code = safeCode(input.code);
  const message = (input.message ?? "").trim().toLowerCase();

  if (input.name === "AuthRetryableFetchError") {
    return { kind: "unavailable", diagnostic: "fetch_failed" };
  }

  if (isAccountSignal(code, message)) {
    const diagnostic = diagnosticFor(code, input.status, "account_signal");
    if (context === "sign_in") {
      return { kind: "invalid_credentials", diagnostic };
    }
    if (context === "sign_up" || context === "recovery_request" || context === "resend") {
      return { kind: "conceal_account", diagnostic };
    }
    if (context === "callback" || context === "otp_verify") {
      return { kind: "link_invalid", diagnostic };
    }
    return { kind: "unknown", diagnostic };
  }

  if (code === "validation_failed") {
    if (message.includes("email")) {
      return { kind: "invalid_email", diagnostic: "validation_failed" };
    }
    if (message.includes("password")) {
      return { kind: "weak_password", diagnostic: "validation_failed" };
    }
    return { kind: "unknown", diagnostic: "validation_failed" };
  }

  if (code === "reauthentication_needed" || code === "reauthentication_not_valid") {
    return { kind: "invalid_credentials", diagnostic: code };
  }

  if (code === "bad_jwt") {
    if (context === "callback") {
      return { kind: "link_invalid", diagnostic: code };
    }
    return { kind: "session_expired", diagnostic: code };
  }

  if (code && KIND_BY_CODE[code]) {
    return { kind: KIND_BY_CODE[code], diagnostic: code };
  }

  if (input.status === 429) {
    return { kind: "rate_limited", diagnostic: diagnosticFor(code, input.status, "http_429") };
  }

  if (message === "invalid login credentials") {
    return { kind: "invalid_credentials", diagnostic: diagnosticFor(code, input.status, "invalid_credentials") };
  }
  if (message === "email not confirmed") {
    return { kind: "email_not_confirmed", diagnostic: diagnosticFor(code, input.status, "email_not_confirmed") };
  }
  if (
    (context === "callback" || context === "otp_verify") &&
    message === "email link is invalid or has expired"
  ) {
    return { kind: "link_invalid", diagnostic: diagnosticFor(code, input.status, "link_invalid") };
  }

  if (input.status === 0 || (typeof input.status === "number" && input.status >= 500 && input.status <= 599)) {
    return { kind: "unavailable", diagnostic: diagnosticFor(code, input.status, "fetch_failed") };
  }

  return { kind: "unknown", diagnostic: diagnosticFor(code, input.status, "unclassified") };
}

function messageFor(kind: AuthFailureKind, input: AuthErrorInput, context: AuthErrorContext): string {
  if (context === "otp_verify") {
    if (kind === "link_expired") {
      return "That code has expired. Request a new email and try again.";
    }
    if (kind === "link_reused") {
      return "That code was already used. Request a new email and try again.";
    }
    if (kind === "link_invalid" || kind === "invalid_credentials") {
      return "That code is incorrect. Check the email and try again.";
    }
  }
  if (kind === "weak_password") {
    const message = (input.message ?? "").toLowerCase();
    if (
      message.includes("easy to guess") ||
      message.includes("known to be weak") ||
      message.includes("pwned") ||
      message.includes("leaked")
    ) {
      return "That password is too easy to guess. Choose a different one, using 10 to 72 characters.";
    }
    return "That password doesn't meet the requirements. Use 10 to 72 characters.";
  }
  if (kind === "invalid_credentials" && context === "password_update") {
    return "The current password is incorrect.";
  }
  if (kind === "conceal_account") {
    if (context === "recovery_request") {
      return RESET_REQUEST_ACCEPTED;
    }
    if (context === "resend") {
      return RESEND_ACCEPTED;
    }
    return SIGN_UP_CHECK_EMAIL_BODY;
  }
  switch (kind) {
    case "invalid_email":
      return "Enter a valid email address.";
    case "invalid_credentials":
      return INVALID_CREDENTIALS_MESSAGE;
    case "email_not_confirmed":
      return EMAIL_NOT_CONFIRMED_MESSAGE;
    case "same_password":
      return "Choose a password that's different from your current one.";
    case "rate_limited":
      return "Too many attempts. Wait a few minutes and try again.";
    case "unavailable":
      return "We couldn't reach the account service. Check your connection and try again.";
    case "session_expired":
      return "Your session expired. Request a new reset link, or log in again.";
    case "signup_disabled":
      return "Email accounts are unavailable right now. Try again later.";
    case "user_banned":
      return "This account can't sign in. Contact support if you need help.";
    case "email_not_authorized":
      return "That email address can't be used to create an account.";
    case "link_expired":
      return "That link has expired. Request a new one.";
    case "link_reused":
      return "That link was already used, or it was opened in a different browser. Request a new one.";
    case "link_invalid":
      return "That link is invalid or expired. Request a new one.";
    case "unknown":
      return "Something went wrong. Try again.";
    default:
      return "Something went wrong. Try again.";
  }
}

function envelopeFor(kind: AuthFailureKind): Pick<MappedAuthError, "errorCode" | "retryable"> {
  switch (kind) {
    case "invalid_email":
    case "weak_password":
    case "same_password":
    case "email_not_authorized":
      return { errorCode: ErrorCode.INVALID_REQUEST, retryable: false };
    case "rate_limited":
      return { errorCode: ErrorCode.AUTH_FAILED, retryable: true };
    case "unavailable":
      return { errorCode: ErrorCode.DEPENDENCY_UNAVAILABLE, retryable: true };
    case "signup_disabled":
      return { errorCode: ErrorCode.DEPENDENCY_UNAVAILABLE, retryable: false };
    case "unknown":
      return { errorCode: ErrorCode.DEPENDENCY_UNAVAILABLE, retryable: false };
    default:
      return { errorCode: ErrorCode.AUTH_FAILED, retryable: false };
  }
}

export function classifyAuthError(input: AuthErrorInput, context: AuthErrorContext): MappedAuthError {
  const resolved = resolveKind(input, context);
  const envelope = envelopeFor(resolved.kind);
  return {
    kind: resolved.kind,
    message: messageFor(resolved.kind, input, context),
    errorCode: envelope.errorCode,
    retryable: envelope.retryable,
    diagnostic: sanitizeDiagnostic(resolved.diagnostic),
  };
}

export function linkErrorCodeForKind(kind: AuthFailureKind): AuthLinkErrorCode {
  switch (kind) {
    case "link_expired":
      return "link_expired";
    case "link_reused":
      return "link_reused";
    case "rate_limited":
      return "link_rate_limited";
    case "unavailable":
      return "link_unavailable";
    default:
      return "link_invalid";
  }
}

export type PublicAuthFlow = "recovery_request" | "resend" | "sign_up";

/** Neutral means the caller must use the same response as a successful request. */
export function publicAuthOutcome(
  flow: PublicAuthFlow,
  mapped: MappedAuthError | null,
): "neutral" | "error" {
  if (!mapped || mapped.kind === "conceal_account") {
    return "neutral";
  }
  if (flow === "sign_up" && mapped.kind === "email_not_confirmed") {
    return "neutral";
  }
  return "error";
}

export function authLogLevel(mapped: MappedAuthError): "info" | "warn" {
  if (mapped.kind === "unknown" || mapped.kind === "unavailable" || mapped.kind === "rate_limited") {
    return "warn";
  }
  return "info";
}

export function localAuthFailure(
  diagnostic:
    | "email_invalid"
    | "email_or_password_missing"
    | "password_policy"
    | "password_mismatch"
    | "password_missing"
    | "recovery_cookie_missing"
    | "session_missing",
  message: string,
): MappedAuthError {
  const invalidRequest =
    diagnostic === "email_invalid" ||
    diagnostic === "password_policy" ||
    diagnostic === "password_mismatch" ||
    diagnostic === "password_missing" ||
    diagnostic === "email_or_password_missing";
  const kind: AuthFailureKind =
    diagnostic === "recovery_cookie_missing" || diagnostic === "session_missing"
      ? "session_expired"
      : diagnostic === "password_policy" ||
          diagnostic === "password_mismatch" ||
          diagnostic === "password_missing"
        ? "weak_password"
        : "invalid_email";
  return {
    kind,
    message,
    errorCode: invalidRequest ? ErrorCode.INVALID_REQUEST : ErrorCode.AUTH_FAILED,
    retryable: false,
    diagnostic,
  };
}
