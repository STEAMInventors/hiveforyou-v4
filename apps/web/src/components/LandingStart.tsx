"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { HiveComposer } from "@/components/HiveComposer";
import { AddFilesButton } from "@/components/hives/SourceFilePicker";
import { PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS } from "@/components/button-classes";
import { useHiveComposer } from "@/components/hives/useCreateHive";
import { Segmented } from "@/components/ui/Segmented";
import { FRONT_PAGE_COPY } from "@/content/front-page";
import { saveGuestDraft, type GuestDraft } from "@/lib/guest-draft";
import { CREATE_HIVE_AFTER_SIGN_UP_PATH, clientsSignInPath } from "@/lib/hive-routes";

type Audience = "clients" | "self";

const AUDIENCE_OPTIONS = [
  { id: "clients", label: FRONT_PAGE_COPY.audienceClients },
  { id: "self", label: FRONT_PAGE_COPY.audienceSelf },
] as const;

/** "Who is this for" switch and the one input under it. The choice lives in the URL as `?for=self`. */
export function LandingStart() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const audience: Audience = searchParams?.get("for") === "self" ? "self" : "clients";
  const [email, setEmail] = useState("");

  const saveDraftAndSignUp = useCallback(
    async (draft: GuestDraft) => {
      try {
        await saveGuestDraft(draft);
      } catch {
        // Without browser storage the visitor re-selects files after sign-up.
      }
      router.push(CREATE_HIVE_AFTER_SIGN_UP_PATH);
    },
    [router],
  );
  const guestComposer = useHiveComposer(saveDraftAndSignUp);
  const { composerProps } = guestComposer;

  const chooseAudience = (next: Audience) => {
    if (next === audience) return;
    router.push(next === "self" ? "/?for=self" : "/", { scroll: false });
  };

  return (
    <div className="flex w-full flex-col items-center">
      <div className="mt-8">
        <Segmented
          options={AUDIENCE_OPTIONS}
          value={audience}
          onChange={chooseAudience}
          ariaLabel={FRONT_PAGE_COPY.audienceLabel}
          size="large"
        />
      </div>

      <div className="mt-4 w-full">
        {audience === "clients" ? (
          <form
            noValidate
            aria-label={FRONT_PAGE_COPY.audienceClients}
            className="w-full"
            onSubmit={(event) => {
              event.preventDefault();
              router.push(clientsSignInPath(email));
            }}
          >
            <div className="ring-brand w-full" data-front-start>
              <div className="flex min-h-14 items-center gap-2.5 rounded-[14px] bg-paper py-1.5 pl-[18px] pr-1.5 text-left">
                <label htmlFor="front-work-email" className="sr-only">
                  {FRONT_PAGE_COPY.emailLabel}
                </label>
                <input
                  id="front-work-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  placeholder={FRONT_PAGE_COPY.emailLabel}
                  onChange={(event) => setEmail(event.target.value)}
                  className="min-h-11 min-w-0 flex-1 border-0 bg-transparent p-0 text-[16px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-0 focus-visible:outline-none"
                />
                <button type="submit" className={`${PRIMARY_BUTTON_CLASS} shrink-0`}>
                  {FRONT_PAGE_COPY.start}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <>
            <HiveComposer {...composerProps} presentation="landing" />
            <div className="mt-3 flex justify-center">
              <AddFilesButton
                label={FRONT_PAGE_COPY.addDocuments}
                showLabel
                disabled={composerProps.busy}
                onAdd={composerProps.onAddFiles}
                className={QUIET_BUTTON_CLASS}
              />
            </div>
          </>
        )}
      </div>

      <p className="m-0 mt-3 max-w-[520px] text-[13.5px] leading-[1.5] text-ink-3">
        {audience === "clients" ? FRONT_PAGE_COPY.noteClients : FRONT_PAGE_COPY.noteSelf}
      </p>
      <p className="m-0 mt-1 max-w-[520px] text-[13.5px] leading-[1.5] text-ink-3">{FRONT_PAGE_COPY.noteInvited}</p>
    </div>
  );
}
