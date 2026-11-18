import { normalizeGapTitle } from "../pipeline/gap-fill";
import type { Pack } from "../pipeline/pack-contracts";
import { newClientPackHolderLabel } from "./pack-holder-labels";
import type { GapHolderType } from "../pipeline/canonical-gap-holders";
import { normalizeGapHolderType } from "../pipeline/canonical-gap-holders";

export const CHECKLIST_TAILOR_PROMPT_ID = "checklist-tailor/1";
export const CHECKLIST_TAILOR_PROMPT_VERSION = "1";
export const MAX_TAILOR_PROFESSIONAL_TEXT = 2000;
export const MAX_TAILOR_REASON_CHARS = 160;
export const MAX_TAILOR_EXTRA_ITEMS = 5;
export const MAX_TAILOR_EXTRA_TITLE = 120;

export const CHECKLIST_TAILOR_ADVICE_WORDS = [
  "should",
  "must",
  "recommend",
  "file",
  "discharge",
  "guaranteed",
  "will win",
  "you need to",
  "advise",
  "liable",
] as const;

export type ChecklistTailorDecision = "ask" | "leave_out" | "depends";

export type ChecklistTailorPackRow = {
  readonly key: string;
  readonly title: string;
  readonly appliesWhen: string | null;
  readonly holderType: GapHolderType | null;
  readonly holder: string;
  readonly gapKind: string;
};

export type ChecklistTailorModelRow = {
  readonly key: string;
  readonly decision: ChecklistTailorDecision;
  readonly reason: string | null;
  readonly quote: string | null;
};

export type ChecklistTailorModelExtra = {
  readonly title: string;
  readonly reason: string;
  readonly quote: string;
};

export type ChecklistTailorModelOutput = {
  rows: {
    key: string;
    decision: ChecklistTailorDecision;
    reason?: string | null;
    quote?: string | null;
  }[];
  extras?: ChecklistTailorModelExtra[];
};

export type ChecklistTailorRowTag = "plain" | "depends" | "from_note" | "left_out" | "added";

export type TailoredChecklistItem = {
  readonly key: string;
  readonly title: string;
  readonly ticked: boolean;
  readonly custom: boolean;
  readonly tag: ChecklistTailorRowTag;
  readonly reason: string | null;
  readonly quote: string | null;
  readonly sourceLabel: string | null;
  readonly group: "client" | "other";
};

export type ChecklistTailorResult = {
  readonly tailored: boolean;
  readonly message: string | null;
  readonly items: readonly TailoredChecklistItem[];
  readonly askCount: number;
  readonly leftOutCount: number;
};

export function packRowsForTailor(pack: Pack): ChecklistTailorPackRow[] {
  const rows: ChecklistTailorPackRow[] = [];
  for (const doc of pack.documentsUsuallyNeeded) {
    if (doc.gapKind === "FUTURE_RECORD") continue;
    const holderType = normalizeGapHolderType(doc.holderType);
    if (holderType === "COUNSEL") continue;
    const title = doc.document.replace(/\s+/g, " ").trim();
    if (title === "") continue;
    rows.push({
      key: normalizeGapTitle(title),
      title,
      appliesWhen: doc.appliesWhen,
      holderType,
      holder: doc.holder,
      gapKind: doc.gapKind,
    });
  }
  return rows;
}

export function normalizeForQuoteMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function quoteAppearsInText(quote: string, professionalText: string): boolean {
  const q = normalizeForQuoteMatch(quote);
  if (q === "") return false;
  return normalizeForQuoteMatch(professionalText).includes(q);
}

export function reasonFailsGuard(reason: string): boolean {
  const trimmed = reason.replace(/\s+/g, " ").trim();
  if (trimmed.length > MAX_TAILOR_REASON_CHARS) return true;
  const lower = trimmed.toLowerCase();
  return CHECKLIST_TAILOR_ADVICE_WORDS.some((word) => lower.includes(word));
}

function dependsDefaultReason(appliesWhen: string): string {
  return `Only if the client ${appliesWhen.replace(/\s+/g, " ").trim().replace(/\.$/, "")}.`;
}

