import { ConsoleEmailSender } from "./console-sender";
import { ResendEmailSender } from "./resend-sender";
import type { EmailSender } from "./types";

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
  return new ConsoleEmailSender();
}

export type { EmailSender, SendEmailInput, InvitationEmailRole } from "./types";