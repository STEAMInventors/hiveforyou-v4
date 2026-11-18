import type { GapHolderType } from "../pipeline/canonical-gap-holders";
import { normalizeGapHolderType } from "../pipeline/canonical-gap-holders";
import { normalizeGapTitle } from "../pipeline/gap-fill";
import type { Pack } from "../pipeline/pack-contracts";
import { newClientPackHolderLabel } from "./pack-holder-labels";

export const SOMETHING_ELSE_PACK_ID = "";
export const MAX_STARTING_CHECKLIST_ROWS = 40;
export const CUSTOM_ITEM_TITLE_MAX = 120;

export type NewClientPackOption = {
  readonly id: string;
  readonly version: number;
  readonly title: string;
};

export type NewClientChecklistRow = {
  readonly key: string;
  readonly title: string;
  readonly appliesWhen: string | null;
  readonly sourceLabel: string | null;
  readonly group: "client" | "other";
  readonly defaultTicked: boolean;
  readonly custom: boolean;
};

export type NewClientChecklistSelection = {
  readonly key: string;
  readonly title: string;
  readonly ticked: boolean;
  readonly custom: boolean;
};

export type AddCustomItemResult =
  | { ok: true; title: string; key: string }
  | { ok: false; reason: "empty" | "too_long" | "duplicate" | "cap" };

function rowHolderType(holder: string, holderType: GapHolderType | null): GapHolderType | null {
  return normalizeGapHolderType(holderType);
}

export function packOptionsFromEntries(
  entries: readonly { id: string; pack: Pack }[],
): NewClientPackOption[] {
  return [...entries]
    .sort((a, b) => a.pack.meta.title.localeCompare(b.pack.meta.title))
    .map((entry) => ({
      id: entry.id,
      version: entry.pack.meta.version,
      title: entry.pack.meta.title,
    }));
}

export function buildNewClientChecklistRows(pack: Pack): NewClientChecklistRow[] {
  const rows: NewClientChecklistRow[] = [];
  for (const doc of pack.documentsUsuallyNeeded) {
    if (doc.gapKind === "FUTURE_RECORD") continue;
    const holderType = rowHolderType(doc.holder, doc.holderType);
    if (holderType === "COUNSEL") continue;
    const title = doc.document.replace(/\s+/g, " ").trim();
    if (title === "") continue;
    const key = normalizeGapTitle(title);
    const isClient = holderType === "ASKER_OR_CLIENT" || holderType === null;
    const isOther = holderType === "THIRD_PARTY" || holderType === "COURT_RECORD";
    if (!isClient && !isOther) continue;
    const holderLabel = isOther ? newClientPackHolderLabel(holderType!, doc.holder) : null;
    rows.push({
      key,
      title,
      appliesWhen: doc.appliesWhen,
      sourceLabel: holderLabel ? `Usually from ${holderLabel}` : null,
      group: isClient ? "client" : "other",
      defaultTicked: isClient,
      custom: false,
    });
  }
  return rows;
}

export function mergePackChangeKeepingCustom(
  nextPackRows: readonly NewClientChecklistRow[],
  current: readonly NewClientChecklistSelection[],
): NewClientChecklistSelection[] {
  const custom = current.filter((row) => row.custom);
  const tickedKeys = new Set(current.filter((row) => row.ticked && !row.custom).map((row) => row.key));
  const packPart: NewClientChecklistSelection[] = nextPackRows.map((row) => ({
    key: row.key,
    title: row.title,
    ticked: tickedKeys.has(row.key) ? true : row.defaultTicked,
    custom: false,
  }));
  return [...packPart, ...custom];
}

export function initialChecklistSelection(packRows: readonly NewClientChecklistRow[]): NewClientChecklistSelection[] {
  return packRows.map((row) => ({
    key: row.key,
    title: row.title,
    ticked: row.defaultTicked,
    custom: false,
  }));
}

export function tryAddCustomChecklistItem(
  rawTitle: string,
  existing: readonly NewClientChecklistSelection[],
): AddCustomItemResult {
  const title = rawTitle.replace(/\s+/g, " ").trim();
  if (title === "") return { ok: false, reason: "empty" };
  if (title.length > CUSTOM_ITEM_TITLE_MAX) return { ok: false, reason: "too_long" };
  const lower = title.toLowerCase();
  if (existing.some((row) => row.title.toLowerCase() === lower)) return { ok: false, reason: "duplicate" };
  if (existing.length >= MAX_STARTING_CHECKLIST_ROWS) return { ok: false, reason: "cap" };
  const key = `custom:${normalizeGapTitle(title)}`;
  return { ok: true, title, key };
}

export function selectedChecklistCount(selection: readonly NewClientChecklistSelection[]): number {
  return selection.filter((row) => row.ticked).length;
}

export function clientFirstName(displayName: string | null | undefined): string | null {
  const trimmed = displayName?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

export function invitePrimaryLabel(clientName: string): string {
  const first = clientFirstName(clientName);
  return first ? `Invite ${first} to upload` : "Invite them to upload";
}

export type NewClientValidation = {
  nameError: string | null;
  emailError: string | null;
  checklistError: string | null;
};

export function validateNewClientForm(input: {
  name: string;
  email: string;
  mode: "invite" | "documents";
  packId: string | null;
  selection: readonly NewClientChecklistSelection[];
}): NewClientValidation {
  const name = input.name.trim();
  let nameError: string | null = null;
  if (!name) nameError = "Enter the client's name.";
  const email = input.email.trim().toLowerCase();
  let emailError: string | null = null;
  if (input.mode === "invite") {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailError = "Enter a valid email address.";
    }
  }
  let checklistError: string | null = null;
  if (input.packId && selectedChecklistCount(input.selection) < 1) {
    checklistError = "Tick at least one item, or choose Something else.";
  }
  return { nameError, emailError, checklistError };
}