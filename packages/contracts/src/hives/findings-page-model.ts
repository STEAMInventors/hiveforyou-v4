import type { CanonicalStudy } from "../pipeline/canonical-study-contracts";
import type { Pack, PackCheck } from "../pipeline/pack-contracts";
import { checkIdsLinkedToSpine } from "../pipeline/spine-check-display";
import type { StudyView, StudyViewRow, StudyViewSources, StudyViewValue } from "../pipeline/study-view-contracts";
import { partitionDocumentRequests, DOCUMENT_REQUEST_LIST_COMPONENT } from "../pipeline/document-request-list-contracts";
import type { CoverageGap, SnapshotDocument } from "../study-preparation/study-preparation-contracts";
import { STUDY_VIEW_BLOCK_NAMES, type StudyViewBlockName } from "../pipeline/study-view-contracts";

export const FINDINGS_ANCHORS = {
  topics: "topics",
  openItems: "open-items",
  timeline: "timeline",
} as const;

export const FINDINGS_FORBIDDEN_STATUS_CODES = ["matches", "worth-asking"] as const;

export type FindingsOpenItemKind = "missing" | "difference" | "needs";

export type FindingsOpenItem = {
  readonly id: string;
  readonly kind: FindingsOpenItemKind;
  readonly title: string;
  readonly question: string;
  readonly factIds: readonly string[];
};

export type FindingsTopicStatement = {
  readonly id: string;
  readonly text: string;
  readonly values: readonly StudyViewValue[];
};

export type FindingsTopic = {
  readonly id: string;
  readonly title: string;
  readonly uncertain: boolean;
  readonly statements: readonly FindingsTopicStatement[];
  readonly openItems: readonly FindingsOpenItem[];
};

export type FindingsGlanceMetric = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly sub: string | null;
  readonly values: readonly StudyViewValue[];
  readonly calculationId: string | null;
};

export type FindingsGlanceMetricsInput = {
  readonly view: StudyView;
  readonly pack: Pack | null;
  readonly canonicalStudy: CanonicalStudy | null;
  readonly snapshotDocuments: readonly SnapshotDocument[];
  readonly coverageGaps: readonly CoverageGap[];
};

export type FindingsChainEvidenceLink = {
  readonly linkLabel: string;
  readonly statusLabel: string;
  readonly valueText: string;
  readonly values: readonly StudyViewValue[];
};

export type FindingsChainEvidenceSection = {
  readonly chainLabel: string;
  readonly rowLabel: string;
  readonly links: readonly FindingsChainEvidenceLink[];
};

const MAX_GLANCE_METRICS = 4;
const MAX_METRIC_VALUE_CHARS = 16;

function blockRows(view: StudyView, name: string): readonly StudyViewRow[] {
  return view.blocks.find((block) => block.name === name)?.rows ?? [];
}

function allViewValues(view: StudyView): StudyViewValue[] {
  const names: readonly StudyViewBlockName[] = STUDY_VIEW_BLOCK_NAMES;
  return names.flatMap((name) => blockRows(view, name)).flatMap((row) => [...row.values]);
}

function factIdsFromValues(values: readonly StudyViewValue[]): string[] {
  return [...new Set(values.map((value) => value.factId))];
}

function allFactIds(row: StudyViewRow): string[] {
  return factIdsFromValues(row.values);
}

function checkById(pack: Pack): Map<string, PackCheck> {
  return new Map(pack.checks.map((check) => [check.id, check]));
}

function packCheckGroupTitle(study: CanonicalStudy, pack: Pack, spineId: string): string | null {
  const checks = checkById(pack);
  const linked = checkIdsLinkedToSpine(study, pack, spineId);
  for (const checkId of linked) {
    const def = checks.get(checkId);
    if (def?.group?.trim()) return def.group.trim();
  }
  return null;
}

export function fromDocumentTopicTitle(typeInPlainWords: string): string {
  const trimmed = typeInPlainWords.trim();
  if (trimmed === "") return "Other findings";
  const lower = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return `From the ${lower}`;
}

export function findingsTopicGroup(
  row: StudyViewRow,
  study: CanonicalStudy,
  pack: Pack | null,
): { key: string; title: string } {
  if (pack) {
    const packGroup = packCheckGroupTitle(study, pack, row.id);
    if (packGroup) return { key: `pack:${packGroup.toLowerCase()}`, title: packGroup };
  }
  const docId = row.values[0]?.sourceRef.sourceDocumentId.trim().toLowerCase();
  const document = docId ? study.documents.find((entry) => entry.sourceDocumentId.toLowerCase() === docId) : null;
  const type = document?.typeInPlainWords?.trim();
  if (type) {
    return { key: `doc:${docId ?? type.toLowerCase()}`, title: fromDocumentTopicTitle(type) };
  }
  return { key: "other", title: "Other findings" };
}

