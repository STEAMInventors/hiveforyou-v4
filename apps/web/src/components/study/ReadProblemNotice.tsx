import type { CoverageGap } from "@hiveforyou/contracts";
import Link from "next/link";

import { HiveMark } from "./HiveMark";

/** A document, or some of its pages, that came back without usable text. */
export type ReadProblem = {
  readonly sourceDocumentId: string;
  readonly label: string;
  /** Pages without text; empty when the coverage record does not list them. */
  readonly pageNumbers: readonly number[];
  readonly wholeDocument: boolean;
  /** Partial extraction still pending or failed after bounded retries (not an unreadable scan). */
  readonly pendingExtraction?: boolean;
  readonly verifiedPageCount?: number;
};

const WHOLE_DOCUMENT_REASONS: ReadonlySet<string> = new Set(["UNREADABLE", "NO_TEXT", "READ_FAILED"]);
const PAGE_REASONS: ReadonlySet<string> = new Set(["PARTIAL_READ", "PAGES_WITHOUT_TEXT", "PAGES_NOT_READ", "PAGES_NOT_EXTRACTED"]);

const fileStem = (fileName: string) => fileName.replace(/\.[^.]+$/, "").trim() || "Document";

/**
 * One problem per document from the revision's coverage gaps. Documents not read yet are not read
 * problems. A whole-document problem lists every page when the page count is known.
 */
export function readProblemsFromCoverage(
  gaps: readonly Pick<CoverageGap, "sourceDocumentId" | "fileName" | "reason" | "pageNumbers">[],
  labelFor: (sourceDocumentId: string) => string | undefined,
  pageCountFor: (sourceDocumentId: string) => number | undefined = () => undefined,
): ReadProblem[] {
  const byDocument = new Map<string, { fileName: string; pages: Set<number>; whole: boolean; pendingExtraction: boolean }>();
  for (const gap of gaps) {
    const pendingExtraction = gap.reason === "PAGES_NOT_EXTRACTED";
    const whole = WHOLE_DOCUMENT_REASONS.has(gap.reason);
    if (!whole && !PAGE_REASONS.has(gap.reason)) continue;
    const entry = byDocument.get(gap.sourceDocumentId) ?? {
      fileName: gap.fileName,
      pages: new Set<number>(),
      whole: false,
      pendingExtraction: false,
    };
    entry.pendingExtraction ||= pendingExtraction;
    entry.whole ||= whole && !pendingExtraction;
    for (const page of gap.pageNumbers) entry.pages.add(page);
    byDocument.set(gap.sourceDocumentId, entry);
  }
  return [...byDocument].map(([sourceDocumentId, entry]) => {
    const pageCount = pageCountFor(sourceDocumentId);
    const pageNumbers =
      entry.whole && pageCount ? Array.from({ length: pageCount }, (_, index) => index + 1) : [...entry.pages].sort((a, b) => a - b);
    const verifiedPageCount = pageCountFor(sourceDocumentId);
    return {
      sourceDocumentId,
      label: labelFor(sourceDocumentId) ?? fileStem(entry.fileName),
      pageNumbers,
      wholeDocument: entry.whole,
      pendingExtraction: entry.pendingExtraction,
      verifiedPageCount,
    };
  });
}

export function readProblemSentence(problem: ReadProblem): string {
  const n = problem.pageNumbers.length;
  if (problem.pendingExtraction) {
    const total = problem.verifiedPageCount;
    if (typeof total === "number" && total > 0 && n > 0 && n < total) {
      return `${n} of ${total} pages could not be read yet. Analysis can continue once those pages finish extracting.`;
    }
    if (typeof total === "number" && total > 0) {
      return `${total === 1 ? "1 page" : `${total} pages`} could not be read yet. Analysis can continue once ${total === 1 ? "it finishes" : "they finish"} extracting.`;
    }
    return `${n === 1 ? "1 page" : `${n} pages`} could not be read yet.`;
  }
  if (n === 0) {
    return problem.wholeDocument
      ? "Its pages came back without text, so it is not part of this report."
      : "Some pages came back without text, so they are not part of this report.";
  }
  return `${n} ${n === 1 ? "page" : "pages"} came back without text, so ${n === 1 ? "it is" : "they are"} not part of this report.`;
}

export function ReadProblemNotice({ problems, documentsHref }: { problems: readonly ReadProblem[]; documentsHref: string }) {
  if (problems.length === 0) return null;
  return (
    <section
      aria-label="Documents that could not be read"
      className="flex flex-col gap-4 rounded-control border border-coral-border bg-missing-bg px-5 py-4"
      data-testid="read-problem-notice"
    >
      <div className="flex items-start gap-2">
        <HiveMark />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {problems.map((problem) => (
            <div key={problem.sourceDocumentId} className="flex flex-col gap-1">
              <p className="m-0 text-body font-semibold text-coral-deep">
                {problem.pendingExtraction
                  ? `${problem.label} is not fully in this report yet.`
                  : `${problem.label} could not be read.`}
              </p>
              <p className="m-0 max-w-prose text-body text-ink">{readProblemSentence(problem)}</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <Link
          href={documentsHref}
          className="inline-flex h-11 items-center justify-center rounded-control bg-cell-blue-deep px-4 text-small font-medium text-paper no-underline hover:bg-cell-blue-hover"
        >
          Upload a clearer copy
        </Link>
      </div>
    </section>
  );
}
