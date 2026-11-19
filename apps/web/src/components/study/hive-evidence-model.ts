import type { CanonicalStudy, CoverageGap, StudyView, StudyViewSources } from "@hiveforyou/contracts";

import { buildCitationContextMap } from "@/components/study/citation-context";
import { findingsChipLabels, shortDocumentLabels } from "@/components/study/SourceChip";

export type HiveEvidenceViewerModel = {
  readonly labels: ReadonlyMap<string, string>;
  readonly chipLabels: ReadonlyMap<string, string>;
  readonly pageCountFor: (sourceDocumentId: string) => number | undefined;
  readonly citationContexts: ReturnType<typeof buildCitationContextMap>;
};

/** Shared label, page-count, and citation context for EvidenceViewerProvider (Findings, board conversation). */
export function buildHiveEvidenceViewerModel(input: {
  readonly view: StudyView | null;
  readonly sources: StudyViewSources | null;
  readonly canonicalStudy: CanonicalStudy | null;
  readonly coverageGaps?: readonly CoverageGap[];
  readonly documentPages?: Readonly<Record<string, number>>;
}): HiveEvidenceViewerModel | null {
  if (!input.view) return null;

  const documents = input.view.blocks.find((block) => block.name === "documents")?.rows ?? [];
  const typeByDoc = new Map(
    documents.map((row) => [row.id.toLowerCase(), row.typeInPlainWords?.trim() || null] as const),
  );
  if (input.canonicalStudy) {
    for (const document of input.canonicalStudy.documents) {
      const key = document.sourceDocumentId.toLowerCase();
      if (!typeByDoc.get(key)) typeByDoc.set(key, document.typeInPlainWords.trim() || null);
    }
  }
  const labelled = [...typeByDoc.entries()].map(([sourceDocumentId, typeInPlainWords]) => ({
    sourceDocumentId,
    typeInPlainWords,
    date: documents.find((row) => row.id.toLowerCase() === sourceDocumentId)?.date ?? null,
  }));
  const shortLabels = shortDocumentLabels(labelled);
  const chipLabels = findingsChipLabels(labelled);
  const fullLabels = new Map<string, string>();
  for (const document of labelled) {
    const full =
      (document.typeInPlainWords ?? "").trim() || shortLabels.get(document.sourceDocumentId) || "Document";
    fullLabels.set(document.sourceDocumentId, full);
  }
  const pageCountFor = (id: string) => input.documentPages?.[id] ?? input.documentPages?.[id.toLowerCase()];

  return {
    labels: fullLabels,
    chipLabels,
    pageCountFor,
    citationContexts: buildCitationContextMap(input.view, input.sources),
  };
}