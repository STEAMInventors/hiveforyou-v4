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
    <nav className="tab-nav" aria-label="Hive workspace">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href(hiveId)}
          aria-current={active === tab.key ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
