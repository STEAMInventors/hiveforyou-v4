"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useCallback, useRef, useState } from "react";

import type { HiveComposerProps } from "@/components/HiveComposer";
import { clearGuestDraft, type GuestDraft } from "@/lib/guest-draft";
import { createHive } from "@/lib/hives-client";
import { createIntentRequest } from "@/lib/source-documents-client";

import type { CreateHiveModalProps } from "./CreateHiveModal";
import {
  runCreateHiveFlow,
  validateComposerDraft,
  type CreateHiveFailure,
  type CreateHiveProgress,
} from "./create-hive-flow";
import {
  MAX_FILES_PER_BATCH,
  toSelectedSourceFiles,
  uploadSelectedSourceFiles,
  type SelectedSourceFile,
} from "./source-file-upload";

const EMPTY_PROGRESS: CreateHiveProgress = { hive: null, intentSaved: false };

/** Intent + attachments state and D-026 validation shared by every Hive composer. */
export function useHiveComposer(onValidSubmit: (draft: GuestDraft) => void | Promise<void>) {
  const [intentText, setIntentText] = useState("");
  const [files, setFiles] = useState<SelectedSourceFile[]>([]);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [failure, setFailure] = useState<CreateHiveFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback((draft: GuestDraft) => {
    setIntentText(draft.intentText);
    setFiles(toSelectedSourceFiles(draft.files).slice(0, MAX_FILES_PER_BATCH));
  }, []);

  const reset = useCallback(() => {
    setIntentText("");
    setFiles([]);
    setIntentError(null);
    setFilesError(null);
    setFailure(null);
  }, []);

  const clearErrors = useCallback(() => {
    setIntentError(null);
    setFilesError(null);
    setFailure(null);
  }, []);

  const submit = useCallback(async () => {
    const validation = validateComposerDraft({ intentText, files });
    setIntentError(validation.intentError);
    setFilesError(validation.filesError);
    if (!validation.ok) {
      return;
    }
    setFailure(null);
    setBusy(true);
    try {
      await onValidSubmit({ intentText: intentText.trim(), files: files.map((item) => item.file) });
    } finally {
      setBusy(false);
    }
  }, [files, intentText, onValidSubmit]);

  const composerProps: HiveComposerProps = {
    intentText,
    files,
    intentError,
    filesError,
    failure,
    busy,
    onIntentTextChange: (value) => {
      setIntentText(value);
      setIntentError(null);
      setFailure(null);
    },
    onAddFiles: (picked) => {
      setFiles((current) =>
        [...current, ...toSelectedSourceFiles(picked)].slice(0, MAX_FILES_PER_BATCH),
      );
      setFilesError(null);
      setFailure(null);
    },
    onRemoveFile: (key) => {
      setFiles((current) => current.filter((item) => item.key !== key));
      setFilesError(null);
      setFailure(null);
    },
    onSubmit: () => void submit(),
  };

  return { composerProps, files, setFiles, setFailure, load, reset, clearErrors, busy };
}

export function useCreateHive(onCreated: (hive: Hive) => void) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<CreateHiveProgress>(EMPTY_PROGRESS);
  const progressRef = useRef<CreateHiveProgress>(EMPTY_PROGRESS);
  const hiveRequestIdRef = useRef("");
  const intentRequestIdRef = useRef("");

  const ensureRequestIds = () => {
    if (!hiveRequestIdRef.current) {
      hiveRequestIdRef.current = crypto.randomUUID();
    }
    if (!intentRequestIdRef.current) {
      intentRequestIdRef.current = crypto.randomUUID();
    }
  };

  const updateProgress = (next: CreateHiveProgress) => {
    progressRef.current = next;
    setProgress(next);
  };

  const create = async (draft: GuestDraft) => {
    ensureRequestIds();
    const result = await runCreateHiveFlow(
      {
        createHive,
        createIntentRequest,
        uploadFiles: uploadSelectedSourceFiles,
      },
      {
        progress: progressRef.current,
        intentText: draft.intentText,
        hiveRequestId: hiveRequestIdRef.current,
        intentRequestId: intentRequestIdRef.current,
        files: composer.files,
        onProgress: updateProgress,
        onFileUpdate: (key, patch) =>
          composer.setFiles((current) =>
            current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
          ),
      },
    );
    if (result.ok) {
      finish(result.hive);
      return;
    }
    if (result.failure.errorCode === "IDEMPOTENCY_CONFLICT") {
      if (result.failure.stage === "createHive") {
        hiveRequestIdRef.current = crypto.randomUUID();
      }
      intentRequestIdRef.current = crypto.randomUUID();
    }
    composer.setFailure(result.failure);
  };

  const composer = useHiveComposer(create);
  const { load, reset: resetComposer, clearErrors } = composer;

  const reset = useCallback(() => {
    resetComposer();
    progressRef.current = EMPTY_PROGRESS;
    setProgress(EMPTY_PROGRESS);
    hiveRequestIdRef.current = "";
    intentRequestIdRef.current = "";
  }, [resetComposer]);

  const finish = (hive: Hive) => {
    setOpen(false);
    reset();
    void clearGuestDraft();
    onCreated(hive);
  };

  const openModal = useCallback(
    (draft?: GuestDraft) => {
      if (draft) {
        load(draft);
      }
      clearErrors();
      setOpen(true);
    },
    [clearErrors, load],
  );

  const closeModal = () => {
    if (composer.busy) {
      return;
    }
    if (progress.hive) {
      finish(progress.hive);
      return;
    }
    setOpen(false);
    reset();
  };

  const composerProps: HiveComposerProps = {
    ...composer.composerProps,
    intentLocked: progress.intentSaved,
    onIntentTextChange: (value) => {
      if (progress.intentSaved) {
        return;
      }
      intentRequestIdRef.current = "";
      composer.composerProps.onIntentTextChange(value);
    },
  };

  const modalProps: CreateHiveModalProps = {
    open,
    busy: composer.busy,
    hiveCreated: progress.hive !== null,
    onClose: closeModal,
    composerProps,
  };

  return { openModal, submitBusy: composer.busy, composerProps, modalProps };
}
