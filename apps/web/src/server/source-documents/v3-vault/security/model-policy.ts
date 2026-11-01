import type { EvidenceClass } from "@hives/contracts";
import { HiveError, type HiveErrorInput } from "@hives/core";

export const MODEL_HOSTING_CLASSES = [
  "LOCAL_PRIVATE",
  "DETERMINISTIC_MOCK",
  "EXTERNAL_HOSTED",
] as const;
export type ModelHostingClass = (typeof MODEL_HOSTING_CLASSES)[number];

export const DATA_CLASSES = ["SYNTHETIC", "DEIDENTIFIED", "IDENTIFIABLE_SOURCE"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export type ModelPolicy = {
  readonly hostingClass: ModelHostingClass;
  readonly allowedDataClasses: readonly DataClass[];
  readonly nodeEnv: "development" | "test" | "production";
};

const SENSITIVE_SOURCE_CLASSES: readonly EvidenceClass[] = ["SOURCE_RECORD", "CUSTOMER_INPUT"];

export function assertModelAllowed(
  policy: ModelPolicy,
  input: {
    readonly dataClass: DataClass;
    readonly evidenceClasses: readonly EvidenceClass[];
    readonly correlationId: HiveErrorInput["correlationId"];
  },
): void {
  const hasSensitive = input.evidenceClasses.some((value) =>
    SENSITIVE_SOURCE_CLASSES.includes(value),
  );
  const effectiveClass: DataClass =
    hasSensitive && input.dataClass !== "SYNTHETIC" ? "IDENTIFIABLE_SOURCE" : input.dataClass;

  if (policy.hostingClass === "EXTERNAL_HOSTED") {
    const permitted =
      policy.allowedDataClasses.includes(effectiveClass) &&
      policy.nodeEnv !== "production" &&
      effectiveClass !== "IDENTIFIABLE_SOURCE";
    if (!permitted) {
      throw new HiveError({
        code: "EXTERNAL_MODEL_DENIED",
        category: "POLICY_ERROR",
        message: "Identifiable or sensitive source records must not be sent to an external model.",
        retryable: false,
        severity: "FATAL",
        correlationId: input.correlationId,
        safeContext: { hostingClass: policy.hostingClass, dataClass: effectiveClass },
      });
    }
  }

  if (
    !policy.allowedDataClasses.includes(effectiveClass) &&
    policy.hostingClass !== "DETERMINISTIC_MOCK"
  ) {
    throw new HiveError({
      code: "MODEL_DATA_CLASS_DENIED",
      category: "POLICY_ERROR",
      message: "Model policy does not permit this data class.",
      retryable: false,
      severity: "FATAL",
      correlationId: input.correlationId,
    });
  }
}
