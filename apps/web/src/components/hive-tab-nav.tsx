import Link from "next/link";

type HiveTabNavProps = {
  hiveId: string;
  active: "documents" | "study" | "reports";
  documentCount?: number;
};

const tabs = [
  { key: "documents" as const, label: "Documents", href: (id: string) => `/hives/${id}/documents` },
  { key: "study" as const, label: "Study", href: (id: string) => `/hives/${id}/study` },
  { key: "reports" as const, label: "Reports", href: (id: string) => `/hives/${id}/reports` },
];

export function HiveTabNav({ hiveId, active, documentCount }: HiveTabNavProps) {
  return (
    <nav
      aria-label="Hive workspace"
      className="flex gap-1 overflow-x-auto"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        const count =
          tab.key === "documents" && typeof documentCount === "number" && documentCount > 0
            ? String(documentCount)
            : null;
        return (
          <Link
            key={tab.key}
            href={tab.href(hiveId)}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "-mb-px inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 border-cell-blue px-3.5 text-[15px] font-medium text-ink no-underline"
                : "-mb-px inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3.5 text-[15px] font-medium text-ink-muted no-underline transition-colors hover:text-ink"
            }
          >
            <span>{tab.label}</span>
            {count ? (
              <span className="text-[12px] font-normal text-ink-subtle">{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
