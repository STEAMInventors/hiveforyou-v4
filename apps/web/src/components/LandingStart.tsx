"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { HiveComposer } from "@/components/HiveComposer";
import { CreateHiveModal } from "@/components/hives/CreateHiveModal";
import { useCreateHive } from "@/components/hives/useCreateHive";
import { saveGuestDraft, type GuestDraft } from "@/lib/guest-draft";
import {
  CREATE_HIVE_AFTER_SIGN_UP_PATH,
  hiveDocumentsPath,
} from "@/lib/hive-routes";

export function LandingStart({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const handleCreated = useCallback(
    (hive: Hive) => {
      router.push(hiveDocumentsPath(hive.id));
    },
    [router],
  );
  const createFlow = useCreateHive(handleCreated);

  const handleSubmit = async (draft: GuestDraft) => {
    if (signedIn) {
      createFlow.openModal(draft);
      return;
    }
    setSaving(true);
    try {
      await saveGuestDraft(draft);
    } catch {
      // Without browser storage the visitor re-selects files after sign-up.
    }
    router.push(CREATE_HIVE_AFTER_SIGN_UP_PATH);
  };

  return (
    <>
      <HiveComposer busy={createFlow.submitBusy || saving} onSubmit={(draft) => void handleSubmit(draft)} />
      {signedIn ? <CreateHiveModal {...createFlow.modalProps} /> : null}
    </>
  );
}
