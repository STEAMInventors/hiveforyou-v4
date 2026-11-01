import { safeNextPath } from "./redirects";
import { RESET_PASSWORD_PATH, isRecoveryOtpType } from "./recovery";
import { safeEmailOtpType } from "./otp";

export { safeEmailOtpType };

/** Whether this callback should finish on the password reset screen. */
export function callbackRecoveryIntent(input: {
  next: string | null;
  type: string | null;
}): boolean {
  if (safeNextPath(input.next, "/hives") === RESET_PASSWORD_PATH) {
    return true;
  }
  return isRecoveryOtpType(input.type);
}

export function callbackSuccessPath(recoveryIntent: boolean, next: string | null): string {
  if (recoveryIntent) {
    return RESET_PASSWORD_PATH;
  }
  return safeNextPath(next, "/hives");
}
