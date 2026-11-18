import type { CanonicalConflict, CanonicalStudy } from "../pipeline/canonical-study-contracts";
import { buildDocumentRequestListData, type StudyViewReferencedDocument } from "../pipeline/document-request-list-contracts";
import { normalizeGapTitle } from "../pipeline/gap-fill";
import {
  gapsSatisfiedInStudy,
  gapUploadCountsAsPending,
  type GapUploadLink,
} from "../pipeline/missing-documents";
import type { StudyViewRow, StudyViewSources } from "../pipeline/study-view-contracts";

export type HiveBoardChecklistStatus = "in" | "added_pending" | "not_in";

export type HiveBoardActionKind = "link" | "rebuild_study" | "generate_report";

export type HiveBoardAction = {
  readonly kind: HiveBoardActionKind;
  readonly label: string;
  readonly href?: string;
};

export type HiveBoardChecklistItem = {
  readonly gapId: string;
  readonly title: string;
  readonly status: HiveBoardChecklistStatus;
  readonly statusText: string;
  readonly action: HiveBoardAction;
};

export type HiveBoardNeedKind = "unreadable" | "not_in_study" | "conflict";

export type HiveBoardSourceChip = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly quote?: string;
  readonly factIds?: readonly string[];
};

export type HiveBoardNeedItem = {
  readonly kind: HiveBoardNeedKind;
  readonly kindLabel: string;
  readonly title: string;
  readonly detail: string;
  readonly sourceChips: readonly HiveBoardSourceChip[];
  readonly action: HiveBoardAction;
  readonly conflictId?: string;
};

export type HiveBoardNext = {
  readonly title: string;
  readonly detail: string;
  readonly action: HiveBoardAction | null;
};

export type HiveBoardActivityItem = {
  readonly at: string;
  readonly atLabel: string;
  readonly actor: "You" | "HiveForYou";
  readonly text: string;
};

export type HiveBoardReadinessLine = {
  readonly label: string;
  readonly value: string;
};

export type HiveBoardProgress = {
  readonly in: number;
  readonly total: number;
  readonly segments: readonly HiveBoardChecklistStatus[];
};

export type HiveBoardModel = {
  readonly kicker: string;
  readonly headline: string;
  readonly progress: HiveBoardProgress | null;
  readonly needs: readonly HiveBoardNeedItem[];
  readonly next: HiveBoardNext | null;
  readonly checklist: readonly HiveBoardChecklistItem[];
  readonly activity: readonly HiveBoardActivityItem[];
  readonly readiness: readonly HiveBoardReadinessLine[];
  readonly checklistNote: string;
};

export type HiveBoardConflictRow = {
  readonly id: string;
  readonly subject: string;
  readonly detail: string;
  readonly sourceChips: readonly HiveBoardSourceChip[];
};

export type HiveBoardStoredEvent =
  | { readonly kind: "document_added"; readonly at: string; readonly fileName: string }
  | { readonly kind: "document_read"; readonly at: string; readonly fileName: string }
  | { readonly kind: "document_unreadable"; readonly at: string; readonly fileName: string }
  | { readonly kind: "study_built"; readonly at: string; readonly revisionNumber: number }
  | { readonly kind: "intent_saved"; readonly at: string; readonly intentText: string }
  | {
      readonly kind: "report_written";
      readonly at: string;
      readonly audience: "CUSTOMER" | "PRO";
    };

export type HiveBoardInput = {
  readonly hiveName: string;
  readonly hiveKind: "own" | "client";
  readonly documentsPath: string;
  readonly studyPath: string;
  readonly reportsPath: string;
  readonly documentCount: number;
  readonly documentsReadCount: number;
  readonly documentsNotInStudyCount: number;
  readonly readingInProgress: boolean;
  readonly readingProgressText: string | null;
  readonly unreadableDocuments: readonly { readonly fileName: string }[];
  readonly canonicalStudy: CanonicalStudy | null;
  readonly referencedDocuments?: readonly StudyViewReferencedDocument[];
  readonly gapUploads?: readonly GapUploadLink[];
  readonly acceptedStudyRevisionId?: string | null;
  readonly acceptedStudyRevisionAcceptedAt?: string | null;
  readonly conflictRows?: readonly HiveBoardConflictRow[];
  readonly studyRevisionNumber: number | null;
  readonly hasSucceededReport: boolean;
  readonly latestReportAudience: "CUSTOMER" | "PRO" | null;
  readonly latestReportFinishedAt: string | null;
  readonly storedEvents: readonly HiveBoardStoredEvent[];
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatBoardDate(iso: string, now: Date): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  return DATE_FORMAT.format(new Date(parsed));
}

