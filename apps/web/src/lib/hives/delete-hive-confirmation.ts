export const HIVE_DELETE_CONFIRMATION_TEXT = "delete" as const;

export function isHiveDeleteConfirmed(input: string): boolean {
  return input === HIVE_DELETE_CONFIRMATION_TEXT;
}
