import type { ReportAudience } from "../reports/writer-report-contracts";

/** Domain-free default audience guidance for hive-write/1 (D-052). */
export const WRITE_AUDIENCE_BASE: Record<ReportAudience, string> = {
  CUSTOMER:
    "the person this case concerns or their family; plain language; what it means and what to do next",
  PRO: "a professional reviewing this case on the person's behalf; precise; lead with conflicts, gaps and unsupported items",
};

export type WriteAudienceOptions = {
  readonly statedAudience?: string | null;
  readonly professionalPerspective?: string | null;
};

/** Combines the report role baseline with optional free-text from the user's request. */
export function buildWriteAudienceText(role: ReportAudience, options: WriteAudienceOptions = {}): string {
  const base = WRITE_AUDIENCE_BASE[role];
  const extra =
    role === "CUSTOMER"
      ? (options.statedAudience?.trim() ?? "")
      : (options.professionalPerspective?.trim() ?? options.statedAudience?.trim() ?? "");
  return extra ? `${base}; ${extra}` : base;
}
