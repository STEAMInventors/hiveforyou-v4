import { describe, expect, it } from "vitest";

import { callbackSuccessPath, safeEmailOtpType } from "./callback-intent";

describe("callback intent", () => {
  it("routes success through safeNextPath", () => {
    expect(callbackSuccessPath("/hives/abc")).toBe("/hives/abc");
    expect(callbackSuccessPath("https://evil.example.com")).toBe("/hives");
  });

  it("allows only known email OTP types", () => {
    expect(safeEmailOtpType("recovery")).toBe("recovery");
    expect(safeEmailOtpType("SIGNUP")).toBe("signup");
    expect(safeEmailOtpType("email")).toBe("email");
    expect(safeEmailOtpType("javascript:")).toBeNull();
  });
});