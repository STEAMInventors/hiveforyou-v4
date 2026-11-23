"use client";

import type { ListFirmResponse } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PRIMARY_BUTTON_CLASS } from "@/components/button-classes";
import { FirmPracticeAreasCard } from "@/components/firm/FirmPracticeAreasCard";
import type { PracticeAreaSetupOption } from "@/server/firm/practice-area-options";

type FirmTeamPanelProps = {
  initial: ListFirmResponse | null;
  practiceAreaOptions?: PracticeAreaSetupOption[];
};

export function FirmTeamPanel({ initial, practiceAreaOptions = [] }: FirmTeamPanelProps) {
  const router = useRouter();
  const [firmName, setFirmName] = useState("");
  const [assistantName, setAssistantName] = useState("HiveForYou");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (initial?.firm) {
    return (
      <div className="flex max-w-xl flex-col gap-6" data-testid="firm-team-panel">
        <div>
          <h1 className="m-0 font-brand text-[30px] font-semibold text-ink">{initial.firm.name}</h1>
          <p className="m-0 mt-1 text-body text-ink-2">
            {initial.firm.callerRole === "owner" ? "You own this firm." : "You are on this team."}
          </p>
        </div>
        {practiceAreaOptions.length > 0 ? (
          <FirmPracticeAreasCard firm={initial} options={practiceAreaOptions} />
        ) : null}
        <section>
          <h2 className="m-0 mb-2 text-[18px] font-semibold text-ink">People</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {initial.members.map((member) => (
              <li key={`${member.email}-${member.role}`} className="rounded-input border border-line px-4 py-3">
                <p className="m-0 text-body font-medium text-ink">{member.displayName?.trim() || member.email}</p>
                <p className="m-0 text-small text-ink-2">
                  {member.title} · {member.role}
                </p>
              </li>
            ))}
          </ul>
        </section>
        {initial.pendingInvitations.length > 0 ? (
          <section>
            <h2 className="m-0 mb-2 text-[18px] font-semibold text-ink">Pending invitations</h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {initial.pendingInvitations.map((invite) => (
                <li key={invite.invitationId} className="rounded-input border border-line px-4 py-3 text-body text-ink-2">
                  {invite.email} · {invite.title}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="flex max-w-md flex-col gap-4"
      data-testid="firm-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void createFirm();
      }}
    >
      <h1 className="m-0 font-brand text-[30px] font-semibold text-ink">Create your firm</h1>
      <p className="m-0 text-body text-ink-2">
        Add a firm when you want a second seat to assign client hives and leave team notes.
      </p>
      <label className="flex flex-col gap-1 text-small text-ink-2">
        Firm name
        <input
          className="rounded-input border border-line bg-paper px-3 py-2 text-body text-ink outline-none transition-[border-color,box-shadow] focus:border-blue focus:shadow-focus"
          value={firmName}
          onChange={(event) => setFirmName(event.target.value)}
          maxLength={100}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-small text-ink-2">
        Assistant name (client-facing)
        <input
          className="rounded-input border border-line bg-paper px-3 py-2 text-body text-ink outline-none transition-[border-color,box-shadow] focus:border-blue focus:shadow-focus"
          value={assistantName}
          onChange={(event) => setAssistantName(event.target.value)}
          maxLength={40}
        />
      </label>
      {error ? <p className="m-0 text-small text-coral-deep">{error}</p> : null}
      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={busy || firmName.trim().length < 1}>
        Create firm
      </button>
    </form>
  );

  async function createFirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/firm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: firmName.trim(),
          assistantName: assistantName.trim() || null,
        }),
      });
      if (!response.ok) {
        setError("Could not create the firm. Try again.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
}