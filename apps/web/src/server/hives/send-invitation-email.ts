import type { HiveInvitationRole } from "@hiveforyou/contracts";

import {
  clientInviteFromDisplay,
  clientInviteSubject,
  professionalInviteSubject,
  renderClientInviteEmail,
  renderProfessionalInviteEmail,
} from "@/server/email/invitation-templates";
import { resolveEmailSender } from "@/server/email";

export type SendInvitationEmailInput = {
  role: HiveInvitationRole;
  toEmail: string;
  inviteUrl: string;
  ownerOrProfessionalName: string;
  hiveName: string;
  requestedItemCount?: number;
};

export async function sendInvitationEmail(input: SendInvitationEmailInput): Promise<void> {
  const sender = resolveEmailSender();
  if (input.role === "client") {
    const subject = clientInviteSubject(input.ownerOrProfessionalName, input.requestedItemCount ?? 0);
    const { text, html } = renderClientInviteEmail({
      professionalName: input.ownerOrProfessionalName,
      inviteUrl: input.inviteUrl,
      requestedItemCount: input.requestedItemCount ?? 0,
    });
    await sender.send({
      to: input.toEmail,
      subject,
      text,
      html,
      fromDisplay: clientInviteFromDisplay(input.ownerOrProfessionalName),
    });
    return;
  }
  const subject = professionalInviteSubject(input.ownerOrProfessionalName);
  const { text, html } = renderProfessionalInviteEmail({
    ownerName: input.ownerOrProfessionalName,
    hiveName: input.hiveName,
    inviteUrl: input.inviteUrl,
  });
  await sender.send({
    to: input.toEmail,
    subject,
    text,
    html,
    fromDisplay: "HiveForYou",
  });
}