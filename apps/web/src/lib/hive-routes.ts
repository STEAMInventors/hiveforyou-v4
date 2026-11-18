export const MY_HIVES_PATH = "/hives";

export const NEW_CLIENT_HIVE_PATH = `${MY_HIVES_PATH}/new-client`;

export const CREATE_HIVE_PARAM = "create";

export const MY_HIVES_CREATE_PATH = `${MY_HIVES_PATH}?${CREATE_HIVE_PARAM}=1`;

export const CREATE_HIVE_AFTER_SIGN_UP_PATH = `/sign-in?next=${encodeURIComponent(MY_HIVES_CREATE_PATH)}`;

export type HiveWorkspaceSection = "board" | "documents" | "findings" | "reports" | "audit" | "notes";

export const HIVE_SECTION_LABELS: Record<HiveWorkspaceSection, string> = {
  board: "Hive board",
  documents: "Documents",
  findings: "Findings",
  reports: "Reports",
  audit: "Audit trail",
  notes: "Team notes",
};

export type FindingsTab = "known" | "gaps" | "timeline" | "review";

export const FINDINGS_TAB_LABELS: Record<FindingsTab, string> = {
  known: "What we know",
  gaps: "Gaps and conflicts",
  timeline: "Timeline",
  review: "To review",
};

const FINDINGS_TABS: ReadonlySet<string> = new Set(["known", "gaps", "timeline", "review"]);

export function hivePath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}`;
}

export function hiveBoardPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/board`;
}

export function hiveDocumentsPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/documents`;
}

/** Legacy study URL. The study page sends people to Findings. */
export function hiveStudyPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/study`;
}

/** `known` is the default and is written without `?tab`. */
export function hiveFindingsPath(hiveId: string, tab?: FindingsTab): string {
  const base = `${MY_HIVES_PATH}/${hiveId}/findings`;
  if (!tab || tab === "known") return base;
  return `${base}?tab=${tab}`;
}

export function hiveAuditPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/audit`;
}

export function hiveNotesPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/notes`;
}

export function hiveReportsPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/reports`;
}

export function parseFindingsTab(value: string | string[] | undefined): FindingsTab {
  const raw = Array.isArray(value) ? value[0] : value;
  const key = raw?.trim().toLowerCase() ?? "";
  if (FINDINGS_TABS.has(key)) return key as FindingsTab;
  return "known";
}

export function hiveSectionPath(hiveId: string, section: HiveWorkspaceSection): string {
  switch (section) {
    case "board":
      return hiveBoardPath(hiveId);
    case "documents":
      return hiveDocumentsPath(hiveId);
    case "findings":
      return hiveFindingsPath(hiveId);
    case "reports":
      return hiveReportsPath(hiveId);
    case "audit":
      return hiveAuditPath(hiveId);
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
  if (
    pathname.startsWith(`${base}/findings`) ||
    pathname.startsWith(`${base}/facts`) ||
    pathname.startsWith(`${base}/missing`) ||
    pathname.startsWith(`${base}/timeline`) ||
    pathname.startsWith(`${base}/study`)
  ) {
    return "findings";
  }
  if (pathname.startsWith(`${base}/reports`)) return "reports";
  if (pathname.startsWith(`${base}/audit`) || pathname.startsWith(`${base}/activity`)) return "audit";
  if (pathname.startsWith(`${base}/notes`)) return "notes";
  return null;
}

/** Maps legacy `/study` hash anchors onto Findings tabs. */
export function mapStudyLegacyHash(hiveId: string, hash: string): string {
  const key = hash.replace(/^#/, "").trim().toLowerCase();
  if (key === "missing" || key === "disagree" || key === "where-documents-disagree" || key === "missing-documents") {
    return hiveFindingsPath(hiveId, "gaps");
  }
  if (key === "timeline") {
    return hiveFindingsPath(hiveId, "timeline");
  }
  return hiveFindingsPath(hiveId);
}

/**
 * Query string for a legacy redirect. `overrides` replace a key (`null` drops it)
 * after the incoming params are copied, so other params stay.
 */
export function preservedQuery(
  searchParams: Record<string, string | string[] | undefined>,
  overrides: Record<string, string | null> = {},
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) search.append(key, entry);
  }
  for (const [key, value] of Object.entries(overrides)) {
    search.delete(key);
    if (value !== null) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** Opens the original file at a physical page for the owner (D-011). */
export function sourcePagePath(hiveId: string, sourceDocumentId: string, pageNumber: number): string {
  return `/api/v1/hives/${encodeURIComponent(hiveId)}/source-documents/${encodeURIComponent(sourceDocumentId)}/pages/${pageNumber}`;
}
