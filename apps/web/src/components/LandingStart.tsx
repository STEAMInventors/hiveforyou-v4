"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { HiveComposer } from "@/components/HiveComposer";
import { NameHiveDialog } from "@/components/hives/NameHiveDialog";
import { useCreateHive, useHiveComposer } from "@/components/hives/useCreateHive";
import { saveGuestDraft, type GuestDraft } from "@/lib/guest-draft";
import {
  CREATE_HIVE_AFTER_SIGN_UP_PATH,
  hiveDocumentsPath,
} from "@/lib/hive-routes";

const STARTER_SITUATIONS = [
  "Understand what these documents mean for me",
  "Reconcile financial statements",
  "Review an insurance claim",
  "Organize an application package",
] as const;

export function LandingStart({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const handleCreated = useCallback(
    (hive: Hive) => {
      router.push(hiveDocumentsPath(hive.id));
    },
    [router],
  );
  const createFlow = useCreateHive(handleCreated);

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

  const composerProps = signedIn ? createFlow.composerProps : guestComposer.composerProps;

  return (
    <div className="flex w-full flex-col gap-5">
      {signedIn ? <NameHiveDialog {...createFlow.namingDialogProps} /> : null}
      <HiveComposer {...composerProps} />
      <div className="flex flex-wrap justify-center gap-2">
        {STARTER_SITUATIONS.map((situation) => {
          const active = composerProps.intentText === situation;
          return (
            <button
              key={situation}
              type="button"
              aria-pressed={active}
              disabled={composerProps.busy || composerProps.intentLocked}
              className={`h-9 cursor-pointer rounded-full border px-3.5 text-[14px] transition-colors hover:border-cell-blue disabled:cursor-not-allowed disabled:opacity-45 ${
                active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink"
              }`}
              onClick={() => composerProps.onIntentTextChange(situation)}
            >
              {situation}
            </button>
          );
        })}
      </div>
    </div>
  );
}
