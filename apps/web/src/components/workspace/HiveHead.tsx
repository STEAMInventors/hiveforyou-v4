"use client";

import type { Hive } from "@hiveforyou/contracts";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AvatarStack, formatPeopleLine, type AvatarPerson } from "@/components/ui/AvatarStack";
import { LockIcon } from "@/components/ui/LockIcon";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import {
  hiveAuditPath,
  hiveDocumentsPath,
  hiveNotesPath,
  hivePath,
  hiveReportsPath,
  hiveSectionFromPathname,
} from "@/lib/hive-routes";

type TabId = "home" | "documents" | "report" | "audit" | "notes";

function activeTab(pathname: string, hiveId: string): TabId {
  const section = hiveSectionFromPathname(pathname, hiveId);
  if (section === "documents") return "documents";
  if (section === "reports") return "report";
  if (section === "audit") return "audit";
  if (section === "notes") return "notes";
  return "home";
}

export function HiveHead({
  hive,
  assistantName,
  documentCount,
  unreadMessages,
}: {
  hive: Hive;
  assistantName: string;
  documentCount: number | null;
  unreadMessages: number | null;
}) {
  const pathname = usePathname() ?? "";
  const selected = activeTab(pathname, hive.id);
  const staff = showsFirmThreePane(hive);
  const showNotes = staff && Boolean(hive.firmId);
  const purpose = hive.description?.trim() || null;
  const clientName = hive.kind === "client" ? hive.name : null;
  const sub = [purpose, clientName ? `for ${clientName}` : null].filter(Boolean).join(" · ");
  const people: AvatarPerson[] = [];
  if (clientName) people.push({ id: "client", name: clientName, kind: "client" });
  if (hive.assigneeDisplayName?.trim()) {
    people.push({ id: "staff", name: hive.assigneeDisplayName.trim(), kind: "staff" });
  }
  if (assistantName.trim()) people.push({ id: "assistant", name: assistantName.trim(), kind: "assistant" });
  const tabs: { id: TabId; href: string; label: string; count?: number | null; lock?: boolean }[] = [
    { id: "home", href: hivePath(hive.id), label: "Home", count: unreadMessages },
    { id: "documents", href: hiveDocumentsPath(hive.id), label: "Documents", count: documentCount },
    { id: "report", href: hiveReportsPath(hive.id), label: "Report" },
    { id: "audit", href: hiveAuditPath(hive.id), label: "Audit trail" },
  ];
  if (showNotes) tabs.push({ id: "notes", href: hiveNotesPath(hive.id), label: "Team notes", lock: true });

  return (
    <header className="pb-0 pt-7" data-testid="hive-head">
      <div className="flex flex-col items-start justify-between gap-3 min-[760px]:flex-row min-[760px]:items-end">
        <div className="min-w-0">
          <h1 className="m-0 font-brand text-title-sm font-semibold leading-[1.15] tracking-[-0.02em] text-ink min-[760px]:text-title">
            {hive.name}
          </h1>
          {sub ? <p className="m-0 mt-1.5 text-[14px] text-ink-3">{sub}</p> : null}
        </div>
        {people.length ? (
          <div className="flex items-center gap-2.5 text-meta text-ink-3">
            <AvatarStack people={people} />
            <span>{formatPeopleLine(people.map((person) => person.name))}</span>
          </div>
        ) : null}
      </div>
      <div role="tablist" aria-label="Hive" className="mt-5 flex gap-5 overflow-x-auto border-b border-line [scrollbar-width:none] min-[760px]:gap-[26px]">
        {tabs.map((tab) => {
          const on = selected === tab.id;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              role="tab"
              aria-selected={on}
              className={`inline-flex h-11 shrink-0 items-center gap-[7px] border-b-2 bg-transparent text-[14px] no-underline min-[760px]:h-[42px] ${
                on ? "border-ink font-semibold text-ink" : "border-transparent font-medium text-ink-3 hover:text-ink"
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 ? (
                <span className="rounded-[9px] bg-mist px-[7px] py-px text-[11.5px] font-semibold tabular-nums text-ink-3">
                  {tab.count}
                </span>
              ) : tab.id === "documents" && documentCount != null ? (
                <span className="rounded-[9px] bg-mist px-[7px] py-px text-[11.5px] font-semibold tabular-nums text-ink-3">
                  {documentCount}
                </span>
              ) : null}
              {tab.lock ? <LockIcon className="h-[13px] w-[13px]" /> : null}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
