"use client";

import type { GetStudyPreparationResponse, GetHiveResponse, Hive, HiveBoardModel, ListFirmResponse } from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type HTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";

import { PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS, WORKSPACE_SECONDARY } from "@/components/button-classes";
import { HiveBoardPanel } from "@/components/hives/HiveBoardPanel";
import { HiveBoardChecklistCard } from "@/components/hives/HiveBoardChecklistCard";
import { HiveBoardClientPane } from "@/components/hives/HiveBoardClientPane";
import { HiveBoardNeedRows } from "@/components/hives/HiveBoardNeedRows";
import {
  boardPollIntervalMs,
  boardPollStateFromFailures,
} from "@/components/hives/hive-board-poll";
import { HiveHandoverBanner } from "@/components/workspace/HiveHandoverBanner";
import type { FirmHandoverCard } from "@/server/firm/load-firm-board";
import { hiveBoardStageAction, hiveBoardStageSegments, splitBoardHeadline } from "@/components/hives/hive-board-stage";
import { useStudyPreparation } from "@/components/hives/useStudyPreparation";
import { PaneErrorBoundary } from "@/components/pane-error-boundary";
import { personFirstName } from "@/lib/hives/firm-board";
import type { HiveBoardUpload } from "@/server/hives/hive-board-loader";
import { useWorkspaceAction } from "@/components/workspace/useWorkspaceAction";

type PaneId = "items" | "client";

type HiveBoardThreePaneProps = {
  hive: Hive;
  currentUserId: string | null;
  board: HiveBoardModel;
  firm: ListFirmResponse;
  uploads: readonly HiveBoardUpload[];
  documentLabels: Readonly<Record<string, string>>;
  initialPreparation?: GetStudyPreparationResponse;
  pollCorrelationId?: string | null;
  initialPollVersion?: string | null;
  initialFastPoll?: boolean;
  handover?: FirmHandoverCard | null;
};

function readNarrow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 1099px)").matches;
}

