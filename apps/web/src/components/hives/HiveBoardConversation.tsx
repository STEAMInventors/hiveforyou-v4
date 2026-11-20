"use client";

import type { CanonicalStudy, CoverageGap, StudyView, StudyViewSources } from "@hiveforyou/contracts";
import { useMemo } from "react";

import { HiveConversation, type HiveConversationProps } from "@/components/hives/HiveConversation";
import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";
import { buildHiveEvidenceViewerModel } from "@/components/study/hive-evidence-model";

export type HiveBoardConversationProps = HiveConversationProps & {
  readonly studyView: StudyView | null;
  readonly studySources: StudyViewSources | null;
  readonly canonicalStudy: CanonicalStudy | null;
  readonly coverageGaps: readonly CoverageGap[];
  readonly documentPages?: Readonly<Record<string, number>>;
  readonly mode?: "people" | "assistant";
  readonly assistantName?: string;
  readonly teamMemberFirstName?: string | null;
  readonly firmless?: boolean;
  readonly readOnly?: boolean;
  readonly threadOwnerUserId?: string | null;
  readonly onThreadOwnerChange?: (userId: string | null) => void;
  readonly clientThreadUserId?: string | null;
  readonly clientThreadFirstName?: string | null;
  readonly currentUserId?: string | null;
  readonly onSwitchToConversation?: () => void;
};

export function HiveBoardConversation({
  studyView,
  studySources,
  canonicalStudy,
  coverageGaps,
  documentPages,
  hiveId,
  ...conversation
}: HiveBoardConversationProps) {
  const evidence = useMemo(
    () =>
      buildHiveEvidenceViewerModel({
        view: studyView,
        sources: studySources,
        canonicalStudy,
        coverageGaps,
        documentPages,
      }),
    [studyView, studySources, canonicalStudy, coverageGaps, documentPages],
  );

  if (!evidence) {
    return <HiveConversation hiveId={hiveId} {...conversation} />;
  }

  return (
    <EvidenceViewerProvider
      hiveId={hiveId}
      labels={evidence.labels}
      chipLabels={evidence.chipLabels}
      pageCountFor={evidence.pageCountFor}
      citationContexts={evidence.citationContexts}
    >
      <HiveConversation hiveId={hiveId} {...conversation} />
    </EvidenceViewerProvider>
  );
}