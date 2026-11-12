import type { CanonicalGap, CanonicalStudy } from "./canonical-study-contracts";
import { type GapHolderType, inferGapHolderType, normalizeGapHolderType } from "./canonical-gap-holders";
import { gapUploadMatchesSlot, normalizeGapTitle } from "./gap-fill";
import {
  buildDocumentRequestListData,
  type DocumentRequestListData,
  requestableDocumentCount,
  type StudyViewReferencedDocument,
} from "./document-request-list-contracts";

export type MissingDocumentSlot = {
  readonly gapId: string;
  readonly title: string;
  readonly why: string;
  readonly holderType: GapHolderType;
  readonly holder: string;
  readonly uploadState: "open" | "added_pending_rebuild";
  readonly linkedSourceDocumentId?: string;
};

export type MissingDocumentsSummary = {
  readonly uploadSlotCount: number;
  readonly courtRecordCount: number;
  readonly futureRecordCount: number;
  readonly slots: readonly MissingDocumentSlot[];
  readonly courtRecordTitles: readonly string[];
  readonly hasPendingUploads: boolean;
};

export type GapUploadLink = {
  readonly gapId: string;
  readonly sourceDocumentId: string;
  /** Title of the gap on the accepted revision when the owner uploaded (stable across renumbering). */
  readonly gapTitle?: string;
  readonly studyRevisionId?: string;
  /** Registration time for slot uploads; used to ignore pre-acceptance documents. */
  readonly registeredAt?: string;
};

export type FilterGapsInput = {
  readonly gaps: readonly CanonicalGap[];
  /** Documents uploaded against a gap but not yet in the accepted study revision. */
  readonly gapUploads?: readonly GapUploadLink[];
  /** When a newer revision is accepted, gaps satisfied there are removed from the actionable list. */
  readonly satisfiedGapIds?: ReadonlySet<string>;
  readonly satisfiedTitles?: ReadonlySet<string>;
  /** Latest accepted study revision id (for same-revision gap id matching only). */
  readonly acceptedStudyRevisionId?: string | null;
};

const normTitle = normalizeGapTitle;

/** Drop gaps whose id or title already appears in a later accepted revision's corpus. */
export function filterActionableGaps(input: FilterGapsInput): CanonicalGap[] {
  const uploadsByGap = new Map((input.gapUploads ?? []).map((link) => [link.gapId, link.sourceDocumentId]));
  return input.gaps.filter((gap) => {
    if (input.satisfiedGapIds?.has(gap.id)) return false;
    const title = gap.title.trim() !== "" ? gap.title : gap.statement;
    if (title && input.satisfiedTitles?.has(normTitle(title))) return false;
    void uploadsByGap;
    return true;
  });
}

export function gapsSatisfiedInStudy(study: CanonicalStudy, priorGaps: readonly CanonicalGap[]): { gapIds: Set<string>; titles: Set<string> } {
  const titles = new Set(study.documents.map((document) => normTitle(document.typeInPlainWords)).filter((t) => t !== ""));
  const gapIds = new Set<string>();
  const satisfiedTitles = new Set<string>();
  for (const gap of priorGaps) {
    const title = gap.title.trim() !== "" ? gap.title : gap.statement;
    if (titles.has(normTitle(title))) {
      gapIds.add(gap.id);
      if (title) satisfiedTitles.add(normTitle(title));
    }
  }
  return { gapIds, titles: satisfiedTitles };
}

export function buildMissingDocumentsSummary(
  study: CanonicalStudy,
  referencedDocuments: readonly StudyViewReferencedDocument[] = [],
  options: {
    readonly gapUploads?: readonly GapUploadLink[];
    readonly satisfiedGapIds?: ReadonlySet<string>;
    readonly satisfiedTitles?: ReadonlySet<string>;
    readonly acceptedStudyRevisionId?: string | null;
    readonly acceptedStudyRevisionAcceptedAt?: string | null;
  } = {},
): MissingDocumentsSummary {
  const actionable = filterActionableGaps({
    gaps: study.gaps,
    gapUploads: options.gapUploads,
    satisfiedGapIds: options.satisfiedGapIds,
    satisfiedTitles: options.satisfiedTitles,
  });
  const filteredStudy: CanonicalStudy = { ...study, gaps: actionable };
  const listData = buildDocumentRequestListData(filteredStudy, referencedDocuments);
  return summaryFromListData(
    listData,
    options.gapUploads ?? [],
    options.acceptedStudyRevisionId ?? null,
    options.acceptedStudyRevisionAcceptedAt ?? null,
  );
}

/** Slot uploads store revision id, gap id, title, and must land after the accepted revision. */
export function gapUploadCountsAsPending(
  link: GapUploadLink,
  slot: { readonly gapId: string; readonly title: string },
  acceptedStudyRevisionId: string | null,
  acceptedStudyRevisionAcceptedAt: string | null,
): boolean {
  const gapTitle = link.gapTitle?.trim() ?? "";
  const studyRevisionId = link.studyRevisionId?.trim() ?? "";
  if (gapTitle === "" || studyRevisionId === "") return false;
  if (!gapUploadMatchesSlot(link, slot, acceptedStudyRevisionId)) return false;
  if (acceptedStudyRevisionAcceptedAt) {
    const registeredAt = link.registeredAt?.trim() ?? "";
    if (registeredAt === "") return false;
    const acceptedMs = Date.parse(acceptedStudyRevisionAcceptedAt);
    const registeredMs = Date.parse(registeredAt);
    if (!Number.isFinite(acceptedMs) || !Number.isFinite(registeredMs)) return false;
    return registeredMs > acceptedMs;
  }
  return true;
}

