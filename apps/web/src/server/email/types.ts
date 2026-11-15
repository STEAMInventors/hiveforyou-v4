export type InvitationEmailRole = "client" | "professional";

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  fromDisplay?: string;
};

export interface EmailSender {
  send(input: SendEmailInput): Promise<void>;
}