"use client";

import {
  buildAuditTrailEntries,
  buildHiveBoard,
  hiveAttention,
  type Hive,
  type HiveBoardModel,
  type SourceDocument,
} from "@hiveforyou/contracts";
import { useEffect, useMemo } from "react";

import { EMPTY_OMNI_CATALOG, useRegisterOmniCatalog } from "@/components/ui/omni-catalog";
import {
  mergeOmniCatalog,
  omniDocumentsFromStudyRows,
  omniOpenItemsFromFindings,
  omniStatementsFromTopics,
} from "@/lib/omni-catalog-build";

import { AuditTrailPageView } from "@/components/audit/AuditTrailPageView";
import { DocumentsPanel } from "@/components/hives/DocumentsPanel";
import { HiveTeamNotesPanel } from "@/components/hives/HiveTeamNotesPanel";
import { MyHivesPanel } from "@/components/hives/MyHivesPanel";
import { ClientHome } from "@/components/home/ClientHome";
import { HiveHome } from "@/components/home/HiveHome";
import { StudyReport } from "@/components/study/StudyReport";
import { GALLERY_REPORT_FIXTURE } from "../fixtures/gallery-report";
import { AppShell } from "@/components/app-header";

import { GalleryHiveChrome, useGalleryTitle } from "../gallery-hive-chrome";
import {
  galleryFirmlessHome,
  galleryLongHome,
  galleryNoStudyHome,
  galleryStaffHome,
} from "../gallery-home-props";
import {
  GALLERY_ASSISTANT_NAME,
  GALLERY_CLIENT_ID,
  GALLERY_HIVE,
  GALLERY_HIVE_ID,
  GALLERY_ASK_CLIENT_PAGE,
  GALLERY_ASK_STAFF_READONLY_PAGE,
  GALLERY_PEOPLE_PAGE,
  GALLERY_STAFF_ID,
} from "../fixtures/board-messages";
import { MEDICAID_FINDINGS } from "../fixtures/findings-gallery";
import { GalleryFrame } from "./GalleryFrame";
import { GalleryComponents } from "./GalleryComponents";

const REPORT_PAPER = "rounded-paper border border-line bg-paper px-8 py-10 shadow-paper sm:px-14 sm:py-12";

function GalleryOmniCatalog() {
  const catalog = useMemo(() => {
    const documents =
      MEDICAID_FINDINGS.view?.blocks.find((block) => block.name === "documents")?.rows ??
      [];
    return mergeOmniCatalog({
      suggestions: EMPTY_OMNI_CATALOG.suggestions,
      statements: omniStatementsFromTopics(MEDICAID_FINDINGS.topics),
      openItems: omniOpenItemsFromFindings(MEDICAID_FINDINGS.otherOpenItems, MEDICAID_FINDINGS.sources),
      documents: omniDocumentsFromStudyRows(documents, (id) => MEDICAID_FINDINGS.documentPages?.[id] ?? 12),
    });
  }, []);
  useRegisterOmniCatalog(catalog);
  return null;
}

function OmniFocus({ query }: { query?: string }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="omni"]');
    const input = root?.querySelector("input,textarea") ?? document.querySelector<HTMLInputElement>("#omni");
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
    input.focus();
    if (query) {
      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, [query]);
  return null;
}

function medicaidAuditEntries() {
  const { view, sources, canonicalStudy, documentPages } = MEDICAID_FINDINGS;
  if (!view || !canonicalStudy) return [];
  return buildAuditTrailEntries({
    view,
    sources,
    canonicalStudy,
    pack: MEDICAID_FINDINGS.pack,
    documentTotal: canonicalStudy.documents.length,
    pagesRead: 72,
    pagesTotal: 80,
    unreadableLabels: ["June 2024 checking · p.unreadable"],
    duplicatePairs: [],
    documentFirstPageChips: [],
  });
}

function medicaidBoard(): HiveBoardModel {
  return buildHiveBoard(
    {
      hiveName: GALLERY_HIVE.name,
      hiveKind: "client",
      documentsPath: `/hives/${GALLERY_HIVE_ID}/documents`,
      studyPath: `/hives/${GALLERY_HIVE_ID}`,
      reportsPath: `/hives/${GALLERY_HIVE_ID}/reports`,
      documentCount: 9,
      documentsReadCount: 9,
      documentsNotInStudyCount: 0,
      readingInProgress: false,
      readingProgressText: null,
      unreadableDocuments: [{ fileName: "June 2024 checking.pdf" }],
      canonicalStudy: MEDICAID_FINDINGS.canonicalStudy,
      acceptedStudyRevisionId: "rev-gallery",
      acceptedStudyRevisionAcceptedAt: "2026-10-20T00:00:00.000Z",
      studyRevisionNumber: 3,
      hasSucceededReport: true,
      latestReportAudience: "CUSTOMER",
      latestReportFinishedAt: "2026-10-21T00:00:00.000Z",
      storedEvents: [
        { kind: "study_built", at: "2026-10-20T12:00:00.000Z", revisionNumber: 3 },
        { kind: "document_added", at: "2026-10-19T09:30:00.000Z", fileName: "checking-march.pdf" },
      ],
    },
    "2026-10-28",
  );
}

