"use client";

import type { Hive } from "@hiveforyou/contracts";
import type { ListFirmResponse } from "@hiveforyou/contracts";
import { useId, useRef, useState } from "react";

import { TEXT_LINK_CLASS } from "@/components/button-classes";
import { hiveBadgeInitials } from "@/lib/hives/hive-badge-initials";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { HandOverDialog } from "@/components/workspace/HandOverDialog";
import { useWorkspaceAction } from "@/components/workspace/useWorkspaceAction";

type HiveSidebarCardProps = {
  hive: Hive;
  currentUserId: string | null;
  firm: ListFirmResponse | null;
  assigneeLabel: string | null;
  assigneeTitle: string | null;
  assistantName: string;
};

export function HiveSidebarCard({
  hive,
  currentUserId,
  firm,
  assigneeLabel,
  assigneeTitle,
  assistantName,
}: HiveSidebarCardProps) {
  const renameId = useId();
  const path = `/hives/${hive.id}/board`;
  const action = useWorkspaceAction(path);
  const handOverTriggerRef = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(assistantName);
  const [handOverOpen, setHandOverOpen] = useState(false);
  const firmClient = showsFirmThreePane(hive) && firm?.firm;
  const stage = hive.stage ?? "open";
  const canTake =
    firmClient &&
    stage !== "closed" &&
    currentUserId &&
    hive.assigneeUserId?.toLowerCase() !== currentUserId.toLowerCase();
  const canHandOver =
    firmClient &&
    stage !== "closed" &&
    currentUserId &&
    hive.assigneeUserId?.toLowerCase() === currentUserId.toLowerCase();

  const purpose = hive.description?.trim() ?? "";

  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-paper p-3.5" data-testid="hive-sidebar-card">
      <div className="flex gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-mist text-caption font-bold text-ink"
          aria-hidden
        >
          {hiveBadgeInitials(hive.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-small font-semibold text-ink">{hive.name}</p>
          {purpose ? (
            <p className="m-0 line-clamp-2 text-caption text-graphite">{purpose}</p>
          ) : null}
        </div>
      </div>

      {firmClient ? (
        <>
          <p className="m-0 text-caption text-graphite">
            On it:{" "}
            <span className="font-semibold text-ink">
              {assigneeLabel ?? "Unassigned"}
              {assigneeTitle ? ` · ${assigneeTitle}` : ""}
            </span>{" "}
            {canTake ? (
              <button
                type="button"
                className={`${TEXT_LINK_CLASS} border-0 bg-transparent p-0 font-semibold disabled:opacity-45`}
                disabled={action.pending}
                onClick={() => {
                  void action.run({
                    url: `/api/v1/hives/${hive.id}/assignment`,
                    body: { assigneeUserId: currentUserId },
                    failureMessage: "Could not take this hive.",
                  });
                }}
              >
                {action.pending ? "Saving…" : "Take it"}
              </button>
            ) : null}
            {canHandOver && firm ? (
              <button
                ref={handOverTriggerRef}
                type="button"
                className={`${TEXT_LINK_CLASS} border-0 bg-transparent p-0 font-semibold disabled:opacity-45`}
                disabled={action.pending}
                onClick={() => setHandOverOpen(true)}
              >
                Hand over
              </button>
            ) : null}
          </p>
          <p className="m-0 text-caption text-graphite">
            <span className="font-semibold text-ink">{assistantName}</span> · automated{" "}
            {renaming ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                <label htmlFor={renameId} className="sr-only">
                  Assistant name
                </label>
                <input
                  id={renameId}
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  className="min-h-11 rounded-control border border-line px-2 text-caption"
                />
                <button
                  type="button"
                  className={TEXT_LINK_CLASS}
                  disabled={action.pending}
                  onClick={async () => {
                    const name = renameValue.trim();
                    const ok = await action.run({
                      url: "/api/v1/firm/assistant",
                      body: { assistantName: name },
                      failureMessage: "Could not rename the assistant.",
                    });
                    if (ok) setRenaming(false);
                  }}
                >
                  {action.pending ? "Saving…" : "Save"}
                </button>
              </span>
            ) : (
              <button type="button" className={`${TEXT_LINK_CLASS} border-0 bg-transparent p-0`} onClick={() => setRenaming(true)}>
                Rename
              </button>
            )}
          </p>
        </>
      ) : null}

      {action.inlineError ? (
        <p role="alert" className="m-0 text-caption text-coral-deep">
          {action.inlineError.message}
          {action.inlineError.reference ? ` Reference ${action.inlineError.reference}.` : ""}
          {action.inlineError.retryable ? (
            <button
              type="button"
              className="ml-1 border-0 bg-transparent p-0 font-semibold text-cell-blue-deep"
              onClick={() => void action.retrySameKey({
                url: `/api/v1/hives/${hive.id}/assignment`,
                body: { assigneeUserId: currentUserId },
                failureMessage: "Could not take this hive.",
              })}
            >
              Try again
            </button>
          ) : null}
        </p>
      ) : null}

      {firm && currentUserId ? (
        <HandOverDialog
          open={handOverOpen}
          hive={hive}
          firm={firm}
          currentUserId={currentUserId}
          returnFocusRef={handOverTriggerRef}
          onClose={() => setHandOverOpen(false)}
        />
      ) : null}
    </div>
  );
}