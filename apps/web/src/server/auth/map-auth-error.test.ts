import { describe, expect, it } from "vitest";

import {
  authLogSeverity,
  classifyAuthError,
  linkErrorCodeForKind,
  publicAuthOutcome,
  sanitizeDiagnostic,
} from "./map-auth-error";
import {
  EMAIL_NOT_CONFIRMED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  RESET_REQUEST_ACCEPTED,
  SIGN_UP_CHECK_EMAIL_BODY,
  authInfoMessage,
  authLinkErrorMessage,
} from "./messages";

const SECRET = "recovery-token-secret password=hunter2 user@example.com";

function assertNoSecret(value: string) {
  expect(value).not.toContain("recovery-token-secret");
  expect(value).not.toContain("hunter2");
  expect(value).not.toContain("user@example.com");
}

describe("classifyAuthError", () => {
  it("maps invalid email and password policy without echoing provider message", () => {
    const email = classifyAuthError(
      { code: "email_address_invalid", message: SECRET },
      "sign_up",
    );
    expect(email.kind).toBe("invalid_email");
    expect(email.message).toBe("Enter a valid email address.");
    expect(email.errorCode).toBe("INVALID_REQUEST");
    assertNoSecret(email.message);
    assertNoSecret(email.diagnostic);

    const weak = classifyAuthError(
      { code: "weak_password", message: `Password is known to be weak. ${SECRET}` },
      "sign_up",
    );
    expect(weak.kind).toBe("weak_password");
    expect(weak.errorCode).toBe("INVALID_REQUEST");
    assertNoSecret(weak.message);
  });

  it("uses one credentials message for wrong password and unknown account", () => {
    const wrong = classifyAuthError(
      { code: "invalid_credentials", message: SECRET },
      "sign_in",
    );
    const missing = classifyAuthError(
      { code: "user_not_found", message: "User not found" },
      "sign_in",
    );
    expect(wrong.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(missing.message).toBe(wrong.message);
    expect(missing.kind).toBe("invalid_credentials");
    assertNoSecret(wrong.message);
  });

  it("hides whether a signup or reset email already exists", () => {
    const signup = classifyAuthError(
      { code: "user_already_exists", message: "User already registered" },
      "sign_up",
    );
    const reset = classifyAuthError(
      { code: "user_not_found", message: SECRET },
      "recovery_request",
    );
    expect(signup.kind).toBe("conceal_account");
    expect(reset.kind).toBe("conceal_account");
    expect(signup.message).toBe(SIGN_UP_CHECK_EMAIL_BODY);
    expect(reset.message).toBe(RESET_REQUEST_ACCEPTED);
    expect(publicAuthOutcome("sign_up", signup)).toBe("neutral");
    expect(publicAuthOutcome("recovery_request", reset)).toBe("neutral");
    assertNoSecret(signup.message);
    assertNoSecret(reset.message);
  });

  it("distinguishes rate limits, outages, expired links, and reused links", () => {
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
    expect(offline.errorCode).toBe("PERSISTENCE_FAILED");
    assertNoSecret(offline.message);

    expect(classifyAuthError({ code: "otp_expired" }, "callback").kind).toBe(
      "link_expired",
    );
    expect(
      classifyAuthError({ code: "email_not_confirmed", message: SECRET }, "sign_in")
        .message,
    ).toBe(EMAIL_NOT_CONFIRMED_MESSAGE);
    expect(linkErrorCodeForKind("link_expired")).toBe("link_expired");
    expect(linkErrorCodeForKind("link_reused")).toBe("link_reused");
    expect(linkErrorCodeForKind("unavailable")).toBe("link_unavailable");
    expect(linkErrorCodeForKind("unknown")).toBe("link_invalid");
  });

  it("drops unsafe diagnostics", () => {
    expect(sanitizeDiagnostic("token=super-secret")).toBe("unclassified");
  });
});

describe("authInfoMessage & authLinkErrorMessage", () => {
  it("allows only known codes", () => {
    expect(authInfoMessage("password_updated")).toContain("updated");
    expect(authInfoMessage("email_confirmed")).toContain("confirmed");
    expect(authInfoMessage("javascript:alert(1)")).toBeNull();
    expect(authLinkErrorMessage("user@example.com", "login")).toBeNull();
    expect(authLinkErrorMessage("link_expired", "recovery")).toContain("expired");
  });
});
