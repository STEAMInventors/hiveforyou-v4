import {
  buildStudyView,
  buildStudyViewSources,
  CANONICAL_STUDY_SCHEMA,
  type CanonicalStudy,
  type CoverageGap,
  type ReportAudience,
  type StudyView,
  type StudyViewReferencedDocument,
  type StudyViewSources,
  type WriteFactRecord,
  type WriteOutput,
} from "@hiveforyou/contracts";

/**
 * Hand-built from the eval corpus source text and golden labels; not model output. Each fixture runs
 * through the real `buildStudyView`, so it renders exactly what the pipeline would save.
 */
export type ReportFixture = {
  readonly hiveId: string;
  readonly view: StudyView;
  readonly sources: StudyViewSources;
  readonly coverageGaps: readonly CoverageGap[];
  readonly documentPages: Readonly<Record<string, number>>;
  readonly revisionNumber: number;
  readonly writtenAt: string;
  readonly title: string;
};

export type FixtureDocument = {
  readonly id: string;
  readonly fileName: string;
  readonly pages: number;
  readonly canonical: Omit<CanonicalStudy["documents"][number], "sourceDocumentId">;
};

export type FixtureFact = readonly [id: string, documentId: string, page: number, subject: string, attribute: string, valueAsWritten: string, quote: string];

export type FixtureInput = {
  readonly hiveId: string;
  readonly documents: readonly FixtureDocument[];
  readonly facts: readonly FixtureFact[];
  readonly study: Omit<CanonicalStudy, "schema" | "documents">;
  readonly referencedDocuments: readonly StudyViewReferencedDocument[];
  readonly intent: string;
  readonly writes: Readonly<Record<ReportAudience, WriteOutput>>;
  readonly coverageGaps?: readonly CoverageGap[];
};

export function buildFixture(input: FixtureInput, audience: ReportAudience): ReportFixture {
  const facts: WriteFactRecord[] = input.facts.map(([id, sourceDocumentId, pageNumber, subject, attribute, valueAsWritten, quote]) => ({
    id,
    sourceDocumentId,
    pageNumber,
    subject,
    attribute,
    valueAsWritten,
    quote,
  }));
  const study: CanonicalStudy = {
    schema: CANONICAL_STUDY_SCHEMA,
    documents: input.documents.map((document) => ({ sourceDocumentId: document.id, ...document.canonical })),
    ...input.study,
  };
  const { view } = buildStudyView(study, input.writes[audience], facts, {}, {
    intent: input.intent,
    referencedDocuments: input.referencedDocuments,
  });
  const fileNames = new Map(input.documents.map((document) => [document.id, document.fileName]));
  return {
    hiveId: input.hiveId,
    view,
    sources: buildStudyViewSources(view, facts, fileNames),
    coverageGaps: input.coverageGaps ?? [],
    documentPages: Object.fromEntries(input.documents.map((document) => [document.id, document.pages])),
    revisionNumber: 1,
    writtenAt: "2026-11-06T15:00:00.000Z",
    title: input.writes[audience].sections[0]?.heading ?? "Study",
  };
}

export const sentence = (text: string, ...factIds: string[]) => ({ text, factIds });