function audienceLabel(audience: "CUSTOMER" | "PRO"): string {
  return audience === "CUSTOMER" ? "Customer" : "Pro";
}

function conflictSubject(statement: string): string {
  const trimmed = statement.trim();
  if (trimmed === "") return "this point";
  const firstClause = trimmed.split(/[.;]/)[0]?.trim() ?? trimmed;
  return firstClause.length > 80 ? `${firstClause.slice(0, 77)}…` : firstClause;
}

function buildChecklist(input: HiveBoardInput): HiveBoardChecklistItem[] {
  if (!input.canonicalStudy) return [];
  const listData = buildDocumentRequestListData(input.canonicalStudy, input.referencedDocuments ?? []);
  const satisfied = gapsSatisfiedInStudy(input.canonicalStudy, input.canonicalStudy.gaps);
  const uploads = input.gapUploads ?? [];
  const seenTitles = new Set<string>();
  const items: HiveBoardChecklistItem[] = [];

  for (const item of listData.items) {
    if (item.kind !== "REQUESTABLE_DOCUMENT" || item.holderType === "COURT_RECORD") continue;
    const title = item.title.trim();
    const key = title.toLowerCase();
    if (key === "" || seenTitles.has(key)) continue;
    seenTitles.add(key);

    const slot = { gapId: item.id, title };
    const linked = uploads.find((candidate) =>
      gapUploadCountsAsPending(
        candidate,
        slot,
        input.acceptedStudyRevisionId ?? null,
        input.acceptedStudyRevisionAcceptedAt ?? null,
      ) || candidate.gapId === item.id || normalizeGapTitle(candidate.gapTitle ?? "") === normalizeGapTitle(title),
    );
    const inStudy = satisfied.titles.has(normalizeGapTitle(title));
    let status: HiveBoardChecklistStatus;
    let statusText: string;
    if (inStudy) {
      status = "in";
      const addedAt = linked?.registeredAt ?? input.acceptedStudyRevisionAcceptedAt ?? "";
      const label = addedAt ? formatBoardDate(addedAt, new Date()) : "recently";
      statusText = label ? `In. Added ${label}.` : "In.";
    } else if (
      linked &&
      gapUploadCountsAsPending(
        linked,
        slot,
        input.acceptedStudyRevisionId ?? null,
        input.acceptedStudyRevisionAcceptedAt ?? null,
      )
    ) {
      status = "added_pending";
      statusText = "Added. Rebuild the study to include it.";
    } else if (linked) {
      status = "added_pending";
      statusText = "Added. Rebuild the study to include it.";
    } else {
      status = "not_in";
      statusText = "Not in yet.";
    }

    items.push({
      gapId: item.id,
      title,
      status,
      statusText,
      action: {
        kind: "link",
        label: "Add it",
        href: `${input.documentsPath}#missing-slot-${item.id.toLowerCase()}`,
      },
    });
  }

  return items;
}

