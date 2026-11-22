import type { CanonicalStudy, CoverageGap, StudyView, StudyViewRow, StudyViewSources } from "@hiveforyou/contracts";

import {
  buildCitationContextMap,
  buildProjectedTimelineCitationContextMap,
} from "@/components/study/citation-context";
import { findingsChipLabels, shortDocumentLabels } from "@/components/study/SourceChip";

export type HiveWorkspaceDocument = {
  readonly sourceDocumentId: string;
  readonly fileName?: string;
  readonly typeInPlainWords?: string | null;
};

export type HiveEvidenceViewerModel = {
  readonly labels: ReadonlyMap<string, string>;
  readonly chipLabels: ReadonlyMap<string, string>;
  readonly pageCountFor: (sourceDocumentId: string) => number | undefined;
  readonly citationContexts: ReturnType<typeof buildCitationContextMap>;
};

function documentTypeMap(input: {
  readonly view: StudyView | null;
  readonly sources: StudyViewSources | null;
  readonly canonicalStudy: CanonicalStudy | null;
  readonly projectedTimeline?: readonly StudyViewRow[];
  readonly workspaceDocuments?: readonly HiveWorkspaceDocument[];
}): Map<string, string | null> {
  const typeByDoc = new Map<string, string | null>();

  if (input.view) {
    const documents = input.view.blocks.find((block) => block.name === "documents")?.rows ?? [];
    for (const row of documents) {
      typeByDoc.set(row.id.toLowerCase(), row.typeInPlainWords?.trim() || null);
    }
  }

  for (const document of input.workspaceDocuments ?? []) {
    const key = document.sourceDocumentId.toLowerCase();
    const label = document.typeInPlainWords?.trim() || document.fileName?.trim() || null;
    if (!typeByDoc.get(key) && label) typeByDoc.set(key, label);
  }

  if (input.canonicalStudy) {
    for (const document of input.canonicalStudy.documents) {
      const key = document.sourceDocumentId.toLowerCase();
      if (!typeByDoc.get(key)) typeByDoc.set(key, document.typeInPlainWords.trim() || null);
    }
  }
  if (input.sources?.documents) {
    for (const [id, entry] of Object.entries(input.sources.documents)) {
      const fromSource = entry.typeInPlainWords?.trim() || entry.fileName?.trim() || null;
      const key = id.toLowerCase();
      if (!typeByDoc.get(key) && fromSource) typeByDoc.set(key, fromSource);
    }
  }
  if (input.sources?.facts) {
    for (const ref of Object.values(input.sources.facts)) {
      const key = ref.sourceDocumentId.toLowerCase();
      if (!typeByDoc.has(key)) typeByDoc.set(key, null);
    }
  }
  for (const row of input.projectedTimeline ?? []) {
    for (const value of row.values) {
      const key = value.sourceRef.sourceDocumentId.toLowerCase();
      if (!typeByDoc.has(key)) {
        const hint = value.valueAsWritten.trim();
        typeByDoc.set(key, hint || null);
      }
    }
  }
  return typeByDoc;
}

function evidenceFromTypeMap(
  typeByDoc: Map<string, string | null>,
  input: {
    readonly view: StudyView | null;
    readonly sources: StudyViewSources | null;
    readonly projectedTimeline?: readonly StudyViewRow[];
    readonly documentPages?: Readonly<Record<string, number>>;
  },
): HiveEvidenceViewerModel {
  const documents = input.view?.blocks.find((block) => block.name === "documents")?.rows ?? [];
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
  const citationContexts = input.view
    ? buildCitationContextMap(input.view, input.sources)
    : buildProjectedTimelineCitationContextMap(input.projectedTimeline ?? []);

  return {
    labels: fullLabels,
    chipLabels,
    pageCountFor,
    citationContexts,
  };
}

/** Shared label, page-count, and citation context for EvidenceViewerProvider (Findings, board conversation). */
export function buildHiveEvidenceViewerModel(input: {
  readonly view: StudyView | null;
  readonly sources: StudyViewSources | null;
  readonly canonicalStudy: CanonicalStudy | null;
  readonly coverageGaps?: readonly CoverageGap[];
  readonly documentPages?: Readonly<Record<string, number>>;
  /** Legacy saved-report timeline rows when no hive.study-view/1 is loaded. */
  readonly projectedTimeline?: readonly StudyViewRow[];
  readonly workspaceDocuments?: readonly HiveWorkspaceDocument[];
}): HiveEvidenceViewerModel | null {
  if (input.view) {
    const typeByDoc = documentTypeMap(input);
    return evidenceFromTypeMap(typeByDoc, input);
  }
  if (!input.projectedTimeline?.length) return null;
  const typeByDoc = documentTypeMap(input);
  return evidenceFromTypeMap(typeByDoc, input);
}