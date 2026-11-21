"use client";

import type {
  CanonicalStudy,
  CoverageGap,
  FindingsOpenItem,
  FindingsTopic,
  GetStudyPreparationResponse,
  HiveBoardChecklistItem,
  SourceDocument,
  StudyView,
  StudyViewSources,
} from "@hiveforyou/contracts";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CanonicalStudyNotice } from "@/components/hives/CanonicalStudyNotice";
import { HiveConversation } from "@/components/hives/HiveConversation";
import { ChecklistGapAddButton } from "@/components/hives/ChecklistGapAddButton";
import { HiveStudyRebuildAction } from "@/components/hives/HiveStudyRebuildAction";
import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import { buildHiveEvidenceViewerModel } from "@/components/study/hive-evidence-model";
import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";
import { Avatar } from "@/components/ui/AvatarStack";
import { LockIcon } from "@/components/ui/LockIcon";
import { EMPTY_OMNI_CATALOG, useRegisterOmniCatalog } from "@/components/ui/omni-catalog";
import { ProgressMeter } from "@/components/ui/ProgressMeter";
import { ShowFewer, ShowMore } from "@/components/ui/ShowMore";
import { StatusDot } from "@/components/ui/StatusDot";
import { Toast } from "@/components/ui/Toast";
import { WorkspaceLoadError } from "@/components/workspace/WorkspaceLoadError";
import { personFirstName } from "@/lib/hives/firm-board";
import type { StudyAvailability } from "@/lib/hives/study-availability";
import type { StudyLoadError } from "@/server/hives/hive-summary";
import { useHiveChat } from "@/lib/hive-chat-context";
import { hiveDocumentsPath, hiveReportsPath } from "@/lib/hive-routes";

import { askSuggestions } from "./ask-suggestions";
import { clientHomeLeadSentence, rowWhyDetail, stillToSendSectionCount } from "./client-home-model";

const STILL_LIMIT = 3;

export type ClientHomeProps = {
  hiveId: string;
  hiveTitle: string;
  staffDisplayName: string | null;
  staffTitle: string | null;
  assistantName: string;
  checklist: readonly HiveBoardChecklistItem[];
  progress: { in: number; total: number } | null;
  openItems: readonly FindingsOpenItem[];
  initialDocuments: readonly SourceDocument[];
  acceptedStudyRevisionId: string | null;
  initialPeople: ConversationLoad;
  currentUserId: string | null;
  hiveFirmId: string | null;
  loadError: { message: string; correlationId: string; retryable: boolean } | null;
  studyLoadError?: StudyLoadError | null;
  studyAvailability?: StudyAvailability | null;
  initialPreparation?: GetStudyPreparationResponse;
  view: StudyView | null;
  sources: StudyViewSources | null;
  canonicalStudy: CanonicalStudy | null;
  coverageGaps: readonly CoverageGap[];
  topics: readonly FindingsTopic[];
  documentPages?: Readonly<Record<string, number>>;
};

