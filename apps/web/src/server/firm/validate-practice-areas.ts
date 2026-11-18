import { createHiveError, normalizePracticeAreaIds, type HiveError } from "@hiveforyou/contracts";

const PRACTICE_AREA_MAX = 20;

export function validatePracticeAreasForFirm(
  raw: readonly string[],
  allowed: ReadonlySet<string>,
  correlationId: string,
): string[] {
  if (raw.length > PRACTICE_AREA_MAX) {
    throw attachFirmHttpStatus(
      createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: `Choose up to ${PRACTICE_AREA_MAX} areas.`,
        correlationId,
        diagnosticReason: "practice_areas_too_many",
      }),
      400,
    );
  }
  for (const item of raw) {
    if (typeof item !== "string") {
      throw attachFirmHttpStatus(
        createHiveError({
          errorCode: "INVALID_REQUEST",
          category: "VALIDATION",
          stage: "SHELL",
          retryable: false,
          safeMessage: "Choose from the listed areas.",
          correlationId,
          diagnosticReason: "invalid_practice_area_type",
        }),
        400,
      );
    }
    const trimmed = item.trim();
    if (trimmed && !allowed.has(trimmed)) {
      throw attachFirmHttpStatus(
        createHiveError({
          errorCode: "INVALID_REQUEST",
          category: "VALIDATION",
          stage: "SHELL",
          retryable: false,
          safeMessage: "Choose from the listed areas.",
          correlationId,
          diagnosticReason: "unknown_practice_area",
        }),
        400,
      );
    }
  }
  return normalizePracticeAreaIds(
    raw.filter((item): item is string => typeof item === "string"),
    allowed,
  );
}

export function attachFirmHttpStatus(error: HiveError, httpStatus: number): HiveError {
  Object.defineProperty(error, "httpStatus", {
    value: httpStatus,
    enumerable: false,
    configurable: true,
  });
  return error;
}