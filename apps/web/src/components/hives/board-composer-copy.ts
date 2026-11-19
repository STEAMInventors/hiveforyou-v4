import { personFirstName } from "@/lib/hives/firm-board";

export function conversationComposerPlaceholder(input: {
  viewerIsClient: boolean;
  clientName: string | null;
  clientAuthorName: string | null;
  teamMemberFirstName: string;
}): string {
  const other = input.viewerIsClient
    ? personFirstName(input.teamMemberFirstName)
    : personFirstName(input.clientAuthorName ?? input.clientName ?? "them");
  return `Write to ${other}…`;
}

export function assistantComposerHint(input: {
  staffView: boolean;
  viewerIsClient: boolean;
  firmless: boolean;
  assistantName: string;
  teamMemberFirstName: string;
}): string {
  if (input.staffView || input.viewerIsClient === false) {
    return "Only you can see your questions.";
  }
  if (input.firmless) {
    return "Only you can see your questions.";
  }
  return `Only you and ${personFirstName(input.teamMemberFirstName)}'s team can see your questions.`;
}