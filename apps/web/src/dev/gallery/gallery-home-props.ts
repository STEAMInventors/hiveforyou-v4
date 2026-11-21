import type { FindingsOpenItem, FindingsTopic, GetStudyPreparationResponse } from "@hiveforyou/contracts";

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

/** Server-shaped preparation so gallery Home does not call study-preparation APIs in the browser. */
export const GALLERY_STUDY_PREPARATION: GetStudyPreparationResponse = {
  eligibility: {
    documents: [{ sourceDocumentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001", fileName: "statement.pdf", totalPhysicalPages: 12 }],
    excluded: [],
    activeReadCount: 0,
    coverageComplete: true,
    coverageDigest: null,
    gaps: [],
  },
  studyRevision: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    revisionNumber: 6,
    createdAt: "2026-10-20T00:00:00.000Z",
    format: "investigation-1",
    coverageGaps: [],
  },
  processingRun: null,
  reportRuns: [],
  staleness: null,
} as unknown as GetStudyPreparationResponse;

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
    studyLoadError?: HiveHomeProps["studyLoadError"];
    studyAvailability?: HiveHomeProps["studyAvailability"];
    initialPreparation?: GetStudyPreparationResponse | null;
    view?: GalleryFindingsProps["view"] | null;
    sources?: GalleryFindingsProps["sources"] | null;
    canonicalStudy?: GalleryFindingsProps["canonicalStudy"] | null;
  } = {},
): HiveHomeProps {
  const messages = options.messages ?? GALLERY_PEOPLE_PAGE.messages;
  const view = options.view === undefined ? fixture.view : options.view;
  const openItems = options.openItems ?? (view ? fixture.otherOpenItems : []);
  const sources = options.sources === undefined ? fixture.sources : options.sources;
  const canonicalStudy = options.canonicalStudy === undefined ? fixture.canonicalStudy : options.canonicalStudy;
  const topics = options.topics ?? (view ? fixture.topics : []);
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
    sources,
    messages,
    now: new Date("2026-10-28T18:00:00.000Z"),
    study: hasStudy
      ? { revisionNumber: fixture.revisionNumber, acceptedAt: "2026-10-20T00:00:00.000Z" }
      : null,
    documentRows: view ? rowsFromView(view, "documents") : [],
    calculations: fixture.pack?.computedValues ?? [],
  });

  const studyAvailability =
    options.studyAvailability ??
    (hasStudy
      ? view
        ? ({ kind: "canonical" as const } satisfies HiveHomeProps["studyAvailability"])
        : ({ kind: "older", revisionNumber: fixture.revisionNumber } satisfies HiveHomeProps["studyAvailability"])
      : ({ kind: "none" as const } satisfies HiveHomeProps["studyAvailability"]));

  return {
    hiveId: GALLERY_HIVE_ID,
    viewer: options.firmless ? "firmless" : "staff",
    clientName: "Dana Ellis",
    staffName: "Priya Shah",
    assistantName: GALLERY_ASSISTANT_NAME,
    content,
    loadError: null,
    studyLoadError: options.studyLoadError ?? null,
    studyAvailability,
    conflicts: view ? rowsFromView(view, "conflicts") : [],
    timeline: view ? rowsFromView(view, "timeline") : [],
    view,
    sources,
    canonicalStudy,
    coverageGaps: fixture.coverageGaps,
    openItems,
    topics,
    documentPages: fixture.documentPages,
    initialPeople: { ok: true, page: { ...GALLERY_PEOPLE_PAGE, messages } },
    currentUserId: GALLERY_STAFF_ID,
    staffView: !options.firmless,
    viewerIsClient: false,
    hiveFirmId: options.firmless ? null : GALLERY_HIVE.firmId ?? null,
    initialPreparation: options.initialPreparation === null ? undefined : options.initialPreparation ?? GALLERY_STUDY_PREPARATION,
  };
}

export const galleryStaffHome = () => galleryHomeProps(MEDICAID_FINDINGS);
export const galleryLongHome = () =>
  galleryHomeProps(LARGE_FINDINGS, {
    messages: longMessagePage(40).messages,
  });
export const galleryFirmlessHome = () => galleryHomeProps(MEDICAID_FINDINGS, { firmless: true });
export const galleryNoStudyHome = () =>
  galleryHomeProps(MEDICAID_FINDINGS, {
    hasStudy: false,
    progress: null,
    checklist: [],
    view: null,
    sources: null,
    canonicalStudy: null,
    topics: [],
    openItems: [],
    initialPreparation: { ...GALLERY_STUDY_PREPARATION, studyRevision: null },
  });
export const galleryOlderStudyHome = () =>
  galleryHomeProps(MEDICAID_FINDINGS, { view: null, sources: null, canonicalStudy: null, topics: [], openItems: [], studyAvailability: { kind: "older", revisionNumber: 6 } });
export const galleryStudyErrorHome = () =>
  galleryHomeProps(MEDICAID_FINDINGS, {
    view: null,
    sources: null,
    canonicalStudy: null,
    topics: [],
    openItems: [],
    studyLoadError: { message: "We couldn't load the study for this hive.", correlationId: "2eb8421a", retryable: true },
    studyAvailability: {
      kind: "load_error",
      error: { message: "We couldn't load the study for this hive.", correlationId: "2eb8421a", retryable: true },
    },
  });
export const galleryClientOlderStudyHome = () => ({
  ...galleryOlderStudyHome(),
  viewer: "client" as const,
  viewerIsClient: true,
  staffView: false,
});