function medicaidDocuments(empty = false): SourceDocument[] {
  if (empty) return [];
  return (MEDICAID_FINDINGS.canonicalStudy?.documents ?? []).map((document, index) => ({
    sourceDocumentId: document.sourceDocumentId,
    id: document.sourceDocumentId,
    hiveId: GALLERY_HIVE_ID,
    clientRequestId: GALLERY_HIVE.clientRequestId,
    fileName: `statement-${index + 1}.pdf`,
    mimeType: "application/pdf",
    byteSize: 204800,
    sha256: `sha256:${"a".repeat(64)}`,
    storageBucket: "hive-source-documents",
    storagePath: `owner/gallery/${index}.pdf`,
    status: "ACTIVE",
    failureReason: null,
    lifecycleStatus: "ACTIVE",
    uploadStatus: "UPLOADED",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ownerUserId: GALLERY_CLIENT_ID,
    role: document.role,
    typeInPlainWords: document.typeInPlainWords,
    unreadablePageCount: index === 2 ? 1 : 0,
    pageCount: MEDICAID_FINDINGS.documentPages?.[document.sourceDocumentId] ?? 12,
    readPercent: 100,
    duplicateOfSourceDocumentId: null,
    coverageStatus: "INCLUDED",
    readStatus: "READ",
    registeredAt: "2026-10-01T00:00:00.000Z",
    scanStatus: "UNKNOWN_TO_SCANNER",
  })) as unknown as SourceDocument[];
}

const MY_HIVE_FIXTURE: Hive = {
  id: "22222222-2222-4222-8222-222222222222",
  hiveId: "22222222-2222-4222-8222-222222222222",
  name: "Personal records review",
  description: "Gathering records for my own review",
  kind: "own",
  clientRequestId: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
  firmId: null,
  membershipRole: "owner",
};

export function GalleryShell() {
  useGalleryTitle("shell");
  return (
    <GalleryFrame>
      <AppShell
        account={{
          initials: "PS",
          displayName: "Priya Shah",
          email: "priya@example.com",
          startingView: "clients",
        }}
      >
        <p className="m-0 px-5 py-8 text-body text-ink-2" data-testid="gallery-shell-placeholder">
          Shell, typography and buttons — see the components page for the full set.
        </p>
      </AppShell>
    </GalleryFrame>
  );
}

export { GalleryComponents };

export function GalleryOmniStaffEmpty() {
  return (
    <GalleryHiveChrome titleSlug="omni-staff-empty">
      <GalleryOmniCatalog />
      <OmniFocus />
      <p className="sr-only">Omni staff empty</p>
    </GalleryHiveChrome>
  );
}

export function GalleryOmniStaffResults() {
  return (
    <GalleryHiveChrome titleSlug="omni-staff-results">
      <GalleryOmniCatalog />
      <OmniFocus query="2023" />
    </GalleryHiveChrome>
  );
}

export function GalleryOmniAnswer() {
  return (
    <GalleryHiveChrome titleSlug="omni-answer" assistantPage={GALLERY_ASK_CLIENT_PAGE}>
      <OmniFocus />
    </GalleryHiveChrome>
  );
}

export function GalleryOmniClientHandoff() {
  return (
    <GalleryHiveChrome titleSlug="omni-client-handoff" assistantPage={GALLERY_ASK_CLIENT_PAGE}>
      <OmniFocus />
    </GalleryHiveChrome>
  );
}

export function GalleryOmniStaffClientQuestions() {
  return (
    <GalleryHiveChrome titleSlug="omni-staff-client-questions" assistantPage={GALLERY_ASK_STAFF_READONLY_PAGE}>
      <OmniFocus />
    </GalleryHiveChrome>
  );
}

export function GalleryHomeStaff() {
  return (
    <GalleryHiveChrome titleSlug="home-staff">
      <HiveHome {...galleryStaffHome()} />
    </GalleryHiveChrome>
  );
}

export function GalleryHomeLong() {
  return (
    <GalleryHiveChrome titleSlug="home-long">
      <HiveHome {...galleryLongHome()} />
    </GalleryHiveChrome>
  );
}

