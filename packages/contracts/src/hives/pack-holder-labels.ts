import type { GapHolderType } from "../pipeline/canonical-gap-holders";
import { normalizeGapHolderType } from "../pipeline/canonical-gap-holders";

const HOLDER_BRACKET = /\(([^)]+)\)/;

/** Common nouns after THIRD_PARTY (…) get a leading "the" in staff-facing holder lines. */
const COMMON_THIRD_PARTY_NOUNS = new Set([
  "lender",
  "district",
  "school",
  "teacher",
  "vendor",
  "employer",
  "landlord",
  "bank",
  "court",
  "insurer",
  "doctor",
  "agency",
]);

function bracketInner(holder: string): string | null {
  const match = HOLDER_BRACKET.exec(holder.trim());
  const inner = match?.[1]?.replace(/\s+/g, " ").trim();
  return inner && inner !== "" ? inner : null;
}

/** Holder text for new-client "Usually from …" lines; never exposes raw enum tokens. */
export function newClientPackHolderLabel(holderType: GapHolderType | null, holder: string): string | null {
  const type = holderType ? normalizeGapHolderType(holderType) : null;
  if (type === "COUNSEL") return null;
  if (type === "COURT_RECORD") return "the court record";
  if (type === "THIRD_PARTY") {
    const inner = bracketInner(holder);
    if (inner) {
      const lower = inner.toLowerCase();
      if (COMMON_THIRD_PARTY_NOUNS.has(lower)) return `the ${lower}`;
      return inner;
    }
    return "the other party";
  }
  return null;
}