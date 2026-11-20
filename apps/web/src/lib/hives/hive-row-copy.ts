import type { Hive } from "@hiveforyou/contracts";

function firstName(displayName: string | null | undefined): string | null {
  const trimmed = displayName?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

/** What the hive is for: its own description, else the first part of its kicker. */
export function hivePurposeLine(hive: Hive): string | null {
  return hive.description?.trim() || hive.homeKicker?.split(" · ")[0]?.trim() || null;
}

/**
 * Sub line under a row's name: "<purpose> · with <assignee first name>" or "· unassigned" for firm
 * hives; just the purpose when there is no firm. Null when there is nothing to say.
 */
export function hiveRowSubline(hive: Hive, viewerUserId: string | null | undefined): string | null {
  const segments: string[] = [];
  const purpose = hivePurposeLine(hive);
  if (purpose) segments.push(purpose);

  if (hive.firmId) {
    if (hive.assigneeUserId) {
      const isViewer = Boolean(viewerUserId) && hive.assigneeUserId.toLowerCase() === viewerUserId?.toLowerCase();
      const who = isViewer ? "you" : (firstName(hive.assigneeDisplayName) ?? "someone");
      segments.push(`with ${who}`);
    } else {
      segments.push("unassigned");
    }
  }

  return segments.length > 0 ? segments.join(" · ") : null;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * "Updated <relative>" for a hive row: just now, N minutes/hours ago, yesterday, a weekday within the
 * last week, then the date. Null when the timestamp is not a date.
 */
export function formatHiveUpdated(isoTimestamp: string, now: Date = new Date()): string | null {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return null;

  const elapsedMinutes = Math.floor((now.getTime() - parsed.getTime()) / 60_000);
  if (elapsedMinutes < 1) return "Updated just now";
  if (elapsedMinutes < 60) {
    return `Updated ${elapsedMinutes} ${elapsedMinutes === 1 ? "minute" : "minutes"} ago`;
  }

  const dayDiff = Math.round((startOfLocalDay(now).getTime() - startOfLocalDay(parsed).getTime()) / 86_400_000);
  if (dayDiff <= 0) {
    const hours = Math.floor(elapsedMinutes / 60);
    return `Updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (dayDiff === 1) return "Updated yesterday";
  if (dayDiff < 7) return `Updated ${WEEKDAY.format(parsed)}`;
  if (parsed.getFullYear() === now.getFullYear()) return `Updated ${MONTH_DAY.format(parsed)}`;
  return `Updated ${MONTH_DAY_YEAR.format(parsed)}`;
}
