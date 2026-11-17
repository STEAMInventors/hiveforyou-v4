"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { WORKSPACE_PRIMARY } from "@/components/button-classes";
import { Card } from "@/components/workspace/Card";
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
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    const key = crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/hives/${hive.id}/team-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ body, clientRequestId: key }),
      });
      const payload = (await response.json().catch(() => null)) as { safeMessage?: string; correlationId?: string } | null;
      if (!response.ok) {
        setError(
          `${typeof payload?.safeMessage === "string" ? payload.safeMessage : "Could not save the note."}${
            payload?.correlationId ? ` Reference ${payload.correlationId.slice(0, 8)}.` : ""
          }`,
        );
        return;
      }
      setDraft("");
      router.refresh();
    } finally {
      setBusy(false);
    }
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
        {error ? (
          <p role="alert" className="m-0 mt-2 text-caption text-coral-deep">
            {error}
          </p>
        ) : null}
        <button type="button" className={`${WORKSPACE_PRIMARY} mt-3`} disabled={busy || !draft.trim()} onClick={() => void save()}>
          {busy ? "Saving…" : "Save note"}
        </button>
      </Card>
    </div>
  );
}