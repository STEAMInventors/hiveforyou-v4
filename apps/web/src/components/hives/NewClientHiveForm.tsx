"use client";

import { HIVE_DESCRIPTION_MAX_LENGTH, HIVE_NAME_MAX_LENGTH } from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { PRIMARY_BUTTON_CLASS, QUIET_LINK_CLASS } from "@/components/button-classes";
import { createHive, HiveClientError } from "@/lib/hives-client";
import { MY_HIVES_PATH, hiveDocumentsPath } from "@/lib/hive-routes";

export function NewClientHiveForm() {
  const router = useRouter();
  const nameId = useId();
  const aboutId = useId();
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    setFormError(null);
    try {
      const response = await createHive({
        name: name.trim(),
        description: about.trim() ? about.trim() : null,
        clientRequestId: crypto.randomUUID(),
        kind: "client",
      });
      router.push(hiveDocumentsPath(response.hive.id));
    } catch (error) {
      setFormError(
        error instanceof HiveClientError ? error.message : "Could not create this hive. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-5 px-5 pb-16 pt-[clamp(32px,8vh,80px)]">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="m-0 font-brand text-[34px] font-semibold leading-tight text-ink">
          Who is the client?
        </h1>
        <p className="m-0 text-[16px] text-graphite">
          Their hive holds everything for this one matter.
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

      {formError ? (
        <p className="m-0 text-[14px] text-coral-deep" role="alert">
          {formError}
        </p>
      ) : null}

      <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={busy} onClick={() => void submit()}>
        {busy ? "Creating…" : "Create hive and add documents"}
      </button>
      <Link href={MY_HIVES_PATH} className={`${QUIET_LINK_CLASS} self-center`}>
        Cancel
      </Link>
    </div>
  );
}