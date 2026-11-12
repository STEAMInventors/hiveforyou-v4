import type { WriteFactRecord } from "./study-view-contracts";

const DISTRICT = /\b(?:district|lea|school district)\b/i;
const SCHOOL = /\b(?:school|elementary|middle|high school)\b/i;

export type OrganizationNames = { readonly district: string | null; readonly school: string | null };

/** Best-effort district and school names from verified facts for holder display. */
export function organizationNamesFromFacts(facts: readonly WriteFactRecord[]): OrganizationNames {
  let district: string | null = null;
  let school: string | null = null;
  for (const fact of facts) {
    const probe = `${fact.subject} ${fact.attribute} ${fact.valueAsWritten}`.trim();
    const value = fact.valueAsWritten.trim();
    if (value.length < 2 || value.length > 120) continue;
    if (!district && DISTRICT.test(probe)) district = value;
    if (!school && SCHOOL.test(probe) && !DISTRICT.test(value)) school = value;
  }
  return { district, school };
}
