import type { CanonicalStudy } from "../pipeline/canonical-study-contracts";
import type { Pack, PackCheck } from "../pipeline/pack-contracts";
import { checklistVerdictLabel } from "../pipeline/check-verdict-display";
import type { StudyView, StudyViewRow, StudyViewValue } from "../pipeline/study-view-contracts";
import { valuesToSourceRefs } from "./findings-page-model";
import type { StudyViewSources } from "../pipeline/study-view-contracts";

export type AuditChipRef = ReturnType<typeof valuesToSourceRefs>[number];

export type AuditTrailEntry = {
  readonly id: string;
  readonly title: string;
  readonly method: string;
  readonly result: string;
  readonly chips: readonly AuditChipRef[];
};

export type StudyRevisionLine = {
  readonly revisionNumber: number;
  readonly acceptedAt: string;
  readonly summary: string;
};

function blockRows(view: StudyView, name: string): readonly StudyViewRow[] {
  return view.blocks.find((block) => block.name === name)?.rows ?? [];
}

function countDocumentsByType(study: CanonicalStudy): string {
  const tallies = new Map<string, number>();
  for (const document of study.documents) {
    const key = document.typeInPlainWords.trim() || "Unclassified";
    tallies.set(key, (tallies.get(key) ?? 0) + 1);
  }
  const parts = [...tallies.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${count} ${type}`);
  return parts.length > 0 ? parts.join("; ") : "none classified yet";
}

export function buildAuditTrailEntries(input: {
  view: StudyView;
  sources: StudyViewSources | null;
  canonicalStudy: CanonicalStudy | null;
  pack: Pack | null;
  documentTotal: number;
  pagesRead: number;
  pagesTotal: number;
  unreadableLabels: readonly string[];
  duplicatePairs: readonly { a: string; b: string }[];
  documentFirstPageChips: readonly AuditChipRef[];
}): AuditTrailEntry[] {
  const entries: AuditTrailEntry[] = [];
  const study = input.canonicalStudy;

  entries.push({
    id: "classification",
    title: "Document classification",
    method:
      "Each file's first pages read for what it is, who issued it and the period it covers; page counts checked.",
    result: study
      ? `${study.documents.length} files identified: ${countDocumentsByType(study)}.`
      : `${input.documentTotal} files registered; classification follows reading.`,
    chips: input.documentFirstPageChips,
  });

  const unreadable =
    input.unreadableLabels.length > 0 ? ` Unreadable: ${input.unreadableLabels.join("; ")}.` : "";
  entries.push({
    id: "page-reading",
    title: "Page reading",
    method: "Every page read and saved; each saved page verified against the file.",
    result: `${input.pagesRead} of ${input.pagesTotal} pages read.${unreadable}`.trim(),
    chips: [],
  });

  entries.push({
    id: "duplicate-detection",
    title: "Duplicate detection",
    method: "Files compared by exact content fingerprint.",
    result:
      input.duplicatePairs.length > 0
        ? input.duplicatePairs.map((pair) => `${pair.a} matches ${pair.b}; set aside, not deleted.`).join(" ")
        : "No duplicates found.",
    chips: [],
  });

  if (input.pack && study?.checklist?.length) {
    const checklist = new Map(study.checklist.map((item) => [item.checkId, item]));
    for (const def of input.pack.checks) {
      const item = checklist.get(def.id);
      if (!item) continue;
      const row = blockRows(input.view, "checklist").find((entry) => entry.id === def.id);
      const values = row?.values ?? [];
      entries.push({
        id: `check-${def.id}`,
        title: def.check.trim(),
        method: `Looks for: ${def.evidence.trim()}`,
        result: `${checklistVerdictLabel(item.verdict) ?? item.verdict}${item.note ? ` — ${item.note}` : ""}`,
        chips: valuesToSourceRefs(values, input.sources),
      });
    }
  } else if (study) {
    for (const element of study.spine) {
      const row = blockRows(input.view, "spine_table").find((entry) => entry.id === element.id);
      const values = row?.values ?? [];
      entries.push({
        id: `spine-${element.id}`,
        title: element.label.trim() || element.kind.trim() || element.id,
        method: "Statements grouped from the canonical study spine.",
        result: element.status?.trim() || "Recorded",
        chips: valuesToSourceRefs(values, input.sources),
      });
    }
  }

  const timeline = blockRows(input.view, "timeline");
  const conflicts = blockRows(input.view, "conflicts");
  entries.push({
    id: "timeline-conflicts",
    title: "Timeline and conflicts",
    method: "Dated statements put in order; statements compared across documents.",
    result: `${timeline.length} dated events, ${conflicts.length} differences.`,
    chips: [],
  });

  return entries;
}

export function buildStudyRevisionLines(
  revisions: readonly {
    revisionNumber: number;
    createdAt: string;
    sourceDocumentIds: readonly string[];
    predecessorSourceDocumentIds: readonly string[] | null;
  }[],
): StudyRevisionLine[] {
  const sorted = [...revisions].sort((a, b) => b.revisionNumber - a.revisionNumber);
  return sorted.map((revision, index) => {
    const oldest = index === sorted.length - 1;
    const count = revision.sourceDocumentIds.length;
    let summary: string;
    if (oldest && sorted.length === 1) {
      summary = `First Study built from ${count} files`;
    } else if (oldest) {
      summary = `First Study built from ${count} files`;
    } else {
      const prev = sorted[index + 1];
      const prevSet = new Set(prev?.sourceDocumentIds.map((id) => id.toLowerCase()) ?? []);
      const added = revision.sourceDocumentIds.filter((id) => !prevSet.has(id.toLowerCase())).length;
      if (added > 0) {
        summary = `Added ${added} files`;
      } else {
        summary = "Rebuilt after document or intent changes";
      }
    }
    return {
      revisionNumber: revision.revisionNumber,
      acceptedAt: revision.createdAt,
      summary,
    };
  });
}

export function packChecksInOrder(pack: Pack): PackCheck[] {
  return [...pack.checks];
}