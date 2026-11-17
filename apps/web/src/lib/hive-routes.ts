export const MY_HIVES_PATH = "/hives";

export const NEW_CLIENT_HIVE_PATH = `${MY_HIVES_PATH}/new-client`;

export const CREATE_HIVE_PARAM = "create";

export const MY_HIVES_CREATE_PATH = `${MY_HIVES_PATH}?${CREATE_HIVE_PARAM}=1`;

export const CREATE_HIVE_AFTER_SIGN_UP_PATH = `/sign-in?next=${encodeURIComponent(MY_HIVES_CREATE_PATH)}`;

export type HiveWorkspaceSection =
  | "board"
  | "documents"
  | "facts"
  | "missing"
  | "timeline"
  | "reports"
  | "activity"
  | "notes";

export const HIVE_SECTION_LABELS: Record<HiveWorkspaceSection, string> = {
  board: "Hive board",
  documents: "Documents",
  facts: "Facts",
  missing: "Missing and conflicts",
  timeline: "Timeline",
  reports: "Reports",
  activity: "What happened",
  notes: "Team notes",
};

export function hivePath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}`;
}

export function hiveBoardPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/board`;
}

export function hiveDocumentsPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/documents`;
}

/** Legacy study URL; prefer {@link hiveFactsPath}. */
export function hiveStudyPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/study`;
}

export function hiveFactsPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/facts`;
}

export function hiveMissingPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/missing`;
}

export function hiveTimelinePath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/timeline`;
}

export function hiveActivityPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/activity`;
}

export function hiveNotesPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/notes`;
}

export function hiveReportsPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/reports`;
}

export function hiveSectionPath(hiveId: string, section: HiveWorkspaceSection): string {
  switch (section) {
    case "board":
      return hiveBoardPath(hiveId);
    case "documents":
      return hiveDocumentsPath(hiveId);
    case "facts":
      return hiveFactsPath(hiveId);
    case "missing":
      return hiveMissingPath(hiveId);
    case "timeline":
      return hiveTimelinePath(hiveId);
    case "reports":
      return hiveReportsPath(hiveId);
    case "activity":
      return hiveActivityPath(hiveId);
    case "notes":
      return hiveNotesPath(hiveId);
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

export function hiveSectionFromPathname(pathname: string, hiveId: string): HiveWorkspaceSection | null {
  const base = `/hives/${hiveId}`;
  if (pathname === `${base}/board` || pathname === base) return "board";
  if (pathname.startsWith(`${base}/documents`)) return "documents";
  if (pathname.startsWith(`${base}/facts`)) return "facts";
  if (pathname.startsWith(`${base}/missing`)) return "missing";
  if (pathname.startsWith(`${base}/timeline`)) return "timeline";
  if (pathname.startsWith(`${base}/reports`)) return "reports";
  if (pathname.startsWith(`${base}/activity`)) return "activity";
  if (pathname.startsWith(`${base}/notes`)) return "notes";
  if (pathname.startsWith(`${base}/study`)) return "facts";
  return null;
}

/** Maps legacy `/study` hash anchors to the split study routes (D18.9). */
export function mapStudyLegacyHash(hiveId: string, hash: string): string {
  const key = hash.replace(/^#/, "").trim().toLowerCase();
  if (key === "missing" || key === "disagree" || key === "where-documents-disagree" || key === "missing-documents") {
    return hiveMissingPath(hiveId);
  }
  if (key === "timeline") {
    return hiveTimelinePath(hiveId);
  }
  return hiveFactsPath(hiveId);
}

/** Opens the original file at a physical page for the owner (D-011). */
export function sourcePagePath(hiveId: string, sourceDocumentId: string, pageNumber: number): string {
  return `/api/v1/hives/${encodeURIComponent(hiveId)}/source-documents/${encodeURIComponent(sourceDocumentId)}/pages/${pageNumber}`;
}