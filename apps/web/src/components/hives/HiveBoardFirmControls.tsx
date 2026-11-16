"use client";

import type { FirmMemberRow, Hive, ListFirmResponse } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS } from "@/components/button-classes";

type HiveBoardFirmControlsProps = {
  hive: Hive;
  currentUserId: string | null;
  firm: ListFirmResponse;
};

const STAGES = [
  { value: "open", label: "Open" },
  { value: "review", label: "Ready for review" },
  { value: "closed", label: "Closed" },
] as const;

function staffOptions(members: FirmMemberRow[]) {
  return members.filter((member) => member.joined && member.state === "active" && member.userId);
}

export function HiveBoardFirmControls({ hive, currentUserId, firm }: HiveBoardFirmControlsProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [teamNote, setTeamNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hive.firmId || !firm.firm) {
    return null;
  }

  const options = staffOptions(firm.members);
  const assignee = hive.assigneeUserId ?? "";
  const stage = hive.stage ?? "open";

  async function assignTo(userId: string | null) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/hives/${hive.id}/assignment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeUserId: userId,
          note: note.trim() || undefined,
        }),
      });
      if (!response.ok) {
        setError("Could not update the assignee.");
        return;
      }
      setNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function updateStage(nextStage: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/hives/${hive.id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: nextStage }),
      });
      if (!response.ok) {
        setError("Could not update the stage.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveTeamNote() {
    const body = teamNote.trim();
    if (!body) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/hives/${hive.id}/team-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!response.ok) {
        setError("Could not save the team note.");
        return;
      }
      setTeamNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4" data-testid="hive-board-firm-controls">
      <h3 className="m-0 text-small font-semibold text-ink">Team</h3>
      <label className="flex flex-col gap-1 text-small text-graphite">
        Assigned to
        <select
          className="rounded-card border border-line bg-paper px-3 py-2 text-body text-ink"
          value={assignee}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value;
            void assignTo(value ? value : null);
          }}
        >
          <option value="">Unassigned</option>
          {options.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.displayName?.trim() || member.title} ({member.title})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-small text-graphite">
        Handover note
        <textarea
          className="min-h-[72px] rounded-card border border-line bg-paper px-3 py-2 text-body text-ink"
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          maxLength={1000}
        />
      </label>
      {currentUserId ? (
        <button type="button" className={QUIET_BUTTON_CLASS} disabled={busy} onClick={() => void assignTo(currentUserId)}>
          Take this hive
        </button>
      ) : null}
      <StageButtons stage={stage} busy={busy} onChange={updateStage} />
      <label className="flex flex-col gap-1 text-small text-graphite">
        Team note (visible to your firm only)
        <textarea
          className="min-h-[72px] rounded-card border border-line bg-paper px-3 py-2 text-body text-ink"
          value={teamNote}
          disabled={busy}
          onChange={(event) => setTeamNote(event.target.value)}
          maxLength={2000}
        />
      </label>
      <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={busy || !teamNote.trim()} onClick={() => void saveTeamNote()}>
        Save team note
      </button>
      {error ? <p className="m-0 text-small text-coral">{error}</p> : null}
    </section>
  );
}

function StageButtons({
  stage,
  busy,
  onChange,
}: {
  stage: string;
  busy: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {STAGES.map((item) => (
        <button
          key={item.value}
          type="button"
          className={stage === item.value ? PRIMARY_BUTTON_CLASS : QUIET_BUTTON_CLASS}
          disabled={busy || stage === item.value}
          onClick={() => void onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}