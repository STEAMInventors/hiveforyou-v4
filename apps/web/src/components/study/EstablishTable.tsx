"use client";

import type { DocumentRequestObservation, StudyViewRow } from "@hiveforyou/contracts";

import { AsWrittenValue, ChangedValue, distinctValues } from "./ChangedValue";
import { checklistVerdictLabel, rowHasChecklistVerdict } from "@hiveforyou/contracts";

import { spineRowState } from "./StateBar";
import { StatusBadge } from "./StatusBadge";

function AsWritten({ row }: { row: StudyViewRow }) {
  const before = row.values.filter((value) => value.relation === "supporting");
  const after = row.values.filter((value) => value.relation === "updating");
  if (row.status === "SUPERSEDED" && before.length > 0 && after.length > 0) {
    return <ChangedValue before={before} after={after} />;
  }
  const values = distinctValues(row.values);
  if (values.length === 0) return <span className="text-small text-quiet">No value in the documents</span>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {values.map((value) => (
        <li key={value.text}>
          <AsWrittenValue value={value} />
        </li>
      ))}
    </ul>
  );
}

export function EstablishTable({
  rows,
  compact,
  observations = [],
  statusMode = "spine",
}: {
  rows: readonly StudyViewRow[];
  compact: boolean;
  observations?: readonly DocumentRequestObservation[];
  statusMode?: "spine" | "checklist";
}) {
  const observationFor = (spineId: string) =>
    observations.filter((observation) => observation.relatedSpineIds.includes(spineId)).map((observation) => observation.text);
  const cell = `border-b border-line px-3 align-top first:pl-0 last:pr-0 ${compact ? "py-2.5" : "py-4"}`;
  const head = "border-b border-line px-3 pb-2 text-left text-caption font-semibold text-quiet first:pl-0 last:pr-0";
  const showStatusColumn =
    statusMode === "checklist"
      ? rows.some((row) => rowHasChecklistVerdict(row))
      : statusMode === "spine"
        ? rows.some((row) => rowHasChecklistVerdict(row))
        : false;
  return (
    <div className="overflow-x-auto" role="region" aria-label="What the documents establish" tabIndex={0}>
      <table className="w-full min-w-[560px] border-collapse text-body" data-testid="establish-table">
        <thead>
          <tr>
            {showStatusColumn ? (
              <th scope="col" className={`${head} w-[120px]`}>
                Status
              </th>
            ) : statusMode === "spine" ? (
              <th scope="col" className={`${head} w-[120px]`}>
                State
              </th>
            ) : null}
            <th scope="col" className={head}>
              What the documents say
            </th>
            <th scope="col" className={head}>
              As written
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const verdict = checklistVerdictLabel(row.status);
            const state = verdict ? null : spineRowState(row);
            const notes = observationFor(row.id);
            const issueLines = row.issues ?? [];
            return (
              <tr key={row.id} data-row-id={row.id}>
                {showStatusColumn ? (
                  <td className={cell}>{verdict ? <StatusBadge state="neutral" label={verdict} /> : null}</td>
                ) : statusMode === "spine" ? (
                  <td className={cell}>{state ? <StatusBadge state={state} /> : null}</td>
                ) : null}
                <th scope="row" className={`${cell} text-left font-normal text-ink`}>
                  {row.label}
                  {row.missing && row.missing.length > 0 ? (
                    <span className="mt-1 block text-small text-coral-deep">Missing: {row.missing.join("; ")}</span>
                  ) : null}
                  {issueLines.map((text) => (
                    <span key={text} className="mt-1 block text-small text-graphite" data-spine-issue="true">
                      {text}
                    </span>
                  ))}
                  {notes.map((text) => (
                    <span key={text} className="mt-1 block text-small text-graphite" data-observation="true">
                      {text}
                    </span>
                  ))}
                </th>
                <td className={cell}>
                  <AsWritten row={row} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
