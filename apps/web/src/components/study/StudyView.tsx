import type {
  BoundRef,
  StudyRevisionFormat,
  StudyView as StudyViewData,
  StudyViewBlock,
  StudyViewBlockName,
  StudyViewRow,
  StudyViewSourceRef,
  StudyViewSources,
} from "@hiveforyou/contracts";
import Link from "next/link";

import { CARD_CLASS, HEADING_CLASS, SourceChips } from "@/components/a2ui/a2ui-parts";
import { hiveDocumentsPath, sourcePagePath } from "@/lib/hive-routes";

type StudyViewProps = {
  hiveId: string;
  /** Revisions saved before this field existed are `investigation-1`. */
  revisionFormat: StudyRevisionFormat | undefined;
  view: StudyViewData | null;
  sources: StudyViewSources | null;
};

const BLOCK_TITLES: Record<StudyViewBlockName, string> = {
  documents: "Documents",
  spine_table: "What the documents establish",
  conflicts: "Where the documents disagree",
  timeline: "Timeline",
  gaps: "What is missing",
  outside_spine: "Also in the documents",
};

const TABLE_CLASS = "w-full border-collapse text-left text-[13.5px]";
const HEAD_ROW_CLASS = "border-b border-line text-ink-subtle";
const ROW_CLASS = "border-b border-line align-top last:border-b-0";

function plainStatus(status: string | null | undefined): string {
  return status ? status.toLowerCase().replaceAll("_", " ") : "";
}

/**
 * Renders a `hive.study-view/1`: narrative sections first, then blocks in the order the view gives.
 * Every sentence, row and value links to the original physical page; values appear exactly as written.
 */
