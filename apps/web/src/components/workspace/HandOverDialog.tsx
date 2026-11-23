"use client";

import type { Hive, ListFirmResponse } from "@hiveforyou/contracts";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { WORKSPACE_PRIMARY, WORKSPACE_SECONDARY } from "@/components/button-classes";
import { useWorkspaceAction } from "@/components/workspace/useWorkspaceAction";
import { personFirstName } from "@/lib/hives/firm-board";

const NOTE_MAX = 1000;
const UNASSIGNED = "__unassigned__";

type HandOverDialogProps = {
  open: boolean;
  hive: Hive;
  firm: ListFirmResponse;
  currentUserId: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
};

export function HandOverDialog({
  open,
  hive,
  firm,
  currentUserId,
  returnFocusRef,
  onClose,
}: HandOverDialogProps) {
  const titleId = useId();
  const assigneeId = useId();
  const noteId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const path = `/hives/${hive.id}`;
  const action = useWorkspaceAction(path);
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const members = firm.members.filter((m) => m.state === "active" && m.joined && m.userId);
  const currentAssigneeId = hive.assigneeUserId?.toLowerCase() ?? null;
  const unassigned = assignee === UNASSIGNED;

  useEffect(() => {
    if (!open) return;
    setAssignee(UNASSIGNED);
    setNote("");
    setFormError(null);
    setFormError(null);
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLSelectElement>("select")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !action.pending) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, action.pending, onClose]);

  useEffect(() => {
    if (open) return;
    returnFocusRef.current?.focus();
  }, [open, returnFocusRef]);

  if (!open) return null;

  const memberLabel = (userId: string, displayName: string | null | undefined, title: string) => {
    if (userId.toLowerCase() === currentUserId.toLowerCase()) {
      return `Me (${displayName?.trim() || title})`;
    }
    const name = displayName?.trim() || personFirstName(title || "Team member");
    return `${name} · ${title}`;
  };

  async function submit() {
    setFormError(null);
    const assigneeUserId = assignee === UNASSIGNED ? null : assignee;
    if (assigneeUserId && assigneeUserId.toLowerCase() === currentAssigneeId) {
      const member = members.find((m) => m.userId?.toLowerCase() === assigneeUserId.toLowerCase());
      const name = member?.displayName?.trim() || member?.title || "They";
      setFormError(`${name} is already on it.`);
      return;
    }
    const trimmedNote = unassigned ? undefined : note.trim() || undefined;
    if (!unassigned && trimmedNote && trimmedNote.length > NOTE_MAX) return;

    const result = await action.run({
      url: `/api/v1/hives/${hive.id}/assignment`,
      body: { assigneeUserId, note: trimmedNote ?? null },
      failureMessage: "Could not hand over this hive.",
    });
    if (result) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-5"
      onClick={() => !action.pending && onClose()}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-[460px] flex-col gap-4 rounded-[20px] bg-paper p-6"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 id={titleId} className="m-0 font-brand text-[22px] font-semibold text-ink">
          Hand over
        </h2>
        <label className="flex flex-col gap-1.5 text-small font-medium text-ink" htmlFor={assigneeId}>
          Hand over to
          <select
            id={assigneeId}
            value={assignee}
            onChange={(event) => {
              setAssignee(event.target.value);
              setFormError(null);
            }}
            className="min-h-11 rounded-control border border-line px-3 text-base font-normal"
          >
            <option value={UNASSIGNED}>Unassigned</option>
            {members.map((member) =>
              member.userId ? (
                <option key={member.userId} value={member.userId}>
                  {memberLabel(member.userId, member.displayName, member.title)}
                </option>
              ) : null,
            )}
          </select>
        </label>
        {unassigned ? (
          <p className="m-0 text-caption text-ink-2">
            An unassigned hive keeps no handover note. Assign someone to leave a note for them.
          </p>
        ) : (
          <label className="flex flex-col gap-1.5 text-small font-medium text-ink" htmlFor={noteId}>
            Note for the next person
            <span className="text-caption font-normal text-ink-2">Optional</span>
            <textarea
              id={noteId}
              value={note}
              maxLength={NOTE_MAX}
              rows={4}
              onChange={(event) => setNote(event.target.value)}
              className="w-full rounded-control border border-line px-3 py-2 text-small font-normal"
            />
            <span className="text-caption font-normal text-ink-3">
              {note.length}/{NOTE_MAX}
            </span>
          </label>
        )}
        {formError ? (
          <p role="alert" className="m-0 text-small text-coral-deep">
            {formError}
          </p>
        ) : null}
        {action.inlineError ? (
          <p role="alert" className="m-0 text-small text-coral-deep">
            {action.inlineError.message}
            {action.inlineError.reference ? ` Reference ${action.inlineError.reference}.` : ""}
            {action.inlineError.retryable ? (
              <button
                type="button"
                className="ml-2 border-0 bg-transparent p-0 font-semibold text-blue-deep"
                onClick={() => void action.retrySameKey({
                  url: `/api/v1/hives/${hive.id}/assignment`,
                  body: {
                    assigneeUserId: assignee === UNASSIGNED ? null : assignee,
                    note: unassigned ? null : note.trim() || null,
                  },
                  failureMessage: "Could not hand over this hive.",
                })}
              >
                Try again
              </button>
            ) : null}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={WORKSPACE_SECONDARY} disabled={action.pending} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={WORKSPACE_PRIMARY} disabled={action.pending}>
            {action.pending ? "Saving…" : "Hand over"}
          </button>
        </div>
      </form>
    </div>
  );
}