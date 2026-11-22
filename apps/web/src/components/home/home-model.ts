import type {
  FindingsOpenItem,
  FindingsTopic,
  HiveMessage,
  LegacyHomeProjection,
  StudyViewRow,
  StudyViewSources,
  StudyViewValue,
} from "@hiveforyou/contracts";

import { compareMessages } from "@/components/hives/hive-conversation-view";
import { messageDayLabel, messageTimeLabel } from "@/components/hives/hive-conversation-view";
import { statusToState, type DisplayState } from "@/components/study/status-state";
import { personFirstName } from "@/lib/hives/firm-board";

export type HomeChip = {
  sourceDocumentId: string;
  pageNumber: number;
  quote?: string;
  factIds?: string[];
};

export type HomeTopicModel = {
  id: string;
  title: string;
  uncertain: boolean;
  statements: { id: string; text: string; refs: HomeChip[] }[];
};

export type HomeReviewStep = {
  id: string;
  kind: FindingsOpenItem["kind"];
  title: string;
  detail: string;
  refs: HomeChip[];
};

export type HomeCoverageRow = {
  id: string;
  label: string;
  state: DisplayState | null;
};

export type HomeCalculation = {
  id: string;
  label: string;
  detail: string;
};

export type HiveHomeContent = {
  hasStudy: boolean;
  documentsIn: number;
  checklistSize: number | null;
  toReview: number;
  stillToCome: string[];
  lastWrote: { name: string; when: string } | null;
  study: { revisionNumber: number; acceptedLabel: string } | null;
  reviewSteps: HomeReviewStep[];
  topics: HomeTopicModel[];
  statementCount: number;
  coverage: HomeCoverageRow[];
  calculations: HomeCalculation[];
};

export function stillToComeTitles(items: readonly { title: string; status: string }[]): string[] {
  return items.filter((item) => item.status === "not_in").map((item) => item.title.trim()).filter(Boolean);
}

export function missingRecordsDetail(titles: readonly string[]): string {
  const shown = titles.slice(0, 2).join(" · ");
  const extra = titles.length - 2;
  return extra > 0 ? `${shown} · ${extra} more` : shown;
}

export function missingRecordsTitle(count: number, clientFirstName: string | null): string {
  const who = clientFirstName?.trim() || "the client";
  const noun = count === 1 ? "record" : "records";
  return `Ask ${who} for ${count} missing ${noun}`;
}

export function findMissingRecordsTitle(count: number): string {
  const noun = count === 1 ? "record" : "records";
  return `Find ${count} missing ${noun}`;
}

export function requestComposerText(titles: readonly string[]): string {
  return titles.map((title) => title.trim()).filter(Boolean).join("\n");
}

export function formatAcceptedDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(parsed));
}

export function lastWroteWhen(createdAt: string, now: Date): string {
  const day = messageDayLabel(createdAt, now);
  const time = messageTimeLabel(createdAt);
  if (day === "Today") return `today at ${time}`;
  if (day === "Yesterday") return `yesterday at ${time}`;
  return day;
}

export function lastWroteFromMessages(
  messages: readonly HiveMessage[],
  now: Date,
): { name: string; when: string } | null {
  const sorted = [...messages].sort(compareMessages);
  const last = [...sorted].reverse().find((message) => message.authorKind === "person" && !message.isMine);
  if (!last) return null;
  const name = personFirstName(last.authorDisplayName);
  if (!name) return null;
  return { name, when: lastWroteWhen(last.createdAt, now) };
}

function chipFromValue(value: StudyViewValue): HomeChip {
  return {
    sourceDocumentId: value.sourceRef.sourceDocumentId,
    pageNumber: value.sourceRef.pageNumber,
    quote: value.sourceRef.quote,
    factIds: [value.factId],
  };
}

function chipsForFacts(factIds: readonly string[], sources: StudyViewSources | null): HomeChip[] {
  if (!sources) return [];
  const chips: HomeChip[] = [];
  for (const factId of factIds) {
    const ref = sources.facts[factId];
    if (!ref) continue;
    chips.push({
      sourceDocumentId: ref.sourceDocumentId,
      pageNumber: ref.pageNumber,
      quote: ref.quote,
      factIds: [factId],
    });
  }
  return chips;
}

function coverageLabel(row: StudyViewRow): string {
  const type = row.typeInPlainWords?.trim();
  if (type) return type;
  const label = row.label?.trim();
  if (label && !/\.[a-z0-9]{2,5}$/i.test(label)) return label;
  return "Document";
}

