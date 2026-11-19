import type { CanonicalStudy } from "../pipeline/canonical-study-contracts";
import type { Pack, PackCheck } from "../pipeline/pack-contracts";
import { checkIdsLinkedToSpine } from "../pipeline/spine-check-display";
import type { StudyView, StudyViewRow, StudyViewSources, StudyViewValue } from "../pipeline/study-view-contracts";
import { partitionDocumentRequests, DOCUMENT_REQUEST_LIST_COMPONENT } from "../pipeline/document-request-list-contracts";

export const FINDINGS_ANCHORS = {
  topics: "topics",
  openItems: "open-items",
  timeline: "timeline",
} as const;

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

function blockRows(view: StudyView, name: string): readonly StudyViewRow[] {
  return view.blocks.find((block) => block.name === name)?.rows ?? [];
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

function spineGroupForElement(study: CanonicalStudy, pack: Pack | null, spineId: string): string {
  if (!pack) {
    const element = study.spine.find((item) => item.id === spineId);
    return element?.kind?.trim() || element?.label?.trim() || "General";
  }
  const checks = checkById(pack);
  const linked = checkIdsLinkedToSpine(study, pack, spineId);
  for (const checkId of linked) {
    const def = checks.get(checkId);
    if (def?.group?.trim()) return def.group.trim();
  }
  const element = study.spine.find((item) => item.id === spineId);
  return element?.kind?.trim() || "General";
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
    const groupKey = input.canonicalStudy
      ? spineGroupForElement(input.canonicalStudy, input.pack, row.id)
      : row.kind?.trim() || row.label?.trim() || "General";
    const entry = groups.get(groupKey) ?? { title: groupKey, statements: [], uncertain: false };
    entry.statements.push({
      id: row.id,
      text: statementText(row),
      values: row.values,
    });
    if (rowUncertain(row)) entry.uncertain = true;
    groups.set(groupKey, entry);
  }

  for (const row of outside) {
    const groupKey = "Other supporting detail";
    const entry = groups.get(groupKey) ?? { title: groupKey, statements: [], uncertain: false };
    entry.statements.push({
      id: row.id,
      text: statementText(row),
      values: row.values,
    });
    groups.set(groupKey, entry);
  }

  const topics = new Map<string, FindingsTopic>();
  let index = 0;
  for (const [title, group] of groups) {
    index += 1;
    const id = `topic-${index}`;
    topics.set(id, {
      id,
      title,
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

export function buildFindingsGlanceMetrics(view: StudyView, pack: Pack | null): FindingsGlanceMetric[] {
  const chains = blockRows(view, "chains");
  if (chains.length === 0) return [];
  const metrics: FindingsGlanceMetric[] = [];
  for (const row of chains) {
    if (row.values.length === 0) continue;
    const label = row.label?.trim() || row.statement?.trim() || "At a glance";
    const primary = row.values[0]?.valueAsWritten?.trim();
    if (!primary) continue;
    metrics.push({
      id: row.id,
      label,
      value: primary,
      sub: row.kind?.trim() || null,
      values: row.values,
      calculationId: pack?.computedValues.some((c) => row.id.includes(c.id)) ? row.id : null,
    });
  }
  return metrics;
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