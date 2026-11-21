export type AskSuggestionInput = {
  viewer: "staff" | "client" | "own";
  /** Open items waiting on a person. Zero or missing leaves the line out. */
  toReview?: number | null;
  /** Documents still to come. Zero or missing leaves the line out. */
  stillToCome?: number | null;
  /** Documents received. Zero or missing means there is nothing to ask about yet. */
  documentsIn?: number | null;
};

/**
 * Up to three starter questions for the chat, chosen from what the page already knows.
 * Wording is generic; nothing here names a kind of document or case (D-053).
 */
export function askSuggestions(input: AskSuggestionInput): string[] {
  if (!input.documentsIn || input.documentsIn < 1) return [];
  const mine = input.viewer !== "staff";
  const lines: string[] = [];
  if ((input.stillToCome ?? 0) > 0) {
    lines.push(mine ? "What do I still need to send?" : "What is still to come?");
  }
  if (input.viewer !== "client" && (input.toReview ?? 0) > 0) {
    lines.push("What needs review?");
  }
  lines.push(mine ? "What do my documents show?" : "What do the documents show?");
  return lines.slice(0, 3);
}
