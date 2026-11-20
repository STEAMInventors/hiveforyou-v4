"use client";

import type { AuditTrailEntry, HiveBoardModel, StudyRevisionLine } from "@hiveforyou/contracts";
import { useState, type ReactNode } from "react";

import type { ChipRef } from "@/components/study/SourceChip";
import { Section } from "@/components/ui/Section";
import { ShowFewer, ShowMore } from "@/components/ui/ShowMore";
import { SourceRefs } from "@/components/ui/SourceRefs";
import { StatusDot } from "@/components/ui/StatusDot";

const ROW_LIMIT = 6;

const revisionDateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function entryDetail(entry: AuditTrailEntry): string {
  return `${entry.method} ${entry.result}`.trim();
}

function toChipRefs(chips: AuditTrailEntry["chips"]): ChipRef[] {
  return chips.map((chip) => ({
    sourceDocumentId: chip.sourceDocumentId,
    pageNumber: chip.pageNumber,
    quote: chip.quote,
    factIds: "factIds" in chip && chip.factIds ? [...chip.factIds] : [],
  }));
}

function PaginatedSection({
  title,
  count,
  testId,
  children,
  itemCount,
  expanded,
  onExpand,
  onCollapse,
}: {
  title: string;
  count?: number;
  testId: string;
  children: ReactNode;
  itemCount: number;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  return (
    <Section title={title} headingRight={count ?? itemCount}>
      <div data-testid={testId}>{children}</div>
      {itemCount > ROW_LIMIT ? (
        expanded ? (
          <ShowFewer label="Show fewer" onClick={onCollapse} />
        ) : (
          <ShowMore label={`Show all ${itemCount}`} onClick={onExpand} />
        )
      ) : null}
    </Section>
  );
}

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
  const [checksExpanded, setChecksExpanded] = useState(false);
  const [revisionsExpanded, setRevisionsExpanded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);

  const activityRows = [...board.activity].reverse();
  const visibleChecks = checksExpanded ? entries : entries.slice(0, ROW_LIMIT);
  const visibleRevisions = revisionsExpanded ? revisions : revisions.slice(0, ROW_LIMIT);
  const visibleActivity = activityExpanded ? activityRows : activityRows.slice(0, ROW_LIMIT);

  return (
    <div className="mx-auto w-full max-w-col-read" data-testid="audit-trail">
      {entries.length === 0 ? (
        <p className="m-0 text-body text-ink-2" data-testid="audit-empty">
          Checks will appear here after a study is accepted.
        </p>
      ) : (
        <PaginatedSection
          title="Checks and methods"
          count={entries.length}
          testId="audit-checks"
          itemCount={entries.length}
          expanded={checksExpanded}
          onExpand={() => setChecksExpanded(true)}
          onCollapse={() => setChecksExpanded(false)}
        >
          {visibleChecks.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-col gap-1 border-b border-line py-4 first:pt-0"
              data-testid="audit-check-row"
            >
              <div className="flex flex-wrap items-start gap-2.5">
                <StatusDot state="checked" label="Checked" />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-item font-semibold text-ink">{entry.title}</p>
                  <p className="m-0 mt-1 text-meta text-ink-2">{entryDetail(entry)}</p>
                  <SourceRefs refs={toChipRefs(entry.chips)} inert />
                </div>
              </div>
            </div>
          ))}
        </PaginatedSection>
      )}

      <PaginatedSection
        title="Study versions"
        count={revisions.length}
        testId="audit-revisions"
        itemCount={revisions.length}
        expanded={revisionsExpanded}
        onExpand={() => setRevisionsExpanded(true)}
        onCollapse={() => setRevisionsExpanded(false)}
      >
        {revisions.length === 0 ? (
          <p className="m-0 text-body text-ink-2">No study versions yet.</p>
        ) : (
          visibleRevisions.map((revision) => (
            <div
              key={revision.revisionNumber}
              className="border-b border-line py-3.5 first:pt-0"
              data-testid="audit-revision-row"
            >
              <p className="m-0 text-item font-semibold text-ink">
                v{revision.revisionNumber} · {revisionDateFormat.format(new Date(revision.acceptedAt))}
              </p>
              <p className="m-0 mt-1 text-meta text-ink-2">{revision.summary}</p>
            </div>
          ))
        )}
      </PaginatedSection>

      <PaginatedSection
        title="Activity"
        count={activityRows.length}
        testId="audit-activity"
        itemCount={activityRows.length}
        expanded={activityExpanded}
        onExpand={() => setActivityExpanded(true)}
        onCollapse={() => setActivityExpanded(false)}
      >
        {activityRows.length === 0 ? (
          <p className="m-0 text-body text-ink-2">Nothing yet.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {visibleActivity.map((event) => (
              <li
                key={`${event.at}-${event.text}`}
                className="border-b border-line py-3 first:pt-0 text-body text-ink"
              >
                <span className="text-meta text-ink-3">{event.atLabel}</span>
                {" · "}
                <span
                  className={`font-semibold ${
                    event.actor === assistantName || event.actor === "HiveForYou" ? "text-blue-deep" : "text-ink"
                  }`}
                >
                  {event.actor}
                </span>{" "}
                {event.text}
              </li>
            ))}
          </ul>
        )}
      </PaginatedSection>
    </div>
  );
}