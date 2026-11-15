import type { EmailSender, SendEmailInput } from "./types";

/** Used in tests when RESEND_API_KEY is unset. */
export class ConsoleEmailSender implements EmailSender {
  readonly sent: SendEmailInput[] = [];

  async send(input: SendEmailInput): Promise<void> {
    this.sent.push(input);
  }
}