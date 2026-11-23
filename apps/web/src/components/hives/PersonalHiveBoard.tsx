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
  personalBoardRole,
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
  const onRoster = useCallback(
    (data: unknown) => {
      setRoster(personalHiveRoster(data, currentUserId));
    },
    [currentUserId],
  );
  const role = personalBoardRole(hive, roster);
  const owner = role === "owner";
  const activeProfessional = role === "professional";
  const pendingProfessional = role === "pending-professional";
  const closed = proConversationClosedReason(
    roster,
    activeProfessional || pendingProfessional ? "professional" : "owner",
    !pendingProfessional,
  );
  const ownerName = roster.ownerName;
  const proName = roster.professionalName;
  const otherFirst = owner
    ? proName
      ? personFirstName(proName)
      : null
    : ownerName
      ? personFirstName(ownerName)
      : null;

  return (
    <main className="w-full min-w-0 pb-4" data-testid="personal-hive-board">
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
          <p className="m-0 mt-3 text-body text-ink-2">Your study builds once documents are read.</p>
        )}
        <div className="mt-3">
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

      <div
        className="mt-5 grid grid-cols-1 items-start gap-6 min-[760px]:grid-cols-[minmax(240px,340px)_minmax(0,1fr)] min-[760px]:gap-5 min-[1480px]:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.15fr)_minmax(0,1.15fr)] min-[1480px]:items-stretch"
        data-testid="personal-hive-workspace"
      >
        <div className="min-w-0" data-testid="personal-hive-work">
          {activeProfessional ? (
            <MyWorkPanel
              hiveId={hive.id}
              viewer="staff"
              personal
              currentUserId={currentUserId}
              initialRequests={requests}
              otherFirstName={otherFirst}
              className="mt-0"
            />
          ) : pendingProfessional ? (
            <p className="m-0 text-body text-ink-2" data-testid="personal-hive-join-note">
              Join this hive to ask {ownerName ? personFirstName(ownerName) : "the owner"} for documents.
            </p>
          ) : (
            <MyWorkPanel
              hiveId={hive.id}
              viewer="client"
              personal
              currentUserId={currentUserId}
              initialRequests={requests}
              uploadedDocuments={uploadedDocuments}
              otherFirstName={otherFirst}
              className="mt-0"
            />
          )}
          <HiveBoardPeople
            hive={hive}
            currentUserId={currentUserId}
            canInvite={owner}
            viewerRole={owner ? "owner" : activeProfessional || pendingProfessional ? "professional" : undefined}
            onRoster={onRoster}
          />
        </div>

        <HiveBoardMessaging
          hiveId={hive.id}
          firmless
          personal
          sharedClosed={closed}
          joinRequired={pendingProfessional}
          peopleHint={
            owner
              ? "Shared with your Pro. The AI assistant doesn't take part here."
              : `Shared with ${ownerName ? personFirstName(ownerName) : "the owner"}. The AI assistant doesn't take part here.`
          }
          assistantName={assistantName}
          currentUserId={currentUserId}
          initialPeople={initialPeople}
          initialAsk={initialAsk}
          teamMemberFirstName={owner ? proName : null}
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
