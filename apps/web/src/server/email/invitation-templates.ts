import type { InvitationEmailRole } from "./types";

const LOGO_URL = "https://hiveforyou.com/brand/hiveforyou-mark.svg";

export type ClientInviteTemplateInput = {
  professionalName: string;
  inviteUrl: string;
  requestedItemCount: number;
};

export type ProfessionalInviteTemplateInput = {
  ownerName: string;
  hiveName: string;
  inviteUrl: string;
};

export function clientInviteSubject(professionalName: string, requestedItemCount: number): string {
  if (requestedItemCount > 0) {
    return `${professionalName} needs ${requestedItemCount} items from you`;
  }
  return `${professionalName} opened a hive for you`;
}

export function clientInviteFromDisplay(professionalName: string): string {
  return `HiveForYou, for ${professionalName}`;
}

export function renderClientInviteEmail(input: ClientInviteTemplateInput): { text: string; html: string } {
  const headline =
    input.requestedItemCount > 0
      ? `${input.professionalName} needs ${input.requestedItemCount} items from you`
      : `${input.professionalName} opened a hive for you`;
  const text = [
    headline,
    "",
    `${input.professionalName} invited you to a hive on HiveForYou.`,
    "You can send documents from your phone.",
    input.inviteUrl,
    "",
    "No password. You'll get a sign-in code at this address.",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1a1a1a">
<img src="${LOGO_URL}" alt="HiveForYou" width="40" height="40" />
<p style="font-size:16px;line-height:1.5">${headline}</p>
<p style="font-size:15px;line-height:1.55">${input.professionalName} invited you to a hive on HiveForYou. You can send documents from your phone.</p>
<p><a href="${input.inviteUrl}" style="color:#1A56C4">Open your hive</a></p>
<p style="font-size:14px;color:#4A525C">No password. You'll get a sign-in code at this address.</p>
</body></html>`;
  return { text, html };
}

export function professionalInviteSubject(ownerName: string): string {
  return `${ownerName} shared a hive with you`;
}

export function renderProfessionalInviteEmail(input: ProfessionalInviteTemplateInput): {
  text: string;
  html: string;
} {
  const text = [
    `${input.ownerName} shared a hive with you`,
    "",
    `Hive name: ${input.hiveName}`,
    "You'll see a read-only summary until you choose to take it on.",
    input.inviteUrl,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1a1a1a">
<img src="${LOGO_URL}" alt="HiveForYou" width="40" height="40" />
<p style="font-size:16px;line-height:1.5">${input.ownerName} shared a hive with you</p>
<p style="font-size:15px;line-height:1.55"><strong>${input.hiveName}</strong></p>
<p style="font-size:15px;line-height:1.55">You'll see a read-only summary until you choose to take it on.</p>
<p><a href="${input.inviteUrl}" style="color:#1A56C4">Open the summary</a></p>
</body></html>`;
  return { text, html };
}

export function invitationRoleLabel(role: InvitationEmailRole): "client" | "professional" {
  return role;
}