import { personFirstName } from "@/lib/hives/firm-board";

export function hiveBoardPageDescription(input: {
  firmless: boolean;
  view: "conversation" | "ask";
  assistantName: string;
  viewerIsClient: boolean;
  clientName: string | null;
  staffFirstName: string;
}): string {
  if (input.firmless || input.view === "ask") {
    return `Ask ${input.assistantName}, the AI assistant, about the documents. Answers cite their pages.`;
  }
  const otherSide = input.viewerIsClient
    ? personFirstName(input.staffFirstName)
    : personFirstName(input.clientName ?? "them");
  return `Your conversation with ${otherSide}. ${input.assistantName} doesn't take part here.`;
}