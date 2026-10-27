"use client";

import {
  HIVE_DESCRIPTION_MAX_LENGTH,
  HIVE_NAME_MAX_LENGTH,
} from "@hiveforyou/contracts";
import { useEffect, useId, useRef } from "react";

export type CreateHiveModalProps = {
  open: boolean;
  hiveName: string;
  hiveDescription: string;
  nameError?: string | null;
  descriptionError?: string | null;
  submitError?: string | null;
  submitBusy?: boolean;
  onHiveNameChange: (value: string) => void;
  onHiveDescriptionChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export function CreateHiveModal({
  open,
  hiveName,
  hiveDescription,
  nameError = null,
  descriptionError = null,
  submitError = null,
  submitBusy = false,
  onHiveNameChange,
  onHiveDescriptionChange,
  onCancel,
  onSubmit,
}: CreateHiveModalProps) {
  const titleId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitBusy) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onCancel, submitBusy]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" data-testid="create-hive-modal">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-dialog form-stack"
      >
        <div>
          <h2
            id={titleId}
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "1.5rem",
              margin: 0,
            }}
          >
            Create a Hive
          </h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            A private workspace for one situation.
          </p>
        </div>

        {submitError ? (
          <p role="alert" className="notice-error">
            {submitError}
          </p>
        ) : null}

        <label className="form-field">
          Hive name
          <input
            ref={nameInputRef}
            type="text"
            className="form-input"
            value={hiveName}
            maxLength={HIVE_NAME_MAX_LENGTH}
            placeholder="e.g. Maya's IEP 2026"
            aria-invalid={nameError ? "true" : undefined}
            onChange={(event) => onHiveNameChange(event.target.value)}
          />
          <span className="field-hint">
            Up to {HIVE_NAME_MAX_LENGTH} characters.
          </span>
        </label>
        {nameError ? (
          <p role="alert" className="notice-error">
            {nameError}
          </p>
        ) : null}

        <label className="form-field">
          <span>
            Description <span className="field-hint">(optional)</span>
          </span>
          <textarea
            className="form-textarea"
            rows={3}
            value={hiveDescription}
            maxLength={HIVE_DESCRIPTION_MAX_LENGTH}
            placeholder="What this Hive is for — optional"
            aria-invalid={descriptionError ? "true" : undefined}
            onChange={(event) => onHiveDescriptionChange(event.target.value)}
          />
          <span className="field-hint">
            Up to {HIVE_DESCRIPTION_MAX_LENGTH} characters.
          </span>
        </label>
        {descriptionError ? (
          <p role="alert" className="notice-error">
            {descriptionError}
          </p>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="button button-secondary"
            disabled={submitBusy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button"
            disabled={submitBusy}
            onClick={onSubmit}
          >
            {submitBusy ? "Creating…" : "Create Hive"}
          </button>
        </div>
      </div>
    </div>
  );
}
