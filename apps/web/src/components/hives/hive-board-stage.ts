import type { Hive } from "@hiveforyou/contracts";

export type StageSegment = {
  label: string;
  active: boolean;
  complete: boolean;
};

export function hiveBoardStageSegments(hive: Hive, progressIn: number, progressTotal: number): StageSegment[] {
  const stage = hive.stage ?? "open";
  const collecting =
    progressTotal > 0 ? `Collecting · ${progressIn} of ${progressTotal} in` : "Collecting";
  const segments: StageSegment[] = [
    { label: collecting, active: stage === "open", complete: stage !== "open" },
    { label: "Attorney review", active: stage === "review", complete: stage === "closed" },
    { label: "Closed", active: stage === "closed", complete: false },
  ];
  return segments;
}

export function hiveBoardStageAction(
  hive: Hive,
  callerIsAttorney: boolean,
): { label: string; next: "open" | "review" | "closed" } | null {
  const stage = hive.stage ?? "open";
  if (stage === "closed") {
    return callerIsAttorney ? { label: "Reopen intake", next: "open" } : null;
  }
  if (stage === "open") {
    return callerIsAttorney
      ? { label: "Close intake", next: "closed" }
      : { label: "Ready for attorney review", next: "review" };
  }
  if (stage === "review") {
    return callerIsAttorney ? { label: "Close intake", next: "closed" } : null;
  }
  return null;
}

export function splitBoardHeadline(headline: string): { num: string; rest: string } {
  const match = /^(\d+)( .*)$/.exec(headline);
  if (!match?.[1] || match[2] === undefined) return { num: "", rest: headline };
  return { num: match[1], rest: match[2] };
}