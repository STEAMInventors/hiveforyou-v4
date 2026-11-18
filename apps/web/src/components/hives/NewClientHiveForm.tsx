"use client";

import {
  HIVE_DESCRIPTION_MAX_LENGTH,
  HIVE_NAME_MAX_LENGTH,
  SOMETHING_ELSE_PACK_ID,
  type NewClientChecklistRow,
  type NewClientChecklistSelection,
  type NewClientPackOption,
  buildNewClientChecklistRows,
  clientFirstName,
  initialChecklistSelection,
  invitePrimaryLabel,
  mergePackChangeKeepingCustom,
  selectedChecklistCount,
  tryAddCustomChecklistItem,
  validateNewClientForm,
} from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { WORKSPACE_PRIMARY, WORKSPACE_SECONDARY } from "@/components/button-classes";
import { Card } from "@/components/workspace/Card";
import { CORRELATION_HEADER_NAME } from "@/lib/hives-client";
import { MY_HIVES_PATH, hiveBoardPath, hiveDocumentsPath } from "@/lib/hive-routes";

type PackCatalogEntry = NewClientPackOption & {
  rows: NewClientChecklistRow[];
};

const SOMETHING_ELSE_LABEL = "Something else (no checklist)";

type PartialFailure = {
  hiveId: string;
  hiveName: string;
  failedStep: "checklist" | "invitation";
  message: string;
  reference: string | null;
};