function statementText(row: StudyViewRow): string {
  const label = row.label?.trim();
  const statement = row.statement?.trim();
  if (label && statement) return `${label}: ${statement}`;
  if (statement) return statement;
  if (label) return label;
  return "Supporting detail";
}

function rowUncertain(row: StudyViewRow): boolean {
  const status = (row.status ?? "").toUpperCase();
  return status === "UNSUPPORTED" || status === "PARTLY_SHOWN" || status === "NOT_SHOWN" || status === "CONFLICT";
}

export function chainLinkStatusLabel(missing: boolean): string {
  return missing ? "Not shown in these documents" : "Shown in these documents";
}

export function findingsFileReadCounts(
  documents: readonly SnapshotDocument[],
): { filesRead: number; uniqueFiles: number; exactDuplicates: number } | null {
  if (documents.length === 0) return null;
  const seen = new Set<string>();
  for (const document of documents) {
    const sha = document.sha256.trim().toLowerCase();
    if (sha !== "") seen.add(sha);
  }
  const uniqueFiles = seen.size > 0 ? seen.size : documents.length;
  return {
    filesRead: documents.length,
    uniqueFiles,
    exactDuplicates: Math.max(0, documents.length - uniqueFiles),
  };
}

export function findingsPageReadCounts(
  documents: readonly SnapshotDocument[],
  coverageGaps: readonly CoverageGap[],
): { pagesRead: number; pagesTotal: number; unreadable: number } | null {
  if (documents.length === 0) return null;
  let pagesRead = 0;
  let pagesTotal = 0;
  for (const document of documents) {
    pagesRead += document.verifiedPageCount;
    pagesTotal += document.totalPhysicalPages;
  }
  if (pagesTotal === 0) return null;
  const unreadable = coverageGaps.filter(
    (gap) => gap.reason === "UNREADABLE" || gap.reason === "PAGES_WITHOUT_TEXT" || gap.reason === "PAGES_NOT_READ",
  ).length;
  return { pagesRead, pagesTotal, unreadable };
}

function supportedStatementCount(view: StudyView): number | null {
  const spine = blockRows(view, "spine_table");
  const outside = blockRows(view, "outside_spine");
  const count = [...spine, ...outside].filter((row) => row.values.length > 0).length;
  return count > 0 ? count : null;
}

