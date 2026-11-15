"use client";

import { HIVE_DESCRIPTION_MAX_LENGTH, HIVE_NAME_MAX_LENGTH } from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { PRIMARY_BUTTON_CLASS, QUIET_LINK_CLASS } from "@/components/button-classes";
import { DocumentDropZone } from "@/components/hives/DocumentDropZone";
import { SelectedFileChips } from "@/components/hives/SourceFilePicker";
import {
  MAX_FILES_PER_BATCH,
  toSelectedSourceFiles,
  uploadSelectedSourceFiles,
  type SelectedSourceFile,
} from "@/components/hives/source-file-upload";
import { createHive, HiveClientError } from "@/lib/hives-client";
import { MY_HIVES_PATH, hiveDocumentsPath } from "@/lib/hive-routes";
import { fetchUploadQuota, startDocumentReads } from "@/lib/source-documents-client";

const DEFAULT_QUOTA_HINT = "PDF, PNG, JPG or DOCX, up to 25 MB each.";

export function NewClientHiveForm() {
  const router = useRouter();
  const nameId = useId();
  const aboutId = useId();
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [files, setFiles] = useState<SelectedSourceFile[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quotaHint, setQuotaHint] = useState(DEFAULT_QUOTA_HINT);

  useEffect(() => {
    void fetchUploadQuota()
      .then((response) => {
        const { remaining, limit } = response.quota;
        if (remaining === 0) {
          setQuotaHint("You've used this month's free uploads. Your allowance resets on the 1st (UTC).");
          return;
        }
        if (remaining === null) {
          setQuotaHint(DEFAULT_QUOTA_HINT);
          return;
        }
        setQuotaHint(`${DEFAULT_QUOTA_HINT} ${remaining} of ${limit} free uploads left this month.`);
      })
      .catch(() => setQuotaHint(DEFAULT_QUOTA_HINT));
  }, []);

  const uploadableCount = useMemo(() => files.filter((item) => item.state === "ready").length, [files]);

  const addFiles = useCallback((picked: File[]) => {
    const next = toSelectedSourceFiles(picked).slice(0, MAX_FILES_PER_BATCH);
    setFiles((current) => {
      const merged = [...current, ...next].slice(0, MAX_FILES_PER_BATCH);
      return merged;
    });
  }, []);

  const removeFile = useCallback((key: string) => {
    setFiles((current) => current.filter((item) => item.key !== key));
  }, []);

  const validate = (): boolean => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Enter the client's name.");
      return false;
    }
    if (trimmed.length > HIVE_NAME_MAX_LENGTH) {
      setNameError(`Hive name must be ${HIVE_NAME_MAX_LENGTH} characters or fewer.`);
      return false;
    }
    if (about.trim().length > HIVE_DESCRIPTION_MAX_LENGTH) {
      setFormError(`Description must be ${HIVE_DESCRIPTION_MAX_LENGTH} characters or fewer.`);
      return false;
    }
    setNameError(null);
    setFormError(null);
    return true;
  };

  const submit = async () => {
    if (!validate()) {
      return;
    }
    const toUpload = files.filter((item) => item.state === "ready");
    if (files.length > 0 && toUpload.length === 0) {
      setFormError("Remove the files that aren't supported.");
      return;
    }

    setBusy(true);
    setFormError(null);
    const hiveRequestId = crypto.randomUUID();

    try {
      const response = await createHive({
        name: name.trim(),
        description: about.trim() ? about.trim() : null,
        clientRequestId: hiveRequestId,
        kind: "client",
      });
      const hiveId = response.hive.id;

      if (toUpload.length > 0) {
        await uploadSelectedSourceFiles(hiveId, toUpload, (key, patch) =>
          setFiles((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item))),
        );
        try {
          await startDocumentReads(hiveId, { clientRequestId: crypto.randomUUID() });
        } catch {
          // Reading can be retried from Documents; the hive and uploads still open.
        }
      }

      router.push(hiveDocumentsPath(hiveId));
    } catch (error) {
      setFormError(
        error instanceof HiveClientError ? error.message : "Could not create this hive. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitLabel =
    uploadableCount > 0
      ? `Create hive and read ${uploadableCount} ${uploadableCount === 1 ? "document" : "documents"}`
      : "Create hive";

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5 px-5 pb-16 pt-[clamp(32px,8vh,80px)]">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="m-0 font-brand text-[34px] font-semibold leading-tight text-ink">New client</h1>
        <p className="m-0 text-[16px] text-graphite">
          Name the client, add what you have, and HiveForYou starts reading.
        </p>
      </div>

      <label htmlFor={nameId} className="flex flex-col gap-1.5 text-[14px] font-medium text-ink">
        Client&apos;s name
        <input
          id={nameId}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          autoComplete="off"
          className="min-h-12 rounded-control border border-line-strong px-3.5 text-[16px] font-normal text-ink"
        />
      </label>
      {nameError ? (
        <p className="m-0 text-[14px] text-coral-deep" role="alert">
          {nameError}
        </p>
      ) : null}

      <label htmlFor={aboutId} className="flex flex-col gap-1.5 text-[14px] font-medium text-ink">
        What is it about?
        <input
          id={aboutId}
          value={about}
          onChange={(event) => setAbout(event.target.value)}
          placeholder="A few words, for example a benefits application"
          autoComplete="off"
          className="min-h-12 rounded-control border border-line-strong px-3.5 text-[16px] font-normal text-ink"
        />
      </label>

      <DocumentDropZone onAdd={addFiles} disabled={busy} quotaText={quotaHint} />
      <SelectedFileChips files={files} onRemove={removeFile} busy={busy} />

      {formError ? (
        <p className="m-0 text-[14px] text-coral-deep" role="alert">
          {formError}
        </p>
      ) : null}

      <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={busy} onClick={() => void submit()}>
        {busy ? "Creating…" : submitLabel}
      </button>
      <Link href={MY_HIVES_PATH} className={`${QUIET_LINK_CLASS} self-center`}>
        Cancel
      </Link>
    </div>
  );
}