function rowGroup(holderType: GapHolderType | null): "client" | "other" {
  if (holderType === "THIRD_PARTY" || holderType === "COURT_RECORD") return "other";
  return "client";
}

function sourceLabel(holderType: GapHolderType | null, holder: string): string | null {
  if (holderType === "THIRD_PARTY" || holderType === "COURT_RECORD") {
    const label = newClientPackHolderLabel(holderType, holder);
    return label ? `Usually from ${label}` : null;
  }
  return null;
}

export function checklistTailorWithoutModel(
  packRows: readonly ChecklistTailorPackRow[],
  hasProfessionalText: boolean,
): ChecklistTailorResult {
  void hasProfessionalText;
  const items: TailoredChecklistItem[] = packRows.map((row) => {
    const group = rowGroup(row.holderType);
    const defaultTicked = group === "client";
    if (!row.appliesWhen) {
      return {
        key: row.key,
        title: row.title,
        ticked: defaultTicked,
        custom: false,
        tag: "plain",
        reason: null,
        quote: null,
        sourceLabel: sourceLabel(row.holderType, row.holder),
        group,
      };
    }
    return {
      key: row.key,
      title: row.title,
      ticked: false,
      custom: false,
      tag: "depends",
      reason: dependsDefaultReason(row.appliesWhen),
      quote: null,
      sourceLabel: sourceLabel(row.holderType, row.holder),
      group,
    };
  });
  return summarizeTailorItems(items, false, null);
}

export function applyChecklistTailorRules(
  packRows: readonly ChecklistTailorPackRow[],
  professionalText: string,
  model: ChecklistTailorModelOutput,
): ChecklistTailorResult {
  const text = professionalText.replace(/\s+/g, " ").trim();
  const modelByKey = new Map(model.rows.map((row) => [row.key, row]));
  const packTitles = new Set(packRows.map((row) => row.title.toLowerCase()));
  const usedExtraTitles = new Set<string>();

  const items: TailoredChecklistItem[] = [];

  for (const row of packRows) {
    const group = rowGroup(row.holderType);
    const defaultTicked = group === "client";
    const label = sourceLabel(row.holderType, row.holder);

    if (!row.appliesWhen) {
      items.push({
        key: row.key,
        title: row.title,
        ticked: defaultTicked,
        custom: false,
        tag: "plain",
        reason: null,
        quote: null,
        sourceLabel: label,
        group,
      });
      continue;
    }

    const fromModel = modelByKey.get(row.key);
    let decision: ChecklistTailorDecision = "depends";
    let reason: string | null = dependsDefaultReason(row.appliesWhen);
    let quote: string | null = null;
    let tag: ChecklistTailorRowTag = "depends";

    if (fromModel) {
      const modelQuote = typeof fromModel.quote === "string" ? fromModel.quote.replace(/\s+/g, " ").trim() : "";
      const modelReason =
        typeof fromModel.reason === "string" ? fromModel.reason.replace(/\s+/g, " ").trim() : "";
      if (fromModel.decision === "ask" || fromModel.decision === "leave_out") {
        if (modelQuote !== "" && quoteAppearsInText(modelQuote, text)) {
          if (fromModel.decision === "ask" && !reasonFailsGuard(modelReason)) {
            decision = "ask";
            reason = modelReason !== "" ? modelReason : null;
            quote = modelQuote;
            tag = "from_note";
          } else if (fromModel.decision === "leave_out" && !reasonFailsGuard(modelReason) && modelReason !== "") {
            decision = "leave_out";
            reason = modelReason;
            quote = modelQuote;
            tag = "left_out";
          }
        }
      } else if (fromModel.decision === "depends") {
        decision = "depends";
        if (modelReason !== "" && !reasonFailsGuard(modelReason)) reason = modelReason;
      }
    }

    const ticked = decision === "ask";
    if (decision === "leave_out") {
      items.push({
        key: row.key,
        title: row.title,
        ticked: false,
        custom: false,
        tag,
        reason,
        quote,
        sourceLabel: label,
        group,
      });
    } else if (decision === "ask") {
      items.push({
        key: row.key,
        title: row.title,
        ticked: true,
        custom: false,
        tag,
        reason,
        quote,
        sourceLabel: label,
        group,
      });
    } else {
      items.push({
        key: row.key,
        title: row.title,
        ticked: false,
        custom: false,
        tag: "depends",
        reason: reason ?? dependsDefaultReason(row.appliesWhen),
        quote: null,
        sourceLabel: label,
        group,
      });
    }
  }

  for (const extra of model.extras ?? []) {
    const title = extra.title.replace(/\s+/g, " ").trim();
    if (title === "" || title.length > MAX_TAILOR_EXTRA_TITLE) continue;
    const lower = title.toLowerCase();
    if (packTitles.has(lower) || usedExtraTitles.has(lower)) continue;
    if (!quoteAppearsInText(extra.quote, text)) continue;
    const reason = extra.reason.replace(/\s+/g, " ").trim();
    if (reason === "" || reasonFailsGuard(reason)) continue;
    usedExtraTitles.add(lower);
    items.push({
      key: `custom:${normalizeGapTitle(title)}`,
      title,
      ticked: true,
      custom: true,
      tag: "added",
      reason,
      quote: extra.quote.replace(/\s+/g, " ").trim(),
      sourceLabel: null,
      group: "client",
    });
  }

  return summarizeTailorItems(items, true, null);
}

