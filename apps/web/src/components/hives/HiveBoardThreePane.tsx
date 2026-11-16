"use client";

import type { GetStudyPreparationResponse, Hive, HiveBoardModel, ListFirmResponse } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS } from "@/components/button-classes";
import { HiveBoardPanel } from "@/components/hives/HiveBoardPanel";
import { useStudyPreparation } from "@/components/hives/useStudyPreparation";
import { personFirstName } from "@/lib/hives/firm-board";
import type { FirmHandoverCard, FirmTeamNote } from "@/server/firm/load-firm-board";
import type { HiveBoardUpload } from "@/server/hives/hive-board-loader";

type PaneId = "team" | "items" | "client";

type HiveBoardThreePaneProps = {
  hive: Hive;
  currentUserId: string | null;
  board: HiveBoardModel;
  firm: ListFirmResponse;
  teamNotes: readonly FirmTeamNote[];
  handover: FirmHandoverCard | null;
  uploads: readonly HiveBoardUpload[];
  openHiveCounts: Readonly<Record<string, number>>;
  documentLabels: Readonly<Record<string, string>>;
  initialPreparation?: GetStudyPreparationResponse;
};

const CHIP =
  "inline-flex h-[34px] items-center rounded-pill border-0 bg-[#F1F3F5] px-3 text-[13px] font-medium text-ink";
const PALETTE = [
  ["bg-cell-blue-wash", "text-cell-blue-deep"],
  ["bg-leaf-wash", "text-leaf-deep"],
  ["bg-honey-wash", "text-honey-deep"],
  ["bg-coral-wash", "text-coral-deep"],
] as const;
const RING = "conic-gradient(from 200deg, #3B7CF6, #EF5143, #F6B826, #2FA35A, #3B7CF6)";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function readNarrow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 1099px)").matches;
}

function splitHeadline(headline: string): { num: string; rest: string } {
  const match = /^(\d+)( .*)$/.exec(headline);
  if (!match?.[1] || match[2] === undefined) return { num: "", rest: headline };
  return { num: match[1], rest: match[2] };
}

function noteMatches(note: FirmTeamNote, itemKey: string, itemTitle: string): boolean {
  if (!note.itemRef) return false;
  const ref = note.itemRef.trim().toLowerCase();
  return ref === itemKey.toLowerCase() || ref === itemTitle.trim().toLowerCase();
}

function uploadMatches(upload: HiveBoardUpload, itemKey: string, itemTitle: string): boolean {
  const gap = upload.canonicalGapId?.trim().toLowerCase() ?? "";
  const title = upload.canonicalGapTitle?.trim().toLowerCase() ?? "";
  const key = itemKey.trim().toLowerCase();
  const label = itemTitle.trim().toLowerCase();
  return (gap !== "" && gap === key) || (title !== "" && title === label);
}

