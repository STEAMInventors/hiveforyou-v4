"use client";

import type { StudyViewRow } from "@hiveforyou/contracts";

import { useDocumentLabel } from "./SourceChip";
import { formatDocumentDate } from "./Timeline";

export const UNREADABLE_ROLE = "Could not be read";

/**
 * Plain role words. In an anchor chain only the highest position is the version in force; the
 * others are earlier versions.
 */
export function documentRoleLabel(row: StudyViewRow, latestChainPosition: number | null, unreadable: boolean): string {
  if (unreadable) return UNREADABLE_ROLE;
  switch (row.role) {
    case "ANCHOR":
      return row.chainPosition != null && latestChainPosition != null && row.chainPosition < latestChainPosition
        ? "Main document, earlier version"
        : "Main document";
    case "SUPPORTING":
      return "Supporting";
    case "REFERENCE":
      return "Reference";
    default:
      return "";
  }
}

export function latestChainPosition(rows: readonly StudyViewRow[]): number | null {
  const positions = rows.flatMap((row) => (row.role === "ANCHOR" && row.chainPosition != null ? [row.chainPosition] : []));
  return positions.length > 0 ? Math.max(...positions) : null;
}

const CELL = "border-b border-line px-3 py-3 align-top first:pl-0 last:pr-0";
const HEAD = "border-b border-line px-3 pb-2 text-left text-caption font-semibold text-quiet first:pl-0 last:pr-0";

function DocumentCell({ id }: { id: string }) {
  return <>{useDocumentLabel(id)}</>;
}

type DocumentsTableProps = {
  rows: readonly StudyViewRow[];
  unreadableIds: ReadonlySet<string>;
  pageCountFor: (sourceDocumentId: string) => number | undefined;
};

export function DocumentsTable({ rows, unreadableIds, pageCountFor }: DocumentsTableProps) {
  const latest = latestChainPosition(rows);
  return (
    <div className="overflow-x-auto" role="region" aria-label="Documents" tabIndex={0}>
      <table className="w-full min-w-[520px] border-collapse text-body" data-testid="documents-table">
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Document
            </th>
            <th scope="col" className={HEAD}>
              Role
            </th>
            <th scope="col" className={HEAD}>
              Date
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Pages
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const role = documentRoleLabel(row, latest, unreadableIds.has(row.id));
            const pages = pageCountFor(row.id);
            return (
              <tr key={row.id} data-row-id={row.id}>
                <th scope="row" className={`${CELL} text-left font-medium text-ink`}>
                  <DocumentCell id={row.id} />
                </th>
                <td className={`${CELL} ${role === UNREADABLE_ROLE ? "font-medium text-coral-deep" : "text-graphite"}`}>{role}</td>
                <td className={`${CELL} whitespace-nowrap font-brand text-graphite`}>{formatDocumentDate(row.date) ?? "—"}</td>
                <td className={`${CELL} text-right tabular-nums text-graphite`}>{pages ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
