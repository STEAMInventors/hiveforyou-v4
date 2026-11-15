import { afterEach, describe, expect, it, vi } from "vitest";

import { sendInvitationEmail } from "@/server/hives/send-invitation-email";

import { ConsoleEmailSender } from "./console-sender";
import { EmailConfigurationError, resolveEmailSender, setEmailSenderForTests } from "./index";
import { ResendEmailSender } from "./resend-sender";

describe("resolveEmailSender", () => {
  afterEach(() => {
    setEmailSenderForTests(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("throws a configuration error in production when Resend is not configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", " ");
    vi.stubEnv("EMAIL_FROM", "invites@example.com");
    expect(() => resolveEmailSender()).toThrow(EmailConfigurationError);

    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "");
    expect(() => resolveEmailSender()).toThrow(EmailConfigurationError);
  });

  it("uses Resend in production when both settings are present", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "invites@example.com");
    expect(resolveEmailSender()).toBeInstanceOf(ResendEmailSender);
  });

  it("uses the console sender in tests without logging the message", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const testSender = resolveEmailSender();
    expect(testSender).toBeInstanceOf(ConsoleEmailSender);
    await testSender.send({
      to: "guest@example.com",
      subject: "Subject",
      text: "https://app.example/invite/secret-token",
      html: '<a href="https://app.example/invite/secret-token">Open</a>',
    });
    expect(info).not.toHaveBeenCalled();
  });

  it("logs only the recipient and subject from the local development sender", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendInvitationEmail({
      role: "client",
      toEmail: "guest@example.com",
      inviteUrl: "https://app.example/invite/secret-token",
      ownerOrProfessionalName: "Sam",
      hiveName: "Widget batch",
      requestedItemCount: 0,
    });
    const logged = info.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
    expect(logged).toContain("guest@example.com");
    expect(logged).toContain("Sam opened a hive for you");
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("invite/");
  });
});
