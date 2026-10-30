"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { HiveComposer } from "@/components/HiveComposer";
import { CreateHiveModal } from "@/components/hives/CreateHiveModal";
import { useCreateHive } from "@/components/hives/useCreateHive";
import {
  CREATE_HIVE_AFTER_SIGN_UP_PATH,
  hiveDocumentsPath,
} from "@/lib/hive-routes";

export function LandingStart({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const handleCreated = useCallback(
    (hive: Hive) => {
      router.push(hiveDocumentsPath(hive.id));
    },
    [router],
  );
  const createFlow = useCreateHive(handleCreated);

  return (
    <>
      <HiveComposer
        busy={createFlow.submitBusy}
        onSubmit={() => {
          if (signedIn) {
            createFlow.openModal();
          } else {
            router.push(CREATE_HIVE_AFTER_SIGN_UP_PATH);
          }
        }}
      />
      {signedIn ? <CreateHiveModal {...createFlow.modalProps} /> : null}
    </>
  );
}
