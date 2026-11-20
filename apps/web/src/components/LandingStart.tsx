"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { HiveComposer } from "@/components/HiveComposer";
import { AddFilesButton } from "@/components/hives/SourceFilePicker";
import { QUIET_BUTTON_CLASS } from "@/components/button-classes";
import { useHiveComposer } from "@/components/hives/useCreateHive";
import { saveGuestDraft, type GuestDraft } from "@/lib/guest-draft";
import { CREATE_HIVE_AFTER_SIGN_UP_PATH } from "@/lib/hive-routes";

const CLIENTS_SIGN_IN_PATH = "/sign-in?start=clients&next=%2Fhives&new=1";

export function LandingStart() {
  const router = useRouter();

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

  return (
    <div className="flex w-full flex-col items-center gap-[26px]">
      <HiveComposer {...composerProps} presentation="landing" />
      <div className="flex flex-wrap justify-center gap-3">
        <AddFilesButton
          label="Add documents"
          showLabel
          disabled={composerProps.busy}
          onAdd={composerProps.onAddFiles}
          className={QUIET_BUTTON_CLASS}
        />
        <Link href={CLIENTS_SIGN_IN_PATH} className={QUIET_BUTTON_CLASS}>
          I work with clients
        </Link>
      </div>
    </div>
  );
}