function ClientHomeBody(props: ClientHomeProps) {
  const {
    hiveId,
    hiveTitle,
    staffDisplayName,
    staffTitle,
    assistantName,
    checklist,
    progress,
    openItems,
    initialDocuments,
    acceptedStudyRevisionId,
    initialPeople,
    currentUserId,
    hiveFirmId,
    loadError,
    studyLoadError,
    studyAvailability,
    initialPreparation,
  } = props;

  const [documents, setDocuments] = useState<SourceDocument[]>(() => [...initialDocuments]);
  const [expandedStill, setExpandedStill] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const staffName = staffDisplayName?.trim() || "your team";
  const staffFirst = staffDisplayName?.trim() ? personFirstName(staffDisplayName) : "your team";
  const teamVisibility =
    staffDisplayName?.trim() ? `Only you and ${staffFirst}'s team` : "Only you and your team";
  const missingCount = stillToSendSectionCount(checklist);
  const lead = clientHomeLeadSentence(missingCount, staffDisplayName);
  const visibleChecklist = expandedStill ? checklist : checklist.slice(0, STILL_LIMIT);
  const hiddenStill = checklist.length - STILL_LIMIT;

  const chat = useHiveChat();
  const askOn = Boolean(chat?.assistantOn);
  const suggestions = useMemo(
    () =>
      askOn
        ? askSuggestions({
            viewer: "client",
            stillToCome: missingCount,
            documentsIn: progress?.in ?? documents.length,
          })
        : [],
    [askOn, documents.length, missingCount, progress?.in],
  );
  // The sheet shows the same starter questions.
  useRegisterOmniCatalog({ ...EMPTY_OMNI_CATALOG, suggestions });

  const onAddFilesFallback = () => {
    window.location.href = hiveDocumentsPath(hiveId);
  };

  return (
    <main className="min-w-0" data-testid="client-home">
      {loadError ? (
        <WorkspaceLoadError message={loadError.message} correlationId={loadError.correlationId} retryable={loadError.retryable} />
      ) : null}
      {studyLoadError ? (
        <div className="mt-4" data-testid="client-home-study-error">
          <WorkspaceLoadError
            message={studyLoadError.message}
            correlationId={studyLoadError.correlationId}
            retryable={studyLoadError.retryable}
          />
        </div>
      ) : null}
      {studyAvailability?.kind === "older" ? (
        <div className="mt-4 flex flex-col items-start gap-3" data-testid="client-home-older-study">
          <CanonicalStudyNotice />
          <HiveStudyRebuildAction hiveId={hiveId} initialPreparation={initialPreparation} focusDocuments />
        </div>
      ) : null}

      <div className="flex items-center gap-3" data-testid="client-home-staff-card">
        <Avatar person={{ id: "staff", name: staffName, kind: "staff" }} size="lg" />
        <div className="min-w-0">
          <p className="m-0 text-meta text-ink-3">Your file with</p>
          <p className="m-0 text-body font-semibold text-ink">{staffName}</p>
          {staffTitle?.trim() ? <p className="m-0 text-meta text-ink-3">{staffTitle.trim()}</p> : null}
        </div>
      </div>

      <h1 className="m-0 mt-[22px] font-brand text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink">
        {hiveTitle}
      </h1>
      <p className="m-0 mt-1.5 text-[15px] text-ink-2">{lead}</p>

      {progress && progress.total > 0 ? (
        <ProgressMeter received={progress.in} total={progress.total} fullWidth labelled />
      ) : null}

      {askOn && chat ? (
        <div className="mt-[22px]" data-testid="client-home-ask-block">
          <button
            type="button"
            data-testid="client-home-ask"
            className="flex h-[52px] w-full items-center gap-2.5 rounded-[14px] border border-line-strong bg-paper px-3.5 text-left text-[15px] text-ink-2 shadow-lift hover:border-ink-3"
            onClick={() => chat.openChat()}
          >
            <Avatar person={{ id: "ai", name: assistantName, kind: "assistant" }} size="chat" />
            <span className="min-w-0 truncate">Ask {assistantName} about your documents</span>
          </button>
          {suggestions.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-2" data-testid="client-home-chips">
              {suggestions.map((text) => (
                <button
                  key={text}
                  type="button"
                  className="inline-flex h-10 items-center rounded-[9px] border border-line bg-paper px-3 text-left text-[13px] text-ink hover:bg-blue-wash min-[760px]:h-8"
                  onClick={() => chat.openChat({ send: text })}
                >
                  {text}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {checklist.length > 0 ? (
        <section className="mt-[30px]" aria-labelledby="client-still-heading">
          <h2
            id="client-still-heading"
            className="m-0 flex items-baseline justify-between text-[16px] font-semibold text-ink"
          >
            Still to send
            <span className="text-meta font-medium tabular-nums text-ink-3">{missingCount}</span>
          </h2>
          <div data-testid="client-still-to-send">
            {visibleChecklist.map((item) => (
              <div
                key={item.gapId}
                className="grid grid-cols-1 items-center gap-3 border-b border-line py-3.5 min-[760px]:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <p className={`m-0 text-body leading-[1.45] ${item.status === "in" ? "text-ink-3" : "text-ink"}`}>
                    {item.title}
                  </p>
                  {item.status !== "in" && rowWhyDetail(item, openItems) ? (
                    <p className="m-0 mt-0.5 text-meta text-ink-3">{rowWhyDetail(item, openItems)}</p>
                  ) : null}
                </div>
                <div className="flex justify-end">
                  {item.status === "in" ? (
                    <StatusDot state="checked" label="Received" />
                  ) : (
                    <ChecklistGapAddButton
                      hiveId={hiveId}
                      gapId={item.gapId}
                      title={item.title}
                      revisionId={acceptedStudyRevisionId}
                      documents={documents}
                      onDocumentsChange={setDocuments}
                      onAddFiles={onAddFilesFallback}
                      label="Add"
                      showUploadIcon
                      onUploaded={() => setToast("Added.")}
                    />
                  )}
                </div>
              </div>
            ))}
            {checklist.length > STILL_LIMIT ? (
              expandedStill ? (
                <ShowFewer label="Show fewer" onClick={() => setExpandedStill(false)} />
              ) : (
                <ShowMore label={`${hiddenStill} more`} onClick={() => setExpandedStill(true)} />
              )
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mt-[30px]" aria-labelledby="client-messages-heading">
        <h2 id="client-messages-heading" className="m-0 mb-1 text-[16px] font-semibold text-ink">
          Messages with {staffFirst}
        </h2>
        <HiveConversation
          hiveId={hiveId}
          initial={initialPeople}
          staffView={false}
          clientName={null}
          viewerIsClient
          hiveFirmId={hiveFirmId}
          mode="people"
          assistantName={assistantName}
          teamMemberFirstName={staffDisplayName}
          currentUserId={currentUserId}
          column={{
            otherFirstName: staffFirst,
            otherFullName: staffName,
            otherKind: "staff",
            assistantName,
            header: "hidden",
            peopleLockHint: teamVisibility,
          }}
        />
      </section>

      <p className="m-0 mt-6 text-center text-meta">
        <Link href={hiveDocumentsPath(hiveId)} className="font-medium text-ink-2 no-underline hover:text-ink">
          Your documents
        </Link>
        <span className="text-ink-3"> · </span>
        <Link href={hiveReportsPath(hiveId)} className="font-medium text-ink-2 no-underline hover:text-ink">
          Your report
        </Link>
      </p>

      <p className="m-0 mt-[22px] flex gap-2 text-meta text-ink-3">
        <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {teamVisibility} can see this file. {assistantName} is an AI assistant that answers only from your documents
          and never decides anything about your case.
        </span>
      </p>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </main>
  );
}

export function ClientHome(props: ClientHomeProps) {
  const evidence = useMemo(
    () =>
      buildHiveEvidenceViewerModel({
        view: props.view,
        sources: props.sources,
        canonicalStudy: props.canonicalStudy,
        coverageGaps: props.coverageGaps,
        documentPages: props.documentPages,
      }),
    [props.view, props.sources, props.canonicalStudy, props.coverageGaps, props.documentPages],
  );
  const pageCountFor = (id: string) => props.documentPages?.[id] ?? props.documentPages?.[id.toLowerCase()];
  const body = <ClientHomeBody {...props} />;
  if (!evidence) return body;
  return (
    <EvidenceViewerProvider
      hiveId={props.hiveId}
      labels={evidence.labels}
      chipLabels={evidence.chipLabels}
      pageCountFor={pageCountFor}
      citationContexts={evidence.citationContexts}
      view={props.view}
      sources={props.sources}
      canonicalStudy={props.canonicalStudy}
      openItems={props.openItems}
      topics={props.topics}
      coverageGaps={props.coverageGaps}
      clientFirstName={null}
      staffOnFirmHive={false}
    >
      {body}
    </EvidenceViewerProvider>
  );
}