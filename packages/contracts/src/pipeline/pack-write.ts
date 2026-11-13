import type { Pack, PackAudience, PackReportSection } from "./pack-contracts";
import type { CanonicalStudy } from "./canonical-study-contracts";
import type { CheckVerdict, PersonaCoverageItem } from "./pack-canonicalize";
import type { StudyViewBlockName, WriteOutput, WriteSection } from "./study-view-contracts";
import { STUDY_VIEW_BLOCK_NAMES } from "./study-view-contracts";

const CUSTOMER_QUESTIONS_CAP = 7;
const BUILT_BLOCK_SET = new Set([
  "documents",
  "spine_table",
  "conflicts",
  "timeline",
  "outside_spine",
  "checklist",
  "chains",
  "questions",
  "unanswered",
  "terms",
  "general_notes",
  "gaps",
]);

export type PackWriteDrops = {
  unknownBlockNames: number;
  skippedNotBuilt: number;
  sectionsReordered: number;
  customerQuestionsTrimmed: number;
};

export function packWriteInput(
  pack: Pack,
  audience: PackAudience,
  study: CanonicalStudy,
) {
  const persona = pack.personas.find((p) => p.audience === audience);
  const report = audience === "customer" ? pack.customerReport : pack.professionalReport;
  const coverage = (study.personaCoverage ?? []).filter((row) => row.audience === audience);
  return {
    reader: persona,
    coverage,
    report,
    checklistCompact: (study.checklist ?? []).map((item) => ({
      checkId: item.checkId,
      verdict: item.verdict,
      note: item.note,
      factIds: item.factIds,
    })),
    chainsCompact: study.chains,
  };
}

function reportSections(pack: Pack, audience: PackAudience): PackReportSection[] {
  const report = audience === "customer" ? pack.customerReport : pack.professionalReport;
  return report?.sections ?? [];
}

function sectionKey(heading: string): string {
  return heading.trim().toLowerCase();
}

export function enforcePackWriteOrder(
  writeOutput: WriteOutput,
  pack: Pack,
  audience: PackAudience,
): { output: WriteOutput; drops: PackWriteDrops } {
  const drops: PackWriteDrops = {
    unknownBlockNames: 0,
    skippedNotBuilt: 0,
    sectionsReordered: 0,
    customerQuestionsTrimmed: 0,
  };
  const template = reportSections(pack, audience);
  if (template.length === 0) return { output: writeOutput, drops };

  const byHeading = new Map<string, WriteSection>();
  for (const section of writeOutput.sections) {
    byHeading.set(sectionKey(section.heading), section);
  }
  const ordered: WriteSection[] = [];
  for (const spec of template.sort((a, b) => a.order - b.order)) {
    const match = byHeading.get(sectionKey(spec.heading));
    if (match) ordered.push({ ...match, heading: spec.heading });
    else {
      drops.sectionsReordered += 1;
      ordered.push({ heading: spec.heading, paragraphs: [] });
    }
  }
  if (ordered.length < writeOutput.sections.length) drops.sectionsReordered += writeOutput.sections.length - ordered.length;

  const blocks: StudyViewBlockName[] = [];
  for (const block of writeOutput.blocks) {
  const name = block as string;
    if (name === "computed") {
      drops.skippedNotBuilt += 1;
      continue;
    }
    if (!BUILT_BLOCK_SET.has(name) && !STUDY_VIEW_BLOCK_NAMES.includes(block)) {
      drops.unknownBlockNames += 1;
      continue;
    }
    blocks.push(block);
  }
  if (audience === "customer") {
    const qIndex = blocks.indexOf("questions" as StudyViewBlockName);
    if (qIndex >= 0) {
      // cap enforced when building question rows in study view builder
      drops.customerQuestionsTrimmed = 0;
    }
  }
  return {
    output: { ...writeOutput, sections: ordered.length > 0 ? ordered : writeOutput.sections, blocks },
    drops,
  };
}

export function stripCustomerCheckAuthority(text: string): string {
  return text
    .replace(/\b(?:SQ|T|P|E|G|S|A|L|M|F)\d+\b/g, "")
    .replace(/\bREF-\d+\b/gi, "")
    .replace(/\b34 CFR [\d.()a-z-]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function capCustomerQuestions<T>(rows: readonly T[], audience: PackAudience): readonly T[] {
  if (audience !== "customer") return rows;
  return rows.slice(0, CUSTOMER_QUESTIONS_CAP);
}
