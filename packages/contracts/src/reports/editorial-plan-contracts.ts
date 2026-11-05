import type { A2uiComponentName } from "./application-view-contracts";
import type {
  WriterEditorialInsight,
  WriterFindingPriority,
  WriterPriorityFinding,
  WriterSummaryDetailLevel,
} from "./writer-agent";
import type { ReportAudience, ReportBlockType, ScenarioDefinition } from "./writer-report-contracts";

/**
 * `hive.editorial-plan/1` (V4-004K.1 / V4-005): model-owned narrative and presentation proposal
 * over an accepted Canonical Study. The model authors narrative sentences, summaries, sections,
 * interpretations, questions, next steps, and A2UI layouts from the approved 13-component catalog;
 * Hive validates claim IDs, source bindings, numeric grounding, temporal status, missing-record
 * request IDs, and semantic support before publication.
 */
export const EDITORIAL_PLAN_SCHEMA = "hive.editorial-plan/1" as const;

export const EDITORIAL_SUPPORTED_COMPONENTS = [
  "Narrative",
  "RecordTable",
  "Comparison",
  "Timeline",
  "Metric",
  "KeyFindings",
  "EvidencePanel",
  "ScenarioExplorer",
] as const satisfies readonly A2uiComponentName[];

/**
 * Model-selectable A2UI components in V4-005. (`SourceReferences` is automatically bound by
 * `bindApplicationView` at the end of every report, and is also accepted if explicitly placed.)
 */
export const EDITORIAL_MODEL_COMPONENTS = [
  "Narrative",
  "KeyFindings",
  "Metric",
  "RecordTable",
  "Comparison",
  "Timeline",
  "IssueList",
  "QuestionList",
  "EvidencePanel",
  "Chart",
  "Checklist",
  "ScenarioExplorer",
  "SourceReferences",
] as const satisfies readonly A2uiComponentName[];

export type EditorialSupportedComponentName = (typeof EDITORIAL_MODEL_COMPONENTS)[number];

/** Model-authored narrative block unit with explicit verified Study claim IDs. */
export type EditorialNarrativeBlockUnit = {
  readonly type: ReportBlockType;
  readonly text: string;
  readonly claimRefs: readonly string[];
};

/** Model-authored documented narrative unit (`text` + `claimRefs`). */
export type EditorialDocumentedUnit = {
  readonly text: string;
  readonly claimRefs: readonly string[];
};

export type EditorialInterpretationUnit = {
  readonly text: string;
  readonly claimRefs: readonly string[];
};

/** Model-authored uncertainty prose; claim refs must include every cited uncertainty/limitation. */
export type EditorialAuthoredUncertaintyUnit = {
  readonly text: string;
  readonly claimRefs: readonly string[];
};

/** Deterministic uncertainty block compiled verbatim from Study uncertainty/limitation claim text (legacy compatibility). */
export type EditorialCompiledUncertaintyUnit = {
  readonly mode: "compiled";
  readonly claimIds: readonly string[];
};

export type EditorialUncertaintyUnit = EditorialAuthoredUncertaintyUnit | EditorialCompiledUncertaintyUnit;

/**
 * Structured missing-document request unit (V4-004K.5B / V4-005).
 * Trusted code derives the canonical deterministic `requestId` from the verified Study gap
 * identity and missing-record target, binds source page references from `supportingClaimIds`,
 * and compiles the unit to a `QUESTION` report block.
 */
export type EditorialMissingDocumentRequestUnit = {
  readonly gapClaimIds: readonly string[];
  readonly supportingClaimIds: readonly string[];
  readonly text: string;
  readonly blockedAnalysis?: string;
};

export type EditorialQuestionUnit = {
  readonly text: string;
  readonly claimRefs: readonly string[];
};

export type EditorialNextStepUnit = {
  readonly text: string;
  readonly claimRefs: readonly string[];
};

export type EditorialSummaryPlan = {
  /** Model-authored summary narrative prose (V4-005). */
  readonly text?: string;
  /** Verified Study claim IDs supporting `summary.text` (V4-005). */
  readonly claimRefs?: readonly string[];
  /** Optional multi-block model-authored summary (V4-005). */
  readonly blocks?: readonly EditorialNarrativeBlockUnit[];
  /** Legacy claim-ID list (retained for backward compatibility when `text` and `blocks` are omitted). */
  readonly documentedClaimIds?: readonly string[];
  /** Verified calculation claim IDs appended as grounded `{{calc:…}}` bindings (optional suffix per calc). */
  readonly calculationBindings?: readonly { readonly calcId: string; readonly suffix?: string }[];
};

export type EditorialSectionPlan = {
  readonly id: string;
  readonly heading: string;
  readonly priority: WriterFindingPriority;
  readonly goalIds?: readonly string[];
  readonly specialistQuestionIds?: readonly string[];
  readonly insightIds?: readonly string[];
  readonly purpose?: string;
  /** Model-authored narrative blocks in reading order (V4-005). */
  readonly blocks?: readonly EditorialNarrativeBlockUnit[];
  /** Model-authored documented narrative unit (`{ text, claimRefs }`, V4-005). */
  readonly documented?: EditorialDocumentedUnit;
  /** Legacy claim-ID list (retained for backward compatibility when `blocks` and `documented` are omitted). */
  readonly documentedClaimIds?: readonly string[];
  readonly interpretation?: EditorialInterpretationUnit;
  readonly uncertainty?: EditorialUncertaintyUnit;
  readonly questions?: readonly EditorialQuestionUnit[];
  readonly nextSteps?: readonly EditorialNextStepUnit[];
  readonly missingDocumentRequests?: readonly EditorialMissingDocumentRequestUnit[];
};

