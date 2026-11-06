"use client";

import type { MissingGroups } from "./missing-groups";
import { SourceChips } from "./SourceChip";

export { groupMissing, isStructuralNote, type MissingGroups, missingCount } from "./missing-groups";

function pagesText(pageNumbers: readonly number[]): string {
  if (pageNumbers.length === 0) return "";
  return pageNumbers.length === 1 ? `page ${pageNumbers[0]}` : `pages ${pageNumbers.join(", ")}`;
}

function GroupHeading({ children }: { children: string }) {
  return (
    <h4 className="m-0 flex items-center gap-2 text-small font-semibold text-ink">
      <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-pill bg-coral" />
      {children}
    </h4>
  );
}

const ITEM_CLASS = "max-w-prose text-body text-ink";

export function MissingList({ groups }: { groups: MissingGroups }) {
  return (
    <div className="flex flex-col gap-5" data-testid="missing-list">
      {groups.unreadable.length > 0 ? (
        <div className="flex flex-col gap-2" data-group="unreadable">
          <GroupHeading>Could not be read</GroupHeading>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 pl-4">
            {groups.unreadable.map((problem) => (
              <li key={problem.sourceDocumentId} className={ITEM_CLASS}>
                {problem.label}
                {problem.pageNumbers.length > 0 && !problem.wholeDocument ? `, ${pagesText(problem.pageNumbers)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {groups.referenced.length > 0 ? (
        <div className="flex flex-col gap-2" data-group="referenced">
          <GroupHeading>Referred to but not supplied</GroupHeading>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 pl-4">
            {groups.referenced.map((row) => (
              <li key={row.id} className={ITEM_CLASS} data-row-id={row.id}>
                {row.statement} <SourceChips refs={row.referencedBy ?? []} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {groups.expected.length > 0 ? (
        <div className="flex flex-col gap-2" data-group="expected">
          <GroupHeading>Usually expected</GroupHeading>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 pl-4">
            {groups.expected.map((row) => (
              <li key={row.id} className={ITEM_CLASS} data-row-id={row.id}>
                {row.statement}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
