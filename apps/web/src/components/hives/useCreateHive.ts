"use client";

import { validateCreateHiveInput, type Hive } from "@hiveforyou/contracts";
import { useCallback, useRef, useState } from "react";

import { HiveClientError, createHive } from "@/lib/hives-client";

import type { CreateHiveModalProps } from "./CreateHiveModal";

const CREATE_FALLBACK_MESSAGE = "Could not create your Hive. Please try again.";

export function useCreateHive(onCreated: (hive: Hive) => void) {
  const [open, setOpen] = useState(false);
  const [hiveName, setHiveName] = useState("");
  const [hiveDescription, setHiveDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const clientRequestIdRef = useRef<string>("");

  const resetForm = useCallback(() => {
    setHiveName("");
    setHiveDescription("");
    setNameError(null);
    setDescriptionError(null);
    setSubmitError(null);
    clientRequestIdRef.current = "";
  }, []);

  const openModal = useCallback(() => {
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current = crypto.randomUUID();
    }
    setNameError(null);
    setDescriptionError(null);
    setSubmitError(null);
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (submitBusy) {
      return;
    }
    setOpen(false);
    resetForm();
  }, [resetForm, submitBusy]);

  const submit = useCallback(async () => {
    const validated = validateCreateHiveInput({
      name: hiveName,
      description: hiveDescription,
      clientRequestId: clientRequestIdRef.current,
    });

    if (!validated.ok) {
      setNameError(validated.nameError ?? null);
      setDescriptionError(validated.descriptionError ?? null);
      if (!validated.nameError && !validated.descriptionError) {
        setSubmitError(validated.message);
      }
      return;
    }

    setNameError(null);
    setDescriptionError(null);
    setSubmitError(null);
    setSubmitBusy(true);

    try {
      const response = await createHive({
        name: validated.value.name,
        description: validated.value.description,
        clientRequestId: validated.value.clientRequestId,
      });
      setOpen(false);
      resetForm();
      onCreated(response.hive);
    } catch (error) {
      if (
        error instanceof HiveClientError &&
        error.errorCode === "IDEMPOTENCY_CONFLICT"
      ) {
        clientRequestIdRef.current = crypto.randomUUID();
      }
      setSubmitError(
        error instanceof HiveClientError ? error.message : CREATE_FALLBACK_MESSAGE,
      );
    } finally {
      setSubmitBusy(false);
    }
  }, [hiveDescription, hiveName, onCreated, resetForm]);

  const modalProps: CreateHiveModalProps = {
    open,
    hiveName,
    hiveDescription,
    nameError,
    descriptionError,
    submitError,
    submitBusy,
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
    onCancel: closeModal,
    onSubmit: () => void submit(),
  };

  return { openModal, submitBusy, modalProps };
}