export type EditorialRecordTableRowPlan = {
  /** Optional model-authored cell strings (one per column); grounded against row claims. */
  readonly cells?: readonly string[];
  /** Optional row-level claim refs when `cells` are model-authored. */
  readonly claimRefs?: readonly string[];
  /** Per-column claim IDs (used to bind/format cells or provide cell-level provenance). */
  readonly cellClaimIds?: readonly (readonly string[])[];
};

export type EditorialRecordTableLayout = {
  readonly kind: "RecordTable";
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly EditorialRecordTableRowPlan[];
};

export type EditorialComparisonItemPlan = {
  readonly label: string;
  /** Optional model-authored left column text; grounded in `leftClaimIds` / `claimRefs`. */
  readonly left?: string;
  /** Optional model-authored right column text; grounded in `rightClaimIds` / `claimRefs`. */
  readonly right?: string;
  readonly leftClaimIds?: readonly string[];
  readonly rightClaimIds?: readonly string[];
  readonly claimRefs?: readonly string[];
};

export type EditorialComparisonLayout = {
  readonly kind: "Comparison";
  readonly title: string;
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly items: readonly EditorialComparisonItemPlan[];
};

export type EditorialTimelineEventPlan = {
  /** Optional model-authored date label; grounded in `dateClaimIds` / `claimRefs`. */
  readonly date?: string;
  /** Optional model-authored event description; grounded in `textClaimIds` / `claimRefs`. */
  readonly text?: string;
  readonly dateClaimIds?: readonly string[];
  readonly textClaimIds?: readonly string[];
  readonly claimRefs?: readonly string[];
};

export type EditorialTimelineLayout = {
  readonly kind: "Timeline";
  readonly title: string;
  readonly events: readonly EditorialTimelineEventPlan[];
};

export type EditorialMetricLayout = {
  readonly kind: "Metric";
  readonly label: string;
  readonly binding: string;
  readonly claimIds: readonly string[];
  readonly unit?: string | null;
};

export type EditorialKeyFindingsLayout = {
  readonly kind: "KeyFindings";
  readonly title: string;
  readonly claimIds: readonly string[];
};

export type EditorialEvidencePanelLayout = {
  readonly kind: "EvidencePanel";
  readonly title: string;
  readonly claimIds: readonly string[];
};

export type EditorialIssueListItemPlan = {
  readonly text: string;
  readonly severity: "HIGH" | "MEDIUM" | "LOW";
  readonly claimRefs: readonly string[];
};

export type EditorialIssueListLayout = {
  readonly kind: "IssueList";
  readonly title: string;
  readonly issues: readonly EditorialIssueListItemPlan[];
};

export type EditorialQuestionListItemPlan = {
  readonly text: string;
  readonly claimRefs: readonly string[];
};

export type EditorialQuestionListLayout = {
  readonly kind: "QuestionList";
  readonly title: string;
  readonly questions: readonly EditorialQuestionListItemPlan[];
};

export type EditorialChecklistItemPlan = {
  readonly text: string;
  readonly claimRefs: readonly string[];
};

export type EditorialChecklistLayout = {
  readonly kind: "Checklist";
  readonly title: string;
  readonly items: readonly EditorialChecklistItemPlan[];
};

export type EditorialChartPointPlan = {
  readonly label: string;
  readonly binding: string;
};

export type EditorialChartLayout = {
  readonly kind: "Chart";
  readonly title: string;
  readonly chartKind: "bar" | "line";
  readonly unit?: string | null;
  readonly points: readonly EditorialChartPointPlan[];
};

export type EditorialComponentLayout =
  | EditorialRecordTableLayout
  | EditorialComparisonLayout
  | EditorialTimelineLayout
  | EditorialMetricLayout
  | EditorialKeyFindingsLayout
  | EditorialEvidencePanelLayout
  | EditorialIssueListLayout
  | EditorialQuestionListLayout
  | EditorialChecklistLayout
  | EditorialChartLayout
  | { readonly kind: "Narrative" }
  | { readonly kind: "ScenarioExplorer" }
  | { readonly kind: "SourceReferences" };

export type EditorialComponentPlan = {
  readonly component: A2uiComponentName;
  readonly sectionId?: string | null;
  readonly scenarioId?: string | null;
  readonly claimIds: readonly string[];
  readonly insightIds?: readonly string[];
  readonly purpose?: string;
  readonly reuseReason?: string;
  readonly layout: EditorialComponentLayout;
};

export type EditorialPlan = {
  readonly schema?: typeof EDITORIAL_PLAN_SCHEMA;
  readonly audience: ReportAudience;
  readonly title: string;
  readonly audienceObjective: string;
  readonly summaryDetailLevel: WriterSummaryDetailLevel;
  readonly insights?: readonly WriterEditorialInsight[];
  readonly priorityFindings: readonly WriterPriorityFinding[];
  readonly summary: EditorialSummaryPlan;
  readonly sections: readonly EditorialSectionPlan[];
  readonly components: readonly EditorialComponentPlan[];
  readonly scenarios?: readonly ScenarioDefinition[];
};
