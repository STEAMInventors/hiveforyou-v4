"use client";

import type { SourceDocument } from "@hiveforyou/contracts";
import { useCallback, useId } from "react";

import { UploadIcon } from "@/components/hives/SourceFilePicker";
import { Button } from "@/components/ui/Button";
import { uploadSourceDocument as uploadSourceDocumentClient } from "@/lib/source-documents-client";

export function ChecklistGapAddButton({
  hiveId,
  gapId,
  title,
  revisionId,
  documents,
  onDocumentsChange,
  onAddFiles,
  label = "Add it",
  showUploadIcon = false,
  onUploaded,
}: {
  hiveId: string;
  gapId: string;
  title: string;
  revisionId: string | null;
  documents: readonly SourceDocument[];
  onDocumentsChange: (documents: SourceDocument[]) => void;
  onAddFiles: () => void;
  label?: string;
  showUploadIcon?: boolean;
  onUploaded?: () => void;
}) {
  const inputId = useId();
  const runUpload = useCallback(
    async (file: File) => {
      if (!revisionId) return;
      const { sourceDocument } = await uploadSourceDocumentClient(hiveId, {
        file,
        clientRequestId: crypto.randomUUID(),
        canonicalGapId: gapId,
        canonicalGapStudyRevisionId: revisionId,
        canonicalGapTitle: title,
      });
      if (sourceDocument.status === "REGISTERED") {
        onDocumentsChange([
          ...documents,
          {
            ...sourceDocument,
            canonicalGapId: gapId,
            canonicalGapStudyRevisionId: revisionId,
            canonicalGapTitle: title,
          },
        ]);
        onUploaded?.();
      }
    },
    [documents, gapId, hiveId, onDocumentsChange, onUploaded, revisionId, title],
  );

  if (revisionId == null || revisionId.trim() === "") {
    return (
      <Button variant="secondary" type="button" className={showUploadIcon ? "gap-1.5 max-[759px]:h-11" : undefined} onClick={onAddFiles}>
        {showUploadIcon ? <UploadIcon /> : null}
        {label}
      </Button>
    );
  }

  return (
    <>
      <input
        id={inputId}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.docx"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void runUpload(file);
          event.target.value = "";
        }}
      />
      <Button
        variant="secondary"
        type="button"
        className={showUploadIcon ? "gap-1.5 max-[759px]:h-11" : undefined}
        onClick={() => document.getElementById(inputId)?.click()}
      >
        {showUploadIcon ? <UploadIcon /> : null}
        {label}
      </Button>
    </>
  );
}