function buildNeeds(input: HiveBoardInput, conflicts: readonly HiveBoardConflictRow[]): HiveBoardNeedItem[] {
  const needs: HiveBoardNeedItem[] = [];

  for (const doc of input.unreadableDocuments) {
    needs.push({
      kind: "unreadable",
      kindLabel: "Could not read",
      title: `${doc.fileName} could not be read`,
      detail: "Replace the file with a readable copy.",
      sourceChips: [],
      action: { kind: "link", label: "Replace it", href: input.documentsPath },
    });
  }

  if (input.documentsNotInStudyCount > 0) {
    const n = input.documentsNotInStudyCount;
    needs.push({
      kind: "not_in_study",
      kindLabel: "Study",
      title: `${n} ${n === 1 ? "document is" : "documents are"} not in the study yet`,
      detail: "Rebuild the study so the new uploads and pages are included.",
      sourceChips: [],
      action: { kind: "rebuild_study", label: "Rebuild study" },
    });
  }

  for (const conflict of conflicts) {
    needs.push({
      kind: "conflict",
      kindLabel: "Conflict",
      title: `Two values for ${conflict.subject}`,
      detail: conflict.detail,
      sourceChips: conflict.sourceChips,
      action: {
        kind: "link",
        label: "Review",
        href: `${input.studyPath}#where-documents-disagree`,
      },
      conflictId: conflict.id,
    });
  }

  return needs;
}

function buildProgress(checklist: readonly HiveBoardChecklistItem[]): HiveBoardProgress | null {
  if (checklist.length === 0) return null;
  const total = checklist.length;
  const inCount = checklist.filter((row) => row.status === "in" || row.status === "added_pending").length;
  const segments = checklist.map((row) => row.status);
  return { in: inCount, total, segments };
}

function openChecklistCount(checklist: readonly HiveBoardChecklistItem[]): number {
  return checklist.filter((row) => row.status !== "in").length;
}

export type HiveBoardChecklistCountInput = Pick<
  HiveBoardInput,
  | "canonicalStudy"
  | "referencedDocuments"
  | "gapUploads"
  | "acceptedStudyRevisionId"
  | "acceptedStudyRevisionAcceptedAt"
  | "documentsPath"
>;

/** Open checklist rows (not_in and added_pending); single source for board headline, meta Missing, and progress. */
export function hiveBoardOpenChecklistCount(input: HiveBoardChecklistCountInput): number {
  if (!input.canonicalStudy) return 0;
  return openChecklistCount(buildChecklist(input as HiveBoardInput));
}

function buildHeadline(needs: readonly HiveBoardNeedItem[], input: HiveBoardInput, checklist: readonly HiveBoardChecklistItem[]): string {
  if (needs.length > 0) {
    return needs.length === 1 ? "1 thing to review" : `${needs.length} things to review`;
  }
  if (input.documentCount === 0) return "Nothing is in yet";
  if (input.readingInProgress) return "Reading the documents";
  const open = openChecklistCount(checklist);
  if (open > 0) return `${open} still to come`;
  return "Everything is in and checked";
}

function buildNext(
  needs: readonly HiveBoardNeedItem[],
  input: HiveBoardInput,
  checklist: readonly HiveBoardChecklistItem[],
): HiveBoardNext | null {
  if (needs.length > 0) return null;

  if (input.documentCount === 0) {
    return {
      title: "Add the documents you have",
      detail: "Upload whatever you have. Old, partial, or out of order is fine.",
      action: { kind: "link", label: "Add documents", href: input.documentsPath },
    };
  }

  if (input.readingInProgress) {
    return {
      title: "Reading the documents",
      detail: input.readingProgressText ?? "Each page is read, saved, and checked.",
      action: null,
    };
  }

  const firstOpen = checklist.find((row) => row.status === "not_in") ?? checklist.find((row) => row.status !== "in");
  if (firstOpen) {
    return {
      title: firstOpen.title,
      detail: firstOpen.statusText,
      action: firstOpen.action,
    };
  }

  if (!input.hasSucceededReport) {
    return {
      title: "Ready for a report",
      detail: "Generate a report from the accepted study when you are ready.",
      action: { kind: "generate_report", label: "Generate report", href: input.reportsPath },
    };
  }

  return {
    title: "Nothing to review",
    detail: input.latestReportAudience
      ? `Open the latest ${audienceLabel(input.latestReportAudience)} report.`
      : "Open the latest report.",
    action: {
      kind: "link",
      label: "Open the latest report",
      href: input.reportsPath,
    },
  };
}

