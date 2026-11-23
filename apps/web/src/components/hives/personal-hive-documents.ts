import type { PersonalBoardRole } from "./personal-hive-roster";

export type PersonalUploadedDocument = {
  id: string;
  fileName: string;
  createdAt: string;
};

/** The same authorized document list the Documents page uses. `failed` is not an empty hive. */
export type AuthorizedDocumentList =
  | { readonly status: "listed"; readonly documents: readonly PersonalUploadedDocument[] }
  | { readonly status: "failed" };

export type PersonalDocumentsResolution = {
  readonly documents: readonly PersonalUploadedDocument[];
  readonly loadError: { readonly message: string; readonly correlationId: string; readonly retryable: boolean } | null;
};

const LOAD_FAILED = "Could not load your documents.";

/**
 * My Work shows uploaded files only for the owner, resolved the same way as the board role.
 * A listing failure stays an error. An authorized empty list stays empty. Other members get neither.
 */
export function resolvePersonalUploadedDocuments(
  role: PersonalBoardRole,
  list: AuthorizedDocumentList | null,
  correlationId: string,
): PersonalDocumentsResolution {
  if (role !== "owner") return { documents: [], loadError: null };
  if (!list || list.status === "failed") {
    return {
      documents: [],
      loadError: { message: LOAD_FAILED, correlationId, retryable: true },
    };
  }
  return { documents: list.documents, loadError: null };
}
