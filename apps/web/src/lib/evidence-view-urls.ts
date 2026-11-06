/** API paths for in-app evidence viewing (owner session; no quote or fact text in URLs). */

export function evidenceViewerOpenPath(hiveId: string, sourceDocumentId: string): string {
  return `/api/v1/hives/${encodeURIComponent(hiveId)}/source-documents/${encodeURIComponent(sourceDocumentId)}/viewer-open`;
}

export function postViewerOpenInit(pageNumber: number): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageNumber }),
  };
}

export function documentPageTextPath(hiveId: string, sourceDocumentId: string, pageNumber: number): string {
  return `/api/v1/hives/${encodeURIComponent(hiveId)}/source-documents/${encodeURIComponent(
    sourceDocumentId,
  )}/pages/${encodeURIComponent(String(pageNumber))}/text`;
}
