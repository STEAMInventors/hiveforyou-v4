import { ConsoleEmailSender } from "./console-sender";
import { ResendEmailSender } from "./resend-sender";
import type { EmailSender } from "./types";

/** Thrown when production has no Resend sender. Never includes secret values. */
export class EmailConfigurationError extends Error {
  override readonly name = "EmailConfigurationError";

  constructor() {
    super("RESEND_API_KEY and EMAIL_FROM are required in production.");
  }
}

let testOverride: EmailSender | null = null;

export function setEmailSenderForTests(sender: EmailSender | null): void {
  testOverride = sender;
}

export function resolveEmailSender(): EmailSender {
  if (testOverride) {
    return testOverride;
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (apiKey && from) {
    return new ResendEmailSender(apiKey, from);
  }
  if (process.env.NODE_ENV === "production") {
    throw new EmailConfigurationError();
  }
  return new ConsoleEmailSender();
}

export type { EmailSender, SendEmailInput, InvitationEmailRole } from "./types";