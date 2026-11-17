const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const monthDayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const monthDayYearFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatWorkspaceActivityDate(isoTimestamp: string, now = new Date()): string | null {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = startOfLocalDay(now);
  const target = startOfLocalDay(parsed);
  const dayDiff = Math.round((today.getTime() - target.getTime()) / 86_400_000);

  if (dayDiff === 0) {
    return `Today, ${timeFormat.format(parsed)}`;
  }
  if (dayDiff === 1) {
    return `Yesterday, ${timeFormat.format(parsed)}`;
  }
  if (parsed.getFullYear() === now.getFullYear()) {
    return monthDayFormat.format(parsed);
  }
  return monthDayYearFormat.format(parsed);
}