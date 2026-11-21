import type { ReactNode } from "react";

import type { ClientsHomeQueue } from "@/lib/hives/clients-home-queue";

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      {children}
    </svg>
  );
}

const ICONS: Record<ClientsHomeQueue, () => ReactNode> = {
  needs: () => (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </IconBase>
  ),
  ready: () => (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </IconBase>
  ),
  all: () => (
    <IconBase>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </IconBase>
  ),
  own: () => (
    <IconBase>
      <path d="M4 6h16v12H4zM8 6V4h8v2" />
    </IconBase>
  ),
  mine: () => (
    <IconBase>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-4 3.5-6 7-6s7 2 7 6" />
    </IconBase>
  ),
  unassigned: () => (
    <IconBase>
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <path d="M4 10h16" />
    </IconBase>
  ),
};

export function ClientsHomeQueueIcon({ queue }: { queue: ClientsHomeQueue }) {
  const Icon = ICONS[queue];
  return <Icon />;
}
