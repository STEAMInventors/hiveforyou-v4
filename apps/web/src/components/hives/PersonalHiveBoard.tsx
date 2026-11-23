"use client";

import type {
  CanonicalStudy,
  CoverageGap,
  Hive,
  RequestItem,
  StudyView,
  StudyViewSources,
} from "@hiveforyou/contracts";
import Link from "next/link";
import { useCallback, useState } from "react";

import { HiveBoardMessaging } from "@/components/hives/HiveBoardMessaging";
import { HiveBoardPeople } from "@/components/hives/HiveBoardPeople";
import { MyWorkPanel } from "@/components/hives/MyWorkPanel";
import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import { ProgressMeter } from "@/components/ui/ProgressMeter";
import { StateSentence } from "@/components/ui/StateSentence";
import { WorkspaceLoadError } from "@/components/workspace/WorkspaceLoadError";
import { personFirstName } from "@/lib/hives/firm-board";
import { hiveDocumentsPath, hiveFindingsPath } from "@/lib/hive-routes";
import type { StudyLoadError } from "@/server/hives/hive-summary";

import {
  personalHiveRoster,
  proConversationClosedReason,
  type PersonalHiveRoster,
} from "./personal-hive-roster";

const STUDY_LINK =
  "inline-flex h-11 items-center justify-center rounded-button border border-line-strong bg-paper px-[13px] text-[13.5px] font-semibold text-ink no-underline hover:bg-hover min-[760px]:h-[34px]";

export type PersonalCaseSummary = {
  hasStudy: boolean;
  documentsIn: number;
  checklistSize: number | null;
  toReview: number;
  stillToCome: number;
  study: { revisionNumber: number; acceptedLabel: string } | null;
};

export type PersonalUploadedDocument = {
  id: string;
  fileName: string;
  createdAt: string;
};

export type PersonalHiveBoardProps = {
  hive: Hive;
  assistantName: string;
  summary: PersonalCaseSummary | null;
  requests: readonly RequestItem[];
  uploadedDocuments: readonly PersonalUploadedDocument[];
  initialPeople: ConversationLoad;
  initialAsk: ConversationLoad;
  currentUserId: string;
  roster: PersonalHiveRoster;
  loadError: { message: string; correlationId: string; retryable: boolean } | null;
  studyLoadError: StudyLoadError | null;
  view: StudyView | null;
  sources: StudyViewSources | null;
  canonicalStudy: CanonicalStudy | null;
  coverageGaps: readonly CoverageGap[];
  documentPages?: Readonly<Record<string, number>>;
};

export function PersonalHiveBoard({
  hive,
  assistantName,
  summary,
  requests,
  uploadedDocuments,
  initialPeople,
  initialAsk,
  currentUserId,
  roster: initialRoster,
  loadError,
  studyLoadError,
  view,
  sources,
  canonicalStudy,
  coverageGaps,
  documentPages,
}: PersonalHiveBoardProps) {
  const [roster, setRoster] = useState(initialRoster);
  const onRoster = useCallback((data: unknown) => {
    setRoster(personalHiveRoster(data));
  }, []);
  const owner = hive.isOwner === true || hive.membershipRole === "owner";
  const viewer = owner ? "owner" : "professional";
  const closed = proConversationClosedReason(roster, viewer);
  const ownerName = roster.ownerName;
  const proName = roster.professionalName;

  return (
    <main className="mx-auto w-full max-w-col-read pb-24 pt-8" data-testid="personal-hive-board">
      {loadError ? (
        <WorkspaceLoadError
          message={loadError.message}
          correlationId={loadError.correlationId}
          retryable={loadError.retryable}
        />
      ) : null}

      <section data-testid="personal-case-summary">
        {summary ? (
          <>
            <StateSentence
              documentsIn={summary.documentsIn}
              checklistSize={summary.checklistSize}
              toReview={summary.toReview}
              stillToCome={summary.stillToCome}
            />
            {summary.checklistSize != null ? (
              <ProgressMeter received={summary.documentsIn} total={summary.checklistSize} fullWidth />
            ) : null}
          </>
        ) : null}
        {studyLoadError ? (
          <div className="mt-4">
            <WorkspaceLoadError
              message={studyLoadError.message}
              correlationId={studyLoadError.correlationId}
              retryable={studyLoadError.retryable}
            />
          </div>
        ) : null}
        {summary?.hasStudy && summary.study ? (
          <p className="m-0 mt-3 text-meta text-ink-3">
            Study v{summary.study.revisionNumber}
            {summary.study.acceptedLabel ? `, accepted ${summary.study.acceptedLabel}` : ""}. The full study is on its
            own page.
          </p>
        ) : (
          <p className="m-0 mt-3 max-w-[640px] text-body text-ink-2">Your study builds once documents are read.</p>
        )}
        <div className="mt-4">
          {summary?.hasStudy ? (
            <Link href={hiveFindingsPath(hive.id)} className={STUDY_LINK}>
              Open the study
            </Link>
          ) : (
            <Link href={hiveDocumentsPath(hive.id)} className={STUDY_LINK}>
              Go to Documents
            </Link>
          )}
        </div>
      </section>

      {owner ? (
        <MyWorkPanel
          hiveId={hive.id}
          viewer="client"
          personal
          currentUserId={currentUserId}
          initialRequests={requests}
          uploadedDocuments={uploadedDocuments}
          otherFirstName={proName ? personFirstName(proName) : null}
        />
      ) : (
        <MyWorkPanel
          hiveId={hive.id}
          viewer="staff"
          personal
          currentUserId={currentUserId}
          initialRequests={requests}
          otherFirstName={ownerName ? personFirstName(ownerName) : null}
          className="mt-8"
        />
      )}

      <div className="mt-8">
        <HiveBoardPeople
          hive={hive}
          currentUserId={currentUserId}
          onRoster={onRoster}
        />
      </div>

      <div className="mt-8" data-testid="personal-hive-channels">
        <HiveBoardMessaging
          hiveId={hive.id}
          firmless
          personal
          sharedClosed={closed}
          peopleHint="Shared with your Pro. The AI assistant doesn't take part here."
          assistantName={assistantName}
          currentUserId={currentUserId}
          initialPeople={initialPeople}
          initialAsk={initialAsk}
          teamMemberFirstName={proName}
          staffView={false}
          clientName={ownerName ?? hive.name}
          viewerIsClient={owner}
          hiveFirmId={null}
          studyView={view}
          studySources={sources}
          canonicalStudy={canonicalStudy}
          coverageGaps={coverageGaps}
          documentPages={documentPages}
        />
      </div>
    </main>
  );
}
