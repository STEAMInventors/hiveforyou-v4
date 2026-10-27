export const PROCESSING_STAGES = [
  "SHELL",
  "REGISTER",
  "READ",
  "PROTECT",
  "EXTRACT",
  "VERIFY",
  "MERGE",
  "ANALYZE",
  "COMPOSE",
  "SAVE_REPORT",
] as const;

export type ProcessingStage = (typeof PROCESSING_STAGES)[number];

export function isProcessingStage(value: string): value is ProcessingStage {
  return (PROCESSING_STAGES as readonly string[]).includes(value);
}
