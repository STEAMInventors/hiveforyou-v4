import {
  ASSISTANT_REPLY_PROMPT_ID,
  ASSISTANT_REPLY_PROMPT_VERSION,
  CHECKLIST_TAILOR_PROMPT_ID,
  CHECKLIST_TAILOR_PROMPT_VERSION,
  type AuxiliaryPlannerTask,
} from "@hiveforyou/contracts";

export const CHECKLIST_TAILOR_TIMEOUT_MS = 15_000;
export const ASSISTANT_REPLY_TIMEOUT_MS = 45_000;

export type RegistryTask = AuxiliaryPlannerTask;

export type ModelRegistryEntry = {
  readonly task: RegistryTask;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly timeoutMs: number;
};

export const MODEL_REGISTRY: Record<RegistryTask, ModelRegistryEntry> = {
  checklist_tailor: {
    task: "checklist_tailor",
    promptId: CHECKLIST_TAILOR_PROMPT_ID,
    promptVersion: CHECKLIST_TAILOR_PROMPT_VERSION,
    timeoutMs: CHECKLIST_TAILOR_TIMEOUT_MS,
  },
  assistant_reply: {
    task: "assistant_reply",
    promptId: ASSISTANT_REPLY_PROMPT_ID,
    promptVersion: ASSISTANT_REPLY_PROMPT_VERSION,
    timeoutMs: ASSISTANT_REPLY_TIMEOUT_MS,
  },
};