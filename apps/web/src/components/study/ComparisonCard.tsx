"use client";

import type { StudyViewRow } from "@hiveforyou/contracts";

import { type DistinctValue, distinctValues } from "./ChangedValue";
import { type ChipRef, dedupeChipRefs, SourceChips, useDocumentLabel } from "./SourceChip";
import { HiveMark } from "./HiveMark";
import { StatusBadge } from "./StatusBadge";
import { formatDocumentDate } from "./Timeline";

export type ParsedAmount = {
  readonly value: number;
  readonly decimals: number;
  readonly prefix: string;
  readonly suffix: string;
};

const AMOUNT = /^\s*([$€£¥])?\s*(-)?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?)\s*(%|[A-Za-z][A-Za-z/.]*(?:\s[A-Za-z][A-Za-z/.]*)*)?\s*$/;

/** A value that is only an amount: optional currency sign, number, optional unit after it. */
export function parseAmount(text: string): ParsedAmount | null {
  const match = AMOUNT.exec(text);
  if (!match) return null;
  const value = Number(match[3]!.replaceAll(",", ""));
  if (!Number.isFinite(value)) return null;
  return {
    value: match[2] ? -value : value,
    decimals: match[4]?.length ?? 0,
    prefix: match[1] ?? "",
    suffix: (match[5] ?? "").trim(),
  };
}

/**
 * The absolute difference of two amounts written in the same unit, formatted like them; null when
 * either is not a plain amount or the units differ. Computed here, never taken from the model.
 */
export function amountDifference(a: string, b: string): string | null {
  const left = parseAmount(a);
  const right = parseAmount(b);
  if (!left || !right) return null;
  if (left.prefix !== right.prefix || left.suffix.toLowerCase() !== right.suffix.toLowerCase()) return null;
  const decimals = Math.max(left.decimals, right.decimals);
  const scale = 10 ** decimals;
  const difference = Math.abs(Math.round(left.value * scale) - Math.round(right.value * scale)) / scale;
  const number = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
    difference,
  );
  const suffix = left.suffix === "" ? "" : left.suffix === "%" ? "%" : ` ${left.suffix}`;
  return `${left.prefix}${number}${suffix}`;
}

export type ComparisonSide = {
  readonly sourceDocumentId: string;
  readonly values: readonly DistinctValue[];
  readonly quotes: readonly string[];
  readonly refs: readonly ChipRef[];
};

/** One side per document, in the order the conflict cites them. */
export function conflictSides(row: StudyViewRow): ComparisonSide[] {
  const order: string[] = [];
  const byDocument = new Map<string, StudyViewRow["values"][number][]>();
  for (const value of row.values) {
    const id = value.sourceRef.sourceDocumentId;
    if (!byDocument.has(id)) {
      order.push(id);
      byDocument.set(id, []);
    }
    byDocument.get(id)!.push(value);
  }
  return order.map((sourceDocumentId) => {
    const values = byDocument.get(sourceDocumentId)!;
    const distinct = distinctValues(values);
    const refsWithFacts = values.map((value) => ({
      sourceDocumentId: value.sourceRef.sourceDocumentId,
      pageNumber: value.sourceRef.pageNumber,
      quote: value.sourceRef.quote,
      factIds: [value.factId],
    }));
    return {
      sourceDocumentId,
      values: distinct,
      quotes: [...new Set(values.map((value) => value.sourceRef.quote.trim()).filter((quote) => quote !== ""))],
      refs: dedupeChipRefs(refsWithFacts),
    };
  });
}

/** The difference line applies only to exactly two sides with one amount each. */
export function sidesDifference(sides: readonly ComparisonSide[]): string | null {
  if (sides.length !== 2 || sides.some((side) => side.values.length !== 1)) return null;
  return amountDifference(sides[0]!.values[0]!.text, sides[1]!.values[0]!.text);
}

function SideLabel({ side, date }: { side: ComparisonSide; date: string | null | undefined }) {
  const label = useDocumentLabel(side.sourceDocumentId);
  const when = formatDocumentDate(date);
  return (
    <p className="m-0 text-caption text-quiet">
      {label}
      {when ? (
        <>
          {" · "}
          <span className="font-brand">{when}</span>
        </>
      ) : null}
    </p>
  );
}

type ComparisonCardProps = {
  row: StudyViewRow;
  documentDate: (sourceDocumentId: string) => string | null | undefined;
};

export function ComparisonCard({ row, documentDate }: ComparisonCardProps) {
  const sides = conflictSides(row);
  const difference = sidesDifference(sides);
  return (
    <article className="overflow-hidden rounded-card border border-line bg-paper" data-row-id={row.id} data-testid="comparison-card">
      <header className="flex flex-wrap items-start gap-3 border-b border-line bg-mist px-5 py-4 sm:px-7">
        <StatusBadge state="needs" />
        <p className="m-0 max-w-prose flex-1 text-body font-medium text-ink">{row.statement}</p>
      </header>
      <div className="flex flex-wrap gap-px bg-line">
        {sides.map((side) => (
          <section key={side.sourceDocumentId} className="flex min-w-0 flex-[1_1_280px] flex-col gap-2 bg-paper px-5 py-5 sm:px-7">
            <SideLabel side={side} date={documentDate(side.sourceDocumentId)} />
            {side.values.map((value) => (
              <p key={value.text} className="m-0 break-words font-quote text-[32px] leading-[1.15] text-ink" data-testid="comparison-value">
                {value.text}
              </p>
            ))}
            {side.quotes.map((quote) => (
              <p key={quote} className="m-0 font-quote text-small text-graphite">
                “{quote}”
              </p>
            ))}
            <div>
              <SourceChips refs={side.refs} />
            </div>
          </section>
        ))}
      </div>
      {/* TODO(cleanup item 1): add a "Worth asking:" line once hive-write/1 returns one per conflict. */}
      {difference ? (
        <footer className="border-t border-line px-5 py-4 text-small text-graphite sm:px-7" data-testid="comparison-difference">
          <span className="inline-flex flex-wrap items-center gap-2">
            <HiveMark />
            <span>
              Difference: <span className="font-semibold text-ink">{difference}</span> · calculated from the two amounts above
            </span>
          </span>
        </footer>
      ) : null}
    </article>
  );
}
