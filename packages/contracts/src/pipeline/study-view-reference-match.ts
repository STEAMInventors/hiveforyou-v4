export type ReferencedDocumentLike = {
  readonly sourceDocumentId: string;
  readonly description: string;
  readonly page: number;
  readonly quote: string;
};

const matchTokens = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => token.length >= 3 || /\d/.test(token)));

/** Share of a referenced document's description words that a gap statement must contain to match it. */
const REFERENCE_MATCH_SHARE = 0.6;

/**
 * The referenced-document entries a gap statement names: at least two shared words and at least
 * {@link REFERENCE_MATCH_SHARE} of the description's words. Pure text overlap, no vocabulary.
 */
export function matchReferencedDocuments(
  statement: string,
  referencedDocuments: readonly ReferencedDocumentLike[],
): ReferencedDocumentLike[] {
  const gapTokens = matchTokens(statement);
  return referencedDocuments.filter((reference) => {
    const tokens = [...matchTokens(reference.description)];
    if (tokens.length === 0) return false;
    const shared = tokens.filter((token) => gapTokens.has(token)).length;
    return shared >= 2 && shared / tokens.length >= REFERENCE_MATCH_SHARE;
  });
}
