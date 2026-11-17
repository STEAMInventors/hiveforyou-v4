"use client";

import type { HiveBoardChecklistItem, HiveBoardModel } from "@hiveforyou/contracts";
import Link from "next/link";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import { Card } from "@/components/workspace/Card";
import { StatusDot } from "@/components/workspace/StatusDot";

function checklistState(status: HiveBoardChecklistItem["status"]): "checked" | "needs" | "missing" {
  if (status === "in") return "checked";
  if (status === "added_pending") return "needs";
  return "missing";
}

function checklistLabel(status: HiveBoardChecklistItem["status"], statusText: string): string {
  if (statusText.trim()) return statusText;
  if (status === "in") return "In";
  if (status === "added_pending") return "Review";
  return "Missing";
}

export function HiveBoardChecklistCard({ board }: { board: HiveBoardModel }) {
  return (
    <Card
      title="Items"
      headerRight={
        board.progress ? (
          <span className="text-caption text-graphite">
            {board.progress.in} of {board.progress.total} in
          </span>
        ) : null
      }
      testId="hive-board-items-card"
    >
      {board.checklist.length === 0 ? (
        <p className="m-0 text-small text-graphite">{board.checklistNote}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {board.checklist.map((item) => (
            <li key={item.gapId} className="flex flex-col gap-1 border-t border-line py-3 first:border-0 first:pt-0">
              <div className="flex items-start gap-3">
                <StatusDot state={checklistState(item.status)} label={checklistLabel(item.status, item.statusText)} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-small font-medium text-ink">{item.title}</p>
                </div>
                {item.status === "not_in" ? (
                  <Link href={item.action.href ?? "#"} className={WORKSPACE_SECONDARY}>
                    {item.action.label}
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}