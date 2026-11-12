"use client";

import {
  buildMissingDocumentsSummary,
  type CanonicalStudy,
  parseGapUploadLinks,
  type SourceDocument,
  type StudyViewReferencedDocument,
} from "@hiveforyou/contracts";
import { fetchSourceDocuments } from "@/lib/source-documents-client";
import { useEffect, useMemo, useRef, useState } from "react";

import { MissingDocumentsBanner } from "./MissingDocumentsBanner";

const EMPTY_DOCUMENTS: readonly SourceDocument[] = [];
const EMPTY_REFERENCED: readonly StudyViewReferencedDocument[] = [];

type HiveMissingDocumentsChromeProps = {
  readonly hiveId: string;
  readonly canonicalStudy: CanonicalStudy | null;
  readonly referencedDocuments?: readonly StudyViewReferencedDocument[];
  readonly documents?: readonly SourceDocument[];
  readonly fetchDocuments?: boolean;
  readonly acceptedStudyRevisionId?: string | null;
  readonly acceptedStudyRevisionAcceptedAt?: string | null;
  readonly onRebuild?: () => void;
  readonly rebuilding?: boolean;
};

export function HiveMissingDocumentsChrome({
  hiveId,
  canonicalStudy,
  referencedDocuments = EMPTY_REFERENCED,
  documents: initialDocuments = EMPTY_DOCUMENTS,
  fetchDocuments = false,
  acceptedStudyRevisionId = null,
  acceptedStudyRevisionAcceptedAt = null,
  onRebuild,
  rebuilding,
}: HiveMissingDocumentsChromeProps) {
  const [documents, setDocuments] = useState<readonly SourceDocument[]>(() =>
    fetchDocuments ? EMPTY_DOCUMENTS : initialDocuments,
  );
  const fetchGeneration = useRef(0);

  useEffect(() => {
    if (fetchDocuments) return;
    setDocuments(initialDocuments);
  }, [fetchDocuments, initialDocuments]);

  useEffect(() => {
    if (!fetchDocuments) return;
    const generation = ++fetchGeneration.current;
    void fetchSourceDocuments(hiveId)
      .then((response) => {
        if (generation === fetchGeneration.current) setDocuments(response.sourceDocuments);
      })
      .catch(() => undefined);
  }, [fetchDocuments, hiveId]);

  const summary = useMemo(() => {
    if (!canonicalStudy) return null;
    return buildMissingDocumentsSummary(canonicalStudy, referencedDocuments, {
      acceptedStudyRevisionId,
      acceptedStudyRevisionAcceptedAt,
      gapUploads: parseGapUploadLinks(documents),
    });
  }, [acceptedStudyRevisionAcceptedAt, acceptedStudyRevisionId, canonicalStudy, referencedDocuments, documents]);

  if (!summary) return null;
  return <MissingDocumentsBanner hiveId={hiveId} summary={summary} onRebuild={onRebuild} rebuilding={rebuilding} />;
}
