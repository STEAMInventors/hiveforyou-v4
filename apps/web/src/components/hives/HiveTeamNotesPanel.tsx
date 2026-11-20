"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useState } from "react";

import { Composer } from "@/components/ui/Composer";
import { useWorkspaceAction } from "@/components/workspace/useWorkspaceAction";
import type { FirmTeamNote } from "@/server/firm/load-firm-board";

export function HiveTeamNotesPanel({
  hive,
  notes,
}: {
  hive: Hive;
  firmName: string;
  clientName: string;
  notes: readonly FirmTeamNote[];
}) {
  const path = `/hives/${hive.id}/notes`;
  const action = useWorkspaceAction(path);
  const [draft, setDraft] = useState("");

  async function save() {
    const body = draft.trim();
    if (!body || action.pending) return;
    const result = await action.run({
      url: `/api/v1/hives/${hive.id}/team-notes`,
      body: { body, itemRef: null },
      failureMessage: "Could not save the note.",
    });
    if (result) setDraft("");
  }

  return (
    <div className="mx-auto flex w-full max-w-col-read flex-col gap-8" data-testid="team-notes-panel">
      {notes.length === 0 ? (
        <p className="m-0 text-body text-ink-2" data-testid="team-notes-list">
          No team notes yet.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0 p-0" data-testid="team-notes-list">
          {notes.map((note) => (
            <li key={note.teamNoteId} className="border-b border-line py-4 first:pt-0">
              <p className="m-0 text-meta text-ink-3">
                <span className="font-semibold text-ink">{note.authorDisplayName ?? "Team member"}</span>
                {" · "}
                {note.createdAt}
              </p>
              <p className="m-0 mt-1.5 text-body text-ink">{note.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        {action.inlineError ? (
          <p role="alert" className="m-0 text-meta text-coral-deep">
            {action.inlineError.message}
            {action.inlineError.reference ? ` Reference ${action.inlineError.reference}.` : ""}
            {action.inlineError.retryable ? (
              <button
                type="button"
                className="ml-1 border-0 bg-transparent p-0 font-semibold text-blue-deep"
                onClick={() =>
                  void action.retrySameKey({
                    url: `/api/v1/hives/${hive.id}/team-notes`,
                    body: { body: draft.trim(), itemRef: null },
                    failureMessage: "Could not save the note.",
                  })
                }
              >
                Try again
              </button>
            ) : null}
          </p>
        ) : null}
        <Composer
          textareaId="team-note-input"
          textareaLabel="Team note"
          hint="Staff only"
          lock
          primaryLabel={action.pending ? "Adding…" : "Add note"}
          onPrimary={() => void save()}
          primaryDisabled={action.pending || !draft.trim()}
          textareaProps={{
            value: draft,
            onChange: (event) => setDraft(event.target.value),
            rows: 4,
            placeholder: "Write a note only your team will see…",
          }}
        />
      </div>
    </div>
  );
}