"use client";

import { useActionState, useRef, useState } from "react";

import { PRIMARY_BUTTON_CLASS } from "@/components/button-classes";
import { FirmSetupForm } from "@/components/firm/FirmSetupForm";
import type { StartingView } from "@/lib/auth/profile";
import { setStartingViewAction } from "@/server/auth/auth-actions";
import type { SignInActionState } from "@/server/auth/auth-actions";
import { safeNextPath } from "@/server/auth/redirects";

import { SignInFieldError, SignInHeading, SignInShell } from "./SignInShell";

const initialState: SignInActionState = {};

type Choice = {
  view: StartingView;
  title: string;
  description: string;
};

const CHOICES: Choice[] = [
  {
    view: "own",
    title: "My own paperwork",
    description:
      "A letter, a notice, a meeting coming up. You get a plain report and questions worth asking.",
  },
  {
    view: "clients",
    title: "Hives for my clients",
    description: "One hive per client. You see which client needs you today.",
  },
];

type WelcomeFormProps = {
  nextPath: string;
  preselectClients: boolean;
  defaultFirstName: string;
};

export function WelcomeForm({ nextPath, preselectClients, defaultFirstName }: WelcomeFormProps) {
  const safeNext = safeNextPath(nextPath, "/hives");
  const [state, formAction, pending] = useActionState(setStartingViewAction, initialState);
  const [selected, setSelected] = useState<StartingView | null>(
    preselectClients ? "clients" : null,
  );
  const [chooseError, setChooseError] = useState(false);
  const [firstName, setFirstName] = useState(defaultFirstName);
  const [firmSetup, setFirmSetup] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (firmSetup) {
    return (
      <SignInShell>
        <FirmSetupForm onFinished={() => formRef.current?.requestSubmit()} />
        <form ref={formRef} action={formAction} className="hidden">
          <input type="hidden" name="next" value={safeNext} />
          <input type="hidden" name="startingView" value="clients" />
          <input type="hidden" name="displayName" value={firstName.trim()} />
        </form>
      </SignInShell>
    );
  }

  return (
    <SignInShell>
      <SignInHeading
        title="What brings you here?"
        lede="This sets where you start. You can switch any time."
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="welcome-first-name" className="text-sm font-medium text-ink">
          Your first name
        </label>
        <input
          id="welcome-first-name"
          type="text"
          maxLength={60}
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          className="min-h-11 rounded-control border border-line bg-paper px-3 text-[15px] text-ink"
          autoComplete="given-name"
        />
        {state.field === "displayName" && state.error ? (
          <SignInFieldError message={state.error} />
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        {CHOICES.map((choice) => {
          const pressed = selected === choice.view;
          return (
            <button
              key={choice.view}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                setSelected(choice.view);
                setChooseError(false);
              }}
              className={`flex min-h-11 cursor-pointer flex-col gap-1 rounded-card border px-[18px] py-4 text-left transition-colors ${
                pressed
                  ? "border-cell-blue bg-cell-blue-wash"
                  : "border-line bg-paper hover:border-line-strong"
              }`}
            >
              <span className="text-[17px] font-semibold text-ink">{choice.title}</span>
              <span className="text-sm leading-[1.5] text-ink-muted">{choice.description}</span>
            </button>
          );
        })}
      </div>
      {state.field === "startingView" && state.error ? (
        <SignInFieldError message={state.error} />
      ) : null}
      {chooseError ? <SignInFieldError message="Choose one to continue." /> : null}
      <form action={formAction} className="m-0">
        <input type="hidden" name="next" value={safeNext} />
        <input type="hidden" name="startingView" value={selected ?? ""} />
        <input type="hidden" name="displayName" value={firstName.trim()} />
        <button
          type="submit"
          disabled={pending}
          className={`${PRIMARY_BUTTON_CLASS} h-[52px] w-full text-base`}
          onClick={(event) => {
            if (!selected) {
              setChooseError(true);
              event.preventDefault();
              return;
            }
            if (selected === "clients") {
              event.preventDefault();
              setFirmSetup(true);
            }
          }}
        >
          {pending ? "Saving…" : "Continue"}
        </button>
      </form>
    </SignInShell>
  );
}