import { describe, expect, it } from "vitest";

import {
  callbackRecoveryIntent,
  callbackSuccessPath,
  safeEmailOtpType,
} from "./callback-intent";

describe("callback intent", () => {
  it("treats reset-password next and recovery type as recovery", () => {
    expect(callbackRecoveryIntent({ next: "/reset-password", type: null })).toBe(
      true,
    );
    expect(callbackRecoveryIntent({ next: "/hives", type: "recovery" })).toBe(
      true,
    );
    expect(callbackRecoveryIntent({ next: "/hives", type: "signup" })).toBe(
      false,
    );
  });

  it("routes recovery success to reset-password only", () => {
    expect(callbackSuccessPath(true, "/hives")).toBe("/reset-password");
    expect(callbackSuccessPath(false, "/hives/abc")).toBe("/hives/abc");
  });

  it("allows only known email OTP types", () => {
    expect(safeEmailOtpType("recovery")).toBe("recovery");
    expect(safeEmailOtpType("SIGNUP")).toBe("signup");
    expect(safeEmailOtpType("javascript:")).toBeNull();
  });
});
