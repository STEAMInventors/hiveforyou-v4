import {
  HIVE_NAME_MAX_LENGTH,
  INTENT_TEXT_MAX_LENGTH,
  type CreateHiveRequest,
  type CreateHiveResponse,
  type CreateIntentRequestRequest,
  type CreateIntentRequestResponse,
  type Hive,
} from "@hiveforyou/contracts";

import type { SelectedSourceFile, SourceFileState } from "./source-file-upload";

const PROVISIONAL_NAME_TARGET_LENGTH = 60;
const MIN_SENTENCE_LENGTH = 12;
const FALLBACK_HIVE_NAME = "New Hive";
const TRAILING_PUNCTUATION = /[\s.,;:!?…\-–—]+$/u;

/**
 * A short, editable label taken verbatim from the owner's own words. Never
 * paraphrases the intent or draws on document contents.
 */
export function provisionalHiveName(intentText: string): string {
  const collapsed = intentText.replace(/\s+/g, " ").trim();
  const firstSentence = collapsed.split(/(?<=[.!?])\s/u)[0] ?? collapsed;
  const source = firstSentence.length >= MIN_SENTENCE_LENGTH ? firstSentence : collapsed;
  let name = source.replace(TRAILING_PUNCTUATION, "");

  const characters = Array.from(name);
  if (characters.length > PROVISIONAL_NAME_TARGET_LENGTH) {
    const head = characters.slice(0, PROVISIONAL_NAME_TARGET_LENGTH + 1).join("");
    const lastSpace = head.lastIndexOf(" ");
    const cut =
      lastSpace >= MIN_SENTENCE_LENGTH
        ? head.slice(0, lastSpace)
        : characters.slice(0, PROVISIONAL_NAME_TARGET_LENGTH).join("");
    name = `${cut.replace(TRAILING_PUNCTUATION, "")}…`;
  }

  if (!name || name === "…") {
    return FALLBACK_HIVE_NAME;
  }
  const [first = "", ...rest] = Array.from(name);
  return fitHiveNameLength(`${first.toLocaleUpperCase()}${rest.join("")}`);
}

/** The server limit counts UTF-16 code units; trim whole characters to stay inside it. */
function fitHiveNameLength(name: string): string {
  if (name.length <= HIVE_NAME_MAX_LENGTH) {
    return name;
  }
  const characters = Array.from(name.replace(/…$/u, ""));
  while (characters.length > 0 && characters.join("").length + 1 > HIVE_NAME_MAX_LENGTH) {
    characters.pop();
  }
  return `${characters.join("")}…`;
}

export type ComposerDraftValidation = {
  ok: boolean;
  intentError: string | null;
  filesError: string | null;
};

export function validateComposerDraft(input: {
  intentText: string;
  files: readonly Pick<SelectedSourceFile, "state">[];
}): ComposerDraftValidation {
  const intent = input.intentText.trim();
  const intentError = !intent
    ? "Describe what you're trying to get done."
    : intent.length > INTENT_TEXT_MAX_LENGTH
      ? `Keep this to ${INTENT_TEXT_MAX_LENGTH} characters or fewer.`
      : null;
  const filesError =
    input.files.length === 0
      ? "Add at least one document — PDF, PNG, JPG or DOCX, up to 25 MB each."
      : input.files.some((item) => item.state === "invalid")
        ? "Remove the files that aren't supported."
        : null;
  return { ok: !intentError && !filesError, intentError, filesError };
}

export type CreateHiveStage = "createHive" | "saveIntent" | "uploadDocuments";

export type CreateHiveFailure = {
  stage: CreateHiveStage;
  headline: string;
  message: string;
  errorCode: string | null;
  correlationId: string | null;
  retryable: boolean;
};

export type CreateHiveProgress = {
  hive: Hive | null;
  intentSaved: boolean;
};

export type CreateHiveFlowDeps = {
  createHive: (payload: CreateHiveRequest) => Promise<CreateHiveResponse>;
  createIntentRequest: (
    hiveId: string,
    payload: CreateIntentRequestRequest,
  ) => Promise<CreateIntentRequestResponse>;
  uploadFiles: (
    hiveId: string,
    files: SelectedSourceFile[],
    onUpdate: (key: string, patch: Partial<SelectedSourceFile>) => void,
  ) => Promise<{ allSettled: boolean }>;
};

