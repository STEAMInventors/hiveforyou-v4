"use client";

import {
  buildMissingDocumentsSummary,
  holderTypeLabel,
  type MissingDocumentSlot,
  parseGapUploadLinks,
} from "@hiveforyou/contracts";
import { useCallback, useId, useMemo } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import type { SourceDocument } from "@hiveforyou/contracts";
import { uploadSourceDocument } from "@/lib/source-documents-client";

type MissingDocumentsCardProps = {
  readonly hiveId: string;
  readonly study: import("@hiveforyou/contracts").CanonicalStudy;
  readonly acceptedStudyRevisionId?: string | null;
  readonly acceptedStudyRevisionAcceptedAt?: string | null;
  readonly referencedDocuments?: readonly import("@hiveforyou/contracts").StudyViewReferencedDocument[];
  readonly documents: readonly SourceDocument[];
  readonly onDocumentsChange: (documents: SourceDocument[]) => void;
};

export function MissingDocumentsCard({
  hiveId,
  study,
  acceptedStudyRevisionId = null,
  acceptedStudyRevisionAcceptedAt = null,
  referencedDocuments = [],
  documents,
  onDocumentsChange,
}: MissingDocumentsCardProps) {
  const inputId = useId();

  const summary = useMemo(
    () =>
      buildMissingDocumentsSummary(study, referencedDocuments, {
        acceptedStudyRevisionId,
        acceptedStudyRevisionAcceptedAt,
        gapUploads: parseGapUploadLinks(documents),
      }),
    [study, referencedDocuments, documents, acceptedStudyRevisionAcceptedAt, acceptedStudyRevisionId],
  );

  const runSlotUpload = useCallback(
    async (slot: MissingDocumentSlot, file: File) => {
      if (!acceptedStudyRevisionId) return;
      const { sourceDocument } = await uploadSourceDocument(hiveId, {
        file,
        clientRequestId: crypto.randomUUID(),
        canonicalGapId: slot.gapId,
        canonicalGapStudyRevisionId: acceptedStudyRevisionId,
        canonicalGapTitle: slot.title,
      });
      if (sourceDocument.status === "REGISTERED") {
        onDocumentsChange([
          ...documents,
          {
            ...sourceDocument,
            canonicalGapId: slot.gapId,
            canonicalGapStudyRevisionId: acceptedStudyRevisionId,
            canonicalGapTitle: slot.title,
          },
        ]);
      }
    },
    [acceptedStudyRevisionId, documents, hiveId, onDocumentsChange],
  );

  const openSlots = summary.slots.filter((slot) => slot.uploadState === "open");
  const total = openSlots.length;
  if (total === 0 && !summary.hasPendingUploads) return null;

  return (
    <section id="missing" tabIndex={-1} className="flex flex-col gap-4 rounded-card border border-coral/30 bg-paper p-5 sm:p-7" data-testid="missing-documents-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 font-brand text-[18px] font-semibold text-ink">Missing ({total})</h2>
        <p className="m-0 text-small text-quiet">From the latest accepted study</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {summary.slots.map((slot) => (
          <MissingSlotRow key={slot.gapId} slot={slot} inputId={`${inputId}-${slot.gapId}`} onPick={(file) => void runSlotUpload(slot, file)} />
        ))}
      </ul>
    </section>
  );
}

function MissingSlotRow({
  slot,
  inputId,
  onPick,
}: {
  slot: MissingDocumentSlot;
  inputId: string;
  onPick: (file: File) => void;
}) {
  const holder = holderTypeLabel(slot.holderType, slot.holder);
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line p-3 sm:flex-row sm:items-center sm:justify-between" data-gap-id={slot.gapId}>
      <div className="min-w-0">
        <p className="m-0 font-medium text-ink">{slot.title}</p>
        <p className="m-0 text-body text-graphite">{slot.why}</p>
        <p className="m-0 text-small text-quiet">{holder}</p>
        {slot.uploadState === "added_pending_rebuild" ? (
          <p className="m-0 text-small font-medium text-honey" data-testid="slot-added">
            Added — rebuild to include
          </p>
        ) : null}
      </div>
      {slot.uploadState === "open" ? (
        <>
          <input
            id={inputId}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.docx"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onPick(file);
              event.target.value = "";
            }}
          />
          <label htmlFor={inputId} className={`${SECONDARY_BUTTON_CLASS} cursor-pointer`}>
            Upload
          </label>
        </>
      ) : null}
    </li>
  );
}
