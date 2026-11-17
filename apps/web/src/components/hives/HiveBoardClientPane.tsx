"use client";

import type { Hive, HiveBoardModel } from "@hiveforyou/contracts";
import { useMemo, useState } from "react";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import { hiveBadgeInitials } from "@/lib/hives/hive-badge-initials";
import { personFirstName } from "@/lib/hives/firm-board";
import type { HiveBoardUpload } from "@/server/hives/hive-board-loader";

type HiveBoardClientPaneProps = {
  hive: Hive;
  board: HiveBoardModel;
  uploads: readonly HiveBoardUpload[];
  assistantFirst: string;
  onPreview: () => void;
  onInvite: () => void;
};

export function HiveBoardClientPane({
  hive,
  board,
  uploads,
  assistantFirst,
  onPreview,
  onInvite,
}: HiveBoardClientPaneProps) {
  const clientName = hive.name.trim() || "Client";
  const clientFirst = personFirstName(clientName);
  const joined = hive.clientShareStatus === "client_joined";
  const invited = hive.clientShareStatus === "invited" || joined;
  const waitingItems = useMemo(
    () => board.checklist.filter((row) => row.status === "not_in"),
    [board.checklist],
  );
  const hasWaiting = invited && waitingItems.length > 0;
  const [replyDraft, setReplyDraft] = useState("");

  return (
    <aside
      aria-label={clientName}
      className="flex min-h-0 flex-col overflow-hidden border-line bg-paper min-[1100px]:border-l min-[1100px]:w-96"
      data-testid="hive-board-client-pane"
    >
      <header className="flex items-center gap-2.5 border-b border-line px-[18px] pb-3 pt-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-mist text-caption font-bold text-ink">
          {hiveBadgeInitials(clientName)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-small font-semibold text-ink">{clientName}</span>
          <span className="text-caption text-quiet">
            {joined ? "Joined" : hive.clientShareStatus === "invited" ? "Invited, not joined yet" : "Not invited yet"}
          </span>
        </span>
        <button
          type="button"
          className={`${WORKSPACE_SECONDARY} min-h-9 px-3 py-1 text-caption`}
          onClick={onPreview}
        >
          See what {clientFirst} sees
        </button>
      </header>

      {!invited ? (
        <div className="border-b border-line px-[18px] py-3">
          <button type="button" className={WORKSPACE_SECONDARY} onClick={onInvite}>
            Invite {clientFirst}
          </button>
        </div>
      ) : null}

      {hasWaiting ? (
        <div className="flex flex-col gap-2 border-b border-line px-[18px] py-3">
          <p className="m-0 text-small text-ink">
            <span aria-hidden className="text-cell-blue-deep">
              ●
            </span>{" "}
            Waiting on {clientFirst}
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {waitingItems.map((item) => (
              <li key={item.gapId} className="text-small text-ink">
                {item.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[18px] py-3">
        <h2 className="m-0 text-small font-semibold text-ink">Conversation with {clientFirst}</h2>
        {uploads.length === 0 ? (
          <p className="m-0 text-small text-quiet">No uploads yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {uploads.map((upload) => (
              <li key={upload.sourceDocumentId} className="rounded-card bg-mist px-3 py-2 text-small text-ink">
                {upload.fileName}
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-auto flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setReplyDraft("");
          }}
        >
          <label htmlFor={`reply-${hive.id}`} className="text-caption font-semibold text-graphite">
            Reply to {clientFirst}
          </label>
          <textarea
            id={`reply-${hive.id}`}
            value={replyDraft}
            onChange={(event) => setReplyDraft(event.target.value)}
            rows={3}
            placeholder={`Reply to ${clientFirst} as you…`}
            className="w-full rounded-control border border-line px-3 py-2 text-small"
          />
          <p className="m-0 text-caption text-quiet">
            {clientFirst} sees it from you, not from {assistantFirst}.
          </p>
          <button type="submit" className={WORKSPACE_SECONDARY} disabled={!replyDraft.trim()}>
            Send
          </button>
        </form>
      </div>
    </aside>
  );
}