export function GalleryHomeFirmless() {
  return (
    <GalleryHiveChrome titleSlug="home-firmless" firmless>
      <HiveHome {...galleryFirmlessHome()} />
    </GalleryHiveChrome>
  );
}

export function GalleryHomeNoStudy() {
  return (
    <GalleryHiveChrome titleSlug="home-no-study">
      <HiveHome {...galleryNoStudyHome()} />
    </GalleryHiveChrome>
  );
}

function EvidenceGallery({ source }: { source: string }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("source", source);
    window.history.replaceState(null, "", url.toString());
  }, [source]);
  return (
    <GalleryHiveChrome titleSlug={`evidence-${source}`}>
      <HiveHome {...galleryStaffHome()} />
    </GalleryHiveChrome>
  );
}

export function GalleryEvidenceStatement() {
  return <EvidenceGallery source="f1@m1:1" />;
}

export function GalleryEvidenceItem() {
  return <EvidenceGallery source="f-x2@m4:15" />;
}

export function GalleryEvidenceUnreadable() {
  return <EvidenceGallery source="f-x8@m3:11" />;
}

export function GalleryDocuments() {
  const checklist = medicaidBoard().checklist;
  return (
    <GalleryHiveChrome titleSlug="documents">
      <DocumentsPanel
        hiveId={GALLERY_HIVE_ID}
        initialDocuments={medicaidDocuments()}
        studyView={MEDICAID_FINDINGS.view}
        sources={MEDICAID_FINDINGS.sources}
        canonicalStudy={MEDICAID_FINDINGS.canonicalStudy}
        openItems={MEDICAID_FINDINGS.otherOpenItems}
        topics={MEDICAID_FINDINGS.topics}
        checklist={checklist}
      />
    </GalleryHiveChrome>
  );
}

export function GalleryDocumentsEmpty() {
  return (
    <GalleryHiveChrome titleSlug="documents-empty" documentCount={0}>
      <DocumentsPanel hiveId={GALLERY_HIVE_ID} initialDocuments={[]} checklist={[]} />
    </GalleryHiveChrome>
  );
}

const CLIENT_CHECKLIST = [
  { gapId: "g1", title: "Checking statements Apr–Jun 2023", status: "not_in" as const, statusText: "Not in yet", action: { kind: "link" as const, label: "Add it", href: "#" } },
  { gapId: "g2", title: "Savings statements Q2–Q3 2026", status: "not_in" as const, statusText: "Not in yet", action: { kind: "link" as const, label: "Add it", href: "#" } },
  { gapId: "g3", title: "Checking statements Jan–Mar 2023", status: "in" as const, statusText: "Received", action: { kind: "link" as const, label: "View", href: "#" } },
];

export function GalleryClientHome() {
  return (
    <GalleryHiveChrome
      titleSlug="client-home"
      clientViewer
      account={{ initials: "DE", displayName: "Dana Ellis", email: "dana@example.com", startingView: "own" }}
    >
      <ClientHome
        hiveId={GALLERY_HIVE_ID}
        hiveTitle={GALLERY_HIVE.name}
        staffDisplayName="Priya Shah"
        staffTitle="Onboarding associate"
        assistantName={GALLERY_ASSISTANT_NAME}
        checklist={CLIENT_CHECKLIST}
        progress={{ in: 6, total: 9 }}
        openItems={MEDICAID_FINDINGS.otherOpenItems}
        initialDocuments={medicaidDocuments()}
        acceptedStudyRevisionId="rev-gallery"
        initialPeople={{ ok: true, page: GALLERY_PEOPLE_PAGE }}
        currentUserId={GALLERY_CLIENT_ID}
        hiveFirmId={GALLERY_HIVE.firmId ?? null}
        loadError={null}
        view={MEDICAID_FINDINGS.view}
        sources={MEDICAID_FINDINGS.sources}
        canonicalStudy={MEDICAID_FINDINGS.canonicalStudy}
        coverageGaps={MEDICAID_FINDINGS.coverageGaps}
        topics={MEDICAID_FINDINGS.topics}
        documentPages={MEDICAID_FINDINGS.documentPages}
      />
    </GalleryHiveChrome>
  );
}