function truncateMetricValue(text: string, max = MAX_METRIC_VALUE_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function valuesForComputedId(view: StudyView, computeId: string): StudyViewValue[] {
  const id = computeId.trim();
  return allViewValues(view).filter(
    (value) => value.factId === id || value.factId.endsWith(`.${id}`) || value.factId.startsWith(`${id}:`),
  );
}

function filesMetricSub(files: { uniqueFiles: number; exactDuplicates: number }): string {
  if (files.exactDuplicates > 0) {
    const dupLabel = files.exactDuplicates === 1 ? "1 exact duplicate" : `${files.exactDuplicates} exact duplicates`;
    return `${files.uniqueFiles} unique · ${dupLabel}`;
  }
  return `${files.uniqueFiles} unique`;
}

export function buildFindingsGlanceMetrics(input: FindingsGlanceMetricsInput): FindingsGlanceMetric[] {
  const metrics: FindingsGlanceMetric[] = [];
  const push = (metric: FindingsGlanceMetric) => {
    if (metrics.length >= MAX_GLANCE_METRICS) return;
    metrics.push(metric);
  };

  const files = findingsFileReadCounts(input.snapshotDocuments);
  if (files) {
    push({
      id: "files-read",
      label: "Files read",
      value: String(files.filesRead),
      sub: filesMetricSub(files),
      values: [],
      calculationId: null,
    });
  }

  const pages = findingsPageReadCounts(input.snapshotDocuments, input.coverageGaps);
  if (pages) {
    const unreadableSub =
      pages.unreadable > 0
        ? `${pages.unreadable} unreadable`
        : null;
    push({
      id: "pages-read",
      label: "Pages read",
      value: `${pages.pagesRead} of ${pages.pagesTotal}`,
      sub: unreadableSub,
      values: [],
      calculationId: null,
    });
  }

  const supported = supportedStatementCount(input.view);
  if (supported != null) {
    push({
      id: "supported-statements",
      label: "Supported statements",
      value: String(supported),
      sub: "Each tied to its page",
      values: [],
      calculationId: null,
    });
  }

  if (input.pack) {
    for (const def of input.pack.computedValues) {
      if (metrics.length >= MAX_GLANCE_METRICS) break;
      const values = valuesForComputedId(input.view, def.id);
      if (values.length === 0) continue;
      const primary = values[0]?.valueAsWritten?.trim();
      if (!primary) continue;
      push({
        id: `computed-${def.id}`,
        label: def.label.trim() || def.id,
        value: truncateMetricValue(primary),
        sub: null,
        values,
        calculationId: def.id,
      });
    }
  }

  return metrics;
}

export function buildFindingsChainEvidence(
  study: CanonicalStudy | null,
  pack: Pack | null,
  view: StudyView,
): FindingsChainEvidenceSection[] {
  if (!study?.chains?.length || !pack) return [];
  const valueByFact = new Map<string, StudyViewValue>();
  for (const value of allViewValues(view)) valueByFact.set(value.factId, value);

  const sections: FindingsChainEvidenceSection[] = [];
  for (const chain of study.chains) {
    const def = pack.chains.find((entry) => entry.id === chain.chainId);
    const chainLabel = def?.label.trim() || chain.chainId;
    for (const row of chain.rows) {
      const links: FindingsChainEvidenceLink[] = [];
      row.links.forEach((link, index) => {
        const linkLabel = def?.links[index]?.trim() || `Step ${index + 1}`;
        if ("missing" in link && link.missing) {
          links.push({
            linkLabel,
            statusLabel: chainLinkStatusLabel(true),
            valueText: "",
            values: [],
          });
          return;
        }
        if ("factIds" in link) {
          const values = link.factIds
            .map((factId) => valueByFact.get(factId))
            .filter((value): value is StudyViewValue => value !== undefined);
          const parts = values.map((value) => value.valueAsWritten.trim()).filter((part) => part !== "");
          links.push({
            linkLabel,
            statusLabel: chainLinkStatusLabel(false),
            valueText: parts.length > 0 ? parts.join(" · ") : linkLabel,
            values,
          });
        }
      });
      if (links.length > 0) {
        sections.push({
          chainLabel,
          rowLabel: row.label.trim() || "This item",
          links,
        });
      }
    }
  }
  return sections;
}

export function findingsDisplayContainsForbiddenStatusCodes(text: string): boolean {
  const lower = text.toLowerCase();
  return FINDINGS_FORBIDDEN_STATUS_CODES.some((code) => lower.includes(code));
}

export function buildFindingsOpenItems(
  view: StudyView,
  canonicalStudy: CanonicalStudy | null,
): FindingsOpenItem[] {
  const items: FindingsOpenItem[] = [];
  const spine = blockRows(view, "spine_table");
  const conflicts = blockRows(view, "conflicts");

  for (const row of conflicts) {
    items.push({
      id: `conflict-${row.id}`,
      kind: "difference",
      title: row.statement?.trim() || "Documents disagree",
      question: "What explains the difference between these records?",
      factIds: allFactIds(row),
    });
  }

  for (const row of spine) {
    const status = (row.status ?? "").toUpperCase();
    if (status === "PARTLY_SHOWN" || status === "NOT_SHOWN") {
      items.push({
        id: `spine-${row.id}`,
        kind: "needs",
        title: row.label?.trim() || row.statement?.trim() || row.id,
        question: row.issues?.[0] ?? "These documents only partly show this.",
        factIds: allFactIds(row),
      });
    }
  }

  if (canonicalStudy) {
    for (const gap of canonicalStudy.gaps) {
      if (gap.kind === "OBSERVATION") continue;
      items.push({
        id: `gap-${gap.id}`,
        kind: "missing",
        title: gap.title?.trim() || gap.statement?.trim() || gap.id,
        question: gap.why?.trim() || gap.statement?.trim() || "Could we obtain or clarify this?",
        factIds: gap.relatedFactIds,
      });
    }
  }

  const requestList = view.components?.find((entry) => entry.name === DOCUMENT_REQUEST_LIST_COMPONENT) ?? null;
  if (requestList) {
    const parts = partitionDocumentRequests(requestList);
    for (const item of parts.items) {
      items.push({
        id: `request-${item.id}`,
        kind: "missing",
        title: item.title.trim(),
        question: item.why.trim() || item.title.trim(),
        factIds: [],
      });
    }
  }

  return items;
}

export function findingsOpenItemCount(items: readonly FindingsOpenItem[]): number {
  return items.length;
}

function placeOpenItems(
  topics: Map<string, FindingsTopic>,
  openItems: readonly FindingsOpenItem[],
): { placed: Map<string, FindingsOpenItem[]>; other: FindingsOpenItem[] } {
  const placed = new Map<string, FindingsOpenItem[]>();
  const seen = new Set<string>();
  const factToTopics = new Map<string, Set<string>>();

  for (const [topicId, topic] of topics) {
    for (const statement of topic.statements) {
      for (const value of statement.values) {
        const set = factToTopics.get(value.factId) ?? new Set<string>();
        set.add(topicId);
        factToTopics.set(value.factId, set);
      }
    }
  }

  for (const item of openItems) {
    if (seen.has(item.id)) continue;
    let target: string | null = null;
    for (const factId of item.factIds) {
      const matches = factToTopics.get(factId);
      if (matches && matches.size > 0) {
        target = [...matches][0] ?? null;
        break;
      }
    }
    if (target) {
      const list = placed.get(target) ?? [];
      list.push(item);
      placed.set(target, list);
      seen.add(item.id);
    }
  }

  const other = openItems.filter((item) => !seen.has(item.id));
  return { placed, other };
}

export function buildFindingsTopics(input: {
  view: StudyView;
  canonicalStudy: CanonicalStudy | null;
  pack: Pack | null;
  openItems: readonly FindingsOpenItem[];
}): { topics: FindingsTopic[]; otherOpenItems: FindingsOpenItem[] } {
  const groups = new Map<
    string,
    { title: string; statements: FindingsTopicStatement[]; uncertain: boolean }
  >();

  const spine = blockRows(input.view, "spine_table");
  const outside = blockRows(input.view, "outside_spine");

  for (const row of spine) {
    const topic =
      input.canonicalStudy != null
        ? findingsTopicGroup(row, input.canonicalStudy, input.pack)
        : { key: row.id, title: "Other findings" };
    const entry = groups.get(topic.key) ?? { title: topic.title, statements: [], uncertain: false };
    entry.statements.push({
      id: row.id,
      text: statementText(row),
      values: row.values,
    });
    if (rowUncertain(row)) entry.uncertain = true;
    groups.set(topic.key, entry);
  }

  for (const row of outside) {
    const groupKey = "other-outside";
    const entry = groups.get(groupKey) ?? { title: "Other findings", statements: [], uncertain: false };
    entry.statements.push({
      id: row.id,
      text: statementText(row),
      values: row.values,
    });
    groups.set(groupKey, entry);
  }

  const topics = new Map<string, FindingsTopic>();
  let index = 0;
  for (const [, group] of groups) {
    index += 1;
    const id = `topic-${index}`;
    topics.set(id, {
      id,
      title: group.title,
      uncertain: group.uncertain,
      statements: group.statements,
      openItems: [],
    });
  }

  const placement = placeOpenItems(topics, input.openItems);
  for (const [topicId, items] of placement.placed) {
    const topic = topics.get(topicId);
    if (!topic) continue;
    topics.set(topicId, { ...topic, openItems: items });
  }

  return {
    topics: [...topics.values()],
    otherOpenItems: placement.other,
  };
}

export function mapLegacyFindingsTab(tab: string | undefined): string {
  const key = tab?.trim().toLowerCase() ?? "";
  if (key === "gaps" || key === "missing" || key === "review") return FINDINGS_ANCHORS.openItems;
  if (key === "timeline") return FINDINGS_ANCHORS.timeline;
  return FINDINGS_ANCHORS.topics;
}

/** Chip refs for audit / findings when sources map is available. */
export function valuesToSourceRefs(
  values: readonly StudyViewValue[],
  sources: StudyViewSources | null,
): { sourceDocumentId: string; pageNumber: number; quote?: string; factIds: string[] }[] {
  return values.map((value) => {
    const ref = sources?.facts[value.factId];
    return {
      sourceDocumentId: ref?.sourceDocumentId ?? value.sourceRef.sourceDocumentId,
      pageNumber: ref?.pageNumber ?? value.sourceRef.pageNumber,
      quote: ref?.quote ?? value.sourceRef.quote,
      factIds: [value.factId],
    };
  });
}