import { describe, expect, it } from "vitest";

import {
  authLogSeverity,
  classifyAuthError,
  linkErrorCodeForKind,
  publicAuthOutcome,
  sanitizeDiagnostic,
} from "./map-auth-error";
import { authLinkErrorMessage } from "./messages";

const SECRET = "recovery-token-secret password=hunter2 user@example.com";

function assertNoSecret(value: string) {
  expect(value).not.toContain("recovery-token-secret");
  expect(value).not.toContain("hunter2");
  expect(value).not.toContain("user@example.com");
}

describe("classifyAuthError", () => {
  it("maps invalid email without echoing provider message", () => {
    const email = classifyAuthError(
      { code: "email_address_invalid", message: SECRET },
      "sign_up",
    );
    expect(email.kind).toBe("invalid_email");
    expect(email.message).toBe("Enter a valid email address.");
    expect(email.errorCode).toBe("INVALID_REQUEST");
    assertNoSecret(email.message);
    assertNoSecret(email.diagnostic);
  });

  it("maps OTP rate limits for request and verify flows", () => {
    const request = classifyAuthError(
      { code: "over_email_send_rate_limit" },
      "otp_request",
    );
    expect(request.kind).toBe("rate_limited");
    expect(request.message).toContain("Too many codes sent");

    const verify = classifyAuthError({ code: "over_request_rate_limit" }, "otp_verify");
    expect(verify.message).toContain("Too many attempts");
  });

  it("uses one verify message for invalid and expired OTP codes", () => {
    const shared = "That code didn't work. Check it, or send a new one.";
    expect(classifyAuthError({ code: "invalid_otp" }, "otp_verify").message).toBe(shared);
    expect(classifyAuthError({ code: "otp_expired" }, "otp_verify").message).toBe(shared);
  });

  it("hides whether a signup email already exists", () => {
    const signup = classifyAuthError(
      { code: "user_already_exists", message: "User already registered" },
      "sign_up",
    );
    expect(signup.kind).toBe("conceal_account");
    expect(publicAuthOutcome("sign_up", signup)).toBe("neutral");
    assertNoSecret(signup.message);
  });

  it("distinguishes rate limits, outages, and expired links", () => {
    const rate = classifyAuthError(
      { code: "over_request_rate_limit" },
      "sign_in",
    );
    expect(rate.kind).toBe("rate_limited");
    expect(rate.retryable).toBe(true);
    expect(authLogSeverity(rate)).toBe("WARN");

    const offline = classifyAuthError(
      { name: "AuthRetryableFetchError", message: SECRET },
      "sign_in",
    );
    expect(offline.kind).toBe("unavailable");
    expect(offline.retryable).toBe(true);
    assertNoSecret(offline.message);

    expect(classifyAuthError({ code: "otp_expired" }, "callback").kind).toBe(
      "link_expired",
    );
    expect(linkErrorCodeForKind("link_expired")).toBe("link_expired");
    expect(linkErrorCodeForKind("link_expired", "otp_expired")).toBe("otp_expired");
    expect(linkErrorCodeForKind("unavailable")).toBe("link_unavailable");
    expect(linkErrorCodeForKind("unknown")).toBe("link_invalid");
  });

  it("drops unsafe diagnostics", () => {
    expect(sanitizeDiagnostic("token=super-secret")).toBe("unclassified");
  });
});

describe("authLinkErrorMessage", () => {
  it("allows only known sign-in link codes", () => {
    expect(authLinkErrorMessage("javascript:alert(1)")).toBeNull();
    expect(authLinkErrorMessage("otp_expired")).toContain("already been used");
    expect(authLinkErrorMessage("link_expired")).toContain("already been used");
  });
});