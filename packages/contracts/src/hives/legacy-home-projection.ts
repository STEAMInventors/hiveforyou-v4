/**
 * P0.6 — Deterministic Home projection for accepted legacy (`investigation-1`) studies.
 *
 * Canonical `hive.study-view/1` takes strict precedence: when a canonical study view exists,
 * this projection returns empty. For accepted legacy revisions, it extracts strictly
 * source-backed statements, open review items, and comparisons from authenticated
 * `hive-application-view/1` reports belonging to the SAME accepted study revision
 * (latest Customer first, then latest Pro). Never synthesizes facts, never crosses revisions,
 * and drops any item without an authorized, page-bounded source reference.
 */

import { isValidUuid } from "./hive-contracts";
import { isStudyView, type StudyView } from "../pipeline/study-view-contracts";
import {
  APPLICATION_VIEW_SCHEMA,
  type ApplicationView,
  type BoundRef,
} from "../reports/application-view-contracts";
import {
  type ApplicationViewReport,
  type HiveReport,
  isStudyViewReport,
} from "../reports/report-contracts";
import type { ReportAudience } from "../reports/writer-report-contracts";

export type LegacyHomeRef = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly fileName: string;
  readonly factId: string;
  readonly quote: string;
};

export type LegacyHomeStatement = {
  readonly id: string;
  readonly text: string;
  readonly refs: readonly LegacyHomeRef[];
};

export type LegacyHomeTopic = {
  readonly id: string;
  readonly title: string;
  readonly uncertain: boolean;
  readonly statements: readonly LegacyHomeStatement[];
};

export type LegacyHomeOpenItem = {
  readonly id: string;
  readonly kind: "needs";
  readonly title: string;
  readonly detail: string;
  readonly refs: readonly LegacyHomeRef[];
};

export type LegacyHomeComparisonItem = {
  readonly id: string;
  readonly label: string;
  readonly left: string;
  readonly right: string;
  readonly refs: readonly LegacyHomeRef[];
};

export type LegacyHomeComparison = {
  readonly id: string;
  readonly title: string;
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly items: readonly LegacyHomeComparisonItem[];
};

export type LegacyHomeReportAttribution = {
  readonly reportId: string;
  readonly studyRevisionId: string;
  readonly revisionNumber: number;
  readonly audience: ReportAudience;
  readonly title: string;
  readonly createdAt: string;
};

export type LegacyHomeProjection = {
  readonly report: LegacyHomeReportAttribution | null;
  readonly topics: readonly LegacyHomeTopic[];
  readonly openItems: readonly LegacyHomeOpenItem[];
  readonly comparisons: readonly LegacyHomeComparison[];
  readonly statementCount: number;
};

export const EMPTY_LEGACY_HOME_PROJECTION: LegacyHomeProjection = {
  report: null,
  topics: [],
  openItems: [],
  comparisons: [],
  statementCount: 0,
};

export type ProjectLegacyHomeOptions = {
  readonly authorizedSourceDocumentIds?: readonly string[];
  readonly authorizedDocumentPages?: Readonly<Record<string, number>>;
};

function normalizeUuid(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isValidUuid(normalized) ? normalized : null;
}