function legacyDocumentLabel(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return "Document";
  return trimmed.replace(/\.[^./\\]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || trimmed;
}

export function calculationLines(
  values: readonly { id: string; label: string; op: string; inputs: string; per: string }[],
): HomeCalculation[] {
  const lines: HomeCalculation[] = [];
  for (const value of values) {
    const label = value.label.trim() || value.id;
    const detail = [value.op.trim(), value.inputs.trim(), value.per.trim() ? `per ${value.per.trim()}` : ""]
      .filter(Boolean)
      .join(" · ");
    if (!detail) continue;
    lines.push({ id: value.id, label, detail });
  }
  return lines;
}

export function buildHiveHomeContent(input: {
  documentCount: number;
  checklist: readonly { title: string; status: string }[] | null;
  progress: { in: number; total: number } | null;
  openItems: readonly FindingsOpenItem[];
  topics: readonly FindingsTopic[];
  sources: StudyViewSources | null;
  messages: readonly HiveMessage[];
  now: Date;
  study: { revisionNumber: number; acceptedAt: string } | null;
  documentRows: readonly StudyViewRow[];
  calculations: readonly { id: string; label: string; op: string; inputs: string; per: string }[];
  legacyHome?: LegacyHomeProjection | null;
  legacyDocuments?: readonly { sourceDocumentId: string; fileName: string; eligible: boolean }[];
}): HiveHomeContent {
  const checklist = input.checklist ?? [];
  const checklistSize = input.progress && input.progress.total > 0 ? input.progress.total : null;
  const documentsIn = checklistSize != null ? input.progress!.in : input.documentCount;
  const stillToCome = stillToComeTitles(checklist);
  const useLegacyTopics = input.topics.length === 0 && (input.legacyHome?.topics.length ?? 0) > 0;
  const topics: HomeTopicModel[] = useLegacyTopics
    ? input.legacyHome!.topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        uncertain: topic.uncertain,
        statements: topic.statements.map((statement) => ({
          id: statement.id,
          text: statement.text,
          refs: statement.refs.map((ref) => ({
            sourceDocumentId: ref.sourceDocumentId,
            pageNumber: ref.pageNumber,
            quote: ref.quote || undefined,
            factIds: [ref.factId],
          })),
        })),
      }))
    : input.topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        uncertain: topic.uncertain,
        statements: topic.statements.map((statement) => ({
          id: statement.id,
          text: statement.text,
          refs: statement.values.map(chipFromValue),
        })),
      }));
  const useLegacyOpenItems = input.openItems.length === 0 && (input.legacyHome?.openItems.length ?? 0) > 0;
  const reviewSteps: HomeReviewStep[] = useLegacyOpenItems
    ? input.legacyHome!.openItems.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        detail: item.detail,
        refs: item.refs.map((ref) => ({
          sourceDocumentId: ref.sourceDocumentId,
          pageNumber: ref.pageNumber,
          quote: ref.quote || undefined,
          factIds: [ref.factId],
        })),
      }))
    : input.openItems.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        detail: item.question,
        refs: chipsForFacts(item.factIds, input.sources),
      }));
  const coverage: HomeCoverageRow[] =
    input.documentRows.length > 0
      ? input.documentRows.map((row) => ({
          id: row.id,
          label: coverageLabel(row),
          state: statusToState(row.status),
        }))
      : (input.legacyDocuments ?? []).map((doc) => ({
          id: doc.sourceDocumentId,
          label: legacyDocumentLabel(doc.fileName),
          state: doc.eligible ? ("checked" as const) : ("missing" as const),
        }));
  const statementCount = topics.reduce((sum, topic) => sum + topic.statements.length, 0);
  return {
    hasStudy: input.study != null,
    documentsIn,
    checklistSize,
    toReview: reviewSteps.length,
    stillToCome,
    lastWrote: lastWroteFromMessages(input.messages, input.now),
    study:
      input.study && formatAcceptedDate(input.study.acceptedAt)
        ? { revisionNumber: input.study.revisionNumber, acceptedLabel: formatAcceptedDate(input.study.acceptedAt) }
        : input.study
          ? { revisionNumber: input.study.revisionNumber, acceptedLabel: "" }
          : null,
    reviewSteps,
    topics,
    statementCount,
    coverage,
    calculations: calculationLines(input.calculations),
  };
}
