import type { FindingsOpenItem, FindingsTopic } from "@hiveforyou/contracts";

import { buildHiveHomeContent } from "@/components/home/home-model";
import type { HiveHomeProps } from "@/components/home/HiveHome";

import {
  GALLERY_ASSISTANT_NAME,
  GALLERY_HIVE,
  GALLERY_HIVE_ID,
  GALLERY_PEOPLE_PAGE,
  GALLERY_STAFF_ID,
  longMessagePage,
} from "./fixtures/board-messages";
import { LARGE_FINDINGS, MEDICAID_FINDINGS, type GalleryFindingsProps } from "./fixtures/findings-gallery";

function rowsFromView(view: GalleryFindingsProps["view"], name: string) {
  return view.blocks.find((block) => block.name === name)?.rows ?? [];
}

export function galleryHomeProps(
  fixture: GalleryFindingsProps,
  options: {
    firmless?: boolean;
    messages?: typeof GALLERY_PEOPLE_PAGE.messages;
    openItems?: FindingsOpenItem[];
    topics?: FindingsTopic[];
    documentCount?: number;
    checklist?: { title: string; status: string }[];
    progress?: { in: number; total: number } | null;
    hasStudy?: boolean;
  } = {},
): HiveHomeProps {
  const messages = options.messages ?? GALLERY_PEOPLE_PAGE.messages;
  const openItems = options.openItems ?? fixture.otherOpenItems;
  const topics = options.topics ?? fixture.topics;
  const documentCount = options.documentCount ?? 9;
  const checklist =
    options.checklist ??
    Array.from({ length: 9 }, (_, index) => ({
      title: `Record ${index + 1}`,
      status: index < 6 ? "received" : "not_in",
    }));
  const progress = options.progress ?? { in: 6, total: 9 };
  const hasStudy = options.hasStudy ?? true;

  const content = buildHiveHomeContent({
    documentCount,
    checklist,
    progress,
    openItems,
    topics,
    sources: fixture.sources,
    messages,
    now: new Date("2026-10-28T18:00:00.000Z"),
    study: hasStudy
      ? { revisionNumber: fixture.revisionNumber, acceptedAt: "2026-10-20T00:00:00.000Z" }
      : null,
    documentRows: rowsFromView(fixture.view, "documents"),
    calculations: fixture.pack?.computedValues ?? [],
  });

  return {
    hiveId: GALLERY_HIVE_ID,
    viewer: options.firmless ? "firmless" : "staff",
    clientName: "Dana Ellis",
    staffName: "Priya Shah",
    assistantName: GALLERY_ASSISTANT_NAME,
    content,
    loadError: null,
    conflicts: rowsFromView(fixture.view, "conflicts"),
    timeline: rowsFromView(fixture.view, "timeline"),
    view: fixture.view,
    sources: fixture.sources,
    canonicalStudy: fixture.canonicalStudy,
    coverageGaps: fixture.coverageGaps,
    openItems,
    topics,
    documentPages: fixture.documentPages,
    initialPeople: { ok: true, page: { ...GALLERY_PEOPLE_PAGE, messages } },
    currentUserId: GALLERY_STAFF_ID,
    staffView: !options.firmless,
    viewerIsClient: false,
    hiveFirmId: options.firmless ? null : GALLERY_HIVE.firmId ?? null,
  };
}

export const galleryStaffHome = () => galleryHomeProps(MEDICAID_FINDINGS);
export const galleryLongHome = () =>
  galleryHomeProps(LARGE_FINDINGS, {
    messages: longMessagePage(40).messages,
  });
export const galleryFirmlessHome = () => galleryHomeProps(MEDICAID_FINDINGS, { firmless: true });
export const galleryNoStudyHome = () =>
  galleryHomeProps(MEDICAID_FINDINGS, { hasStudy: false, progress: null, checklist: [] });