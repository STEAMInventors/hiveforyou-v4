import type { Hive, HiveListGroup } from "@hiveforyou/contracts";
import { hiveListGroup } from "@hiveforyou/contracts";

import type { HiveSummary } from "@/server/hives/hive-summary";

import type { HiveListSentenceCounts } from "./hive-list-copy";

/** Your hives groups, in the order they are shown (DESIGN §3 "Your hives"). */
export const HIVE_LIST_GROUPS: readonly { key: HiveListGroup; title: string }[] = [
  { key: "review", title: "To review" },
  { key: "reading", title: "Being read" },
  { key: "waiting", title: "Waiting on documents" },
  { key: "done", title: "Up to date" },
];

export type HiveListGroupModel = {
  key: HiveListGroup;
  title: string;
  hives: Hive[];
};

export type HiveListModel = {
  groups: HiveListGroupModel[];
  /** Counts for the state sentence: only hives that have a summary are counted. */
  counts: HiveListSentenceCounts;
};

/**
 * Split already-ranked hives into groups. A hive without a summary is shown in To review (with no
 * status dots) and is left out of the counts, so the sentence never claims more than the data shows.
 * Rank order inside each group is the order of `hives`. Empty groups are omitted.
 */
export function groupHivesForList(
  hives: readonly Hive[],
  summaries: Readonly<Record<string, HiveSummary>>,
): HiveListModel {
  const byGroup = new Map<HiveListGroup, Hive[]>();
  const counts: HiveListSentenceCounts = { review: 0, waiting: 0, reading: 0 };

  for (const hive of hives) {
    const summary = summaries[hive.id];
    const key: HiveListGroup = summary ? hiveListGroup(summary.attention) : "review";
    byGroup.set(key, [...(byGroup.get(key) ?? []), hive]);
    if (summary) {
      if (key === "review") counts.review += 1;
      else if (key === "waiting") counts.waiting += 1;
      else if (key === "reading") counts.reading += 1;
    }
  }

  return {
    groups: HIVE_LIST_GROUPS.flatMap(({ key, title }) => {
      const members = byGroup.get(key);
      return members && members.length > 0 ? [{ key, title, hives: members }] : [];
    }),
    counts,
  };
}
