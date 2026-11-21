import type { StudyRevisionFormat } from "@hiveforyou/contracts";

import type { StudyLoadError } from "@/server/hives/hive-summary";

export type StudyAvailability =
  | { kind: "none" }
  | { kind: "older"; revisionNumber: number }
  | { kind: "load_error"; error: StudyLoadError }
  | { kind: "canonical" };

export function studyAvailability(input: {
  revision: { revisionNumber: number; format?: StudyRevisionFormat } | null;
  hasCanonicalView: boolean;
  studyLoadError: StudyLoadError | null;
}): StudyAvailability {
  if (!input.revision) return { kind: "none" };
  if (input.studyLoadError) return { kind: "load_error", error: input.studyLoadError };
  const format = input.revision.format;
  if (format !== "canonical-study-1" || !input.hasCanonicalView) {
    return { kind: "older", revisionNumber: input.revision.revisionNumber };
  }
  return { kind: "canonical" };
}

export const OLDER_STUDY_NOTICE =
  "This hive was read with an earlier version of HiveForYou. Rebuild the study to see what the documents show and what is still missing.";