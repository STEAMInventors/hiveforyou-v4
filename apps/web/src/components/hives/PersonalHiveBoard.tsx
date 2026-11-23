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
import { useCallback, useState, type ReactNode } from "react";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import { HiveBoardMessaging } from "@/components/hives/HiveBoardMessaging";
import { HiveBoardPeople } from "@/components/hives/HiveBoardPeople";
import { MyWorkPanel } from "@/components/hives/MyWorkPanel";
import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import { ProgressMeter } from "@/components/ui/ProgressMeter";
import { StatusDot } from "@/components/ui/StatusDot";
import { WorkspaceSurface } from "@/components/ui/WorkspaceSurface";
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

function CaseIndicator({ label, value, status }: { label: string; value: string; status: ReactNode }) {
  return (
    <div className="border-b border-line px-3.5 py-3 last:border-b-0 min-[760px]:border-b-0 min-[760px]:border-r min-[760px]:last:border-r-0">
      <p className="m-0 text-meta font-semibold text-ink-3">{label}</p>
      <p className="m-0 mt-1 font-brand text-[22px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-ink">
        {value}
      </p>
      <div className="mt-1.5">{status}</div>
    </div>
  );
}

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
  documentsLoadError?: { message: string; correlationId: string; retryable: boolean } | null;
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
  documentsLoadError = null,
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
  const [inviteOpen, setInviteOpen] = useState(false);
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

      <section
        className="overflow-hidden rounded-[12px] border border-line bg-paper"
        data-testid="personal-case-summary"
      >
        {summary ? (
          <div className="grid grid-cols-1 min-[760px]:grid-cols-3">
            <CaseIndicator
              label="Documents"
              value={String(summary.documentsIn)}
              status={
                <div>
                  {summary.stillToCome > 0 ? (
                    <StatusDot state="missing" label={`${summary.stillToCome} still to come`} />
                  ) : summary.checklistSize != null &&
                    summary.checklistSize > 0 &&
                    summary.documentsIn >= summary.checklistSize ? (
                    <StatusDot state="checked" label="In" />
                  ) : (
                    <StatusDot state="grey" label={summary.documentsIn > 0 ? "Uploaded" : "None yet"} />
                  )}
                  {summary.checklistSize != null ? (
                    <div className="mt-2 max-w-[200px]">
                      <ProgressMeter received={summary.documentsIn} total={summary.checklistSize} />
                    </div>
                  ) : null}
                </div>
              }
            />
            <CaseIndicator
              label="To review"
              value={String(summary.toReview)}
              status={
                summary.toReview > 0 ? (
                  <StatusDot state="needs" label="To review" />
                ) : summary.hasStudy ? (
                  <StatusDot state="checked" label="Nothing to review" />
                ) : (
                  <StatusDot state="grey" label="None waiting" />
                )
              }
            />
            <CaseIndicator
              label="Study"
              value={summary.study ? `v${summary.study.revisionNumber}` : "—"}
              status={
                summary.hasStudy && summary.study ? (
                  <StatusDot state="checked" label="Accepted" />
                ) : (
                  <StatusDot state="grey" label="Not started" />
                )
              }
            />
          </div>
        ) : (
          <p className="m-0 px-3.5 py-3 text-body text-ink-2">The case summary could not be loaded.</p>
        )}
        {studyLoadError ? (
          <div className="border-t border-line px-3.5 py-3">
            <WorkspaceLoadError
              message={studyLoadError.message}
              correlationId={studyLoadError.correlationId}
              retryable={studyLoadError.retryable}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-mist px-3.5 py-2.5">
          {summary?.hasStudy && summary.study ? (
            <p className="m-0 text-meta text-ink-2">
              Study v{summary.study.revisionNumber}
              {summary.study.acceptedLabel ? `, accepted ${summary.study.acceptedLabel}` : ""}. The full study is on its
              own page.
            </p>
          ) : (
            <p className="m-0 text-body text-ink-2">Your study builds once documents are read.</p>
          )}
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
          <WorkspaceSurface
            title={activeProfessional ? "Requests" : "My work and Pro requests"}
            detail={
              activeProfessional
                ? "Ask for documents and track what comes back."
                : "Your uploads, and requests from your Pro."
            }
            tone="mist"
            className="h-full"
            testId="personal-my-work-surface"
            bodyClassName="px-3.5 pb-4 pt-1"
          >
          {activeProfessional ? (
            <MyWorkPanel
              hiveId={hive.id}
              viewer="staff"
              personal
              embedded
              currentUserId={currentUserId}
              initialRequests={requests}
              otherFirstName={otherFirst}
              className="mt-0"
            />
          ) : pendingProfessional ? (
            <p className="m-0 py-3 text-body text-ink-2" data-testid="personal-hive-join-note">
              Join this hive to ask {ownerName ? personFirstName(ownerName) : "the owner"} for documents.
            </p>
          ) : (
            <MyWorkPanel
              hiveId={hive.id}
              viewer="client"
              personal
              embedded
              currentUserId={currentUserId}
              initialRequests={requests}
              uploadedDocuments={uploadedDocuments}
              documentsLoadError={documentsLoadError}
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
            showInviteButton={!owner || closed == null}
            inviteOpen={inviteOpen}
            onInviteOpenChange={setInviteOpen}
          />
          </WorkspaceSurface>
        </div>

        <HiveBoardMessaging
          hiveId={hive.id}
          firmless
          personal
          sharedClosed={closed}
          joinRequired={pendingProfessional}
          inviteAction={
            owner && closed != null ? (
              <button type="button" className={WORKSPACE_SECONDARY} onClick={() => setInviteOpen(true)}>
                Share with a professional
              </button>
            ) : null
          }
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
