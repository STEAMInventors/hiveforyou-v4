import type { FirmHandoverCard } from "@/server/firm/load-firm-board";

type HiveHandoverBannerProps = {
  handover: FirmHandoverCard;
  /** Current user is the assignee who should see the note. */
  visible: boolean;
};

function formatHandoverTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function HiveHandoverBanner({ handover, visible }: HiveHandoverBannerProps) {
  if (!visible) return null;
  const head = `${handover.fromDisplayName} handed this hive to you · ${formatHandoverTime(handover.createdAt)}`;
  const text = handover.note?.trim() || "No note.";
  return (
    <div
      role="status"
      data-testid="hive-handover-banner"
      className="border-b border-line bg-blue-wash px-4 py-3 text-small text-ink min-[900px]:px-6"
    >
      <p className="m-0 font-semibold">{head}</p>
      <p className="m-0 mt-1 text-ink-2">{text}</p>
    </div>
  );
}