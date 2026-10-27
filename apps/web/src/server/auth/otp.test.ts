import { describe, expect, it } from "vitest";

import { otpTypeForPurpose, safeEmailOtpType } from "./otp";

describe("email OTP helpers", () => {
  it("maps product purposes to Supabase OTP types", () => {
    expect(otpTypeForPurpose("recovery")).toBe("recovery");
    expect(otpTypeForPurpose("signup")).toBe("signup");
  });

  it("allows known provider OTP types only", () => {
    expect(safeEmailOtpType("recovery")).toBe("recovery");
    expect(safeEmailOtpType("SIGNUP")).toBe("signup");
    expect(safeEmailOtpType("evil")).toBeNull();
    expect(safeEmailOtpType("")).toBeNull();
  });
});
