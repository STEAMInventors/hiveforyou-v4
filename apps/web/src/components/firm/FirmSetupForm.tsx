"use client";

import { normalizePracticeAreaIds } from "@hiveforyou/contracts";

import type { PracticeAreaSetupOption } from "@/server/firm/practice-area-options";
import { useState } from "react";

import { PRIMARY_BUTTON_CLASS } from "@/components/button-classes";

type FirmSetupFormProps = {
  defaultFirstName: string;
  practiceAreaOptions?: PracticeAreaSetupOption[];
  onFinished: (firstName: string) => void;
};

export function FirmSetupForm({
  defaultFirstName,
  practiceAreaOptions = [],
  onFinished,
}: FirmSetupFormProps) {
  const [firstName, setFirstName] = useState(defaultFirstName);
  const [name, setName] = useState("");
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [askOpen, setAskOpen] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firmPreview = name.trim() || "Rivera Law";

  const toggleArea = (packId: string) => {
    setSelectedAreas((current) =>
      current.includes(packId) ? current.filter((id) => id !== packId) : [...current, packId],
    );
    setError(null);
  };

  const validate = (): boolean => {
    if (!firstName.trim()) {
      setError("Enter your first name.");
      return false;
    }
    if (!name.trim()) {
      setError("Enter your firm or practice name.");
      return false;
    }
    const request = requestText.trim();
    if (selectedAreas.length === 0 && !request) {
      setError('Choose what you handle, or tell us in "Don’t see what you handle?".');
      return false;
    }
    return true;
  };

  async function start() {
    if (!validate()) return;
    setBusy(true);
    setError(null);
    try {
      const practiceAreas = normalizePracticeAreaIds(selectedAreas);
      const created = await fetch("/api/v1/firm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), practiceAreas }),
      });
      if (!created.ok) {
        setError("Could not save your practice. Try again.");
        return;
      }
      const request = requestText.trim();
      if (request) {
        await fetch("/api/v1/firm/practice-area-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: request }),
        });
      }
      onFinished(firstName.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="firm-setup">
      <img src="/brand/hiveforyou-mark.svg" alt="" className="h-10 w-10" width={40} height={40} />
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-brand text-[26px] font-semibold leading-tight text-ink">Set up your practice</h1>
        <p className="m-0 text-body leading-normal text-graphite">
          Three quick things, so HiveForYou asks your clients for the right documents. You can change them later in
          Settings.
        </p>
      </div>

      <section className="flex flex-col gap-[18px] rounded-card border border-line bg-paper p-[22px]">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
          Your first name
          <input
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value);
              setError(null);
            }}
            autoComplete="given-name"
            className="h-11 rounded-control border border-line-strong px-3 text-[15px] font-normal text-ink"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
          Firm or practice name
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="Rivera Law"
            autoComplete="organization"
            className="h-11 rounded-control border border-line-strong px-3 text-[15px] font-normal text-ink"
          />
          <span className="text-[12.5px] font-normal text-quiet">
            Your clients see it in emails: “{firmPreview} needs 9 items from you.” Working alone? Use your own name.
          </span>
        </label>

        <div role="group" aria-labelledby="firm-practice-areas" className="flex flex-col gap-2.5">
          <span id="firm-practice-areas" className="text-sm font-semibold text-ink">
            What do you handle?{" "}
            <span className="font-normal text-quiet">· choose all that apply</span>
          </span>
          {practiceAreaOptions.map((area) => {
            const on = selectedAreas.includes(area.packId);
            return (
              <button
                key={area.packId}
                type="button"
                data-testid={`practice-area-${area.packId}`}
                aria-pressed={on}
                onClick={() => toggleArea(area.packId)}
                className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-control border px-3.5 py-3 text-left ${
                  on ? "border-cell-blue-deep bg-cell-blue-wash" : "border-line bg-paper"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-[13px] ${
                    on ? "border-cell-blue-deep bg-cell-blue-deep text-paper" : "border-line-strong bg-paper text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold text-ink">{area.label}</span>
                  <span className="text-[13px] text-graphite">{area.description}</span>
                </span>
              </button>
            );
          })}

          {!askOpen ? (
            <button
              type="button"
              className="self-start border-0 bg-transparent p-0 text-sm font-medium text-cell-blue-deep"
              onClick={() => setAskOpen(true)}
            >
              Don’t see what you handle?
            </button>
          ) : (
            <label className="flex flex-col gap-1.5 rounded-control bg-canvas p-3.5 text-sm font-semibold text-ink">
              Tell us what you handle
              <textarea
                value={requestText}
                onChange={(event) => {
                  setRequestText(event.target.value);
                  setError(null);
                }}
                rows={2}
                placeholder="Planning for elderly clients; probate"
                className="resize-y rounded-control border border-line-strong bg-paper px-3 py-2.5 text-[15px] font-normal text-ink"
              />
              <span className="text-[12.5px] font-normal leading-snug text-graphite">
                We read every request and will email you when HiveForYou covers it. Meanwhile you can still add clients:
                HiveForYou reads their documents and tells you what’s missing, without a starting checklist.
              </span>
            </label>
          )}
        </div>

        {error ? (
          <div role="alert" className="text-sm text-coral-deep">
            {error}
          </div>
        ) : null}

        <button type="button" className={`${PRIMARY_BUTTON_CLASS} h-11`} disabled={busy} onClick={() => void start()}>
          {busy ? "Saving…" : "Start"}
        </button>
      </section>

      <p className="m-0 text-[12.5px] leading-normal text-quiet">
        Adding your team and naming your intake assistant come later, when you need them.
      </p>
    </div>
  );
}