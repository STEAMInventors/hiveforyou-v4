const DEFAULT_MAX = 24;

/** Short display label for source chips; never cuts mid-word when a word boundary exists. */
export function truncateChipLabel(text: string, max = DEFAULT_MAX): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > Math.floor(max * 0.45)) {
    return `${slice.slice(0, lastSpace).trimEnd()}…`;
  }
  return `${slice.trimEnd()}…`;
}
