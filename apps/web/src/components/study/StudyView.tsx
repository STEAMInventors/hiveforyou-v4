"use client";

import type { CoverageGap, StudyRevisionFormat, StudyView as StudyViewData, StudyViewSources } from "@hiveforyou/contracts";
import Link from "next/link";

import { QUIET_LINK_CLASS } from "@/components/button-classes";
import { hiveDocumentsPath, hiveReportsPath } from "@/lib/hive-routes";

import { StudyReport } from "./StudyReport";

type StudyViewProps = {
  hiveId: string;
  /** Revisions saved before this field existed are `investigation-1`. */
  revisionFormat: StudyRevisionFormat | undefined;
  view: StudyViewData | null;
  sources: StudyViewSources | null;
  revisionNumber?: number;
  coverageGaps?: readonly CoverageGap[];
  documentPages?: Readonly<Record<string, number>>;
};

const NOTICE_CLASS = "flex flex-col gap-3 rounded-card border border-line bg-paper p-5 sm:p-7";
const NOTICE_HEADING = "m-0 font-brand text-section font-semibold text-ink";

/**
 * The study tab: the canonical study of the current revision in the report layout, without the
 * audience switch or narrative. Every row and value links to the original physical page.
 */
export function StudyView({ hiveId, revisionFormat, view, sources, revisionNumber, coverageGaps, documentPages }: StudyViewProps) {
  if (revisionFormat !== "canonical-study-1") {
    return (
      <section role="status" className={NOTICE_CLASS} data-testid="study-legacy-notice">
        <h2 className={NOTICE_HEADING}>This study was built the earlier way</h2>
        <p className="m-0 max-w-prose text-body text-graphite">
          Rebuild it to see it in the new study view. Rebuild uses the pages already read; earlier revisions and their
          reports stay.
        </p>
        <Link href={hiveDocumentsPath(hiveId)} className={QUIET_LINK_CLASS} data-testid="study-legacy-rebuild">
          Rebuild the study from Documents
        </Link>
      </section>
    );
  }
  if (!view) {
    return (
      <section role="status" className={NOTICE_CLASS} data-testid="study-view-pending">
        <h2 className={NOTICE_HEADING}>Your study is accepted, but its page isn&apos;t ready yet</h2>
        <p className="m-0 max-w-prose text-body text-graphite">
          The study page is laid out when a report is written from this revision. Write one from Reports and it appears
          here too.
        </p>
        <Link href={hiveReportsPath(hiveId)} className={QUIET_LINK_CLASS}>
          Go to Reports
        </Link>
      </section>
    );
  }
  return (
    <StudyReport
      hiveId={hiveId}
      view={view}
      sources={sources}
      header={{ kind: "study", revisionNumber: revisionNumber ?? null }}
      coverageGaps={coverageGaps}
      documentPages={documentPages}
      showStateBar={false}
    />
  );
}
