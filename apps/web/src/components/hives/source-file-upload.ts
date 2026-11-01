"use client";

import {
  FREE_UPLOADS_PER_UTC_MONTH,
  validateSourceFileCandidate,
  type SourceDocument,
} from "@hiveforyou/contracts";

import { HiveClientError } from "@/lib/hives-client";
import { uploadSourceDocument } from "@/lib/source-documents-client";

export type SourceFileState =
  | "ready"
  | "invalid"
  | "uploading"
  | "checking"
  | "registered"
  | "rejected"
  | "failed";

export type SelectedSourceFile = {
  key: string;
  file: File;
  clientRequestId: string;
  state: SourceFileState;
  message: string | null;
};

export const MAX_FILES_PER_BATCH = FREE_UPLOADS_PER_UTC_MONTH;

const REJECTION_MESSAGES: Record<string, string> = {
  TYPE_MISMATCH: "This file isn't really a PDF, PNG, JPG or DOCX.",
  SIZE_MISMATCH: "This file changed while uploading. Try again.",
  MALWARE_DETECTED: "This file was flagged by our security check and was not kept.",
  QUOTA_EXCEEDED: "You've used this month's free uploads.",
};

export function rejectionMessage(document: SourceDocument): string {
  return (document.failureReason && REJECTION_MESSAGES[document.failureReason]) ?? "This file was not accepted.";
}

export function toSelectedSourceFiles(files: Iterable<File>): SelectedSourceFile[] {
  return Array.from(files, (file) => {
    const validation = validateSourceFileCandidate({ name: file.name, size: file.size });
    return {
      key: crypto.randomUUID(),
      file,
      clientRequestId: crypto.randomUUID(),
      state: validation.ok ? "ready" : "invalid",
      message: validation.ok ? null : validation.message,
    };
  });
}

export function hasUploadableFiles(files: SelectedSourceFile[]): boolean {
  return files.length > 0 && files.every((item) => item.state !== "invalid");
}

/** Uploads pending files one at a time via V3's server-side registerSourceDocument; replays are safe via clientRequestId. */
export async function uploadSelectedSourceFiles(
  hiveId: string,
  files: SelectedSourceFile[],
  onUpdate: (key: string, patch: Partial<SelectedSourceFile>) => void,
): Promise<{ allSettled: boolean }> {
  let allSettled = true;
  for (const item of files) {
    if (item.state === "registered" || item.state === "rejected" || item.state === "invalid") {
      continue;
    }
    const validation = validateSourceFileCandidate({ name: item.file.name, size: item.file.size });
    if (!validation.ok) {
      onUpdate(item.key, { state: "invalid", message: validation.message });
      continue;
    }
    try {
      onUpdate(item.key, { state: "uploading", message: null });
      const { sourceDocument } = await uploadSourceDocument(hiveId, {
        file: item.file,
        clientRequestId: item.clientRequestId,
      });
      if (sourceDocument.status === "REGISTERED") {
        onUpdate(item.key, { state: "registered", message: null });
      } else {
        onUpdate(item.key, { state: "rejected", message: rejectionMessage(sourceDocument) });
      }
    } catch (error) {
      const settled = error instanceof HiveClientError && error.errorCode === "QUOTA_EXCEEDED";
      if (!settled) {
        allSettled = false;
      }
      onUpdate(item.key, {
        state: settled ? "rejected" : "failed",
        message: error instanceof HiveClientError ? error.message : "This file didn't upload. Try again.",
      });
    }
  }
  return { allSettled };
}
