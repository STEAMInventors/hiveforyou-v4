import type { CanonicalStudy } from "./canonical-study-contracts";
import type { WriteFactRecord } from "./study-view-contracts";

/** Document-type or process words that are not a person's name when they appear as a fact subject. */
const NON_PERSON_SUBJECT = new Set(
  [
    "referral",
    "evaluation",
    "consent",
    "notice",
    "plan",
    "school",
    "district",
    "parent",
    "guardian",
    "team",
    "child",
    "meeting",
    "eligibility",
    "determination",
    "report",
    "assessment",
    "testing",
    "services",
    "goal",
    "goals",
    "fee",
    "amount",
    "payment",
    "invoice",
    "balance",
  ].map((word) => word.toLowerCase()),
);

function anchorDocumentIds(study: CanonicalStudy): string[] {
  const anchors = study.documents.filter((document) => document.role === "ANCHOR");
  if (anchors.length === 0) return [];
  const withChain = anchors.filter((document) => document.chainPosition != null);
  if (withChain.length > 0) {
    const max = Math.max(...withChain.map((document) => document.chainPosition!));
    return withChain.filter((document) => document.chainPosition === max).map((document) => document.sourceDocumentId.toLowerCase());
  }
  return [anchors[0]!.sourceDocumentId.toLowerCase()];
}

function firstToken(name: string): string {
  const token = name.trim().split(/\s+/)[0] ?? "";
  return token.replace(/[’'s]$/i, "").trim();
}

function looksLikePersonName(subject: string): boolean {
  const trimmed = subject.trim();
  if (trimmed === "" || trimmed.length > 80) return false;
  const first = firstToken(trimmed);
  if (first === "" || NON_PERSON_SUBJECT.has(first.toLowerCase())) return false;
  if (!/^[A-Z][a-zA-Z'-]+$/.test(first)) return false;
  return true;
}

/**
 * First name of the person the anchor document is about (the case subject), derived from verified
 * fact subjects on the in-force anchor. Never uses document titles or non-anchor documents.
 */
export function primarySubjectFirstName(
  study: CanonicalStudy,
  facts: readonly WriteFactRecord[],
): string | null {
  const anchors = new Set(anchorDocumentIds(study));
  if (anchors.size === 0) return null;

  const docTypeWords = new Set(
    study.documents
      .filter((document) => anchors.has(document.sourceDocumentId.toLowerCase()))
      .flatMap((document) => document.typeInPlainWords.toLowerCase().split(/\s+/))
      .filter((word) => word.length > 2),
  );

  const counts = new Map<string, number>();
  for (const fact of facts) {
    if (!anchors.has(fact.sourceDocumentId.toLowerCase())) continue;
    const subject = fact.subject.trim();
    if (!looksLikePersonName(subject)) continue;
    const first = firstToken(subject);
    if (docTypeWords.has(first.toLowerCase())) continue;
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }

  if (counts.size === 0) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && name.length < best.length)) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}
