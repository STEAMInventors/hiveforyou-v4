export const MY_HIVES_PATH = "/hives";

export const CREATE_HIVE_PARAM = "create";

export const MY_HIVES_CREATE_PATH = `${MY_HIVES_PATH}?${CREATE_HIVE_PARAM}=1`;

export const CREATE_HIVE_AFTER_SIGN_UP_PATH = `/register?next=${encodeURIComponent(MY_HIVES_CREATE_PATH)}`;

export function hiveDocumentsPath(hiveId: string): string {
  return `${MY_HIVES_PATH}/${hiveId}/documents`;
}