export function HiveBoardThreePane({
  hive,
  currentUserId,
  board,
  firm,
  uploads,
  documentLabels,
  initialPreparation,
  pollCorrelationId = null,
  initialPollVersion = null,
  initialFastPoll = false,
  handover = null,
}: HiveBoardThreePaneProps) {
  const router = useRouter();
  const analysis = useStudyPreparation(hive.id, { initialPreparation });
  const stageActionHook = useWorkspaceAction(`/hives/${hive.id}`);
  const [narrow, setNarrow] = useState(readNarrow);
  const [pane, setPane] = useState<PaneId>("items");
  const [preview, setPreview] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const inviteAction = useWorkspaceAction(`/hives/${hive.id}`);
  const [pollFailures, setPollFailures] = useState(0);
  const [pollUnavailable, setPollUnavailable] = useState(false);
  const pollState = pollUnavailable ? "unavailable" : boardPollStateFromFailures(pollFailures);
  const lastVersionRef = useRef(initialPollVersion);
  const fastPollRef = useRef(initialFastPoll);
  const visibleRef = useRef(typeof document !== "undefined" ? document.visibilityState === "visible" : true);

  useEffect(() => {
    lastVersionRef.current = initialPollVersion;
    fastPollRef.current = initialFastPoll;
  }, [initialPollVersion, initialFastPoll]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 1099px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    let timer: number | null = null;

    const schedule = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(() => void pollOnce(), boardPollIntervalMs(fastPollRef.current));
    };

    const pollOnce = async () => {
      if (!visibleRef.current) return;
      try {
        const response = await fetch(`/api/v1/hives/${encodeURIComponent(hive.id)}`, {
          credentials: "same-origin",
          headers: { "Cache-Control": "no-cache" },
        });
        if (response.status === 401 && typeof window !== "undefined") {
          const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
          window.location.href = `/sign-in?next=${next}`;
          return;
        }
        if (response.status === 404) {
          setPollUnavailable(true);
          setPollFailures(0);
          return;
        }
        if (!response.ok) {
          setPollFailures((count) => count + 1);
          return;
        }
        const payload = (await response.json()) as GetHiveResponse;
        if (typeof payload.fastPoll === "boolean") {
          const wasFast = fastPollRef.current;
          fastPollRef.current = payload.fastPoll;
          if (wasFast !== payload.fastPoll) schedule();
        }
        const version = typeof payload.version === "string" ? payload.version : null;
        if (version && version !== lastVersionRef.current) {
          lastVersionRef.current = version;
          router.refresh();
        }
        setPollFailures(0);
        setPollUnavailable(false);
      } catch {
        setPollFailures((count) => count + 1);
      }
    };

    const onVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current) {
        void pollOnce();
        schedule();
      } else if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hive.id, router]);

  const showHandoverBanner =
    handover &&
    currentUserId &&
    hive.assigneeUserId?.toLowerCase() === currentUserId.toLowerCase() &&
    hive.stage !== "closed";

  const callerIsAttorney = firm.firm?.callerRole === "owner" || firm.firm?.callerRole === "attorney";
  const clientName = hive.name.trim() || "Client";
  const clientFirst = personFirstName(clientName);
  const assistantFirst = personFirstName(firm.firm?.assistantName?.trim() || "HiveForYou");
  const headline = splitBoardHeadline(board.headline);
  const progressIn = board.progress?.in ?? 0;
  const progressTotal = board.progress?.total ?? 0;
  const stageSegments = hiveBoardStageSegments(hive, progressIn, progressTotal);
  const stageAction = hiveBoardStageAction(hive, callerIsAttorney);
  const showPane = (id: PaneId) => !narrow || pane === id;

  if (pollState === "unavailable") {
    return (
      <div className="flex flex-col gap-4 px-4 py-10 min-[900px]:px-6">
        <p className="m-0 text-body text-ink">This hive is no longer available to you.</p>
        <Link href="/hives" className="text-small font-semibold text-cell-blue-deep no-underline">
          Back to your hives
        </Link>
      </div>
    );
  }

  if (preview) {
    return (
      <div className="flex flex-col gap-4 px-4 pb-10 pt-4 min-[900px]:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-small text-graphite">What {clientFirst} sees</p>
          <button type="button" className={QUIET_BUTTON_CLASS} onClick={() => setPreview(false)}>
            Back to your board
          </button>
        </div>
        <HiveBoardPanel
          hive={hive}
          currentUserId={currentUserId}
          hiveId={hive.id}
          hiveName={hive.name}
          hiveDescription={hive.description ?? ""}
          hasDocuments={uploads.length > 0}
          board={board}
          documentLabels={documentLabels}
          initialPreparation={initialPreparation}
          workspaceMode
        />
      </div>
    );
  }

  return (
    <div data-testid="hive-board-three-pane" className="flex min-h-0 flex-1 flex-col">
      {showHandoverBanner && handover ? <HiveHandoverBanner handover={handover} visible /> : null}
      {pollState === "reconnecting" ? (
        <p role="status" className="m-0 border-b border-line bg-honey-wash px-4 py-2 text-caption text-ink">
          Reconnecting… Your work is saved.
        </p>
      ) : null}
      {narrow ? (
        <div role="tablist" aria-label="Board panes" className="flex gap-1 border-b border-line px-4 pt-2">
          {(
            [
              ["items", "Items"],
              ["client", clientFirst],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={pane === id}
              className={`min-h-11 border-0 bg-transparent px-3.5 text-small font-semibold ${
                pane === id ? "border-b-2 border-cell-blue-deep text-cell-blue-deep" : "text-graphite"
              }`}
              onClick={() => setPane(id)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className={
          narrow
            ? "grid min-h-[560px] grid-cols-1"
            : "grid min-h-[560px] flex-1 grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_384px]"
        }
        data-tab={pane}
      >
        {showPane("items") ? (
          <section
            aria-label="Hive board"
            className="flex min-h-0 flex-col gap-4 overflow-y-auto bg-canvas p-4 min-[900px]:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="m-0 font-brand text-section font-semibold leading-tight text-ink">
                {headline.num ? <span className="text-cell-blue-deep">{headline.num}</span> : null}
                {headline.rest}
              </h1>
              {stageAction ? (
                <button
                  type="button"
                  className={WORKSPACE_SECONDARY}
                  disabled={stageActionHook.pending}
                  onClick={() =>
                    void stageActionHook.run({
                      url: `/api/v1/hives/${hive.id}/stage`,
                      body: { stage: stageAction.next, clientRequestId: crypto.randomUUID() },
                      failureMessage: "Could not update the intake.",
                    })
                  }
                >
                  {stageActionHook.pendingLabel ?? stageAction.label}
                </button>
              ) : null}
            </div>
            {stageActionHook.inlineError ? (
              <p role="alert" className="m-0 text-caption text-coral-deep">
                {stageActionHook.inlineError.message}
                {stageActionHook.inlineError.reference ? ` Reference ${stageActionHook.inlineError.reference}.` : ""}
              </p>
            ) : null}
            <div
              role="img"
              aria-label={stageSegments.map((s) => s.label).join(", ")}
              className="flex flex-col gap-2"
              data-testid="hive-board-stage-strip"
            >
              <div className="flex gap-1">
                {stageSegments.map((segment) => (
                  <span
                    key={segment.label}
                    className={`h-1.5 flex-1 rounded-pill ${segment.complete ? "bg-leaf" : segment.active ? "bg-cell-blue" : "bg-line"}`}
                  />
                ))}
              </div>
              <StageLabelRow className="flex flex-wrap gap-x-1 gap-y-1">
                {stageSegments.map((segment, index) => (
                  <span
                    key={segment.label}
                    className={`text-caption ${segment.active ? "font-semibold text-ink" : segment.complete ? "text-leaf-deep" : "text-graphite"}`}
                  >
                    {segment.label}
                    {index < stageSegments.length - 1 ? <span aria-hidden className="text-graphite"> · </span> : null}
                  </span>
                ))}
              </StageLabelRow>
            </div>

            <PaneErrorBoundary hiveId={hive.id} supportReference={pollCorrelationId}>
              <HiveBoardNeedRows hiveId={hive.id} board={board} documentLabels={documentLabels} analysis={analysis} />
            </PaneErrorBoundary>
            <PaneErrorBoundary hiveId={hive.id} supportReference={pollCorrelationId}>
              <HiveBoardChecklistCard board={board} />
            </PaneErrorBoundary>
          </section>
        ) : null}

        {showPane("client") ? (
          <HiveBoardClientPane
            hive={hive}
            board={board}
            uploads={uploads}
            assistantFirst={assistantFirst}
            onPreview={() => setPreview(true)}
            onInvite={() => setInviteOpen(true)}
          />
        ) : null}
      </div>

      {inviteOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,35,40,0.32)] p-5"
          onClick={() => setInviteOpen(false)}
        >
          <form
            role="dialog"
            aria-label={`Invite ${clientFirst}`}
            className="flex w-full max-w-[460px] flex-col gap-4 rounded-[20px] bg-paper p-6"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const email = inviteEmail.trim().toLowerCase();
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                setInviteError("Check the email.");
                return;
              }
              void inviteAction
                .run({
                  url: `/api/v1/hives/${hive.id}/invitations`,
                  body: { email, role: "client", name: clientName, clientRequestId: crypto.randomUUID() },
                  failureMessage: "Could not send the invitation.",
                })
                .then((ok) => {
                  if (ok) setInviteOpen(false);
                });
            }}
          >
            <h2 className="m-0 font-brand text-[22px] font-semibold">Invite {clientFirst}</h2>
            <label className="flex flex-col gap-1.5 text-small font-medium">
              Email
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => {
                  setInviteEmail(event.target.value);
                  setInviteError(null);
                }}
                className="h-12 rounded-xl border border-graphite px-3.5 text-base font-normal"
              />
            </label>
            {inviteError ? (
              <span role="alert" className="text-small text-coral-deep">
                {inviteError}
              </span>
            ) : null}
            {inviteAction.inlineError ? (
              <span role="alert" className="text-small text-coral-deep">
                {inviteAction.inlineError.message}
              </span>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={QUIET_BUTTON_CLASS} onClick={() => setInviteOpen(false)}>
                Cancel
              </button>
              <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={inviteAction.pending}>
                Send invitation
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function StageLabelRow({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
}
