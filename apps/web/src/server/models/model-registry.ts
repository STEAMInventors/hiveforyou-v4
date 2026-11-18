import {
  CHECKLIST_TAILOR_PROMPT_ID,
  CHECKLIST_TAILOR_PROMPT_VERSION,
  type AuxiliaryPlannerTask,
} from "@hiveforyou/contracts";

export const CHECKLIST_TAILOR_TIMEOUT_MS = 15_000;

export type RegistryTask = AuxiliaryPlannerTask;

export type ModelRegistryEntry = {
  readonly task: RegistryTask;
  readonly promptId: typeof CHECKLIST_TAILOR_PROMPT_ID;
  readonly promptVersion: typeof CHECKLIST_TAILOR_PROMPT_VERSION;
  readonly timeoutMs: number;
};

export const MODEL_REGISTRY: Record<RegistryTask, ModelRegistryEntry> = {
  checklist_tailor: {
    task: "checklist_tailor",
    promptId: CHECKLIST_TAILOR_PROMPT_ID,
    promptVersion: CHECKLIST_TAILOR_PROMPT_VERSION,
    timeoutMs: CHECKLIST_TAILOR_TIMEOUT_MS,
  },
};