export function GalleryClientHomeDone() {
  return (
    <GalleryHiveChrome
      titleSlug="client-home-done"
      clientViewer
      documentCount={9}
      account={{ initials: "DE", displayName: "Dana Ellis", email: "dana@example.com", startingView: "own" }}
    >
      <ClientHome
        hiveId={GALLERY_HIVE_ID}
        hiveTitle={GALLERY_HIVE.name}
        staffDisplayName="Priya Shah"
        staffTitle="Onboarding associate"
        assistantName={GALLERY_ASSISTANT_NAME}
        checklist={CLIENT_CHECKLIST.map((row) =>
          row.status === "not_in" ? { ...row, status: "in" as const, statusText: "Received" } : row,
        )}
        progress={{ in: 9, total: 9 }}
        openItems={[]}
        initialDocuments={medicaidDocuments()}
        acceptedStudyRevisionId="rev-gallery"
        initialPeople={{ ok: true, page: GALLERY_PEOPLE_PAGE }}
        currentUserId={GALLERY_CLIENT_ID}
        hiveFirmId={GALLERY_HIVE.firmId ?? null}
        loadError={null}
        view={MEDICAID_FINDINGS.view}
        sources={MEDICAID_FINDINGS.sources}
        canonicalStudy={MEDICAID_FINDINGS.canonicalStudy}
        coverageGaps={MEDICAID_FINDINGS.coverageGaps}
        topics={MEDICAID_FINDINGS.topics}
        documentPages={MEDICAID_FINDINGS.documentPages}
      />
    </GalleryHiveChrome>
  );
}

export function GalleryReport() {
  const fixture = GALLERY_REPORT_FIXTURE;
  return (
    <GalleryHiveChrome titleSlug="report">
      <article className={REPORT_PAPER} data-print="report">
        <StudyReport
          hiveId={GALLERY_HIVE_ID}
          view={fixture.view}
          sources={fixture.sources}
          header={{
            kind: "report",
            audience: "CUSTOMER",
            fallbackTitle: fixture.title,
            revisionNumber: 3,
            writtenAt: fixture.writtenAt,
            currentRevisionNumber: 3,
          }}
          coverageGaps={fixture.coverageGaps}
          documentPages={fixture.documentPages}
          flatInPaper
        />
      </article>
    </GalleryHiveChrome>
  );
}

export function GalleryAudit() {
  return (
    <GalleryHiveChrome titleSlug="audit">
      <p className="m-0 mb-6 text-meta text-ink-3">
        How HiveForYou reached its findings: each check, its method and result.
      </p>
      <AuditTrailPageView
        entries={medicaidAuditEntries()}
        revisions={[
          { revisionNumber: 3, acceptedAt: "2026-10-20T00:00:00.000Z", summary: "Added 2 files" },
          { revisionNumber: 2, acceptedAt: "2026-09-12T00:00:00.000Z", summary: "Rebuilt after document or intent changes" },
          { revisionNumber: 1, acceptedAt: "2026-08-01T00:00:00.000Z", summary: "First Study built from 6 files" },
        ]}
        board={medicaidBoard()}
        assistantName={GALLERY_ASSISTANT_NAME}
      />
    </GalleryHiveChrome>
  );
}

const GALLERY_NOTES = [
  {
    teamNoteId: "note-1",
    authorUserId: GALLERY_STAFF_ID,
    authorDisplayName: "Priya Shah",
    body: "Client will bring the missing savings statements next week.",
    itemRef: null,
    createdAt: "2026-10-25T10:00:00.000Z",
  },
];

export function GalleryNotes() {
  return (
    <GalleryHiveChrome titleSlug="notes">
      <HiveTeamNotesPanel hive={GALLERY_HIVE} firmName="Example firm" clientName="Dana Ellis" notes={GALLERY_NOTES} />
    </GalleryHiveChrome>
  );
}

export function GalleryMyHives() {
  useGalleryTitle("my-hives");
  return (
    <GalleryFrame>
      <AppShell
        account={{
          initials: "PS",
          displayName: "Priya Shah",
          email: "priya@example.com",
          startingView: "own",
        }}
      >
        <MyHivesPanel
          initialHives={[MY_HIVE_FIXTURE, { ...GALLERY_HIVE, kind: "own", firmId: null, membershipRole: "owner" }]}
          summaries={{
            [MY_HIVE_FIXTURE.id]: {
              documentCount: 4,
              intake: { total: 0, received: 0 },
              attention: hiveAttention({
                documentCount: 4,
                unreadableDocumentCount: 0,
                documentsNotReadCount: 0,
                activeReadCount: 0,
                processingRunFailed: false,
                processingRunActive: false,
                documentsNotInStudyCount: 0,
                openConflicts: 0,
                openNeeds: 2,
                openChanged: 0,
                openMissing: 0,
                openChecked: 1,
                hasStudy: true,
                hasReport: true,
              }),
              study: {
                revisionNumber: 2,
                acceptedAt: "2026-10-01T00:00:00.000Z",
                counts: null,
                targets: null,
                toReviewCount: 2,
              },
            },
          }}
          startingView="own"
        />
      </AppShell>
    </GalleryFrame>
  );
}