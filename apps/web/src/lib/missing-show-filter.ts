import type { DisplayState } from "@/components/study/StatusBadge";

export const MISSING_SHOW_FILTERS = ["all", "needs", "changed", "missing"] as const;
export type MissingShowFilter = (typeof MISSING_SHOW_FILTERS)[number];

export type MissingShowParam = Exclude<MissingShowFilter, "all">;

const SHOW_PARAM: ReadonlySet<string> = new Set(["needs", "changed", "missing"]);

export function parseMissingShowParam(value: string | null | undefined): MissingShowParam | null {
  const key = value?.trim().toLowerCase() ?? "";
  if (!SHOW_PARAM.has(key)) return null;
  return key as MissingShowParam;
}

export function missingShowFilterFromParam(param: MissingShowParam | null): MissingShowFilter {
  return param ?? "all";
}

export function itemMatchesShowFilter(itemState: DisplayState, filter: MissingShowFilter): boolean {
  if (filter === "all") return true;
  return itemState === filter;
}

export const MISSING_SHOW_LABEL: Record<MissingShowFilter, string> = {
  all: "All",
  needs: "Needs you",
  changed: "Changed",
  missing: "Missing",
};