export function HiveBoardThreePane({
  hive,
  currentUserId,
  board,
  firm,
  teamNotes,
  handover,
  uploads,
  openHiveCounts,
  documentLabels,
  initialPreparation,
}: HiveBoardThreePaneProps) {
  const router = useRouter();
  const analysis = useStudyPreparation(hive.id, { initialPreparation });
  const [narrow, setNarrow] = useState(readNarrow);
  const [pane, setPane] = useState<PaneId>("items");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(firm.firm?.assistantName ?? "HiveForYou");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 1099px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const staff = useMemo(
    () => firm.members.filter((member) => member.joined && member.state === "active" && member.userId),
    [firm.members],
  );
  const assignee = staff.find(
    (member) => member.userId && currentUserId && member.userId.toLowerCase() === (hive.assigneeUserId ?? "").toLowerCase(),
  );
  const caller = staff.find(
    (member) => member.userId && currentUserId && member.userId.toLowerCase() === currentUserId.toLowerCase(),
  );
  const callerIsAttorney = firm.firm?.callerRole === "owner" || firm.firm?.callerRole === "attorney";
  const stage = hive.stage ?? "open";
  const clientName = hive.name.trim() || "Client";
  const clientFirst = personFirstName(clientName);
  const assistantName = firm.firm?.assistantName?.trim() || "HiveForYou";
  const assistantFirst = personFirstName(assistantName);
  const focused = board.checklist.find((item) => item.gapId === focusId) ?? null;
  const visibleNotes = focused
    ? teamNotes.filter((note) => noteMatches(note, focused.gapId, focused.title))
    : teamNotes;
  const visibleUploads = focused
    ? uploads.filter((upload) => uploadMatches(upload, focused.gapId, focused.title))
    : uploads;
  const headline = splitHeadline(board.headline);
  const missing = board.checklist.filter((item) => item.status === "not_in").length;
  const needCount = board.needs.length;
  const history = historyOpen ? board.activity : board.activity.slice(-3);
  const canTake = stage !== "closed" && (!hive.assigneeUserId || hive.assigneeUserId.toLowerCase() !== (currentUserId ?? "").toLowerCase());
  const showHandoverCard = Boolean(handover && currentUserId && hive.assigneeUserId?.toLowerCase() === currentUserId.toLowerCase() && stage !== "closed");
  const invited = hive.clientShareStatus === "invited" || hive.clientShareStatus === "client_joined";
  const joined = hive.clientShareStatus === "client_joined";
  const stageAction =
    stage === "closed"
      ? callerIsAttorney
        ? { label: "Reopen intake", next: "open" }
        : null
      : stage === "open"
        ? callerIsAttorney
          ? { label: "Close intake", next: "closed" }
          : { label: "Ready for attorney review", next: "review" }
        : null;
  const stageLine = stage === "closed" ? "Closed" : stage === "review" ? "Ready for attorney review" : "In progress";
  const stepColors =
    stage === "closed"
      ? ["bg-leaf", "bg-leaf", "bg-leaf"]
      : stage === "review"
        ? ["bg-leaf", "bg-cell-blue", "bg-line"]
        : ["bg-cell-blue", "bg-line", "bg-line"];
  const showPane = (id: PaneId) => !narrow || pane === id;
  const filledNeeds = board.needs.length > 0;

  async function postJson(url: string, body: unknown, failure: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(failure);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  if (preview) {
    return (
      <div className="flex flex-col gap-4 px-6 pb-10 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-body text-graphite">What {clientFirst} sees</p>
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
        />
      </div>
    );
  }

  return (
    <div data-testid="hive-board-three-pane">
      {narrow ? (
        <div role="tablist" aria-label="Board panes" className="flex gap-1 border-b border-line px-4 pt-2" data-testid="hive-board-pane-tabs">
          {(
            [
              ["team", "Team"],
              ["items", "Items"],
              ["client", clientFirst],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={pane === id}
              className={`min-h-11 border-0 bg-transparent px-3.5 text-sm font-semibold ${
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
            : "grid h-[calc(100vh-117px)] min-h-[560px] grid-cols-[272px_minmax(0,1fr)_384px]"
        }
        data-tab={pane}
      >
        {showPane("team") ? (
          <section aria-label="Your team" className="flex min-h-0 flex-col gap-4 overflow-y-auto border-line bg-mist p-[18px] min-[1100px]:border-r">
            <div className="flex items-center justify-between gap-2">
              <span className="flex flex-col">
                <span className="text-[15px] font-semibold text-ink">{firm.firm?.name}</span>
                <span className="flex items-center gap-1 text-xs text-quiet">
                  <LockIcon />
                  Team only
                </span>
              </span>
              <span className="flex">
                {staff.map((member, index) => {
                  const label = member.displayName?.trim() || member.title;
                  const colors = PALETTE[index % PALETTE.length] ?? PALETTE[0];
                  return (
                    <span
                      key={member.userId}
                      title={`${label} · ${member.title}`}
                      className={`-ml-1.5 flex h-7 w-7 items-center justify-center rounded-pill border-2 border-mist text-[11px] font-bold ${colors[0]} ${colors[1]}`}
                    >
                      {initials(label)}
                    </span>
                  );
                })}
              </span>
            </div>

            <div className="flex flex-col gap-2.5 rounded-[14px] border border-[#E9ECEF] bg-paper px-3.5 py-3">
              <span className="text-xs font-semibold text-quiet">On this hive</span>
              <div className="flex items-center gap-2.5">
                <span className="flex h-[34px] w-[34px] items-center justify-center rounded-pill bg-mist text-xs font-bold text-quiet">
                  {assignee ? initials(assignee.displayName?.trim() || assignee.title) : "–"}
                </span>
                <span className="text-sm">
                  <span className="font-semibold text-ink">
                    {assignee
                      ? currentUserId && assignee.userId?.toLowerCase() === currentUserId.toLowerCase()
                        ? "You"
                        : assignee.displayName?.trim() || assignee.title
                      : "Unassigned"}
                  </span>
                  {assignee ? <span className="text-quiet"> · {assignee.title}</span> : null}
                </span>
              </div>
              <div className="flex gap-1.5">
                {canTake && currentUserId ? (
                  <button type="button" className={CHIP} disabled={busy} onClick={() => void postJson(`/api/v1/hives/${hive.id}/assignment`, { assigneeUserId: currentUserId }, "Could not take this hive.")}>
                    Take it
                  </button>
                ) : null}
                <button type="button" className={CHIP} disabled={busy || stage === "closed"} onClick={() => setHandoverOpen(true)}>
                  Hand over
                </button>
              </div>
              {showHandoverCard && handover ? (
                <div role="status" className="flex flex-col gap-0.5 rounded-[10px] bg-cell-blue-wash px-3 py-2.5">
                  <span className="text-xs font-semibold text-cell-blue-deep">
                    {handover.fromDisplayName} handed this hive to you
                  </span>
                  <span className="text-[13px] leading-snug text-ink">{handover.note?.trim() || "No note."}</span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-2.5 rounded-[14px] border border-[#E9ECEF] bg-paper px-3.5 py-3">
              <span className="text-xs font-semibold text-quiet">Intake</span>
              <div role="img" aria-label={stageLine} className="flex items-center gap-1.5">
                {stepColors.map((color, index) => (
                  <span key={`${color}-${index}`} className={`h-1 flex-1 rounded-pill ${color}`} />
                ))}
              </div>
              <span className={`text-[13px] font-semibold ${stage === "closed" ? "text-leaf-deep" : stage === "review" ? "text-cell-blue-deep" : "text-ink"}`}>
                {stageLine}
              </span>
              {stageAction ? (
                <button
                  type="button"
                  className={`${CHIP} self-start bg-cell-blue-wash text-cell-blue-deep`}
                  disabled={busy}
                  onClick={() => void postJson(`/api/v1/hives/${hive.id}/stage`, { stage: stageAction.next }, "Could not update the intake.")}
                >
                  {stageAction.label}
                </button>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <span className="px-0.5 text-xs font-semibold text-quiet">
                {focused ? "Team notes on this item" : "Team notes"}
              </span>
              {visibleNotes.length === 0 ? <span className="px-0.5 text-[13px] text-quiet">No notes yet.</span> : null}
              <div className="flex flex-col gap-2 overflow-y-auto">
                {visibleNotes.map((note) => {
                  const by = note.authorUserId.toLowerCase() === (currentUserId ?? "").toLowerCase()
                    ? "You"
                    : note.authorDisplayName?.trim() || "Teammate";
                  return (
                    <div key={note.teamNoteId} className="flex items-start gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-cell-blue-wash text-[10px] font-bold text-cell-blue-deep">
                        {initials(by === "You" ? caller?.displayName?.trim() || "You" : by)}
                      </span>
                      <span className="min-w-0">
                        <span className="text-[11.5px] text-quiet">
                          <span className="font-semibold text-ink">{by}</span>
                          {note.itemRef && !focused ? ` · on ${note.itemRef}` : ""}
                        </span>
                        <span className="block text-[13px] leading-snug text-ink">{note.body}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <form
              className="mt-auto flex flex-col gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                const body = noteDraft.trim();
                if (!body) {
                  setNoteError(true);
                  return;
                }
                void (async () => {
                  const ok = await postJson(
                    `/api/v1/hives/${hive.id}/team-notes`,
                    { body, itemRef: focused ? focused.gapId : undefined },
                    "Could not save the note.",
                  );
                  if (ok) {
                    setNoteDraft("");
                    setNoteError(false);
                  }
                })();
              }}
            >
              <div className="flex items-center gap-1.5 rounded-[14px] border border-line bg-paper py-0.5 pl-3.5 pr-0.5">
                <input
                  aria-label={focused ? "Note on this item" : "Note for the team"}
                  placeholder={focused ? "Note on this item…" : "Add a team note…"}
                  value={noteDraft}
                  onChange={(event) => {
                    setNoteDraft(event.target.value);
                    setNoteError(false);
                  }}
                  className="h-9 min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none"
                />
                <button type="submit" aria-label="Add note" className="flex h-9 w-9 items-center justify-center rounded-pill border-0 bg-mist text-cell-blue-deep">
                  +
                </button>
              </div>
              {noteError ? (
                <span role="alert" className="text-xs text-coral-deep">
                  Write a note first.
                </span>
              ) : null}
            </form>
            {error ? <p className="m-0 text-xs text-coral-deep">{error}</p> : null}
          </section>
        ) : null}

        {showPane("items") ? (
          <section aria-label={`${assistantFirst}’s table`} className="flex min-h-0 flex-col gap-4 overflow-y-auto bg-paper p-[18px]">
            <div className="flex flex-col gap-2">
              <span className="text-xs text-quiet">{board.kicker}</span>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="m-0 font-brand text-2xl font-semibold leading-tight text-ink">
                  {headline.num ? <span className="text-cell-blue-deep">{headline.num}</span> : null}
                  {headline.rest}
                </h1>
                <span className="flex flex-wrap gap-1.5">
                  {needCount > 0 ? (
                    <span className="inline-flex h-[22px] items-center rounded-pill bg-cell-blue-wash px-2 text-[11.5px] font-semibold text-cell-blue-deep">
                      {needCount} need you
                    </span>
                  ) : null}
                  {missing > 0 ? (
                    <span className="inline-flex h-[22px] items-center rounded-pill bg-coral-wash px-2 text-[11.5px] font-semibold text-coral-deep">
                      {missing} missing
                    </span>
                  ) : null}
                </span>
              </div>
              {board.progress ? (
                <div role="img" aria-label={board.checklistNote} className="flex gap-1">
                  {board.progress.segments.map((segment, index) => (
                    <span
                      key={`${segment}-${index}`}
                      className="h-1.5 flex-1 rounded-pill"
                      style={{
                        background:
                          segment === "in" ? "#2FA35A" : segment === "added_pending" ? "#3B7CF6" : "rgba(239,81,67,.32)",
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2.5 rounded-xl bg-mist px-3 py-2.5">
              <span aria-hidden className="flex h-[34px] w-[34px] shrink-0 rounded-pill p-0.5" style={{ background: RING }}>
                <span className="flex flex-1 items-center justify-center rounded-pill bg-paper text-xs font-bold text-cell-blue-deep">
                  {initials(assistantName)}
                </span>
              </span>
              <span className="min-w-0 flex-1 text-[13px] text-graphite">
                <span className="font-semibold text-ink">{assistantFirst}’s table</span> · automated. Asks, checks every page. People decide.
              </span>
              {firm.firm?.callerRole === "owner" && !renaming ? (
                <button type="button" className="shrink-0 border-0 bg-transparent p-0 text-[13px] font-medium text-cell-blue-deep" onClick={() => setRenaming(true)}>
                  Rename
                </button>
              ) : null}
            </div>
            {renaming ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-semibold">
                  Assistant’s name
                  <input
                    value={renameValue}
                    onChange={(event) => {
                      setRenameValue(event.target.value);
                      setRenameError(null);
                    }}
                    className="h-[38px] rounded-[10px] border border-graphite px-2.5 text-sm font-normal text-ink"
                  />
                </label>
                <button
                  type="button"
                  className={`${CHIP} bg-cell-blue-wash text-cell-blue-deep`}
                  onClick={() => {
                    const name = renameValue.trim();
                    if (name.length < 1 || name.length > 40) {
                      setRenameError("Use 1 to 40 characters.");
                      return;
                    }
                    void (async () => {
                      const ok = await postJson("/api/v1/firm/assistant", { assistantName: name }, "Could not rename the assistant.");
                      if (ok) setRenaming(false);
                    })();
                  }}
                >
                  Save
                </button>
                <button type="button" className={CHIP} onClick={() => setRenaming(false)}>
                  Cancel
                </button>
                {renameError ? (
                  <span role="alert" className="basis-full text-xs text-coral-deep">
                    {renameError}
                  </span>
                ) : null}
              </div>
            ) : null}

            {board.needs.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h2 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-cell-blue-deep">
                  Needs you
                  <span className="inline-flex h-[22px] items-center rounded-pill bg-cell-blue-deep px-2 text-[11.5px] font-semibold text-paper">
                    {needCount}
                  </span>
                </h2>
                {board.needs.map((need, index) => (
                  <article key={`${need.kind}-${need.title}-${index}`} className="flex flex-col gap-1.5 rounded-[14px] border border-[#E9ECEF] bg-paper px-3.5 py-3">
                    <span className="inline-flex h-[22px] w-fit items-center gap-1 rounded-pill bg-cell-blue-wash px-2 text-[11.5px] font-semibold text-cell-blue-deep">
                      <Hexagon fill="#3B7CF6" />
                      {need.kindLabel}
                    </span>
                    <span className="truncate text-[14.5px] font-semibold text-ink">{need.title}</span>
                    <span className="line-clamp-2 text-[13px] leading-snug text-graphite">{need.detail}</span>
                    <NeedAction
                      hiveId={hive.id}
                      action={need.action}
                      filled={filledNeeds && index === 0}
                      rebuildDisabled={!analysis.rebuildAvailability?.canRebuild || analysis.starting || analysis.active}
                      onRebuild={() => analysis.rebuild()}
                    />
                  </article>
                ))}
              </div>
            ) : board.next?.action ? (
              <NeedAction
                hiveId={hive.id}
                action={board.next.action}
                filled
                rebuildDisabled={!analysis.rebuildAvailability?.canRebuild || analysis.starting || analysis.active}
                onRebuild={() => analysis.rebuild()}
              />
            ) : null}

            <div className="flex flex-col">
              <div className="flex items-center justify-between gap-3 pb-1.5">
                <h2 className="m-0 text-[13px] font-semibold text-ink">Items</h2>
                <span className="text-xs text-quiet">
                  {board.progress ? `${board.progress.in} of ${board.progress.total} in` : ""}
                </span>
              </div>
              {board.checklist.map((item) => {
                const on = focusId === item.gapId;
                const pill =
                  item.status === "in"
                    ? { label: "In", bg: "bg-leaf-wash", fg: "text-leaf-deep", fill: "#2FA35A", stroke: "#2FA35A", check: "#fff" }
                    : item.status === "added_pending"
                      ? { label: "Review", bg: "bg-cell-blue-wash", fg: "text-cell-blue-deep", fill: "#E8F0FE", stroke: "#3B7CF6", check: "transparent" }
                      : { label: "Missing", bg: "bg-coral-wash", fg: "text-coral-deep", fill: "#fff", stroke: "#EF5143", check: "transparent" };
                return (
                  <div key={item.gapId} className={`flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 ${on ? "bg-cell-blue-wash" : ""}`}>
                    <Hexagon fill={pill.fill} stroke={pill.stroke} check={pill.check} size={22} />
                    <button
                      type="button"
                      aria-pressed={on}
                      className="flex min-w-0 flex-1 flex-col border-0 bg-transparent p-0 text-left"
                      onClick={() => setFocusId(on ? null : item.gapId)}
                    >
                      <span className="truncate text-sm text-ink">{item.title}</span>
                      <span className="truncate text-xs text-quiet">{item.statusText}</span>
                    </button>
                    <span className={`inline-flex h-[22px] shrink-0 items-center rounded-pill px-2 text-[11.5px] font-semibold ${pill.bg} ${pill.fg}`}>
                      {pill.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-1">
              <button
                type="button"
                aria-expanded={historyOpen}
                className="flex min-h-9 items-center gap-1.5 self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-graphite"
                onClick={() => setHistoryOpen((open) => !open)}
              >
                History · {board.activity.length}
              </button>
              {history.map((entry) => (
                <div key={`${entry.at}-${entry.text}`} className="flex gap-2.5 py-1 text-[13px] leading-snug">
                  <span className="w-24 shrink-0 text-xs text-quiet">{entry.atLabel}</span>
                  <span>
                    <span className={`font-semibold ${entry.actor === "HiveForYou" ? "text-cell-blue-deep" : "text-ink"}`}>
                      {entry.actor === "HiveForYou" ? assistantFirst : entry.actor}
                    </span>{" "}
                    {entry.text}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {showPane("client") ? (
          <section aria-label={clientName} className="flex min-h-0 flex-col overflow-hidden border-line bg-paper min-[1100px]:border-l">
            <div className="flex items-center gap-2.5 border-b border-line px-[18px] pb-3 pt-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-mist text-[13px] font-bold text-ink">
                {initials(clientName)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold text-ink">{clientName}</span>
                <span className="flex items-center gap-1.5 text-xs text-quiet">
                  <span
                    className="inline-block h-[7px] w-[7px] rounded-pill"
                    style={{ background: joined ? "#2FA35A" : invited ? "#F6B826" : "#B4B9C0" }}
                  />
                  {joined ? "Joined" : invited ? "Invited, not joined yet" : "Not invited yet"}
                </span>
              </span>
              <button
                type="button"
                aria-label={`See what ${clientFirst} sees`}
                title={`See what ${clientFirst} sees`}
                className="flex h-9 w-9 items-center justify-center rounded-pill border-0 bg-mist text-cell-blue-deep"
                onClick={() => setPreview(true)}
              >
                <EyeIcon />
              </button>
            </div>
            {!invited ? (
              <div className="border-b border-line px-[18px] py-3">
                <button type="button" className={CHIP} onClick={() => setInviteOpen(true)}>
                  Invite {clientFirst}
                </button>
              </div>
            ) : null}
            {focused ? (
              <div className="mx-[18px] mt-2.5 flex items-center justify-between gap-2 rounded-pill bg-cell-blue-wash py-1.5 pl-3 pr-1.5 text-xs text-cell-blue-deep">
                <span className="truncate">Uploads for: {focused.title}</span>
                <button type="button" className="rounded-pill border-0 bg-paper px-2.5 py-1 text-xs font-semibold text-cell-blue-deep" onClick={() => setFocusId(null)}>
                  Show all
                </button>
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-[18px] py-3">
              <h2 className="m-0 text-[13px] font-semibold text-ink">Uploads</h2>
              {visibleUploads.length === 0 ? (
                <p className="m-0 text-[13px] text-quiet">No uploads yet.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {visibleUploads.map((upload) => (
                    <li key={upload.sourceDocumentId} className="truncate text-sm text-ink">
                      {upload.fileName}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : null}
      </div>

      {handoverOpen ? (
        <HandOverDialog
          title={hive.name}
          people={staff
            .filter((member) => member.userId?.toLowerCase() !== (hive.assigneeUserId ?? "").toLowerCase())
            .map((member) => {
              const count = openHiveCounts[member.userId?.toLowerCase() ?? ""] ?? 0;
              const name = member.displayName?.trim() || member.email;
              const label =
                currentUserId && member.userId?.toLowerCase() === currentUserId.toLowerCase() ? `Me (${name})` : name;
              return {
                userId: member.userId ?? "",
                name: label,
                title: member.title,
                load: `${count} ${count === 1 ? "hive" : "hives"}`,
              };
            })}
          busy={busy}
          onClose={() => setHandoverOpen(false)}
          onSave={async (userId, note) => {
            const ok = await postJson(
              `/api/v1/hives/${hive.id}/assignment`,
              { assigneeUserId: userId, note: note.trim() || undefined },
              "Could not hand over this hive.",
            );
            if (ok) setHandoverOpen(false);
          }}
        />
      ) : null}

      {inviteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,35,40,0.32)] p-5" onClick={() => setInviteOpen(false)}>
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
              void (async () => {
                const ok = await postJson(
                  `/api/v1/hives/${hive.id}/invitations`,
                  { email, role: "client", name: clientName },
                  "Could not send the invitation.",
                );
                if (ok) setInviteOpen(false);
              })();
            }}
          >
            <h2 className="m-0 font-brand text-[22px] font-semibold">Invite {clientFirst}</h2>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
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
            {inviteError ? <span role="alert" className="text-sm text-coral-deep">{inviteError}</span> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={QUIET_BUTTON_CLASS} onClick={() => setInviteOpen(false)}>
                Cancel
              </button>
              <button type="submit" className={PRIMARY_BUTTON_CLASS}>
                Send invitation
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function NeedAction({
  hiveId,
  action,
  filled,
  rebuildDisabled,
  onRebuild,
}: {
  hiveId: string;
  action: HiveBoardModel["needs"][number]["action"];
  filled: boolean;
  rebuildDisabled: boolean;
  onRebuild: () => void;
}) {
  const className = filled ? PRIMARY_BUTTON_CLASS : QUIET_BUTTON_CLASS;
  if (action.kind === "rebuild_study") {
    return (
      <button type="button" className={className} disabled={rebuildDisabled} onClick={onRebuild}>
        {action.label}
      </button>
    );
  }
  const href = action.href ?? `/hives/${hiveId}/documents`;
  return (
    <a href={href} className={className}>
      {action.label}
    </a>
  );
}

function HandOverDialog({
  title,
  people,
  busy,
  onClose,
  onSave,
}: {
  title: string;
  people: readonly { userId: string; name: string; title: string; load: string }[];
  busy: boolean;
  onClose: () => void;
  onSave: (userId: string, note: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,35,40,0.32)] p-5" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Hand over this hive"
        className="flex w-full max-w-[460px] flex-col gap-4 rounded-[20px] bg-paper p-6 shadow-[0_16px_48px_rgba(31,35,40,0.2)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <span className="font-brand text-[22px] font-semibold">Hand over {title}</span>
          <span className="text-sm text-graphite">They see your note at the top of the board.</span>
        </div>
        <div role="radiogroup" aria-label="Hand over to" className="flex flex-col gap-2">
          {people.map((person) => {
            const on = selected === person.userId;
            return (
              <button
                key={person.userId}
                type="button"
                role="radio"
                aria-checked={on}
                className={`flex min-h-[52px] items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left ${
                  on ? "border-2 border-cell-blue-deep bg-cell-blue-wash" : "border border-line bg-paper"
                }`}
                onClick={() => {
                  setSelected(person.userId);
                  setError(null);
                }}
              >
                <span className="flex flex-col">
                  <span className="text-[15px] font-semibold text-ink">{person.name}</span>
                  <span className="text-[13px] text-graphite">{person.title}</span>
                </span>
                <span className="text-[13px] text-graphite">{person.load}</span>
              </button>
            );
          })}
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Note for them
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Where it stands and what's next"
            className="rounded-xl border border-graphite px-3 py-2.5 text-[15px] font-normal leading-snug text-ink"
          />
        </label>
        {error ? (
          <span role="alert" className="text-sm text-coral-deep">
            {error}
          </span>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={QUIET_BUTTON_CLASS} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={PRIMARY_BUTTON_CLASS}
            disabled={busy}
            onClick={() => {
              if (!selected) {
                setError("Choose who takes it.");
                return;
              }
              void onSave(selected, note);
            }}
          >
            Hand over
          </button>
        </div>
      </div>
    </div>
  );
}

function Hexagon({
  fill,
  stroke = fill,
  check = "transparent",
  size = 10,
}: {
  fill: string;
  stroke?: string;
  check?: string;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <polygon points="12,1.8 21.2,7 21.2,17 12,22.2 2.8,17 2.8,7" fill={fill} stroke={stroke} strokeWidth="2" />
      {check !== "transparent" ? (
        <path d="M8 12.2l2.6 2.6L16 9.6" fill="none" stroke={check} strokeWidth="2.4" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
