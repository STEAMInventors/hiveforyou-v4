/**
 * Assembles pack-driven report sections: every template section in order, with narrative and
 * template blocks. A section is omitted only when it has no narrative and every block is empty.
 */

import type { CanonicalStudy } from "./canonical-study-contracts";
import type { Pack, PackAudience, PackReportBlockRef, PackReportSection } from "./pack-contracts";
import {
  buildChainBlockRows,
  buildChecklistRows,
  buildGeneralNotesRowsForIds,
  buildQuestionRows,
  buildTermsRows,
  buildUnansweredRows,
  redactCustomerPackBlockRows,
} from "./pack-study-view";
import type { StudyViewDocumentRequestList } from "./study-view-contracts";
import type {
  StudyViewBlock,
  StudyViewBlockName,
  StudyViewContext,
  StudyViewRow,
  StudyViewSection,
  StudyViewSentence,
  WriteFactRecord,
  WriteSection,
} from "./study-view-contracts";

export type StudyViewPackBlock = StudyViewBlock | { readonly name: "gaps"; readonly rows: readonly [] };

export type StudyViewPackSection = {
  readonly order: number;
  readonly heading: string;
  readonly paragraphs: StudyViewSection["paragraphs"];
  readonly blocks: readonly StudyViewPackBlock[];
  readonly documentRequestList?: StudyViewDocumentRequestList;
};

export type PackReportAssemblyDrops = {
  packSectionsOmitted: number;
  packBlocksSkippedNotBuilt: number;
  packBlocksUnknown: number;
};

const PACK_BLOCK_ALIASES: Record<string, StudyViewBlockName | "gaps" | "computed"> = {
  documents: "documents",
  spine_table: "spine_table",
  conflicts: "conflicts",
  timeline: "timeline",
  outside_spine: "outside_spine",
  checklist: "checklist",
  chains: "chains",
  questions: "questions",
  unanswered: "unanswered",
  terms: "terms",
  general_notes: "general_notes",
  gaps: "gaps",
  computed: "computed",
};

function sectionKey(heading: string): string {
  return heading.trim().toLowerCase();
}

function normalizeHeading(template: string, firstName: string | null): string {
  if (!firstName?.trim()) return template;
  return template.replace(/\{first name\}/gi, firstName.trim());
}

function expandIdArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of args) {
    const part = raw.trim();
    const range = /^([A-Za-z]+)(\d+)-(\1)(\d+)$/i.exec(part);
    if (range) {
      const prefix = range[1].toUpperCase();
      const start = Number.parseInt(range[2], 10);
      const end = Number.parseInt(range[3], 10);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        for (let n = lo; n <= hi; n++) out.push(`${prefix}${n}`);
        continue;
      }
    }
    if (part !== "") out.push(part);
  }
  return out;
}

function filterChainRows(
  study: CanonicalStudy,
  pack: Pack,
  facts: ReadonlyMap<string, WriteFactRecord>,
  args: readonly string[],
): StudyViewRow[] {
  const chains = buildChainBlockRows(study, pack, facts);
  const want = new Set(expandIdArgs(args).map((id) => id.toUpperCase()));
  const picked = want.size === 0 ? chains : chains.filter((chain) => want.has(chain.chainId.toUpperCase()));
  return picked.flatMap((chain) =>
    chain.rows.map((row) => ({
      ...row,
      id: `${chain.chainId}:${row.id}`,
      label: `${chain.label} · ${row.label ?? ""}`.trim(),
    })),
  );
}

function filterSpineRows(rows: StudyViewRow[], args: readonly string[]): StudyViewRow[] {
  if (args.length === 0) return rows;
  const hint = args.join(" ").toLowerCase();
  if (hint.includes("goal")) return rows.filter((row) => (row.kind ?? "").toLowerCase().includes("goal") || /goal/i.test(row.label ?? ""));
  if (hint.includes("service")) return rows.filter((row) => /service|minute|week/i.test(`${row.label ?? ""} ${row.kind ?? ""}`));
  return rows;
}

type PrebuiltBlocks = ReadonlyMap<StudyViewBlockName, readonly StudyViewRow[]>;

function rowsForTemplateBlock(
  ref: PackReportBlockRef,
  study: CanonicalStudy,
  facts: ReadonlyMap<string, WriteFactRecord>,
  context: StudyViewContext,
  prebuilt: PrebuiltBlocks,
  drops: PackReportAssemblyDrops,
): { name: string; rows: StudyViewRow[] } | null {
  const canonical = PACK_BLOCK_ALIASES[ref.name.trim().toLowerCase()];
  if (!canonical) {
    drops.packBlocksUnknown += 1;
    return null;
  }
  if (canonical === "computed") {
    drops.packBlocksSkippedNotBuilt += 1;
    return null;
  }
  if (canonical === "gaps") {
    return { name: "gaps", rows: [] };
  }
  const pack = context.pack;
  if (!pack) return { name: canonical, rows: [] };
  let rows: StudyViewRow[] = [];
  if (canonical === "chains") {
    rows = filterChainRows(study, pack, facts, ref.args);
  } else if (canonical === "general_notes") {
    const ids = expandIdArgs(ref.args);
    rows = buildGeneralNotesRowsForIds(pack, ids);
  } else if (canonical === "questions") {
    rows = [...buildQuestionRows(study, pack, facts, context.reportAudience ?? "professional")];
  } else if (canonical === "unanswered") {
    rows = buildUnansweredRows(study, pack, context.reportAudience ?? "professional", facts);
  } else if (canonical === "checklist") {
    rows = buildChecklistRows(study, pack, facts, context.reportAudience ?? "professional");
  } else if (canonical === "terms") {
    rows = buildTermsRows(pack, [...facts.values()]);
  } else {
    rows = [...(prebuilt.get(canonical) ?? [])];
    if (canonical === "spine_table") rows = filterSpineRows(rows, ref.args);
  }
  const audience = context.reportAudience;
  if (audience === "customer") {
    rows = redactCustomerPackBlockRows(canonical, rows, pack);
  }
  return { name: canonical, rows };
}

