"use client";

import { useState } from "react";

import { PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS } from "@/components/button-classes";

type Teammate = { email: string; title: string };

type FirmSetupFormProps = {
  onFinished: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function FirmSetupForm({ onFinished }: FirmSetupFormProps) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<Teammate[]>([{ email: "", title: "Paralegal" }]);
  const [assistant, setAssistant] = useState("HiveForYou");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = assistant.trim() || "HiveForYou";

  const next = () => {
    if (step === 1) {
      if (!name.trim()) {
        setError("Enter your firm’s name.");
        return;
      }
      setError(null);
      setStep(2);
      return;
    }
    if (step === 2) {
      const bad = rows.find((row) => row.email.trim() && !EMAIL_RE.test(row.email.trim().toLowerCase()));
      if (bad) {
        setError(`Check the email “${bad.email.trim()}”.`);
        return;
      }
      setError(null);
      setStep(3);
      return;
    }
    if (assistant.trim().length > 40) {
      setError("Use 1 to 40 characters.");
      return;
    }
    void finish();
  };

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const created = await fetch("/api/v1/firm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), assistantName: preview }),
      });
      if (!created.ok) {
        setError("Could not create the firm. Try again.");
        return;
      }
      for (const row of rows) {
        const email = row.email.trim().toLowerCase();
        if (!email) continue;
        const invited = await fetch("/api/v1/firm/invitations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, title: row.title.trim() || "Team member", role: "member" }),
        });
        if (!invited.ok) {
          setError("The firm is saved. An invitation could not be sent. Try again from your firm page.");
          return;
        }
      }
      onFinished();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="firm-setup">
      <div role="img" aria-label={`Step ${step} of 3`} className="flex gap-1.5">
        {[1, 2, 3].map((index) => (
          <span key={index} className={`h-1 flex-1 rounded-pill ${index <= step ? "bg-cell-blue-deep" : "bg-line"}`} />
        ))}
      </div>
      <span className="text-sm text-graphite">Step {step} of 3</span>

      {step === 1 ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="m-0 font-brand text-[32px] font-semibold leading-tight text-ink">Name your firm</h1>
            <p className="m-0 text-body leading-normal text-graphite">
              Your clients and your team see it. Every client hive belongs to the firm, so anyone on the team can pick it up.
            </p>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Firm name
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              placeholder="For example, Rivera Law"
              className="h-[52px] rounded-xl border border-graphite px-4 text-[17px] font-normal text-ink"
            />
          </label>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="m-0 font-brand text-[32px] font-semibold leading-tight text-ink">Who works with you?</h1>
            <p className="m-0 text-body leading-normal text-graphite">
              They get an invitation by email. Working alone? Skip this; you can add people later.
            </p>
          </div>
          {rows.map((row, index) => (
            <div key={index} className="flex flex-wrap gap-2.5">
              <label className="flex min-w-[220px] flex-[2] flex-col gap-1.5 text-sm font-medium text-ink">
                Email
                <input
                  type="email"
                  value={row.email}
                  placeholder="name@yourfirm.com"
                  onChange={(event) => {
                    const value = event.target.value;
                    setRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, email: value } : item)));
                    setError(null);
                  }}
                  className="h-12 rounded-xl border border-graphite px-3.5 text-base font-normal text-ink"
                />
              </label>
              <label className="flex min-w-[140px] flex-1 flex-col gap-1.5 text-sm font-medium text-ink">
                Title
                <input
                  value={row.title}
                  onChange={(event) => {
                    const value = event.target.value;
                    setRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, title: value } : item)));
                  }}
                  className="h-12 rounded-xl border border-graphite px-3.5 text-base font-normal text-ink"
                />
              </label>
            </div>
          ))}
          <button
            type="button"
            className="self-start border-0 bg-transparent p-0 text-[15px] font-medium text-cell-blue-deep"
            onClick={() => setRows((current) => [...current, { email: "", title: "Paralegal" }])}
          >
            Add someone else
          </button>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="m-0 font-brand text-[32px] font-semibold leading-tight text-ink">Name your intake assistant</h1>
            <p className="m-0 text-body leading-normal text-graphite">
              It asks your clients for documents and checks every page. Clients always see that it is automated, and it never answers questions about the matter.
            </p>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Assistant’s name
            <input
              value={assistant}
              onChange={(event) => {
                setAssistant(event.target.value);
                setError(null);
              }}
              className="h-[52px] rounded-xl border border-graphite px-4 text-[17px] font-normal text-ink"
            />
          </label>
          <span className="text-sm text-graphite">Clients see: “{preview} · automated”</span>
        </>
      ) : null}

      {error ? (
        <div role="alert" className="text-sm text-coral-deep">
          {error}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {step === 2 ? (
          <button
            type="button"
            className={QUIET_BUTTON_CLASS}
            onClick={() => {
              setRows([{ email: "", title: "Paralegal" }]);
              setError(null);
              setStep(3);
            }}
          >
            Skip for now
          </button>
        ) : (
          <span />
        )}
        <button type="button" className={`${PRIMARY_BUTTON_CLASS} h-12 px-7`} disabled={busy} onClick={next}>
          {busy ? "Saving…" : step === 3 ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}
