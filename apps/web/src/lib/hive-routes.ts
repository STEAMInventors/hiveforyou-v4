import { mapLegacyFindingsTab } from "@hiveforyou/contracts";

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

export { FINDINGS_ANCHORS } from "@hiveforyou/contracts";

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

/** Staff and firmless Home. Zero-document hives still open on Documents. */
export function hiveHomePath(hiveId: string): string {
  return hivePath(hiveId);
}

/** What the documents show, on Home. */
export const HOME_SHOW_ANCHOR = "show";

export function hiveHomeShowPath(hiveId: string): string {
  return `${hiveHomePath(hiveId)}#${HOME_SHOW_ANCHOR}`;
}

/** Legacy board URL. The page redirects to Home so older links, including emails, still land. */
export function hiveBoardPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/board`;
}

export function hiveDocumentsPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/documents`;
}

/** The "What we asked for" card on Documents. */
export const CHECKLIST_ANCHOR_ID = "requested";

export function hiveRequestedItemsPath(hiveId: string): string {
  return `${hiveDocumentsPath(hiveId)}#${CHECKLIST_ANCHOR_ID}`;
}

/** Legacy study URL. The study page sends people to Findings. */
export function hiveStudyPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/study`;
}

/** Default Findings URL; legacy tabs map to hash anchors via redirect helpers. */
export function hiveFindingsPath(hiveId: string, tab?: FindingsTab): string {
  const base = `${MY_HIVES_PATH}/${hiveId}/findings`;
  if (!tab || tab === "known") return base;
  return `${base}#${mapLegacyFindingsTab(tab)}`;
}

/** Query string before hash for server redirects. */
export function hiveFindingsRedirectPath(
  hiveId: string,
  options?: { tab?: FindingsTab; queryString?: string },
): string {
  const base = `${MY_HIVES_PATH}/${hiveId}/findings`;
  const qs = options?.queryString ?? "";
  const hash = options?.tab && options.tab !== "known" ? `#${mapLegacyFindingsTab(options.tab)}` : "";
  return `${base}${qs}${hash}`;
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
      return hiveHomePath(hiveId);
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

/** Maps legacy `/study` hashes onto Home. Findings now lives at `#show`. */
export function mapStudyLegacyHash(hiveId: string, _hash: string): string {
  return hiveHomeShowPath(hiveId);
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
