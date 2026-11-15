import type { EmailSender, SendEmailInput } from "./types";

/** Tests and local development only. Production must use Resend. */
export class ConsoleEmailSender implements EmailSender {
  readonly sent: SendEmailInput[] = [];

  async send(input: SendEmailInput): Promise<void> {
    this.sent.push(input);
    if (process.env.NODE_ENV === "development") {
      console.info(`[email] to=${input.to} subject=${input.subject}`);
    }
  }
}