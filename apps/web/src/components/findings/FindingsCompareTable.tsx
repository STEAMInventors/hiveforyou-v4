"use client";

import type { StudyViewRow } from "@hiveforyou/contracts";

import { SourceRefs } from "@/components/ui/SourceRefs";
import { StatusDot } from "@/components/ui/StatusDot";
import { conflictSides } from "@/components/study/ComparisonCard";
import { statusToState } from "@/components/study/status-state";
import { useDocumentLabel } from "@/components/study/SourceChip";

function CompareResultCell({ row }: { row: StudyViewRow }) {
  const state = statusToState(row.status) ?? "needs";
  const label =
    state === "checked" ? "Matches" : state === "changed" ? "Changed" : state === "missing" ? "Missing" : "To review";
  const chips = row.values.map((value) => ({
    sourceDocumentId: value.sourceRef.sourceDocumentId,
    pageNumber: value.sourceRef.pageNumber,
    quote: value.sourceRef.quote,
    factIds: [value.factId],
  }));
  return (
    <td className="min-w-[9rem] align-top py-3 pr-2 text-body">
      <StatusDot state={state} label={label} />
      {row.statement ? <p className="m-0 mt-1 text-small text-ink-2">{row.statement}</p> : null}
      <SourceRefs refs={chips} />
    </td>
  );
}

function CompareValueCell({ text, documentId }: { text: string; documentId: string }) {
  const label = useDocumentLabel(documentId);
  return (
    <td className="min-w-[7rem] align-top py-3 pr-3 text-body">
      <span className="font-semibold text-ink">{text}</span>
      {documentId ? <p className="m-0 mt-0.5 text-meta text-ink-3">{label}</p> : null}
    </td>
  );
}

export function FindingsCompareTable({ rows }: { rows: readonly StudyViewRow[] }) {
  if (rows.length === 0) {
    return <p className="m-0 text-small text-ink-2">No disagreements recorded in this Study.</p>;
  }
  return (
    <div className="-mx-1 max-w-full overflow-x-auto px-1" data-testid="findings-compare-table">
      <table className="w-full min-w-[min(100%,32rem)] border-collapse text-left">
        <thead>
          <tr className="border-b border-ink text-meta text-ink-3">
            <th className="pb-2 pr-3 font-medium">What differs</th>
            <th className="pb-2 pr-3 font-medium">Side A</th>
            <th className="pb-2 pr-3 font-medium">Side B</th>
            <th className="pb-2 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const sides = conflictSides(row);
            const left = sides[0];
            const right = sides[1];
            return (
              <tr key={row.id} className="border-b border-line hover:bg-[#fafbfc]" data-row-id={row.id}>
                <td className="max-w-[14rem] py-3 pr-3 align-top text-body font-medium text-ink">{row.statement}</td>
                <CompareValueCell
                  text={left?.values[0]?.text ?? left?.quotes[0] ?? "—"}
                  documentId={left?.sourceDocumentId ?? ""}
                />
                <CompareValueCell
                  text={right?.values[0]?.text ?? right?.quotes[0] ?? "—"}
                  documentId={right?.sourceDocumentId ?? ""}
                />
                <CompareResultCell row={row} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FindingsChainEvidenceBlock({
  sections,
}: {
  sections: readonly import("@hiveforyou/contracts").FindingsChainEvidenceSection[];
}) {
  if (sections.length === 0) return null;
  return (
    <div className="mt-6 flex flex-col gap-4 border-t border-line pt-6" data-testid="findings-chain-evidence">
      <h4 className="m-0 text-item font-semibold text-ink">How the evidence connects</h4>
      {sections.map((section) => (
        <div key={`${section.chainLabel}:${section.rowLabel}`} className="flex flex-col gap-2">
          <p className="m-0 text-body font-semibold text-ink">
            {section.chainLabel}: {section.rowLabel}
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {section.links.map((link) => (
              <li key={link.linkLabel} className="min-w-0 border-b border-line pb-2 text-body text-ink last:border-0">
                <span className="font-medium">{link.linkLabel}</span>
                {link.valueText ? <span className="text-ink-2"> — {link.valueText}</span> : null}
                <span className="ml-1 text-meta text-ink-3">({link.statusLabel})</span>
                {link.values.length > 0 ? (
                  <SourceRefs
                    refs={link.values.map((value) => ({
                      sourceDocumentId: value.sourceRef.sourceDocumentId,
                      pageNumber: value.sourceRef.pageNumber,
                      quote: value.sourceRef.quote,
                      factIds: [value.factId],
                    }))}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}