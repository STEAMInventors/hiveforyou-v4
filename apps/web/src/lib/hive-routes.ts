export const MY_HIVES_PATH = "/hives";

export const NEW_CLIENT_HIVE_PATH = `${MY_HIVES_PATH}/new-client`;

export const CREATE_HIVE_PARAM = "create";

export const MY_HIVES_CREATE_PATH = `${MY_HIVES_PATH}?${CREATE_HIVE_PARAM}=1`;

export const CREATE_HIVE_AFTER_SIGN_UP_PATH = `/sign-in?next=${encodeURIComponent(MY_HIVES_CREATE_PATH)}`;

export function hivePath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}`;
}

export function hiveBoardPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/board`;
}

export function hiveDocumentsPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/documents`;
}

export function hiveStudyPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/study`;
}

export function hiveReportsPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/reports`;
}

/** Opens the original file at a physical page for the owner (D-011). */
export function sourcePagePath(hiveId: string, sourceDocumentId: string, pageNumber: number): string {
  return `/api/v1/hives/${encodeURIComponent(hiveId)}/source-documents/${encodeURIComponent(sourceDocumentId)}/pages/${pageNumber}`;
}