function activityText(event: HiveBoardStoredEvent): string {
  switch (event.kind) {
    case "document_added":
      return `added ${event.fileName}`;
    case "document_read":
      return `read ${event.fileName}`;
    case "document_unreadable":
      return `could not read ${event.fileName}`;
    case "study_built":
      return `built study revision ${event.revisionNumber}`;
    case "intent_saved": {
      const snippet = event.intentText.trim().slice(0, 60);
      return `saved a question: ${snippet}`;
    }
    case "report_written":
      return `wrote the ${audienceLabel(event.audience)} report`;
  }
}

function buildActivity(events: readonly HiveBoardStoredEvent[], now: Date): HiveBoardActivityItem[] {
  const sorted = [...events]
    .filter((event) => Date.parse(event.at))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 8);
  return sorted.map((event) => ({
    at: event.at,
    atLabel: formatBoardDate(event.at, now),
    actor: event.kind === "document_added" || event.kind === "intent_saved" ? "You" : "HiveForYou",
    text: activityText(event),
  }));
}

function buildReadiness(
  needs: readonly HiveBoardNeedItem[],
  checklist: readonly HiveBoardChecklistItem[],
  input: HiveBoardInput,
): HiveBoardReadinessLine[] {
  const missingOpen = openChecklistCount(checklist);
  const studyValue =
    input.studyRevisionNumber && input.studyRevisionNumber > 0
      ? `Revision ${input.studyRevisionNumber}`
      : "Not built yet";
  let latestReport = "None yet";
  if (input.latestReportAudience && input.latestReportFinishedAt) {
    const date = formatBoardDate(input.latestReportFinishedAt, new Date());
    latestReport = `${audienceLabel(input.latestReportAudience)}, ${date}`;
  }

  return [
    {
      label: "Documents",
      value: `${input.documentsReadCount} read, ${input.documentsNotInStudyCount} new`,
    },
    { label: "To review", value: String(needs.length) },
    { label: "Missing", value: String(missingOpen) },
    { label: "Study", value: studyValue },
    { label: "Latest report", value: latestReport },
  ];
}

export function conflictRowsFromStudy(
  study: CanonicalStudy,
  viewConflicts: readonly StudyViewRow[],
  sources: StudyViewSources | null,
): HiveBoardConflictRow[] {
  const byId = new Map(study.conflicts.map((c: CanonicalConflict) => [c.id, c]));
  return viewConflicts.map((row) => {
    const canonical = byId.get(row.id);
    const subject = conflictSubject(canonical?.statement ?? row.statement ?? "this point");
    const values = row.values.map((value) => value.valueAsWritten.trim()).filter((value) => value !== "");
    const detail =
      values.length >= 2
        ? `One record says ${values[0]}; another says ${values[1]}.`
        : row.statement?.trim() || canonical?.statement?.trim() || "";
    const sourceChips: HiveBoardSourceChip[] = [];
    if (sources) {
      for (const value of row.values) {
        const ref = sources.facts[value.factId];
        if (!ref) continue;
        sourceChips.push({
          sourceDocumentId: ref.sourceDocumentId,
          pageNumber: ref.pageNumber,
          quote: ref.quote,
          factIds: [value.factId],
        });
      }
    }
    return { id: row.id, subject, detail, sourceChips };
  });
}

/** Deterministic intake board model (FL-4). */
export function buildHiveBoard(input: HiveBoardInput, now: Date | string): HiveBoardModel {
  const at = typeof now === "string" ? new Date(now) : now;
  const conflicts = input.conflictRows ?? [];
  const checklist = buildChecklist(input);
  const needs = buildNeeds(input, conflicts);
  const progress = buildProgress(checklist);
  const inLinked = checklist.filter((row) => row.status === "in" || row.status === "added_pending").length;
  const checklistNote =
    checklist.length === 0
      ? "From what the documents refer to or usually include."
      : `${inLinked} of ${checklist.length} in, from what the documents refer to or usually include.`;

  return {
    kicker: input.hiveKind === "client" ? `Intake for ${input.hiveName}` : "Your hive",
    headline: buildHeadline(needs, input, checklist),
    progress,
    needs,
    next: buildNext(needs, input, checklist),
    checklist,
    activity: buildActivity(input.storedEvents, at),
    readiness: buildReadiness(needs, checklist, input),
    checklistNote,
  };
}