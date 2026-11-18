import type { Hive } from "@hiveforyou/contracts";
import type { HiveAttentionCounts, HiveAttentionResult } from "@hiveforyou/contracts";
import { hiveAttention } from "@hiveforyou/contracts";

import type { HiveSummary } from "@/server/hives/hive-summary";

function firstName(displayName: string | null | undefined): string | null {
  const trimmed = displayName?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

export function clientHiveMetaLine(hive: Hive, viewerUserId: string | null | undefined): string {
  if (hive.kind === "own") {
    return "Your own matter";
  }

  const segments: string[] = [];
  const matter = hive.description?.trim() || hive.homeKicker?.split(" · ")[0]?.trim();
  if (matter) {
    segments.push(matter);
  }

  if (hive.clientShareStatus === "invited") {
    segments.push("invited");
  } else if (hive.clientShareStatus === "client_joined") {
    segments.push("client joined");
  }

  if (hive.firmId) {
    if (hive.stage === "closed") {
      segments.push("closed");
    } else if (hive.assigneeUserId) {
      const onIt =
        viewerUserId && hive.assigneeUserId.toLowerCase() === viewerUserId.toLowerCase()
          ? "you"
          : firstName(hive.assigneeDisplayName) ?? "someone";
      segments.push(`${onIt} on it`);
    } else {
      segments.push("unassigned");
    }
  }

  return segments.join(" · ");
}

const FALLBACK_ATTENTION: HiveAttentionResult = hiveAttention({
  documentCount: 0,
  unreadableDocumentCount: 0,
  documentsNotReadCount: 0,
  activeReadCount: 0,
  processingRunFailed: false,
  processingRunActive: false,
  documentsNotInStudyCount: 0,
  openConflicts: 0,
  openNeeds: 0,
  openChanged: 0,
  openMissing: 0,
  openChecked: 0,
  hasStudy: false,
  hasReport: false,
});

export function clientListIntakeDisplay(
  summary: HiveSummary | undefined,
  attention: HiveAttentionResult = summary?.attention ?? FALLBACK_ATTENTION,
): { text: string; segmentTotal: number; segmentReceived: number } {
  const documentCount = summary?.documentCount ?? 0;
  const intake = summary?.intake ?? { total: 0, received: 0 };

  if (documentCount === 0) {
    return { text: "—", segmentTotal: 0, segmentReceived: 0 };
  }

  if (intake.total > 0) {
    return { text: `${intake.received} of ${intake.total} in`, segmentTotal: intake.total, segmentReceived: intake.received };
  }

  if ((attention.counts.missing ?? 0) === 0) {
    return { text: "Nothing missing", segmentTotal: 1, segmentReceived: 1 };
  }

  return { text: "Nothing missing", segmentTotal: Math.max(documentCount, 1), segmentReceived: 0 };
}

export function attentionStatusDots(counts: HiveAttentionCounts): { state: "needs" | "changed" | "missing" | "checked"; label: string }[] {
  const rows: { state: "needs" | "changed" | "missing" | "checked"; label: string }[] = [];
  if (counts.needs && counts.needs > 0) {
    rows.push({ state: "needs", label: `${counts.needs} to review` });
  }
  if (counts.changed && counts.changed > 0) {
    rows.push({ state: "changed", label: `${counts.changed} changed` });
  }
  if (counts.missing && counts.missing > 0) {
    rows.push({ state: "missing", label: `${counts.missing} missing` });
  }
  return rows;
}