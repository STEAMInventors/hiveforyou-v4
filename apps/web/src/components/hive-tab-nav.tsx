import Link from "next/link";

type HiveTabNavProps = {
  hiveId: string;
  active: "documents" | "study" | "reports";
};

const tabs = [
  { key: "documents" as const, label: "Documents", href: (id: string) => `/hives/${id}/documents` },
  { key: "study" as const, label: "Study", href: (id: string) => `/hives/${id}/study` },
  { key: "reports" as const, label: "Reports", href: (id: string) => `/hives/${id}/reports` },
];

export function HiveTabNav({ hiveId, active }: HiveTabNavProps) {
  return (
    <nav
      aria-label="Hive workspace"
      className="mb-8 flex gap-6 overflow-x-auto border-b border-line"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.href(hiveId)}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "-mb-px whitespace-nowrap border-b-2 border-cell-blue-deep pb-3 text-sm font-semibold text-cell-blue-deep no-underline"
                : "whitespace-nowrap border-b-2 border-transparent pb-3 text-sm font-medium text-ink-muted no-underline hover:text-ink"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
