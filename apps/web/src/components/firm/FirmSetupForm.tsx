"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { PRIMARY_BUTTON_CLASS } from "@/components/button-classes";
import { useWorkspaceAction } from "@/components/workspace/useWorkspaceAction";
import type { PracticeAreaSetupOption } from "@/server/firm/practice-area-options";

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
  const [validationError, setValidationError] = useState<string | null>(null);
  const firmAction = useWorkspaceAction("/welcome");
  const requestAction = useWorkspaceAction("/welcome");
  const firmKeyRef = useRef<string>(crypto.randomUUID());
  const requestKeyRef = useRef<string>(crypto.randomUUID());

  const firmPreview = name.trim() || "Rivera Law";
  const pending = firmAction.pending || requestAction.pending;

  const toggleArea = (packId: string) => {
    setSelectedAreas((current) =>
      current.includes(packId) ? current.filter((id) => id !== packId) : [...current, packId],
    );
    setValidationError(null);
  };

  const validate = (): boolean => {
    if (!firstName.trim()) {
      setValidationError("Enter your first name.");
      return false;
    }
    if (!name.trim()) {
      setValidationError("Enter your firm or practice name.");
      return false;
    }
    const request = requestText.trim();
    if (selectedAreas.length === 0 && !request) {
      setValidationError('Choose what you handle, or tell us in "Don’t see what you handle?".');
      return false;
    }
    return true;
  };

  async function start() {
    if (pending || !validate()) return;
    setValidationError(null);
    firmAction.clearError();
    requestAction.clearError();

    const created = await firmAction.run({
      url: "/api/v1/firm",
      body: { name: name.trim(), practiceAreas: selectedAreas },
      idempotencyKey: firmKeyRef.current,
      failureMessage: "Could not save your practice. Try again.",
      refreshOnSuccess: false,
    });
    if (created === null) return;

    const request = requestText.trim();
    if (request) {
      const submitted = await requestAction.run({
        url: "/api/v1/firm/practice-area-requests",
        body: { body: request },
        idempotencyKey: requestKeyRef.current,
        failureMessage: "Your practice is saved, but we couldn't send your request. Try again.",
        refreshOnSuccess: false,
      });
      if (submitted === null) return;
    }

    onFinished(firstName.trim());
  }

  return (
    <div className="flex flex-col gap-5" data-testid="firm-setup">
      <img src="/brand/hiveforyou-mark.svg" alt="" className="h-10 w-10" width={40} height={40} />
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-brand text-[26px] font-semibold leading-tight text-ink">Set up your practice</h1>
        <p className="m-0 text-body leading-normal text-ink-2">
          Three quick things, so HiveForYou asks your clients for the right documents. You can change these later in
          Firm settings.
        </p>
      </div>

      <section className="flex flex-col gap-[18px] rounded-input border border-line bg-paper p-[22px]">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
          Your first name
          <input
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value);
              setValidationError(null);
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
              setValidationError(null);
            }}
            placeholder="Rivera Law"
            autoComplete="organization"
            className="h-11 rounded-control border border-line-strong px-3 text-[15px] font-normal text-ink"
          />
          <span className="text-[12.5px] font-normal text-ink-3">
            Your clients see it in emails: “{firmPreview} needs 9 items from you.” Working alone? Use your own name.
          </span>
        </label>

        <div role="group" aria-labelledby="firm-practice-areas" className="flex flex-col gap-2.5">
          <span id="firm-practice-areas" className="text-sm font-semibold text-ink">
            What do you handle?{" "}
            <span className="font-normal text-ink-3">· choose all that apply</span>
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
                  on ? "border-blue-deep bg-blue-wash" : "border-line bg-paper"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-[13px] ${
                    on ? "border-blue-deep bg-blue-deep text-paper" : "border-line-strong bg-paper text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold text-ink">{area.label}</span>
                  <span className="text-[13px] text-ink-2">{area.description}</span>
                </span>
              </button>
            );
          })}

          {!askOpen ? (
            <button
              type="button"
              className="self-start border-0 bg-transparent p-0 text-sm font-medium text-blue-deep"
              onClick={() => setAskOpen(true)}
            >
              Don’t see what you handle?
            </button>
          ) : (
            <label className="flex flex-col gap-1.5 rounded-control bg-mist p-3.5 text-sm font-semibold text-ink">
              Tell us what you handle
              <textarea
                value={requestText}
                onChange={(event) => {
                  setRequestText(event.target.value);
                  setValidationError(null);
                  requestAction.clearError();
                }}
                rows={2}
                placeholder="Planning for elderly clients; probate"
                className="resize-y rounded-control border border-line-strong bg-paper px-3 py-2.5 text-[15px] font-normal text-ink"
              />
              <span className="text-[12.5px] font-normal leading-snug text-ink-2">
                We read every request and will email you when HiveForYou covers it. Meanwhile you can still add clients:
                HiveForYou reads their documents and tells you what’s missing, without a starting checklist.
              </span>
              {requestAction.inlineError ? (
                <span role="alert" className="text-[12.5px] font-normal text-coral-deep">
                  {requestAction.inlineError.message}
                  {requestAction.inlineError.reference
                    ? ` Reference ${requestAction.inlineError.reference}.`
                    : ""}
                  {requestAction.inlineError.retryable ? (
                    <button
                      type="button"
                      className="ml-1 border-0 bg-transparent p-0 font-semibold text-blue-deep"
                      onClick={() =>
                        void requestAction.retrySameKey({
                          url: "/api/v1/firm/practice-area-requests",
                          body: { body: requestText.trim() },
                          failureMessage: "Your practice is saved, but we couldn't send your request. Try again.",
                          refreshOnSuccess: false,
                        }).then((result) => {
                          if (result !== null) onFinished(firstName.trim());
                        })
                      }
                    >
                      Try again
                    </button>
                  ) : null}
                </span>
              ) : null}
            </label>
          )}
        </div>

        {validationError ? (
          <div role="alert" className="text-sm text-coral-deep">
            {validationError}
          </div>
        ) : null}

        {firmAction.inlineError ? (
          <div role="alert" className="text-sm text-coral-deep">
            {firmAction.inlineError.message}
            {firmAction.inlineError.reference ? ` Reference ${firmAction.inlineError.reference}.` : ""}
            {firmAction.inlineError.errorCode === "IDEMPOTENCY_CONFLICT" ? (
              <>
                {" "}
                <Link href="/hives" className="font-semibold text-blue-deep">
                  Go to your hives
                </Link>
              </>
            ) : firmAction.inlineError.retryable ? (
              <button
                type="button"
                className="ml-1 border-0 bg-transparent p-0 font-semibold text-blue-deep"
                onClick={() => void firmAction.retrySameKey({
                  url: "/api/v1/firm",
                  body: { name: name.trim(), practiceAreas: selectedAreas },
                  failureMessage: "Could not save your practice. Try again.",
                  refreshOnSuccess: false,
                })}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          className={`${PRIMARY_BUTTON_CLASS} h-11`}
          disabled={pending}
          onClick={() => void start()}
        >
          {pending ? "Saving…" : "Start"}
        </button>
      </section>

      <p className="m-0 text-[12.5px] leading-normal text-ink-3">
        Adding your team and naming your intake assistant come later, when you need them.
      </p>
    </div>
  );
}