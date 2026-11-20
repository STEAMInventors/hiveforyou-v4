import Link from "next/link";

import { QUIET_LINK_CLASS } from "@/components/button-classes";
import { HiveMark } from "@/components/study/HiveMark";
import { hiveDocumentsPath } from "@/lib/hive-routes";

type TabEmptyStateProps = {
  variant: "documents" | "study" | "reports";
  hiveId: string;
};

const copy: Record<TabEmptyStateProps["variant"], { title: string; body: string }> = {
  documents: {
    title: "No documents yet",
    body: "Upload whatever you have to start your hive.",
  },
  study: {
    title: "No study yet",
    body: "Upload whatever you have to start your hive, then analyze it from Documents. The study appears here once it's accepted.",
  },
  reports: {
    title: "No reports yet",
    body: "Reports are written from an accepted study. Nothing has been written in this hive yet.",
  },
};

export function TabEmptyState({ variant, hiveId }: TabEmptyStateProps) {
  const content = copy[variant];
  const titleId = `empty-${variant}-title`;

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col items-start gap-3 rounded-card border-2 border-dashed border-line bg-paper p-7"
    >
      <h2 id={titleId} className="m-0 inline-flex items-center gap-2 font-brand text-section font-semibold text-ink">
        <HiveMark className="h-5 w-5 shrink-0" />
        {content.title}
      </h2>
      <p className="m-0 max-w-prose text-body text-graphite">{content.body}</p>
      {variant !== "documents" ? (
        <Link href={hiveDocumentsPath(hiveId)} className={QUIET_LINK_CLASS}>
          Go to Documents
        </Link>
      ) : null}
    </section>
  );
}
