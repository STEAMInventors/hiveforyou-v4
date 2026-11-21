/** Query keys for the in-app evidence view (no quote or fact text in URLs). */

export const EVIDENCE_SOURCE_PARAM = "source";
export const EVIDENCE_ITEM_PARAM = "item";

export type ParsedEvidenceSource = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
};

export function formatEvidenceSource(chip: { sourceDocumentId: string; pageNumber: number }): string {
  return `${chip.sourceDocumentId}:${chip.pageNumber}`;
}

export function parseEvidenceSource(raw: string | null | undefined): ParsedEvidenceSource | null {
  const text = raw?.trim() ?? "";
  if (text === "") return null;
  const split = text.lastIndexOf(":");
  if (split <= 0 || split === text.length - 1) return null;
  const sourceDocumentId = text.slice(0, split).trim();
  const page = Number.parseInt(text.slice(split + 1), 10);
  if (sourceDocumentId === "" || !Number.isInteger(page) || page < 1) return null;
  return { sourceDocumentId, pageNumber: page };
}

export function evidenceSourceInSearch(search: URLSearchParams): ParsedEvidenceSource | null {
  return parseEvidenceSource(search.get(EVIDENCE_SOURCE_PARAM));
}