export type CreateHiveFlowInput = {
  progress: CreateHiveProgress;
  intentText: string;
  hiveRequestId: string;
  intentRequestId: string;
  files: SelectedSourceFile[];
  onProgress: (progress: CreateHiveProgress) => void;
  onFileUpdate: (key: string, patch: Partial<SelectedSourceFile>) => void;
};

export type CreateHiveFlowResult =
  | { ok: true; hive: Hive }
  | { ok: false; failure: CreateHiveFailure; progress: CreateHiveProgress };

const STAGE_HEADLINES: Record<CreateHiveStage, string> = {
  createHive: "Your Hive wasn't created.",
  saveIntent: "Your Hive was created, but what you need wasn't saved.",
  uploadDocuments: "Your Hive was created, but your documents didn't all upload.",
};

const STAGE_FALLBACK_MESSAGES: Record<CreateHiveStage, string> = {
  createHive: "Could not create your Hive. Please try again.",
  saveIntent: "Could not save what you need. Please try again.",
  uploadDocuments: "Something went wrong with your documents. Please try again.",
};

type ErrorLike = {
  message?: unknown;
  errorCode?: unknown;
  correlationId?: unknown;
  retryable?: unknown;
};

function toFailure(stage: CreateHiveStage, error: unknown): CreateHiveFailure {
  const record = (error && typeof error === "object" ? error : {}) as ErrorLike;
  const isClientError = typeof record.errorCode === "string";
  return {
    stage,
    headline: STAGE_HEADLINES[stage],
    message:
      isClientError && typeof record.message === "string" && record.message
        ? record.message
        : STAGE_FALLBACK_MESSAGES[stage],
    errorCode: isClientError ? (record.errorCode as string) : null,
    correlationId:
      typeof record.correlationId === "string" && record.correlationId
        ? record.correlationId
        : null,
    retryable: typeof record.retryable === "boolean" ? record.retryable : true,
  };
}

/**
 * Creates the Hive, records the owner's intent, then uploads documents. Each
 * stage is skipped on retry once it has succeeded, and every request carries a
 * stable client request ID so replays are idempotent.
 */
export async function runCreateHiveFlow(
  deps: CreateHiveFlowDeps,
  input: CreateHiveFlowInput,
): Promise<CreateHiveFlowResult> {
  let progress = { ...input.progress };
  const intentText = input.intentText.trim();

  if (!progress.hive) {
    try {
      const response = await deps.createHive({
        name: provisionalHiveName(intentText),
        clientRequestId: input.hiveRequestId,
      });
      progress = { ...progress, hive: response.hive };
      input.onProgress(progress);
    } catch (error) {
      return { ok: false, failure: toFailure("createHive", error), progress };
    }
  }
  const hive = progress.hive as Hive;

  if (!progress.intentSaved) {
    try {
      await deps.createIntentRequest(hive.id, {
        intentText,
        clientRequestId: input.intentRequestId,
      });
      progress = { ...progress, intentSaved: true };
      input.onProgress(progress);
    } catch (error) {
      return { ok: false, failure: toFailure("saveIntent", error), progress };
    }
  }

  const states = new Map<string, SourceFileState>(
    input.files.map((item) => [item.key, item.state]),
  );
  const lastFileIssue: { message: string | null; correlationId: string | null } = {
    message: null,
    correlationId: null,
  };
  const onUpdate = (key: string, patch: Partial<SelectedSourceFile>) => {
    if (patch.state) {
      states.set(key, patch.state);
    }
    if (patch.state === "failed" || patch.state === "rejected") {
      lastFileIssue.message = patch.message ?? lastFileIssue.message;
      lastFileIssue.correlationId = patch.correlationId ?? lastFileIssue.correlationId;
    }
    input.onFileUpdate(key, patch);
  };

  let allSettled: boolean;
  try {
    ({ allSettled } = await deps.uploadFiles(hive.id, input.files, onUpdate));
  } catch (error) {
    return { ok: false, failure: toFailure("uploadDocuments", error), progress };
  }

  const registered = Array.from(states.values()).filter((state) => state === "registered").length;
  if (allSettled && registered > 0) {
    return { ok: true, hive };
  }
  return {
    ok: false,
    progress,
    failure: {
      stage: "uploadDocuments",
      headline: STAGE_HEADLINES.uploadDocuments,
      message: allSettled
        ? "None of your documents were accepted. Add another document to continue."
        : (lastFileIssue.message ?? "Some documents didn't upload. Try again."),
      errorCode: null,
      correlationId: lastFileIssue.correlationId,
      retryable: !allSettled,
    },
  };
}