export function StudyView({ hiveId, revisionFormat, view, sources }: StudyViewProps) {
  if (revisionFormat !== "canonical-study-1") {
    return (
      <section role="status" className={CARD_CLASS} data-testid="study-legacy-notice">
        <h2 className={HEADING_CLASS}>This study was built the earlier way</h2>
        <p className="m-0 text-[15px] leading-[1.55] text-ink-muted">
          Rebuild it to see it in the new study view. Rebuild uses the pages already read; earlier revisions and their
          reports stay.
        </p>
        <Link
          href={hiveDocumentsPath(hiveId)}
          className="inline-flex font-medium text-cell-blue-deep"
          data-testid="study-legacy-rebuild"
        >
          Rebuild Study from Documents
        </Link>
      </section>
    );
  }
  if (!view) {
    return (
      <section role="status" className={CARD_CLASS} data-testid="study-view-pending">
        <h2 className={HEADING_CLASS}>Your study view isn&apos;t written yet</h2>
        <p className="m-0 text-[15px] leading-[1.55] text-ink-muted">
          It appears here once a report has been written from this study. You can generate one from the Reports tab.
        </p>
      </section>
    );
  }

  const fileName = (sourceDocumentId: string) => sources?.documents[sourceDocumentId]?.fileName ?? "Document";
  const toBound = (ref: StudyViewSourceRef): BoundRef => ({
    sourceDocumentId: ref.sourceDocumentId,
    pageNumber: ref.pageNumber,
    fileName: fileName(ref.sourceDocumentId),
  });
  const pageHref = (ref: BoundRef) => sourcePagePath(hiveId, ref.sourceDocumentId, ref.pageNumber);
  const uniqueRefs = (refs: StudyViewSourceRef[]): BoundRef[] => {
    const seen = new Set<string>();
    return refs.filter((ref) => ref.pageNumber > 0).map(toBound).filter((ref) => {
      const key = `${ref.sourceDocumentId}:${ref.pageNumber}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const sentenceRefs = (factIds: readonly string[]) =>
    uniqueRefs(factIds.map((id) => sources?.facts[id]).filter((ref): ref is StudyViewSourceRef => !!ref));
  const rowRefs = (row: StudyViewRow) => uniqueRefs(row.values.map((value) => value.sourceRef));
  const chips = (refs: BoundRef[]) => <SourceChips refs={refs} pageHref={pageHref} />;

  const values = (row: StudyViewRow) =>
    row.values.length === 0 ? null : (
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {row.values.map((value) => (
          <li key={value.factId} className="flex flex-wrap items-center gap-2" data-fact-id={value.factId}>
            <span className="text-ink" data-testid="study-value">
              {value.valueAsWritten}
            </span>
            {chips(uniqueRefs([value.sourceRef]))}
          </li>
        ))}
      </ul>
    );

  const statementList = (block: StudyViewBlock, options: { dated?: boolean; noSource?: string } = {}) => (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {block.rows.map((row) => {
        const refs = rowRefs(row);
        return (
          <li key={row.id} className="flex flex-col gap-1.5" data-row-id={row.id}>
            {options.dated ? (
              <span className="font-mono text-[12.5px] text-ink-subtle">{row.asWritten ?? row.date ?? ""}</span>
            ) : null}
            <span className="text-[15px] leading-[1.55] text-ink">{row.statement}</span>
            {values(row)}
            {refs.length > 0 ? chips(refs) : options.noSource ? (
              <span className="text-[12.5px] text-ink-subtle">{options.noSource}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  const renderBlock = (block: StudyViewBlock) => {
    switch (block.name) {
      case "documents":
        return (
          <div className="overflow-x-auto">
            <table className={TABLE_CLASS}>
              <thead>
                <tr className={HEAD_ROW_CLASS}>
                  <th className="py-1.5 pr-3 font-medium">Document</th>
                  <th className="py-1.5 pr-3 font-medium">Role</th>
                  <th className="py-1.5 pr-3 font-medium">Type</th>
                  <th className="py-1.5 pr-3 font-medium">Date</th>
                  <th className="py-1.5 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={row.id} className={ROW_CLASS} data-row-id={row.id}>
                    <td className="py-2 pr-3 text-ink">{fileName(row.id)}</td>
                    <td className="py-2 pr-3 text-ink">{plainStatus(row.role)}</td>
                    <td className="py-2 pr-3 text-ink">{row.typeInPlainWords ?? ""}</td>
                    <td className="py-2 pr-3 text-ink">{row.date ?? ""}</td>
                    <td className="py-2">{chips([{ sourceDocumentId: row.id, pageNumber: 1, fileName: fileName(row.id) }])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "spine_table":
        return (
          <div className="overflow-x-auto">
            <table className={TABLE_CLASS}>
              <thead>
                <tr className={HEAD_ROW_CLASS}>
                  <th className="py-1.5 pr-3 font-medium">Item</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 font-medium">As written</th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={row.id} className={ROW_CLASS} data-row-id={row.id}>
                    <th scope="row" className="py-2 pr-3 font-medium text-ink">
                      {row.label}
                      {row.missing && row.missing.length > 0 ? (
                        <span className="mt-1 block font-normal text-coral-deep">Missing: {row.missing.join(", ")}</span>
                      ) : null}
                    </th>
                    <td className="py-2 pr-3 text-ink">{plainStatus(row.status)}</td>
                    <td className="py-2">
                      {values(row) ?? <span className="text-ink-subtle">No value found in the documents</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "timeline":
        return statementList(block, { dated: true });
      case "gaps":
        return statementList(block, { noSource: "Not found in the documents that were read." });
      case "conflicts":
      case "outside_spine":
        return statementList(block);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="study-view">
      {view.sections.map((section, sectionIndex) => (
        <section key={`section-${sectionIndex}`} className={CARD_CLASS} data-testid="study-view-section">
          <h3 className={HEADING_CLASS}>{section.heading}</h3>
          {section.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex} className="m-0 flex flex-col gap-1.5 text-[15px] leading-[1.6] text-ink">
              {paragraph.sentences.map((sentence, sentenceIndex) => {
                const refs = sentenceRefs(sentence.factIds);
                if (refs.length === 0) return null;
                return (
                  <span key={sentenceIndex} className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-testid="study-sentence">
                    <span>{sentence.text}</span>
                    {chips(refs)}
                  </span>
                );
              })}
            </p>
          ))}
        </section>
      ))}
      {view.blocks.map((block) =>
        block.rows.length === 0 ? null : (
          <section key={block.name} className={CARD_CLASS} data-block={block.name} data-testid="study-view-block">
            <h3 className={HEADING_CLASS}>{BLOCK_TITLES[block.name]}</h3>
            {renderBlock(block)}
          </section>
        ),
      )}
    </div>
  );
}
