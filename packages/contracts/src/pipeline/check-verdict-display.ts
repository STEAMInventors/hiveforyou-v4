const VERDICT_LABELS: Record<string, string> = {
  SHOWN: "Shown",
  PARTLY_SHOWN: "Partly shown",
  NOT_SHOWN: "Not shown",
  CONFLICT: "Conflict",
  NOT_APPLICABLE: "Not applicable",
  NOT_ASSESSED: "Not assessed",
};

const CHECKLIST_VERDICTS = new Set(Object.keys(VERDICT_LABELS));

/** User-facing checklist verdict label; null for non-checklist statuses. */
export function checklistVerdictLabel(verdict: string | null | undefined): string | null {
  if (!verdict) return null;
  const key = verdict.trim().toUpperCase();
  return CHECKLIST_VERDICTS.has(key) ? VERDICT_LABELS[key]! : null;
}

export function rowHasChecklistVerdict(row: { readonly status?: string | null }): boolean {
  return checklistVerdictLabel(row.status) !== null;
}