function summaryFromListData(
  listData: DocumentRequestListData,
  gapUploads: readonly GapUploadLink[],
  acceptedStudyRevisionId: string | null,
  acceptedStudyRevisionAcceptedAt: string | null,
): MissingDocumentsSummary {
  const slots: MissingDocumentSlot[] = [];
  const courtRecordTitles: string[] = [];
  let futureRecordCount = 0;

  for (const item of listData.items) {
    if (item.kind === "FUTURE_RECORD") {
      futureRecordCount += 1;
      continue;
    }
    if (item.kind !== "REQUESTABLE_DOCUMENT") continue;
    const holderType = item.holderType ?? "ASKER_OR_CLIENT";
    if (holderType === "COURT_RECORD") {
      courtRecordTitles.push(item.title);
      continue;
    }
    const slot = { gapId: item.id, title: item.title };
    const link = gapUploads.find((candidate) =>
      gapUploadCountsAsPending(candidate, slot, acceptedStudyRevisionId, acceptedStudyRevisionAcceptedAt),
    );
    slots.push({
      gapId: item.id,
      title: item.title,
      why: item.why,
      holderType,
      holder: item.holder,
      uploadState: link ? "added_pending_rebuild" : "open",
      ...(link ? { linkedSourceDocumentId: link.sourceDocumentId } : {}),
    });
  }

  const hasPendingUploads = slots.some((slot) => slot.uploadState === "added_pending_rebuild");
  return {
    uploadSlotCount: slots.filter((slot) => slot.uploadState === "open").length,
    courtRecordCount: courtRecordTitles.length,
    futureRecordCount,
    slots,
    courtRecordTitles,
    hasPendingUploads,
  };
}

/** Count for summary chips and banners: upload slots still open, excluding court records and future records. */
export function missingDocumentChipCount(summary: MissingDocumentsSummary): number {
  return summary.uploadSlotCount;
}

export function shouldShowMissingDocumentsBanner(summary: MissingDocumentsSummary): boolean {
  return summary.uploadSlotCount > 0 || summary.hasPendingUploads;
}

const HOLDER_HINT = /\(([^)]+)\)/;

function thirdPartyHint(holder: string): "district" | "school" | "teacher" | "generic" {
  const match = HOLDER_HINT.exec(holder);
  const hint = (match?.[1] ?? holder).toLowerCase();
  if (hint.includes("district")) return "district";
  if (hint.includes("school")) return "school";
  if (hint.includes("teacher")) return "teacher";
  return "generic";
}

export type HolderLabelContext = {
  readonly customer?: boolean;
  readonly districtName?: string | null;
  readonly schoolName?: string | null;
};

/** Holder line for document requests; never returns raw enum tokens. */
export function holderTypeLabel(
  holderType: GapHolderType,
  holder: string,
  context: HolderLabelContext = {},
): string {
  switch (holderType) {
    case "ASKER_OR_CLIENT":
      return context.customer ? "You" : "Client";
    case "COUNSEL":
      return holder.trim() !== "" ? holder.trim() : "Counsel";
    case "THIRD_PARTY": {
      const hint = thirdPartyHint(holder);
      if (hint === "district") return context.districtName?.trim() || "the district";
      if (hint === "school") return context.schoolName?.trim() || "the school";
      if (hint === "teacher") return "the teacher";
      const named = holder.replace(HOLDER_HINT, "").replace(/THIRD_PARTY/i, "").trim();
      return named !== "" && !/^third[-\s]?party$/i.test(named) ? named : "the school";
    }
    case "COURT_RECORD":
      return "Court claims register";
  }
}

export function parseGapUploadLinks(
  documents: readonly {
    readonly canonicalGapId?: string | null;
    readonly canonicalGapStudyRevisionId?: string | null;
    readonly canonicalGapTitle?: string | null;
    readonly id?: string;
    readonly registeredAt?: string | null;
  }[],
): GapUploadLink[] {
  const links: GapUploadLink[] = [];
  for (const document of documents) {
    const gapId = typeof document.canonicalGapId === "string" ? document.canonicalGapId.trim() : "";
    const sourceDocumentId = typeof document.id === "string" ? document.id.trim().toLowerCase() : "";
    const gapTitle = typeof document.canonicalGapTitle === "string" ? document.canonicalGapTitle.trim() : "";
    const studyRevisionId =
      typeof document.canonicalGapStudyRevisionId === "string" ? document.canonicalGapStudyRevisionId.trim().toLowerCase() : "";
    const registeredAt = typeof document.registeredAt === "string" ? document.registeredAt.trim() : "";
    if (gapId !== "" && sourceDocumentId !== "") {
      links.push({
        gapId,
        sourceDocumentId,
        ...(gapTitle ? { gapTitle } : {}),
        ...(studyRevisionId ? { studyRevisionId } : {}),
        ...(registeredAt ? { registeredAt } : {}),
      });
    }
  }
  return links;
}

export function enrichGapHolderTypes(gap: CanonicalGap): CanonicalGap {
  if (gap.kind !== "REQUESTABLE_DOCUMENT") return { ...gap, holderType: null };
  const holderType = normalizeGapHolderType(gap.holderType) ?? inferGapHolderType(gap);
  return { ...gap, holderType };
}

export { requestableDocumentCount };