export function NewClientHiveForm({
  packCatalog,
  initialName,
}: {
  packCatalog: PackCatalogEntry[];
  initialName?: string;
}) {
  const router = useRouter();
  const nameId = useId();
  const emailId = useId();
  const noteId = useId();
  const matterId = useId();
  const addItemId = useId();

  const defaultPackId = packCatalog[0]?.id ?? SOMETHING_ELSE_PACK_ID;

  const [name, setName] = useState(initialName?.trim() ?? "");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [packId, setPackId] = useState(defaultPackId);
  const [selection, setSelection] = useState<NewClientChecklistSelection[]>(() => {
    const first = packCatalog[0];
    return first ? initialChecklistSelection(first.rows) : [];
  });
  const [addTitle, setAddTitle] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [partial, setPartial] = useState<PartialFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyRef = useRef<string>(crypto.randomUUID());
  const lastModeRef = useRef<"invite" | "documents">("invite");

  const packRows = useMemo(() => {
    const entry = packCatalog.find((row) => row.id === packId);
    return entry?.rows ?? [];
  }, [packCatalog, packId]);

  const clientRows = packRows.filter((row) => row.group === "client");
  const otherRows = packRows.filter((row) => row.group === "other");
  const customRows = selection.filter((row) => row.custom);
  const showChecklist = packId !== SOMETHING_ELSE_PACK_ID;
  const tickedCount = selectedChecklistCount(selection);
  const clientGreeting = clientFirstName(name) ?? "your client";

  useEffect(() => {
    if (!initialName?.trim()) return;
    setName(initialName.trim());
  }, [initialName]);

  const onPackChange = useCallback(
    (nextPackId: string) => {
      setPackId(nextPackId);
      setChecklistError(null);
      if (nextPackId === SOMETHING_ELSE_PACK_ID) {
        setSelection((current) => current.filter((row) => row.custom));
        return;
      }
      const entry = packCatalog.find((row) => row.id === nextPackId);
      if (!entry) return;
      setSelection((current) => mergePackChangeKeepingCustom(entry.rows, current));
    },
    [packCatalog],
  );

  const toggleItem = (key: string) => {
    setSelection((current) => current.map((row) => (row.key === key ? { ...row, ticked: !row.ticked } : row)));
    setChecklistError(null);
  };

  const submitAddItem = () => {
    const result = tryAddCustomChecklistItem(addTitle, selection);
    if (!result.ok) {
      const messages = {
        empty: "Enter a short name for the item.",
        too_long: `Keep it to ${120} characters or fewer.`,
        duplicate: "That item is already on the list.",
        cap: "You can add up to 40 items.",
      };
      setAddError(messages[result.reason]);
      return;
    }
    setAddError(null);
    setAddTitle("");
    setSelection((current) => [
      ...current,
      { key: result.key, title: result.title, ticked: true, custom: true },
    ]);
  };

  const runSubmit = async (mode: "invite" | "documents") => {
    const validation = validateNewClientForm({
      name,
      email,
      mode,
      packId: showChecklist ? packId : null,
      selection,
    });
    setNameError(validation.nameError);
    setEmailError(validation.emailError);
    setChecklistError(validation.checklistError);
    if (validation.nameError || validation.emailError || validation.checklistError) return;

    lastModeRef.current = mode;
    setBusy(true);
    setPartial(null);
    const ticked = selection.filter((row) => row.ticked);
    const body = {
      name: name.trim(),
      email: mode === "invite" ? email.trim().toLowerCase() : undefined,
      note: note.trim() || undefined,
      packId: showChecklist ? packId : null,
      items: ticked.map((row) => ({ key: row.key, title: row.title, custom: row.custom })),
      mode,
    };

    try {
      const response = await fetch("/api/v1/hives/new-client", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyRef.current,
          [CORRELATION_HEADER_NAME]: crypto.randomUUID(),
        },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && payload && typeof payload === "object" && (payload as { ok?: unknown }).ok === true) {
        const hiveId = String((payload as { hiveId: string }).hiveId);
        router.push(mode === "invite" ? hiveBoardPath(hiveId) : hiveDocumentsPath(hiveId));
        return;
      }
      const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
      const hiveId = typeof record?.hiveId === "string" ? record.hiveId : "";
      const failedStep = record?.failedStep === "checklist" || record?.failedStep === "invitation" ? record.failedStep : null;
      const error = record?.error && typeof record.error === "object" ? (record.error as { message?: string; correlationId?: string }) : null;
      if (hiveId && failedStep) {
        setPartial({
          hiveId,
          hiveName: name.trim(),
          failedStep,
          message: error?.message ?? "Something went wrong.",
          reference: error?.correlationId ? error.correlationId.slice(0, 8) : null,
        });
        return;
      }
      const message =
        error?.message ??
        (record && typeof record.message === "string" ? record.message : "Could not create this hive. Try again.");
      if (validation.nameError === null) {
        setNameError(message);
      }
    } catch {
      setNameError("Couldn't reach HiveForYou. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const partialLine =
    partial?.failedStep === "checklist"
      ? `${partial.hiveName}'s hive is created, but the checklist didn't save.`
      : partial
        ? `${partial.hiveName}'s hive is created, but the invitation didn't send.`
        : null;

  const renderRow = (row: NewClientChecklistSelection, sourceLabel: string | null) => {
    const checked = row.ticked;
    return (
      <label
        key={row.key}
        className="flex cursor-pointer items-start gap-3 rounded-control border border-transparent py-2 hover:bg-mist/60"
      >
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-cell-blue-deep"
          checked={checked}
          onChange={() => toggleItem(row.key)}
          disabled={busy}
        />
        <span className="min-w-0 flex-1 text-small text-ink">
          {row.title}
          {sourceLabel ? <span className="text-graphite"> · {sourceLabel}</span> : null}
        </span>
      </label>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 bg-canvas px-5 pb-16 pt-[clamp(32px,8vh,80px)]">
      <Link
        href={MY_HIVES_PATH}
        className="inline-flex min-h-11 items-center self-start text-small font-medium text-cell-blue-deep no-underline hover:underline"
      >
        ← All clients
      </Link>

      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-brand text-[34px] font-semibold leading-tight text-ink">New client</h1>
        <p className="m-0 text-[16px] text-graphite">Their hive holds everything for this one matter.</p>
      </div>

      <Card title="Client">
        <div className="flex flex-col gap-4 min-[600px]:grid min-[600px]:grid-cols-2">
          <label htmlFor={nameId} className="flex flex-col gap-1.5 text-small font-medium text-ink">
            Client&apos;s name
            <input
              id={nameId}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
              autoComplete="off"
              maxLength={HIVE_NAME_MAX_LENGTH}
              className="min-h-12 rounded-control border border-line-strong px-3.5 text-[16px] font-normal text-ink"
            />
            {nameError ? (
              <span className="text-small text-coral-deep" role="alert">
                {nameError}
              </span>
            ) : null}
          </label>

          <label htmlFor={emailId} className="flex flex-col gap-1.5 text-small font-medium text-ink">
            Client&apos;s email
            <span className="text-caption font-normal text-quiet">· needed only to invite them</span>
            <input
              id={emailId}
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(null);
              }}
              autoComplete="email"
              className="min-h-12 rounded-control border border-line-strong px-3.5 text-[16px] font-normal text-ink"
            />
            {emailError ? (
              <span className="text-small text-coral-deep" role="alert">
                {emailError}
              </span>
            ) : null}
          </label>
        </div>

        <label htmlFor={matterId} className="mt-4 flex flex-col gap-1.5 text-small font-medium text-ink">
          Matter type
          <select
            id={matterId}
            value={packId}
            onChange={(event) => onPackChange(event.target.value)}
            className="min-h-12 rounded-control border border-line-strong bg-paper px-3.5 text-[16px] font-normal text-ink"
          >
            {packCatalog.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.title}
              </option>
            ))}
            <option value={SOMETHING_ELSE_PACK_ID}>{SOMETHING_ELSE_LABEL}</option>
          </select>
        </label>

        <label htmlFor={noteId} className="mt-4 flex flex-col gap-1.5 text-small font-medium text-ink">
          Note
          <span className="text-caption font-normal text-quiet">· optional, for your team</span>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={HIVE_DESCRIPTION_MAX_LENGTH}
            rows={3}
            className="rounded-control border border-line-strong px-3.5 py-2.5 text-[16px] font-normal text-ink"
          />
        </label>
      </Card>

      {showChecklist ? (
        <Card
          title="Starting checklist"
          headerRight={<span className="text-caption text-graphite">{tickedCount} items selected</span>}
        >
          <p className="m-0 mb-3 text-small text-graphite">
            What {clientGreeting} will be asked for. Untick anything you already have; you can add or remove items later.
          </p>
          <div className="flex flex-col gap-1">
            {clientRows.map((row) => {
              const selected = selection.find((item) => item.key === row.key);
              if (!selected) return null;
              return renderRow(selected, null);
            })}
            {customRows.map((row) => renderRow(row, null))}
          </div>
          {otherRows.length > 0 ? (
            <>
              <p className="m-0 mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-quiet">
                Usually from someone else
              </p>
              <div className="flex flex-col gap-1">
                {otherRows.map((row) => {
                  const selected = selection.find((item) => item.key === row.key);
                  if (!selected) return null;
                  return renderRow(selected, row.sourceLabel);
                })}
              </div>
            </>
          ) : null}
          {checklistError ? (
            <p className="m-0 mt-2 text-small text-coral-deep" role="alert">
              {checklistError}
            </p>
          ) : null}
          <div className="mt-4 flex flex-col gap-2 min-[600px]:flex-row min-[600px]:items-end">
            <label htmlFor={addItemId} className="flex flex-1 flex-col gap-1.5 text-small font-medium text-ink">
              Add an item
              <input
                id={addItemId}
                value={addTitle}
                onChange={(event) => {
                  setAddTitle(event.target.value);
                  setAddError(null);
                }}
                maxLength={120}
                className="min-h-11 rounded-control border border-line-strong px-3.5 text-[16px] font-normal text-ink"
              />
            </label>
            <button type="button" className={WORKSPACE_SECONDARY} disabled={busy} onClick={submitAddItem}>
              Add
            </button>
          </div>
          {addError ? (
            <p className="m-0 text-small text-coral-deep" role="alert">
              {addError}
            </p>
          ) : null}
        </Card>
      ) : null}

      {partial ? (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-paper px-[18px] py-4">
          <p className="m-0 text-small text-ink" role="alert">
            {partialLine}
          </p>
          {partial.reference ? (
            <p className="m-0 font-mono text-caption text-quiet">Error code: {partial.reference}</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={WORKSPACE_SECONDARY}
              disabled={busy}
              onClick={() => void runSubmit(lastModeRef.current)}
            >
              Try again
            </button>
            <Link href={hiveBoardPath(partial.hiveId)} className={`${WORKSPACE_SECONDARY} no-underline`}>
              Open {clientFirstName(partial.hiveName) ?? partial.hiveName}&apos;s hive
            </Link>
          </div>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <button
          type="button"
          className={WORKSPACE_PRIMARY}
          disabled={busy}
          onClick={() => void runSubmit("invite")}
        >
          {busy ? "Sending…" : invitePrimaryLabel(name)}
        </button>
        <button
          type="button"
          className={WORKSPACE_SECONDARY}
          disabled={busy}
          onClick={() => void runSubmit("documents")}
        >
          {busy ? "Creating…" : "I have their documents"}
        </button>
        <Link href={MY_HIVES_PATH} className="self-center text-small font-medium text-graphite">
          Cancel
        </Link>
      </section>

      <p className="m-0 text-center text-caption leading-snug text-quiet">
        The invitation emails {clientGreeting} a sign-in code (no password) and the checklist count. Nothing from the
        documents is ever in an email.
      </p>
    </div>
  );
}