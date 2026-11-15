import type { EmailSender, SendEmailInput } from "./types";

const RESEND_URL = "https://api.resend.com/emails";

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async send(input: SendEmailInput): Promise<void> {
    const from = input.fromDisplay ? `${input.fromDisplay} <${this.fromAddress}>` : this.fromAddress;
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });
    if (!response.ok) {
      throw new Error(`resend_failed:${response.status}`);
    }
  }
}