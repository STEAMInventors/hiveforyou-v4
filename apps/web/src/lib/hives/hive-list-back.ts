import type { HiveKind } from "@hiveforyou/contracts";

import { MY_HIVES_PATH } from "@/lib/hive-routes";
import type { StartingView } from "@/lib/auth/profile";

export type HiveListBackLink = {
  readonly href: string;
  readonly label: string;
};

export function hiveListBackLink(startingView: StartingView, hiveKind: HiveKind): HiveListBackLink {
  if (startingView === "clients") {
    if (hiveKind === "client") {
      return { label: "All clients", href: `${MY_HIVES_PATH}?view=all` };
    }
    return { label: "My own matters", href: `${MY_HIVES_PATH}?view=own` };
  }
  return { label: "Your hives", href: MY_HIVES_PATH };
}