function summarizeTailorItems(
  items: TailoredChecklistItem[],
  tailored: boolean,
  message: string | null,
): ChecklistTailorResult {
  const askCount = items.filter((row) => row.ticked).length;
  const leftOutCount = items.filter((row) => !row.ticked && !row.custom && row.tag === "left_out").length;
  const ordered = orderTailoredItems(items);
  return { tailored, message, items: ordered, askCount, leftOutCount };
}

const TAG_ORDER: Record<ChecklistTailorRowTag, number> = {
  from_note: 0,
  added: 1,
  plain: 2,
  depends: 3,
  left_out: 4,
};

export function orderTailoredItems(items: readonly TailoredChecklistItem[]): TailoredChecklistItem[] {
  return [...items].sort((a, b) => {
    if (a.ticked !== b.ticked) return a.ticked ? -1 : 1;
    const orderA = TAG_ORDER[a.tag];
    const orderB = TAG_ORDER[b.tag];
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  });
}

function isTailorDecision(value: unknown): value is ChecklistTailorDecision {
  return value === "ask" || value === "leave_out" || value === "depends";
}

export function parseChecklistTailorModelOutput(raw: unknown): ChecklistTailorModelOutput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.rows)) return null;
  const rows: ChecklistTailorModelOutput["rows"] = [];
  for (const row of record.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const item = row as Record<string, unknown>;
    if (typeof item.key !== "string" || item.key.trim() === "" || !isTailorDecision(item.decision)) return null;
    rows.push({
      key: item.key.trim(),
      decision: item.decision,
      reason: typeof item.reason === "string" ? item.reason : item.reason === null ? null : undefined,
      quote: typeof item.quote === "string" ? item.quote : item.quote === null ? null : undefined,
    });
  }
  const extras: ChecklistTailorModelExtra[] = [];
  if (record.extras !== undefined) {
    if (!Array.isArray(record.extras)) return null;
    if (record.extras.length > MAX_TAILOR_EXTRA_ITEMS) return null;
    for (const extra of record.extras) {
      if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
      const item = extra as Record<string, unknown>;
      if (typeof item.title !== "string" || item.title.trim() === "" || item.title.length > MAX_TAILOR_EXTRA_TITLE) {
        return null;
      }
      if (typeof item.reason !== "string" || item.reason.trim() === "") return null;
      if (typeof item.quote !== "string" || item.quote.trim() === "") return null;
      extras.push({
        title: item.title.trim(),
        reason: item.reason.trim(),
        quote: item.quote.trim(),
      });
    }
  }
  return { rows, extras };
}