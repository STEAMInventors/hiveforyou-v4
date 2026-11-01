export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 72;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isPlausibleEmail(value: string): boolean {
  return value.length > 0 && value.length <= 320 && EMAIL_PATTERN.test(value);
}

export type NewPasswordIssue = "missing" | "mismatch" | "policy";

export function newPasswordIssue(password: string, confirm: string): NewPasswordIssue | null {
  if (!password || !confirm) {
    return "missing";
  }
  if (password !== confirm) {
    return "mismatch";
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return "policy";
  }
  return null;
}

const OTP_MIN_LENGTH = 6;
const OTP_MAX_LENGTH = 10;

export function normalizeOtpToken(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export function isPlausibleOtpToken(value: string): boolean {
  const normalized = normalizeOtpToken(value);
  return (
    normalized.length >= OTP_MIN_LENGTH &&
    normalized.length <= OTP_MAX_LENGTH &&
    /^[0-9]+$/.test(normalized)
  );
}

export function newPasswordIssueMessage(issue: NewPasswordIssue): string {
  switch (issue) {
    case "missing":
      return "Enter your new password twice.";
    case "mismatch":
      return "Those passwords don't match.";
    case "policy":
      return `Use a password between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`;
  }
}
