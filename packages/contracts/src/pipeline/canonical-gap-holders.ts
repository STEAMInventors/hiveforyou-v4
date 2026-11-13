import type { CanonicalGap, CanonicalStudy } from "./canonical-study-contracts";

export const GAP_HOLDER_TYPES = ["ASKER_OR_CLIENT", "COUNSEL", "THIRD_PARTY", "COURT_RECORD"] as const;
export type GapHolderType = (typeof GAP_HOLDER_TYPES)[number];

const GAP_HOLDER_TYPE_SET = new Set<string>(GAP_HOLDER_TYPES);

const COURT_RECORD_GAP =
  /\b(?:proof(?:s)? of claim|claims register|claims docket|register of claims|filed claim|claim register)\b/i;
const COUNSEL_GAP = /\b(?:trustee|case trustee|party counsel|attorney|counsel)\b/i;

export function normalizeGapHolderType(value: unknown): GapHolderType | null {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return GAP_HOLDER_TYPE_SET.has(text) ? (text as GapHolderType) : null;
}

/** Infer holder type from gap text when the model omitted `holderType`. */
export function inferGapHolderType(gap: Pick<CanonicalGap, "kind" | "holder" | "title" | "statement" | "holderType">): GapHolderType | null {
  if (gap.kind !== "REQUESTABLE_DOCUMENT") return null;
  if (gap.holderType) return gap.holderType;
  const probe = `${gap.title} ${gap.statement} ${gap.holder}`.trim();
  if (COURT_RECORD_GAP.test(probe)) return "COURT_RECORD";
  if (/\b(?:client|party|filer|preparer|you)\b/i.test(gap.holder)) return "ASKER_OR_CLIENT";
  if (COUNSEL_GAP.test(gap.holder) || COUNSEL_GAP.test(probe)) return "COUNSEL";
  if (gap.holder.trim() !== "") return "THIRD_PARTY";
  return "ASKER_OR_CLIENT";
}

/** Assign and validate `holderType` on every requestable gap after canonicalize. */
export function assignCanonicalGapHolderTypes(study: CanonicalStudy): CanonicalStudy {
  const gaps = study.gaps.map((gap) => {
    if (gap.kind !== "REQUESTABLE_DOCUMENT") {
      return { ...gap, holderType: null };
    }
    const normalized = normalizeGapHolderType(gap.holderType) ?? inferGapHolderType(gap);
    return { ...gap, holderType: normalized };
  });
  return { ...study, gaps };
}
