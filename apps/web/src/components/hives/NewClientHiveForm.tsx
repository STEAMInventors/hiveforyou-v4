"use client";

import {
  type ChecklistTailorResult,
  type ChecklistTailorRowTag,
  HIVE_NAME_MAX_LENGTH,
  MAX_TAILOR_PROFESSIONAL_TEXT,
  SOMETHING_ELSE_PACK_ID,
  type NewClientChecklistRow,
  type NewClientChecklistSelection,
  type NewClientPackOption,
  type TailoredChecklistItem,
  matterTypesForFirm,
  clientFirstName,
  invitePrimaryLabel,
  orderTailoredItems,
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

const TAILOR_BUTTON_EXTRA =
  "self-start bg-cell-blue-wash text-cell-blue-deep hover:border-cell-blue-wash hover:bg-cell-blue-tint";

type PartialFailure = {
  hiveId: string;
  hiveName: string;
  failedStep: "checklist" | "invitation";
  message: string;
  reference: string | null;
};

function dependsReason(appliesWhen: string): string {
  const clause = appliesWhen.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  return `Only if the client ${clause}.`;
}

function defaultItemsFromPackRows(rows: readonly NewClientChecklistRow[]): TailoredChecklistItem[] {
  const items: TailoredChecklistItem[] = rows.map((row) => {
    if (row.appliesWhen) {
      return {
        key: row.key,
        title: row.title,
        ticked: false,
        custom: false,
        tag: "depends",
        reason: dependsReason(row.appliesWhen),
        quote: null,
        sourceLabel: row.sourceLabel,
        group: row.group,
      };
    }
    return {
      key: row.key,
      title: row.title,
      ticked: row.defaultTicked,
      custom: false,
      tag: "plain",
      reason: null,
      quote: null,
      sourceLabel: row.sourceLabel,
      group: row.group,
    };
  });
  return orderTailoredItems(items);
}

function userCustomItems(items: readonly TailoredChecklistItem[]): TailoredChecklistItem[] {
  return items.filter((row) => row.custom && row.tag !== "added");
}

function asChecklistSelection(items: readonly TailoredChecklistItem[]): NewClientChecklistSelection[] {
  return items.map((row) => ({
    key: row.key,
    title: row.title,
    ticked: row.ticked,
    custom: row.custom,
  }));
}

const TAG_PILL: Record<Exclude<ChecklistTailorRowTag, "plain">, { label: string; className: string }> = {
  depends: { label: "Depends", className: "bg-honey-wash text-honey-deep" },
  from_note: { label: "From your note", className: "bg-cell-blue-wash text-cell-blue-deep" },
  left_out: { label: "Left out", className: "bg-mist text-graphite" },
  added: { label: "Added by HiveForYou", className: "bg-leaf-wash text-leaf-deep" },
};

const USER_ADDED_PILL = { label: "Added by you", className: "bg-cell-blue-wash text-cell-blue-deep" };

function PersonPlusIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 11a4 4 0 1 0 0-8 4 4 0 1 0 0 8zM3 21v-1a6 6 0 0 1 9-5.2M19 14v6M16 17h6" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}

export function NewClientHiveForm({
  packCatalog,
  initialName,
  firmPracticeAreas = null,
}: {
  packCatalog: PackCatalogEntry[];
  initialName?: string;
  firmPracticeAreas?: string[] | null;
}) {
  const router = useRouter();
  const nameId = useId();
  const emailId = useId();
  const professionalTextId = useId();
  const matterId = useId();
  const addItemId = useId();

  const checklistPacks = useMemo(
    () => packCatalog.filter((pack) => pack.id !== SOMETHING_ELSE_PACK_ID && pack.rows.length > 0),
    [packCatalog],
  );
  const [showAllMatterTypes, setShowAllMatterTypes] = useState(false);
  const visibleChecklistPacks = useMemo(
    () => matterTypesForFirm(checklistPacks, firmPracticeAreas, showAllMatterTypes),
    [checklistPacks, firmPracticeAreas, showAllMatterTypes],
  );
  const defaultPackId = visibleChecklistPacks[0]?.id ?? packCatalog[0]?.id ?? SOMETHING_ELSE_PACK_ID;
  const canShowAllMatterTypes =
    !showAllMatterTypes &&
    Boolean(firmPracticeAreas?.length) &&
    visibleChecklistPacks.length < checklistPacks.length;

  const [name, setName] = useState(initialName?.trim() ?? "");
  const [email, setEmail] = useState("");
  const [professionalText, setProfessionalText] = useState("");
  const [packId, setPackId] = useState(defaultPackId);
  const [items, setItems] = useState<TailoredChecklistItem[]>(() => {
    const first = packCatalog[0];
    return first ? defaultItemsFromPackRows(first.rows) : [];
  });
  const [tailored, setTailored] = useState(false);
  const [tailorMessage, setTailorMessage] = useState<string | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const [partial, setPartial] = useState<PartialFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyRef = useRef<string>(crypto.randomUUID());
  const lastModeRef = useRef<"invite" | "documents">("invite");

  const packEntry = useMemo(() => packCatalog.find((row) => row.id === packId), [packCatalog, packId]);
  const packTitle = packEntry?.title ?? "";
  const showChecklist = packId !== SOMETHING_ELSE_PACK_ID;
  const selection = useMemo(() => asChecklistSelection(items), [items]);
  const clientGreeting = clientFirstName(name) ?? "your client";
  const clientFirst = clientFirstName(name);
  const listTitle = clientFirst ? `What to ask ${clientFirst} for` : "What to ask your client for";
  const askCount = items.filter((row) => row.ticked).length;
  const leftOutCount = items.filter((row) => !row.ticked && !row.custom && row.tag === "left_out").length;

  const clientItems = useMemo(
    () => orderTailoredItems(items.filter((row) => row.group === "client")),
    [items],
  );
  const otherItems = useMemo(
    () => orderTailoredItems(items.filter((row) => row.group === "other")),
    [items],
  );

  const listSubtitle = tailored
    ? `Tailored by HiveForYou from your note and the ${packTitle} pack. Change anything.`
    : `The ${packTitle} pack\u2019s list. Tell HiveForYou what you know to tailor it.`;

  const tailorButtonLabel = tailoring ? "Tailoring…" : tailored ? "Suggest again" : "Tailor the checklist";
  const suggestAgainTitle = tailored ? "Replaces the suggestions; your added items stay" : undefined;

  useEffect(() => {
    if (!initialName?.trim()) return;
    setName(initialName.trim());
  }, [initialName]);

  const onPackChange = useCallback(
    (nextPackId: string) => {
      setPackId(nextPackId);
      setChecklistError(null);
      setTailored(false);
      setTailorMessage(null);
      setTailorError(null);
      if (nextPackId === SOMETHING_ELSE_PACK_ID) {
        setItems((current) => userCustomItems(current));
        return;
      }
      const entry = packCatalog.find((row) => row.id === nextPackId);
      if (!entry) return;
      setItems((current) => [...defaultItemsFromPackRows(entry.rows), ...userCustomItems(current)]);
    },
    [packCatalog],
  );

  useEffect(() => {
    if (packId === SOMETHING_ELSE_PACK_ID) return;
    if (visibleChecklistPacks.some((pack) => pack.id === packId)) return;
    onPackChange(visibleChecklistPacks[0]?.id ?? SOMETHING_ELSE_PACK_ID);
  }, [packId, visibleChecklistPacks, onPackChange]);

  const toggleItem = (key: string) => {
    setItems((current) => current.map((row) => (row.key === key ? { ...row, ticked: !row.ticked } : row)));
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
    setItems((current) => [
      ...current,
      {
        key: result.key,
        title: result.title,
        ticked: true,
        custom: true,
        tag: "plain",
        reason: null,
        quote: null,
        sourceLabel: null,
        group: "client",
      },
    ]);
  };

  const runTailor = async () => {
    if (!showChecklist || tailoring || busy) return;
    setTailoring(true);
    setTailorError(null);
    try {
      const response = await fetch("/api/v1/hives/new-client/tailor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CORRELATION_HEADER_NAME]: crypto.randomUUID(),
        },
        body: JSON.stringify({
          packId,
          professionalText: professionalText.replace(/\s+/g, " ").trim(),
        }),
        credentials: "same-origin",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== "object") {
        setTailorError("Couldn't tailor right now. Try again.");
        return;
      }
      const result = payload as ChecklistTailorResult;
      const kept = userCustomItems(items);
      setItems(orderTailoredItems([...result.items, ...kept]));
      setTailored(result.tailored || professionalText.trim() !== "");
      setTailorMessage(result.message);
      setChecklistError(null);
    } catch {
      setTailorError("Couldn't reach HiveForYou. Check your connection and try again.");
    } finally {
      setTailoring(false);
    }
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
    const trimmedNote = professionalText.replace(/\s+/g, " ").trim();
    const body = {
      name: name.trim(),
      email: mode === "invite" ? email.trim().toLowerCase() : undefined,
      professionalText: trimmedNote || undefined,
      packId: showChecklist ? packId : null,
      items: ticked.map((row) => ({ title: row.title, custom: row.custom })),
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

  const renderChecklistRow = (row: TailoredChecklistItem) => {
    const pill =
      row.custom && row.tag !== "added"
        ? USER_ADDED_PILL
        : row.tag !== "plain"
          ? TAG_PILL[row.tag]
          : null;
    const showMeta = pill !== null;
    return (
      <label
        key={row.key}
        className="flex cursor-pointer items-start gap-3 border-b border-line py-3 last:border-b-0 hover:bg-mist/40"
      >
        <input
          type="checkbox"
          className="mt-0.5 size-[18px] shrink-0 accent-cell-blue-deep"
          checked={row.ticked}
          onChange={() => toggleItem(row.key)}
          disabled={busy || tailoring}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={`text-small ${row.ticked ? "text-ink" : "text-graphite"}`}>{row.title}</span>
          {showMeta ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center rounded-pill px-[7px] py-px text-[11.5px] font-semibold ${pill.className}`}
              >
                {pill.label}
              </span>
              {row.reason ? <span className="text-caption text-graphite">{row.reason}</span> : null}
            </span>
          ) : null}
        </span>
      </label>
    );
  };

  const renderOtherRow = (row: TailoredChecklistItem) => (
    <label
      key={row.key}
      className="flex cursor-pointer items-start gap-3 border-b border-line py-3 last:border-b-0 hover:bg-mist/40"
    >
      <input
        type="checkbox"
        className="mt-0.5 size-[18px] shrink-0 accent-cell-blue-deep"
        checked={row.ticked}
        onChange={() => toggleItem(row.key)}
        disabled={busy || tailoring}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-small ${row.ticked ? "text-ink" : "text-graphite"}`}>{row.title}</span>
        {row.sourceLabel ? <span className="text-caption text-graphite">{row.sourceLabel}</span> : null}
      </span>
    </label>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-5 bg-canvas px-4 pb-16 pt-[clamp(24px,6vh,64px)] min-[900px]:px-8">
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-control bg-cell-blue-wash text-cell-blue-deep"
        >
          <PersonPlusIcon />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link
            href={MY_HIVES_PATH}
            className="inline-flex min-h-5 items-center self-start text-caption text-graphite no-underline hover:underline"
          >
            All clients /
          </Link>
          <h1 className="m-0 font-brand text-[21px] font-semibold leading-tight text-ink">New client</h1>
        </div>
      </div>

      <div className="flex flex-col gap-5 min-[900px]:grid min-[900px]:grid-cols-[400px_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-5">
        <div className="min-[900px]:sticky min-[900px]:top-[calc(var(--app-header-height,57px)+12px)] min-[900px]:self-start">
          <Card title="Who is the client?" subtitle="Their hive holds everything for this one matter.">
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
                className="min-h-10 rounded-control border border-line-strong px-3 text-[16px] font-normal text-ink"
              />
              {nameError ? (
                <span className="text-small text-coral-deep" role="alert">
                  {nameError}
                </span>
              ) : null}
            </label>

            <label htmlFor={emailId} className="mt-4 flex flex-col gap-1.5 text-small font-medium text-ink">
              <span>
                Client&apos;s email{" "}
                <span className="text-caption font-normal text-quiet">· needed only to invite them</span>
              </span>
              <input
                id={emailId}
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError(null);
                }}
                autoComplete="email"
                className="min-h-10 rounded-control border border-line-strong px-3 text-[16px] font-normal text-ink"
              />
              {emailError ? (
                <span className="text-small text-coral-deep" role="alert">
                  {emailError}
                </span>
              ) : null}
            </label>

            <div className="mt-4 flex flex-col gap-1.5 text-small font-medium text-ink">
              <span className="flex items-center justify-between gap-2">
                Matter type
                {canShowAllMatterTypes ? (
                  <button
                    type="button"
                    className="min-h-5 border-0 bg-transparent p-0 text-caption font-medium text-cell-blue-deep"
                    onClick={() => setShowAllMatterTypes(true)}
                  >
                    Show all matter types
                  </button>
                ) : null}
              </span>
              {visibleChecklistPacks.length === 1 && !showAllMatterTypes ? (
                <span className="text-[16px] font-normal text-ink">{visibleChecklistPacks[0]?.title}</span>
              ) : (
                <select
                  id={matterId}
                  value={packId}
                  onChange={(event) => onPackChange(event.target.value)}
                  className="min-h-10 rounded-control border border-line-strong bg-paper px-3 text-[16px] font-normal text-ink"
                >
                  {visibleChecklistPacks.map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {pack.title}
                    </option>
                  ))}
                  <option value={SOMETHING_ELSE_PACK_ID}>{SOMETHING_ELSE_LABEL}</option>
                </select>
              )}
            </div>

            {showChecklist ? (
              <>
                <label htmlFor={professionalTextId} className="mt-4 flex flex-col gap-1.5 text-small font-medium text-ink">
                  <span>
                    What do you know so far?{" "}
                    <span className="text-caption font-normal text-quiet">· optional</span>
                  </span>
                  <textarea
                    id={professionalTextId}
                    value={professionalText}
                    onChange={(event) => setProfessionalText(event.target.value)}
                    maxLength={MAX_TAILOR_PROFESSIONAL_TEXT}
                    rows={4}
                    placeholder="Single, wages from one employer, car loan, a credit card lawsuit, no business."
                    className="rounded-control border border-line-strong px-3 py-2.5 text-[16px] font-normal text-ink"
                  />
                  <span className="text-caption font-normal leading-snug text-quiet">
                    HiveForYou uses this to choose what to ask {clientGreeting} for. Only your team sees it.
                  </span>
                </label>
                <button
                  type="button"
                  className={`${WORKSPACE_SECONDARY} ${TAILOR_BUTTON_EXTRA}`}
                  disabled={busy || tailoring}
                  title={suggestAgainTitle}
                  onClick={() => void runTailor()}
                >
                  <SparkleIcon />
                  {tailorButtonLabel}
                </button>
                {tailorMessage ? (
                  <p className="m-0 text-caption text-graphite" role="status">
                    {tailorMessage}
                  </p>
                ) : null}
                {tailorError ? (
                  <p className="m-0 text-small text-coral-deep" role="alert">
                    {tailorError}
                  </p>
                ) : null}
              </>
            ) : null}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {showChecklist ? (
            <Card
              title={listTitle}
              subtitle={listSubtitle}
              headerRight={
                <div className="flex gap-4">
                  <span className="flex flex-col items-end">
                    <span className="font-brand text-[21px] font-semibold leading-none text-cell-blue-deep">{askCount}</span>
                    <span className="text-caption text-quiet">to ask for</span>
                  </span>
                  {leftOutCount > 0 ? (
                    <span className="flex flex-col items-end">
                      <span className="font-brand text-[21px] font-semibold leading-none text-graphite">{leftOutCount}</span>
                      <span className="text-caption text-quiet">left out</span>
                    </span>
                  ) : null}
                </div>
              }
            >
              <div className="px-0 pb-2">
                {clientItems.map((row) => renderChecklistRow(row))}
                {otherItems.length > 0 ? (
                  <>
                    <p className="m-0 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-quiet">
                      Usually from someone else
                    </p>
                    {otherItems.map((row) => renderOtherRow(row))}
                  </>
                ) : null}
                {checklistError ? (
                  <p className="m-0 pt-2 text-small text-coral-deep" role="alert">
                    {checklistError}
                  </p>
                ) : null}
                <div className="flex flex-col gap-2 pt-3 min-[600px]:flex-row min-[600px]:items-end">
                  <label htmlFor={addItemId} className="flex min-w-0 flex-1 flex-col gap-1.5 text-small font-medium text-ink">
                    Add an item
                    <input
                      id={addItemId}
                      value={addTitle}
                      onChange={(event) => {
                        setAddTitle(event.target.value);
                        setAddError(null);
                      }}
                      placeholder="Add an item, for example Lease for a storage unit"
                      maxLength={120}
                      className="min-h-10 rounded-control border border-line-strong px-3 text-[16px] font-normal text-ink"
                    />
                  </label>
                  <button type="button" className={WORKSPACE_SECONDARY} disabled={busy || tailoring} onClick={submitAddItem}>
                    Add
                  </button>
                </div>
                {addError ? (
                  <p className="m-0 text-small text-coral-deep" role="alert">
                    {addError}
                  </p>
                ) : null}
              </div>
            </Card>
          ) : (
            <Card title="No checklist">
              <p className="m-0 text-small leading-relaxed text-graphite">
                {clientFirst ?? "Your client"} can send whatever they have. HiveForYou reads every page and tells you
                what&apos;s missing as documents arrive.
              </p>
            </Card>
          )}

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

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              className={WORKSPACE_PRIMARY}
              disabled={busy || tailoring}
              onClick={() => void runSubmit("invite")}
            >
              {busy ? "Sending…" : invitePrimaryLabel(name)}
            </button>
            <button
              type="button"
              className={WORKSPACE_SECONDARY}
              disabled={busy || tailoring}
              onClick={() => void runSubmit("documents")}
            >
              {busy ? "Creating…" : "I have their documents"}
            </button>
            <Link href={MY_HIVES_PATH} className="px-1.5 text-small font-medium text-graphite no-underline hover:underline">
              Cancel
            </Link>
          </div>

          <p className="m-0 text-caption leading-snug text-quiet">
            {clientFirst ?? "Your client"} gets an email with a sign-in code and the number of items. Nothing from the
            documents or your note is ever in an email.
          </p>
        </div>
      </div>
    </div>
  );
}