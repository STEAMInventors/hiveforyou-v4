import type { CaseId, SourceDocumentId, UserId } from "@hives/contracts";

export function buildSourceObjectPath(
  ownerUserId: UserId,
  caseId: CaseId,
  sourceDocumentId: SourceDocumentId,
): string {
  return `${ownerUserId}/${caseId}/${sourceDocumentId}/original`;
}
