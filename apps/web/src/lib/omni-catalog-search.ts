import type { OmniCatalog, OmniHit } from "@/lib/omni-catalog-model";

function includes(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

export function omniHits(catalog: OmniCatalog, rawQuery: string): OmniHit[] {
  const query = rawQuery.trim().toLowerCase();
  const hits: OmniHit[] = [];
  if (!query) return hits;
  for (const statement of catalog.statements) {
    if (hits.filter((hit) => hit.kind === "statement").length >= 4) break;
    if (includes(statement.text, query) || includes(statement.topic, query)) {
      hits.push({ kind: "statement", id: `statement-${statement.id}`, statement });
    }
  }
  for (const item of catalog.openItems) {
    if (hits.filter((hit) => hit.kind === "item").length >= 3) break;
    if (includes(item.title, query) || includes(item.detail ?? "", query)) {
      hits.push({ kind: "item", id: `item-${item.id}`, item });
    }
  }
  for (const document of catalog.documents) {
    if (hits.filter((hit) => hit.kind === "document").length >= 3) break;
    const rawFileName = document.fileName?.trim() ?? "";
    const normalizedFileName = rawFileName.replace(/[_-]+/g, " ");
    const blob = `${document.role} ${document.typeLabel} ${document.period} ${rawFileName} ${normalizedFileName}`;
    if (includes(blob, query)) {
      hits.push({ kind: "document", id: `document-${document.id}`, document });
    }
  }
  return hits;
}

export function omniHasMatches(hits: readonly OmniHit[]): boolean {
  return hits.length > 0;
}

export type TextPiece = { text: string; match: boolean };

export function highlightPieces(text: string, rawQuery: string): TextPiece[] {
  const query = rawQuery.trim();
  if (!query) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const pieces: TextPiece[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = lower.indexOf(needle, cursor);
    if (at === -1) {
      pieces.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (at > cursor) pieces.push({ text: text.slice(cursor, at), match: false });
    pieces.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }
  return pieces.filter((piece) => piece.text.length > 0);
}