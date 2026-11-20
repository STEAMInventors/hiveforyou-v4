"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useState } from "react";

import { WORKSPACE_PRIMARY } from "@/components/button-classes";
import { Card } from "@/components/workspace/Card";
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
    <div className="flex flex-col gap-4">
      <Card title="Notes" testId="team-notes-list">
        {notes.length === 0 ? (
          <p className="m-0 text-small text-graphite">No team notes yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {notes.map((note) => (
              <li key={note.teamNoteId} className="border-t border-line pt-3 first:border-0 first:pt-0">
                <p className="m-0 text-caption text-quiet">
                  {note.authorDisplayName ?? "Team member"} · {note.createdAt}
                </p>
                <p className="m-0 mt-1 text-small text-ink">{note.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Add a note">
        <label htmlFor="team-note-input" className="sr-only">
          Team note
        </label>
        <textarea
          id="team-note-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={4}
          className="w-full rounded-control border border-line px-3 py-2 text-small"
        />
        {action.inlineError ? (
          <p role="alert" className="m-0 mt-2 text-caption text-coral-deep">
            {action.inlineError.message}
            {action.inlineError.reference ? ` Reference ${action.inlineError.reference}.` : ""}
            {action.inlineError.retryable ? (
              <button
                type="button"
                className="ml-1 border-0 bg-transparent p-0 font-semibold text-cell-blue-deep"
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
        <button
          type="button"
          className={`${WORKSPACE_PRIMARY} mt-3`}
          disabled={action.pending || !draft.trim()}
          onClick={() => void save()}
        >
          {action.pending ? "Saving…" : "Save note"}
        </button>
      </Card>
    </div>
  );
}