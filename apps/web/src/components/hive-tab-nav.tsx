import Link from "next/link";

import { hiveDocumentsPath, hiveReportsPath, hiveStudyPath } from "@/lib/hive-routes";

export type HiveTab = "documents" | "study" | "reports";

type HiveTabNavProps = {
  hiveId: string;
  active: HiveTab;
};

const tabs = [
  { key: "documents" as const, label: "Documents", href: hiveDocumentsPath },
  { key: "study" as const, label: "Study", href: hiveStudyPath },
  { key: "reports" as const, label: "Reports", href: hiveReportsPath },
];

const TAB_CLASS =
  "relative inline-flex min-h-11 items-center whitespace-nowrap rounded-t-control px-3 text-body font-medium no-underline transition-colors";

/** The 3px active bar sits on the 1px rule below the tabs; nothing here scrolls or clips. */
export function HiveTabNav({ hiveId, active }: HiveTabNavProps) {
  return (
    <nav aria-label="Hive sections" className="border-b border-line" data-testid="hive-tabs">
      <ul className="m-0 -ml-3 flex list-none flex-wrap gap-x-1 p-0">
        {tabs.map((tab) => {
          const isActive = active === tab.key;
          return (
            <li key={tab.key} className="flex">
              <Link
                href={tab.href(hiveId)}
                aria-current={isActive ? "page" : undefined}
                className={`${TAB_CLASS} ${
                  isActive
                    ? "text-ink after:absolute after:inset-x-3 after:-bottom-px after:h-[3px] after:rounded-t-[2px] after:bg-cell-blue"
                    : "text-graphite hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
