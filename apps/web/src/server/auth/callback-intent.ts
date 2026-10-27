import { safeEmailOtpType } from "./otp";
import { RESET_PASSWORD_PATH, isRecoveryOtpType } from "./recovery";
import { safeNextPath } from "./redirects";

export { safeEmailOtpType };

export function callbackRecoveryIntent(input: {
  next: string | null;
  type: string | null;
}): boolean {
  if (safeNextPath(input.next, "/hives") === RESET_PASSWORD_PATH) {
    return true;
  }
  return isRecoveryOtpType(input.type);
}

export function callbackSuccessPath(
  recoveryIntent: boolean,
  next: string | null,
): string {
  if (recoveryIntent) {
    return RESET_PASSWORD_PATH;
  }
  return safeNextPath(next, "/hives");
}
