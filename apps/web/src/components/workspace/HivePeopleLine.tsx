import { hiveBadgeInitials } from "@/lib/hives/hive-badge-initials";
import { personFirstName } from "@/lib/hives/firm-board";

type HivePeopleLineProps = {
  ownHive: boolean;
  clientName: string | null;
  staffLabel: string | null;
  assistantName: string;
  className?: string;
};

function AvatarBubble({ initials, className = "" }: { initials: string; className?: string }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-mist text-[11px] font-bold text-ink ring-2 ring-paper ${className}`}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function HivePeopleLine({ ownHive, clientName, staffLabel, assistantName, className = "" }: HivePeopleLineProps) {
  const clientFirst = clientName ? personFirstName(clientName) : null;
  const staffFirst = staffLabel && staffLabel !== "You" ? personFirstName(staffLabel) : staffLabel === "You" ? "You" : null;

  const text = ownHive
    ? `You and ${assistantName}`
    : clientFirst && staffFirst
      ? `${clientFirst}, ${staffFirst} and ${assistantName}`
      : clientFirst
        ? `${clientFirst} and ${assistantName}`
        : assistantName;

  return (
    <div className={`flex items-center gap-2.5 text-[12.5px] text-ink-3 ${className}`.trim()} data-testid="hive-people-line">
      <div className="flex items-center">
        {ownHive ? (
          <>
            <AvatarBubble initials="You" />
            <AvatarBubble initials={hiveBadgeInitials(assistantName)} className="-ml-1.5" />
          </>
        ) : (
          <>
            {clientName ? <AvatarBubble initials={hiveBadgeInitials(clientName)} /> : null}
            {staffLabel ? <AvatarBubble initials={hiveBadgeInitials(staffLabel)} className="-ml-1.5" /> : null}
            <AvatarBubble initials={hiveBadgeInitials(assistantName)} className="-ml-1.5" />
          </>
        )}
      </div>
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}
