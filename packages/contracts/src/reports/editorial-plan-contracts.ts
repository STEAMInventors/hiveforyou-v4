import type { A2uiComponentName } from "./application-view-contracts";
import type {
  WriterEditorialInsight,
  WriterFindingPriority,
  WriterPriorityFinding,
  WriterSummaryDetailLevel,
} from "./writer-agent";
import type { ReportAudience, ScenarioDefinition } from "./writer-report-contracts";

/**
 * `hive.editorial-plan/1` (V4-004K.1): minimal model-authored editorial selections and
 * interpretation text. Trusted code compiles deterministic DOCUMENTED blocks and A2UI props;
 * it never infers professional conclusions or broadens citations beyond explicit selections.
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

export type EditorialSupportedComponentName = (typeof EDITORIAL_SUPPORTED_COMPONENTS)[number];

export type EditorialInterpretationUnit = {
  readonly text: string;
  readonly claimRefs: readonly string[];
};

/** Model-authored uncertainty prose; claim refs must include every cited uncertainty/limitation. */
export type EditorialAuthoredUncertaintyUnit = {
  readonly text: string;
  readonly claimRefs: readonly string[];
};

/** Deterministic uncertainty block compiled verbatim from Study uncertainty/limitation claim text. */
export type EditorialCompiledUncertaintyUnit = {
  readonly mode: "compiled";
  readonly claimIds: readonly string[];
};

export type EditorialUncertaintyUnit = EditorialAuthoredUncertaintyUnit | EditorialCompiledUncertaintyUnit;

export type EditorialSummaryPlan = {
  readonly documentedClaimIds: readonly string[];
  /** Verified calculation claim IDs appended as grounded `{{calc:…}}` bindings (optional suffix per calc). */
  readonly calculationBindings?: readonly { readonly calcId: string; readonly suffix?: string }[];
};

export type EditorialSectionPlan = {
  readonly id: string;
  readonly heading: string;
  readonly priority: WriterFindingPriority;
  readonly insightIds?: readonly string[];
  readonly purpose?: string;
  readonly documentedClaimIds?: readonly string[];
  readonly interpretation?: EditorialInterpretationUnit;
  readonly uncertainty?: EditorialUncertaintyUnit;
};

export type EditorialRecordTableRowPlan = {
  readonly cellClaimIds: readonly (readonly string[])[];
};

export type EditorialRecordTableLayout = {
  readonly kind: "RecordTable";
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly EditorialRecordTableRowPlan[];
};

export type EditorialComparisonItemPlan = {
  readonly label: string;
  readonly leftClaimIds: readonly string[];
  readonly rightClaimIds: readonly string[];
};

export type EditorialComparisonLayout = {
  readonly kind: "Comparison";
  readonly title: string;
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly items: readonly EditorialComparisonItemPlan[];
};

export type EditorialTimelineEventPlan = {
  readonly dateClaimIds: readonly string[];
  readonly textClaimIds: readonly string[];
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

export type EditorialComponentLayout =
  | EditorialRecordTableLayout
  | EditorialComparisonLayout
  | EditorialTimelineLayout
  | EditorialMetricLayout
  | EditorialKeyFindingsLayout
  | EditorialEvidencePanelLayout
  | { readonly kind: "Narrative" }
  | { readonly kind: "ScenarioExplorer" };

export type EditorialComponentPlan = {
  readonly component: A2uiComponentName;
  readonly sectionId?: string | null;
  readonly scenarioId?: string | null;
  readonly claimIds: readonly string[];
  readonly purpose?: string;
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
