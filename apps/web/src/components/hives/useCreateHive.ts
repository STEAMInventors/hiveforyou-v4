"use client";

import {
  validateCreateHiveInput,
  validateCreateIntentRequestInput,
  type Hive,
} from "@hiveforyou/contracts";
import { useCallback, useRef, useState } from "react";

import { clearGuestDraft, type GuestDraft } from "@/lib/guest-draft";
import { HiveClientError, createHive } from "@/lib/hives-client";
import { createIntentRequest } from "@/lib/source-documents-client";

import type { CreateHiveModalProps } from "./CreateHiveModal";
import {
  MAX_FILES_PER_BATCH,
  hasUploadableFiles,
  toSelectedSourceFiles,
  uploadSelectedSourceFiles,
  type SelectedSourceFile,
  type SourceFileState,
} from "./source-file-upload";

const CREATE_FALLBACK_MESSAGE = "Could not create your Hive. Please try again.";

export function useCreateHive(onCreated: (hive: Hive) => void) {
  const [open, setOpen] = useState(false);
  const [hiveName, setHiveName] = useState("");
  const [hiveDescription, setHiveDescription] = useState("");
  const [intentText, setIntentText] = useState("");
  const [files, setFiles] = useState<SelectedSourceFile[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [createdHive, setCreatedHive] = useState<Hive | null>(null);
  const clientRequestIdRef = useRef<string>("");
  const intentRequestIdRef = useRef<string>("");

  const resetForm = useCallback(() => {
    setHiveName("");
    setHiveDescription("");
    setIntentText("");
    setFiles([]);
    setNameError(null);
    setDescriptionError(null);
    setIntentError(null);
    setFilesError(null);
    setSubmitError(null);
    setCreatedHive(null);
    clientRequestIdRef.current = "";
    intentRequestIdRef.current = "";
  }, []);

  const openModal = useCallback((draft?: GuestDraft) => {
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current = crypto.randomUUID();
      intentRequestIdRef.current = crypto.randomUUID();
    }
    if (draft) {
      setIntentText(draft.intentText);
      setFiles(toSelectedSourceFiles(draft.files).slice(0, MAX_FILES_PER_BATCH));
    }
    setNameError(null);
    setDescriptionError(null);
    setIntentError(null);
    setFilesError(null);
    setSubmitError(null);
    setOpen(true);
  }, []);

  const finish = useCallback(
    (hive: Hive) => {
      setOpen(false);
      resetForm();
      void clearGuestDraft();
      onCreated(hive);
    },
    [onCreated, resetForm],
  );

  const closeModal = useCallback(() => {
    if (submitBusy) {
      return;
    }
    if (createdHive) {
      finish(createdHive);
      return;
    }
    setOpen(false);
    resetForm();
  }, [createdHive, finish, resetForm, submitBusy]);

  const submit = useCallback(async () => {
    const validated = validateCreateHiveInput({
      name: hiveName,
      description: hiveDescription,
      clientRequestId: clientRequestIdRef.current,
    });
    const intent = validateCreateIntentRequestInput({
      intentText,
      clientRequestId: intentRequestIdRef.current,
    });
    const filesOk = hasUploadableFiles(files);

    setNameError(validated.ok ? null : (validated.nameError ?? null));
    setDescriptionError(validated.ok ? null : (validated.descriptionError ?? null));
    setIntentError(intent.ok ? null : intent.message);
    setFilesError(
      filesOk
        ? null
        : files.length === 0
          ? "Add at least one document."
          : "Remove the files that aren't supported.",
    );
    if (!validated.ok || !intent.ok || !filesOk) {
      if (!validated.ok && !validated.nameError && !validated.descriptionError) {
        setSubmitError(validated.message);
      }
      return;
    }

    setSubmitError(null);
    setSubmitBusy(true);

    const states = new Map<string, SourceFileState>(files.map((item) => [item.key, item.state]));
    const updateFile = (key: string, patch: Partial<SelectedSourceFile>) => {
      if (patch.state) {
        states.set(key, patch.state);
      }
      setFiles((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    };

    try {
      let hive = createdHive;
      if (!hive) {
        const response = await createHive({
          name: validated.value.name,
          description: validated.value.description,
          clientRequestId: validated.value.clientRequestId,
        });
        hive = response.hive;
        setCreatedHive(hive);
      }
      await createIntentRequest(hive.id, intent.value);

      const { allSettled } = await uploadSelectedSourceFiles(hive.id, files, updateFile);
      const registered = Array.from(states.values()).filter((state) => state === "registered").length;

      if (allSettled && registered > 0) {
        finish(hive);
        return;
      }
      setSubmitError(
        allSettled
          ? "None of your documents were accepted. Add another document to continue."
          : "Some documents didn't upload. Try again, or open your Hive and add them later.",
      );
    } catch (error) {
      if (error instanceof HiveClientError && error.errorCode === "IDEMPOTENCY_CONFLICT") {
        clientRequestIdRef.current = crypto.randomUUID();
        intentRequestIdRef.current = crypto.randomUUID();
      }
      setSubmitError(
        error instanceof HiveClientError ? error.message : CREATE_FALLBACK_MESSAGE,
      );
    } finally {
      setSubmitBusy(false);
    }
  }, [createdHive, files, finish, hiveDescription, hiveName, intentText]);

  const modalProps: CreateHiveModalProps = {
    open,
    hiveName,
    hiveDescription,
    intentText,
    files,
    nameError,
    descriptionError,
    intentError,
    filesError,
    submitError,
    submitBusy,
    hiveCreated: createdHive !== null,
    onHiveNameChange: (value) => {
      setHiveName(value);
      setNameError(null);
      setSubmitError(null);
    },
    onHiveDescriptionChange: (value) => {
      setHiveDescription(value);
      setDescriptionError(null);
      setSubmitError(null);
    },
    onIntentTextChange: (value) => {
      setIntentText(value);
      setIntentError(null);
      setSubmitError(null);
    },
    onAddFiles: (picked) => {
      setFiles((current) =>
        [...current, ...toSelectedSourceFiles(picked)].slice(0, MAX_FILES_PER_BATCH),
      );
      setFilesError(null);
      setSubmitError(null);
    },
    onRemoveFile: (key) => {
      setFiles((current) => current.filter((item) => item.key !== key));
      setSubmitError(null);
    },
    onCancel: closeModal,
    onSubmit: () => void submit(),
  };

  return { openModal, submitBusy, modalProps };
}
