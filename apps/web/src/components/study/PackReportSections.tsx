"use client";

import type { StudyViewBlockName, StudyViewDocumentRequestList, StudyViewPackBlock, StudyViewPackSection, StudyViewRow } from "@hiveforyou/contracts";
import type { ReactNode } from "react";

import { DocumentRequestList } from "./DocumentRequestList";
import { DocumentsTable } from "./DocumentsTable";
import { EstablishTable } from "./EstablishTable";
import { InferenceLabel } from "./InferenceLabel";
import { ComparisonCard } from "./ComparisonCard";
import { SourceChips, type ChipRef } from "./SourceChip";
import { Timeline } from "./Timeline";
import { rowChips } from "./Timeline";

const CARD = "flex flex-col rounded-card border border-line bg-paper p-5 sm:p-7";
const SECTION_HEADING = "m-0 font-brand text-section font-semibold text-ink";

type PackReportSectionsProps = {
  readonly sections: readonly StudyViewPackSection[];
  readonly customer: boolean;
  readonly sentenceChips: (factIds: readonly string[]) => ChipRef[];
  readonly documentDate: (id: string) => string | null;
  readonly unreadableIds: ReadonlySet<string>;
  readonly pageCountFor: (id: string) => number | undefined;
};

function questionListBlock(rows: readonly StudyViewRow[]): ReactNode {
  if (rows.length === 0) return null;
  return (
    <ol className="m-0 list-decimal pl-5">
      {rows.map((row, index) => (
        <li key={row.id || `q-${index + 1}`} className="max-w-prose py-1 text-body text-ink">
          {row.statement}
          {row.values.length > 0 ? <> <SourceChips refs={row.values.map((value) => ({ sourceDocumentId: value.sourceRef.sourceDocumentId, pageNumber: value.sourceRef.pageNumber, quote: value.sourceRef.quote, factIds: [value.factId] }))} /></> : null}
        </li>
      ))}
    </ol>
  );
}

type PackBlockRenderContext = Omit<PackReportSectionsProps, "sections">;

function renderBlock(
  name: StudyViewBlockName | "gaps",
  rows: readonly StudyViewRow[],
  gapsList: StudyViewDocumentRequestList | undefined,
  props: PackBlockRenderContext,
): ReactNode {
  if (name === "gaps" && gapsList) {
    return <DocumentRequestList component={gapsList} customer={props.customer} sentenceChips={props.sentenceChips} />;
  }
  if (rows.length === 0) return null;
  switch (name) {
    case "spine_table":
    case "checklist":
      return <EstablishTable rows={rows.map((row) => ({ ...row, label: row.label ?? row.statement ?? row.id }))} compact={!props.customer} observations={[]} statusMode={name === "checklist" ? "checklist" : "spine"} />;
    case "conflicts":
      return rows.map((row) => <ComparisonCard key={row.id} row={row} documentDate={props.documentDate} />);
    case "timeline":
      return <Timeline rows={rows} upcomingId={null} />;
    case "documents":
      return <DocumentsTable rows={rows} unreadableIds={props.unreadableIds} pageCountFor={props.pageCountFor} />;
    case "questions":
      return questionListBlock(rows);
    case "terms":
    case "general_notes":
    case "unanswered":
    case "outside_spine":
      return (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((row) => (
            <li key={row.id} className="max-w-prose text-body text-ink">
              {row.statement ?? row.label} <SourceChips refs={rowChips(row)} />
            </li>
          ))}
        </ul>
      );
    case "chains":
      return (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((row) => (
            <li key={row.id} className="max-w-prose text-body text-ink">
              <span className="font-medium">{row.label}</span>
              {row.missing && row.missing.length > 0 ? <span className="text-quiet"> · not shown</span> : null}
              <SourceChips refs={rowChips(row)} />
            </li>
          ))}
        </ul>
      );
    default:
      return null;
  }
}

export function PackReportSections({ sections, ...props }: PackReportSectionsProps) {
  return (
    <>
      {sections.map((section) => (
        <section
          key={`pack-${section.order}`}
          id={`pack-section-${section.order}`}
          tabIndex={-1}
          className={`${CARD} ${props.customer ? "gap-4" : "gap-3"}`}
          data-testid="pack-report-section"
        >
          <h3 className={SECTION_HEADING}>{section.heading}</h3>
          {section.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex} className="m-0 max-w-prose text-body text-ink">
              {paragraph.sentences.map((sentence, sentenceIndex) => {
                const chips = props.sentenceChips(sentence.factIds);
                if (chips.length === 0) return null;
                return (
                  <span key={sentenceIndex}>
                    <InferenceLabel />
                    {sentence.text} <SourceChips refs={chips} />{" "}
                  </span>
                );
              })}
            </p>
          ))}
          {section.blocks.map((block, blockIndex) => (
            <div key={`${section.order}-block-${blockIndex}`} className="flex flex-col gap-2" data-pack-block={block.name}>
              {renderBlock(
                block.name as StudyViewPackBlock["name"],
                block.name === "gaps" ? [] : block.rows,
                section.documentRequestList,
                props,
              )}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