function narrativeForTemplate(
  template: PackReportSection,
  writeByHeading: ReadonlyMap<string, WriteSection>,
  firstName: string | null,
): StudyViewSection["paragraphs"] {
  const heading = normalizeHeading(template.heading, firstName);
  const section = writeByHeading.get(sectionKey(heading)) ?? writeByHeading.get(sectionKey(template.heading));
  if (!section) return [];
  return section.paragraphs.map((paragraph) => ({
    sentences: paragraph.sentences.map(
      (sentence): StudyViewSentence => ({ text: sentence.text, factIds: [...sentence.factIds] }),
    ),
  }));
}

function blockHasContent(block: StudyViewPackBlock, list?: StudyViewDocumentRequestList): boolean {
  if (block.name === "gaps" && list) return list.items.length > 0 || (list.legacyLines?.length ?? 0) > 0;
  return block.rows.length > 0;
}

function sectionHasNarrative(paragraphs: StudyViewSection["paragraphs"]): boolean {
  return paragraphs.some((paragraph) => paragraph.sentences.some((sentence) => sentence.text.trim() !== ""));
}

export function assemblePackReportSections(input: {
  readonly pack: Pack;
  readonly audience: PackAudience;
  readonly study: CanonicalStudy;
  readonly facts: readonly WriteFactRecord[];
  readonly writeSections: readonly WriteSection[];
  readonly prebuilt: PrebuiltBlocks;
  readonly context: StudyViewContext;
  readonly documentRequestList?: StudyViewDocumentRequestList;
  readonly firstName?: string | null;
}): { sections: StudyViewPackSection[]; drops: PackReportAssemblyDrops } {
  const drops: PackReportAssemblyDrops = {
    packSectionsOmitted: 0,
    packBlocksSkippedNotBuilt: 0,
    packBlocksUnknown: 0,
  };
  const report = input.audience === "customer" ? input.pack.customerReport : input.pack.professionalReport;
  const template = report?.sections ?? [];
  if (template.length === 0) return { sections: [], drops };

  const factMap = new Map(input.facts.map((fact) => [fact.id, fact]));
  const writeByHeading = new Map<string, WriteSection>();
  for (const section of input.writeSections) {
    writeByHeading.set(sectionKey(section.heading), section);
  }

  const firstName = input.firstName ?? null;
  const sections: StudyViewPackSection[] = [];
  const emittedGeneralNoteIds = new Set<string>();

  for (const spec of [...template].sort((a, b) => a.order - b.order)) {
    const heading = normalizeHeading(spec.heading, firstName);
    const paragraphs = narrativeForTemplate(spec, writeByHeading, firstName);
    const blocks: StudyViewPackBlock[] = [];
    let gapsList: StudyViewDocumentRequestList | undefined;
    for (const ref of spec.blocks) {
      const built = rowsForTemplateBlock(ref, input.study, factMap, input.context, input.prebuilt, drops);
      if (!built) continue;
      if (built.name === "general_notes" && input.context.reportAudience === "customer") {
        built.rows = built.rows.filter((row) => {
          const noteId = row.id.trim().toUpperCase();
          if (emittedGeneralNoteIds.has(noteId)) return false;
          emittedGeneralNoteIds.add(noteId);
          return true;
        });
      }
      if (built.name === "gaps" && input.documentRequestList) {
        gapsList = input.documentRequestList;
        blocks.push({ name: "gaps", rows: [] });
        continue;
      }
      blocks.push({ name: built.name as StudyViewBlockName, rows: built.rows });
    }
    const hasNarrative = sectionHasNarrative(paragraphs);
    const hasBlock = blocks.some((block, index) =>
      blockHasContent(block, block.name === "gaps" ? gapsList : undefined),
    );
    if (!hasNarrative && !hasBlock) {
      drops.packSectionsOmitted += 1;
      continue;
    }
    sections.push({
      order: spec.order,
      heading,
      paragraphs,
      blocks,
      ...(gapsList ? { documentRequestList: gapsList } : {}),
    });
  }

  return { sections, drops };
}

export function packReportSectionHeadings(sections: readonly StudyViewPackSection[]): string[] {
  return sections.map((section) => `${section.order}. ${section.heading}`);
}
