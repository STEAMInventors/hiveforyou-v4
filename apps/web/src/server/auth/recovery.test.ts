import { describe, expect, it } from "vitest";

import {
  isRecoveryCookieValue,
  isRecoveryOtpType,
  isRecoveryResetSession,
  recoveryCookieOptions,
} from "./recovery";

describe("recovery helpers", () => {
  it("requires both signed-in state and recovery cookie", () => {
    expect(isRecoveryResetSession(true, "1")).toBe(true);
    expect(isRecoveryResetSession(false, "1")).toBe(false);
    expect(isRecoveryResetSession(true, undefined)).toBe(false);
    expect(isRecoveryCookieValue("1")).toBe(true);
    expect(isRecoveryOtpType("RECOVERY")).toBe(true);
    expect(recoveryCookieOptions(true).httpOnly).toBe(true);
  });
});