function normalizeProse(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function authorizedDocumentIdSet(ids: readonly string[] | null | undefined): ReadonlySet<string> | null {
  if (ids === undefined || ids === null) return null;
  return new Set(ids.map((id) => id.trim().toLowerCase()).filter((id) => isValidUuid(id)));
}

function authorizedDocumentPageMap(
  pages: Readonly<Record<string, number>> | null | undefined,
): ReadonlyMap<string, number> | null {
  if (!pages) return null;
  const map = new Map<string, number>();
  for (const [id, count] of Object.entries(pages)) {
    const normalized = id.trim().toLowerCase();
    if (!isValidUuid(normalized)) continue;
    if (typeof count === "number" && Number.isInteger(count) && count >= 1) {
      map.set(normalized, count);
    }
  }
  return map.size > 0 ? map : null;
}

function isResolvableRef(ref: BoundRef): boolean {
  if (!ref || typeof ref.sourceDocumentId !== "string" || typeof ref.fileName !== "string") return false;
  const documentId = ref.sourceDocumentId.trim().toLowerCase();
  return isValidUuid(documentId) && Number.isInteger(ref.pageNumber) && ref.pageNumber >= 1 && ref.fileName.trim() !== "";
}

function filterAuthorizedRefs(
  refs: readonly BoundRef[] | null | undefined,
  authorizedIds: ReadonlySet<string> | null,
  authorizedPages: ReadonlyMap<string, number> | null,
  factIdPrefix: string,
  quote = "",
): LegacyHomeRef[] {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const seen = new Set<string>();
  const out: LegacyHomeRef[] = [];
  refs.forEach((ref, index) => {
    if (!isResolvableRef(ref)) return;
    const docId = ref.sourceDocumentId.trim().toLowerCase();
    if (authorizedIds !== null && !authorizedIds.has(docId)) return;
    const maxPages = authorizedPages?.get(docId);
    if (maxPages !== undefined && ref.pageNumber > maxPages) return;
    const key = `${docId}:${ref.pageNumber}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      sourceDocumentId: docId,
      pageNumber: ref.pageNumber,
      fileName: ref.fileName.trim(),
      factId: `${factIdPrefix}:r${index}`,
      quote: quote.trim(),
    });
  });
  return out;
}

function orderedSameRevisionApplicationReports(
  reports: readonly HiveReport[] | null | undefined,
  acceptedStudyRevisionId: string | null | undefined,
): ApplicationViewReport[] {
  if (!reports?.length) return [];
  const targetRevisionId = normalizeUuid(acceptedStudyRevisionId);
  if (!targetRevisionId) return [];

  const saved = reports.filter((report): report is ApplicationViewReport => {
    if (isStudyViewReport(report)) return false;
    return normalizeUuid(report.studyRevisionId) === targetRevisionId;
  });

  const customer = saved.filter((report) => report.audience === "CUSTOMER");
  const pro = saved.filter((report) => report.audience === "PRO");
  const other = saved.filter((report) => report.audience !== "CUSTOMER" && report.audience !== "PRO");
  return [...customer, ...pro, ...other];
}

/** Projects source-backed Home topics, open review items, and comparisons from one saved ApplicationView. */
export function projectApplicationViewHome(
  view: ApplicationView,
  options?: ProjectLegacyHomeOptions,
): Omit<LegacyHomeProjection, "report"> {
  if (!view || view.schema !== APPLICATION_VIEW_SCHEMA || !Array.isArray(view.components)) {
    return { topics: [], openItems: [], comparisons: [], statementCount: 0 };
  }

  const authorizedIds = authorizedDocumentIdSet(options?.authorizedSourceDocumentIds);
  const authorizedPages = authorizedDocumentPageMap(options?.authorizedDocumentPages);
  const seenStatements = new Set<string>();
  const seenOpenItems = new Set<string>();

  const topics: LegacyHomeTopic[] = [];
  const openItems: LegacyHomeOpenItem[] = [];
  const comparisons: LegacyHomeComparison[] = [];

  const pushOpenItem = (id: string, title: string, detail: string, refs: LegacyHomeRef[]) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || refs.length === 0) return;
    const key = normalizeProse(trimmedTitle);
    if (seenOpenItems.has(key)) return;
    seenOpenItems.add(key);
    openItems.push({
      id,
      kind: "needs",
      title: trimmedTitle,
      detail: detail.trim(),
      refs,
    });
  };

  view.components.forEach((component, componentIndex) => {
    const compId = component.id?.trim() || `c${componentIndex}`;

    switch (component.component) {
      case "KeyFindings": {
        const statements: LegacyHomeStatement[] = [];
        component.items.forEach((item, itemIndex) => {
          const text = item.text?.trim() ?? "";
          if (!text) return;
          const key = normalizeProse(text);
          if (seenStatements.has(key)) return;
          const quote = item.quotes?.[0] ?? "";
          const refs = filterAuthorizedRefs(
            item.refs,
            authorizedIds,
            authorizedPages,
            `AVH-KF${componentIndex}-I${itemIndex}`,
            quote,
          );
          if (refs.length === 0) return;
          seenStatements.add(key);
          statements.push({ id: `av-kf-${compId}-${itemIndex}`, text, refs });
        });
        if (statements.length > 0) {
          topics.push({
            id: `av-topic-${compId}`,
            title: component.title?.trim() || "Key findings",
            uncertain: false,
            statements,
          });
        }
        break;
      }

      case "EvidencePanel": {
        const statements: LegacyHomeStatement[] = [];
        component.claims.forEach((claim, claimIndex) => {
          const text = claim.text?.trim() ?? "";
          if (!text) return;
          const key = normalizeProse(text);
          if (seenStatements.has(key)) return;
          const quote = claim.quotes?.[0] ?? "";
          const refs = filterAuthorizedRefs(
            claim.refs,
            authorizedIds,
            authorizedPages,
            `AVH-EP${componentIndex}-C${claimIndex}`,
            quote,
          );
          if (refs.length === 0) return;
          seenStatements.add(key);
          statements.push({ id: `av-ep-${compId}-${claimIndex}`, text, refs });
        });
        if (statements.length > 0) {
          topics.push({
            id: `av-topic-${compId}`,
            title: component.title?.trim() || "Supporting evidence",
            uncertain: false,
            statements,
          });
        }
        break;
      }

      case "Narrative": {
        const heading = component.heading?.trim() || "Summary";
        const statements: LegacyHomeStatement[] = [];
        let uncertainCount = 0;

        component.blocks.forEach((block, blockIndex) => {
          const text = block.text?.trim() ?? "";
          if (!text) return;
          const refs = filterAuthorizedRefs(
            block.refs,
            authorizedIds,
            authorizedPages,
            `AVH-N${componentIndex}-B${blockIndex}`,
          );
          if (refs.length === 0) return;

          if (block.type === "QUESTION" || block.type === "NEXT_STEP") {
            pushOpenItem(`av-open-${compId}-${blockIndex}`, text, heading === "Summary" ? "" : heading, refs);
            return;
          }

          const key = normalizeProse(text);
          if (seenStatements.has(key)) return;
          seenStatements.add(key);
          if (block.type === "UNCERTAINTY") {
            uncertainCount += 1;
          }
          statements.push({ id: `av-n-${compId}-${blockIndex}`, text, refs });
        });

        if (statements.length > 0) {
          topics.push({
            id: `av-topic-${compId}`,
            title: heading,
            uncertain: uncertainCount === statements.length,
            statements,
          });
        }
        break;
      }

      case "IssueList": {
        const sectionTitle = component.title?.trim() || "";
        component.issues.forEach((issue, issueIndex) => {
          const refs = filterAuthorizedRefs(
            issue.refs,
            authorizedIds,
            authorizedPages,
            `AVH-IS${componentIndex}-I${issueIndex}`,
          );
          pushOpenItem(`av-issue-${compId}-${issueIndex}`, issue.text ?? "", sectionTitle, refs);
        });
        break;
      }

      case "QuestionList": {
        const sectionTitle = component.title?.trim() || "";
        component.questions.forEach((question, questionIndex) => {
          const refs = filterAuthorizedRefs(
            question.refs,
            authorizedIds,
            authorizedPages,
            `AVH-QL${componentIndex}-Q${questionIndex}`,
          );
          pushOpenItem(`av-question-${compId}-${questionIndex}`, question.text ?? "", sectionTitle, refs);
        });
        break;
      }

      case "Checklist": {
        const sectionTitle = component.title?.trim() || "";
        component.items.forEach((item, itemIndex) => {
          const refs = filterAuthorizedRefs(
            item.refs,
            authorizedIds,
            authorizedPages,
            `AVH-CL${componentIndex}-I${itemIndex}`,
          );
          pushOpenItem(`av-check-${compId}-${itemIndex}`, item.text ?? "", sectionTitle, refs);
        });
        break;
      }

      case "Comparison": {
        const items: LegacyHomeComparisonItem[] = [];
        component.items.forEach((item, itemIndex) => {
          const label = item.label?.trim() ?? "";
          const left = item.left?.trim() ?? "";
          const right = item.right?.trim() ?? "";
          if (!label || (!left && !right)) return;
          const refs = filterAuthorizedRefs(
            item.refs,
            authorizedIds,
            authorizedPages,
            `AVH-CMP${componentIndex}-I${itemIndex}`,
          );
          if (refs.length === 0) return;
          items.push({
            id: `av-cmp-${compId}-${itemIndex}`,
            label,
            left: left || "—",
            right: right || "—",
            refs,
          });
        });
        if (items.length > 0) {
          comparisons.push({
            id: `av-cmp-${compId}`,
            title: component.title?.trim() || "Comparison",
            leftLabel: component.leftLabel?.trim() || "Side A",
            rightLabel: component.rightLabel?.trim() || "Side B",
            items,
          });
        }
        break;
      }

      default:
        break;
    }
  });

  const statementCount = topics.reduce((sum, topic) => sum + topic.statements.length, 0);
  return { topics, openItems, comparisons, statementCount };
}

/**
 * Resolves Home findings, open review items, and comparisons for an accepted legacy study
 * from the latest Customer (or else Pro) saved `hive-application-view/1` report belonging to
 * the SAME accepted study revision. Returns empty whenever a canonical `hive.study-view/1` exists.
 */
export function resolveLegacyHomeProjection(input: {
  readonly studyView: StudyView | null;
  readonly reports: readonly HiveReport[] | null | undefined;
  readonly acceptedStudyRevisionId: string | null | undefined;
  readonly authorizedSourceDocumentIds?: readonly string[];
  readonly authorizedDocumentPages?: Readonly<Record<string, number>>;
}): LegacyHomeProjection {
  if (input.studyView && isStudyView(input.studyView)) {
    return EMPTY_LEGACY_HOME_PROJECTION;
  }

  const candidates = orderedSameRevisionApplicationReports(input.reports, input.acceptedStudyRevisionId);
  for (const report of candidates) {
    const projected = projectApplicationViewHome(report.view, {
      authorizedSourceDocumentIds: input.authorizedSourceDocumentIds,
      authorizedDocumentPages: input.authorizedDocumentPages,
    });
    if (
      projected.statementCount > 0 ||
      projected.openItems.length > 0 ||
      projected.comparisons.length > 0
    ) {
      return {
        report: {
          reportId: report.id.trim().toLowerCase(),
          studyRevisionId: report.studyRevisionId.trim().toLowerCase(),
          revisionNumber: report.revisionNumber,
          audience: report.audience,
          title: report.title,
          createdAt: report.createdAt,
        },
        ...projected,
      };
    }
  }

  return EMPTY_LEGACY_HOME_PROJECTION;
}
