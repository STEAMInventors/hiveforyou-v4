"use client";

import type { AuditTrailEntry, StudyRevisionLine } from "@hiveforyou/contracts";

import { SourceChips } from "@/components/study/SourceChip";
import type { HiveBoardModel } from "@hiveforyou/contracts";

const CARD = "rounded-[14px] border border-line bg-paper p-[22px]";

export function AuditTrailPageView({
  entries,
  revisions,
  board,
  assistantName,
}: {
  entries: readonly AuditTrailEntry[];
  revisions: readonly StudyRevisionLine[];
  board: HiveBoardModel;
  assistantName: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 min-[1100px]:grid-cols-[2fr_1fr]">
      <section className={`${CARD} flex flex-col gap-4`} data-testid="audit-checks">
        <div>
          <h2 className="m-0 font-brand text-[20px] font-semibold text-ink">Checks and methods</h2>
          <p className="m-0 mt-1 text-small text-graphite">
            A readable description of how HiveForYou reached its findings.
          </p>
        </div>
        {entries.map((entry) => (
          <div key={entry.id} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
            <h3 className="m-0 text-[15px] font-semibold text-ink">{entry.title}</h3>
            <p className="m-0 mt-2 text-small text-ink">
              <span className="font-semibold">Method:</span> {entry.method}
            </p>
            <p className="m-0 mt-1 text-small text-ink">
              <span className="font-semibold">Result:</span> {entry.result}
            </p>
            {entry.chips.length > 0 ? (
              <div className="mt-2">
                <SourceChips refs={entry.chips} />
              </div>
            ) : null}
          </div>
        ))}
      </section>
      <aside className="flex flex-col gap-4">
        <section className={`${CARD} flex flex-col gap-3`} data-testid="audit-revisions">
          <h2 className="m-0 font-brand text-[20px] font-semibold text-ink">Study revisions</h2>
          {revisions.map((revision) => (
            <div key={revision.revisionNumber} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
              <p className="m-0 text-small font-semibold text-ink">
                v{revision.revisionNumber} ·{" "}
                {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(revision.acceptedAt))}
              </p>
              <p className="m-0 text-small text-graphite">{revision.summary}</p>
            </div>
          ))}
        </section>
        <details className={CARD} data-testid="audit-activity">
          <summary className="cursor-pointer font-brand text-[20px] font-semibold text-ink">Activity log</summary>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {[...board.activity].reverse().map((event) => (
              <li key={`${event.at}-${event.text}`} className="border-t border-line pt-2 text-small text-graphite first:border-t-0">
                <span className="text-quiet">{event.atLabel}</span> ·{" "}
                <span className={event.actor === assistantName ? "text-cell-blue-deep" : ""}>{event.actor}</span> {event.text}
              </li>
            ))}
          </ul>
        </details>
      </aside>
    </div>
  );
}