import {
  partitionDocumentRequests,
  type StudyViewDocumentRequestList,
  type StudyViewRow,
} from "@hiveforyou/contracts";
import type { ReactNode } from "react";

import { StatusDot } from "@/components/workspace/StatusDot";

import { ComparisonCard } from "./ComparisonCard";
import { SourceChips } from "./SourceChip";
import { type MissingGroups } from "./missing-groups";
import {
  missingItemStateForConflict,
  missingItemStateForRequest,
  type MissingItemRow,
} from "./MissingItemsCard";

function missingListRow(
  id: string,
  state: "missing",
  title: ReactNode,
): MissingItemRow {
  return {
    id,
    state,
    node: (
      <div className="flex flex-col gap-2">
        <StatusDot state={state} />
        <div className="text-body text-ink">{title}</div>
      </div>
    ),
  };
}

export function buildMissingItemRows(input: {
  conflicts: readonly StudyViewRow[];
  missing: MissingGroups;
  documentRequestList: StudyViewDocumentRequestList | null;
  documentDate: (sourceDocumentId: string) => string | null | undefined;
}): MissingItemRow[] {
  const rows: MissingItemRow[] = [];

  for (const conflict of input.conflicts) {
    rows.push({
      id: `conflict-${conflict.id}`,
      state: missingItemStateForConflict(conflict),
      node: <ComparisonCard row={conflict} documentDate={input.documentDate} />,
    });
  }

  for (const problem of input.missing.unreadable) {
    const pages =
      problem.pageNumbers.length > 0 && !problem.wholeDocument
        ? problem.pageNumbers.length === 1
          ? `, page ${problem.pageNumbers[0]}`
          : `, pages ${problem.pageNumbers.join(", ")}`
        : "";
    rows.push(
      missingListRow(`unreadable-${problem.sourceDocumentId}`, "missing", (
        <>
          {problem.label}
          {pages}
        </>
      )),
    );
  }

  for (const row of input.missing.referenced) {
    rows.push(
      missingListRow(`referenced-${row.id}`, "missing", (
        <>
          {row.statement} <SourceChips refs={row.referencedBy ?? []} />
        </>
      )),
    );
  }

  for (const row of input.missing.expected) {
    rows.push(missingListRow(`expected-${row.id}`, "missing", row.statement));
  }

  if (input.documentRequestList) {
    const parts = partitionDocumentRequests(input.documentRequestList);
    for (const item of parts.items) {
      const later = item.kind === "FUTURE_RECORD";
      const state = missingItemStateForRequest(later ? "later" : "now");
      rows.push({
        id: `request-${item.id}`,
        state,
        node: (
          <div className="flex flex-col gap-2">
            <StatusDot state={state} />
            <p className="m-0 font-medium text-ink">{item.title}</p>
            {item.why.trim() && item.why.trim() !== item.title.trim() ? (
              <p className="m-0 text-small text-ink-2">{item.why}</p>
            ) : null}
            {"basis" in item && item.basis.type === "MENTIONED" ? (
              <span className="text-small text-ink-3">
                Mentioned in{" "}
                <SourceChips
                  refs={item.basis.sourceRefs.map((ref) => ({
                    sourceDocumentId: ref.sourceDocumentId,
                    pageNumber: ref.pageNumber,
                    quote: ref.quote,
                  }))}
                />
              </span>
            ) : null}
          </div>
        ),
      });
    }
    for (const line of parts.legacyLines) {
      rows.push({
        id: `request-legacy-${line.id}`,
        state: "needs",
        node: (
          <div className="flex flex-col gap-2">
            <StatusDot state="needs" />
            <p className="m-0 text-body text-ink">{line.text}</p>
          </div>
        ),
      });
    }
  }

  return rows;
}