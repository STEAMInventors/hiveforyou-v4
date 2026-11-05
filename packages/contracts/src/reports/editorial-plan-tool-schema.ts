import { A2UI_COMPONENTS } from "./application-view-contracts";
import { EDITORIAL_PLAN_SCHEMA } from "./editorial-plan-contracts";
import { WRITER_LIMITS } from "./writer-report-contracts";

const WRITER_FINDING_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
const WRITER_INSIGHT_ROLES = ["CENTRAL", "SUPPORTING"] as const;
const WRITER_SUMMARY_DETAIL_LEVELS = ["CONCISE", "BALANCED", "COMPREHENSIVE"] as const;

const str = (description: string, maxLength: number) => ({ type: "string", description, maxLength });
const claimIdsSchema = (description: string) => ({
  type: "array",
  description,
  maxItems: WRITER_LIMITS.claimRefsPerBlock,
  items: { type: "string", maxLength: 16 },
});
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const calcBindingSchema = object(
  {
    calcId: str("Verified calculation claim id.", 16),
    suffix: str("Optional suffix after the {{calc:…}} binding.", 80),
  },
  ["calcId"],
);

const interpretationUnitSchema = object(
  {
    text: str("Interpretation prose grounded in claimRefs.", WRITER_LIMITS.blockText),
    claimRefs: claimIdsSchema("Supporting Study claim ids."),
  },
  ["text", "claimRefs"],
);

const authoredUncertaintySchema = object(
  {
    text: str("Uncertainty prose that visibly surfaces cited limitations.", WRITER_LIMITS.blockText),
    claimRefs: claimIdsSchema("Mandatory uncertainty/limitation claim ids."),
  },
  ["text", "claimRefs"],
);

const compiledUncertaintySchema = object(
  {
    mode: { type: "string", enum: ["compiled"] },
    claimIds: claimIdsSchema("Study uncertainty/limitation claims compiled verbatim."),
  },
  ["mode", "claimIds"],
);

const uncertaintyUnitSchema = {
  oneOf: [authoredUncertaintySchema, compiledUncertaintySchema],
};

const missingDocumentRequestSchema = object(
  {
    gapClaimIds: claimIdsSchema("Verified MISSING_EVIDENCE, PARTIALLY_ANSWERED, LIMITATION, or UNCERTAINTY claim ids establishing the gap."),
    supportingClaimIds: claimIdsSchema("Page-backed source FACT claim ids establishing what the document states."),
    text: str("Actionable missing-document request question in approximately 7th-grade English.", WRITER_LIMITS.blockText),
    blockedAnalysis: str("Analysis or determination blocked by the missing record (required for PRO).", 600),
  },
  ["gapClaimIds", "supportingClaimIds", "text"],
);

const summaryPlanSchema = object(
  {
    documentedClaimIds: claimIdsSchema("Study claim ids compiled into the summary DOCUMENTED block."),
    calculationBindings: {
      type: "array",
      maxItems: 8,
      items: calcBindingSchema,
    },
  },
  ["documentedClaimIds"],
);

const sectionPlanSchema = object(
  {
    id: str("Section id: s1…s99.", 8),
    heading: str("Section heading.", WRITER_LIMITS.heading),
    priority: { type: "string", enum: [...WRITER_FINDING_PRIORITIES] },
    insightIds: {
      type: "array",
      maxItems: 12,
      items: { type: "string", maxLength: 32 },
    },
    purpose: str("Section purpose for this audience.", 400),
    documentedClaimIds: claimIdsSchema("Optional DOCUMENTED claim ids for this section."),
    interpretation: interpretationUnitSchema,
    uncertainty: uncertaintyUnitSchema,
    missingDocumentRequests: {
      type: "array",
      maxItems: 8,
      items: missingDocumentRequestSchema,
    },
  },
  ["id", "heading", "priority"],
);

const recordTableRowSchema = object(
  {
    cellClaimIds: {
      type: "array",
      description: "One claim-id list per table column.",
      maxItems: 12,
      items: claimIdsSchema("Claim ids for one cell."),
    },
  },
  ["cellClaimIds"],
);

const recordTableLayoutSchema = object(
  {
    kind: { type: "string", enum: ["RecordTable"] },
    title: str("Table title.", WRITER_LIMITS.heading),
    columns: {
      type: "array",
      maxItems: 12,
      items: str("Column label.", 120),
    },
    rows: {
      type: "array",
      maxItems: 24,
      items: recordTableRowSchema,
    },
  },
  ["kind", "title", "columns", "rows"],
);

const comparisonItemSchema = object(
  {
    label: str("Comparison row label.", 200),
    leftClaimIds: claimIdsSchema("Left column claim ids."),
    rightClaimIds: claimIdsSchema("Right column claim ids."),
  },
  ["label", "leftClaimIds", "rightClaimIds"],
);

const comparisonLayoutSchema = object(
  {
    kind: { type: "string", enum: ["Comparison"] },
    title: str("Comparison title.", WRITER_LIMITS.heading),
    leftLabel: str("Left column header.", 120),
    rightLabel: str("Right column header.", 120),
    items: {
      type: "array",
      maxItems: 24,
      items: comparisonItemSchema,
    },
  },
  ["kind", "title", "leftLabel", "rightLabel", "items"],
);

const timelineEventSchema = object(
  {
    dateClaimIds: claimIdsSchema("Date claim ids."),
    textClaimIds: claimIdsSchema("Event text claim ids."),
  },
  ["dateClaimIds", "textClaimIds"],
);

const timelineLayoutSchema = object(
  {
    kind: { type: "string", enum: ["Timeline"] },
    title: str("Timeline title.", WRITER_LIMITS.heading),
    events: {
      type: "array",
      maxItems: 24,
      items: timelineEventSchema,
    },
  },
  ["kind", "title", "events"],
);

const metricLayoutSchema = object(
  {
    kind: { type: "string", enum: ["Metric"] },
    label: str("Metric label.", 200),
    binding: str("Single {{calc:…}} binding token.", 48),
    claimIds: claimIdsSchema("Supporting claim ids."),
    unit: str("Optional unit or null.", 40),
  },
  ["kind", "label", "binding", "claimIds"],
);

const keyFindingsLayoutSchema = object(
  {
    kind: { type: "string", enum: ["KeyFindings"] },
    title: str("Key findings title.", WRITER_LIMITS.heading),
    claimIds: claimIdsSchema("Finding claim ids."),
  },
  ["kind", "title", "claimIds"],
);

const evidencePanelLayoutSchema = object(
  {
    kind: { type: "string", enum: ["EvidencePanel"] },
    title: str("Evidence panel title.", WRITER_LIMITS.heading),
    claimIds: claimIdsSchema("Evidence claim ids."),
  },
  ["kind", "title", "claimIds"],
);

const narrativeLayoutSchema = object({ kind: { type: "string", enum: ["Narrative"] } }, ["kind"]);
const scenarioExplorerLayoutSchema = object({ kind: { type: "string", enum: ["ScenarioExplorer"] } }, ["kind"]);

const componentLayoutSchema = {
  oneOf: [
    narrativeLayoutSchema,
    scenarioExplorerLayoutSchema,
    recordTableLayoutSchema,
    comparisonLayoutSchema,
    timelineLayoutSchema,
    metricLayoutSchema,
    keyFindingsLayoutSchema,
    evidencePanelLayoutSchema,
  ],
};

const componentPlanSchema = object(
  {
    component: { type: "string", enum: [...A2UI_COMPONENTS] },
    sectionId: str("Section id for Narrative components.", 16),
    scenarioId: str("Scenario id for ScenarioExplorer.", 16),
    claimIds: claimIdsSchema("Supporting claim ids for this component."),
    purpose: str("Why this component serves the audience.", 400),
    layout: componentLayoutSchema,
  },
  ["component", "claimIds", "layout"],
);

const insightSchema = object(
  {
    id: str("Insight id (e.g. INS1).", 32),
    meaning: str("Editorial meaning of this insight.", 600),
    claimIds: claimIdsSchema("United supporting claim ids."),
    questionIds: {
      type: "array",
      maxItems: 24,
      items: { type: "string", maxLength: 8, description: "Plan question id (P1, P2, ...)." },
    },
    role: { type: "string", enum: [...WRITER_INSIGHT_ROLES] },
    reuseReason: str("Optional reuse justification.", 400),
  },
  ["id", "meaning", "claimIds", "questionIds", "role"],
);

const priorityFindingSchema = object(
  {
    claimId: str("Priority finding claim id.", 16),
    priority: { type: "string", enum: [...WRITER_FINDING_PRIORITIES] },
    insightId: str("Optional insight id.", 32),
  },
  ["claimId", "priority"],
);

const nullableStr = (description: string, maxLength: number) => ({
  type: ["string", "null"],
  description,
  maxLength,
});

const scenarioParameterSchema = object(
  {
    name: str("Parameter identifier (camelCase).", 32),
    label: str("Human-readable label.", 200),
    value: str("Plain numeric value.", 40),
    unit: nullableStr("Optional unit or null.", 40),
    basis: { type: "string", enum: ["DOCUMENTED", "ASSUMPTION"] },
    claimRef: nullableStr("Study claim id for DOCUMENTED parameters; null for ASSUMPTION.", 16),
  },
  ["name", "label", "value", "unit", "basis", "claimRef"],
);

const scenarioResultSchema = object(
  {
    id: str("Result id within this scenario: R1 to R9.", 8),
    label: str("Human-readable result label.", 200),
    unit: nullableStr("Optional unit or null.", 40),
    formula: {
      type: "object",
      description: "Deterministic formula tree (same as record_scenario).",
      additionalProperties: true,
    },
  },
  ["id", "label", "unit", "formula"],
);

const scenarioItemSchema = object(
  {
    id: str("Scenario id: S1 to S9.", 8),
    title: str("Scenario title.", WRITER_LIMITS.heading),
    question: str("Scenario question.", 600),
    rationale: str("Scenario rationale.", 1200),
    claimRefs: claimIdsSchema("Supporting Study claim ids."),
    parameters: {
      type: "array",
      maxItems: WRITER_LIMITS.parameters,
      items: scenarioParameterSchema,
    },
    results: {
      type: "array",
      maxItems: WRITER_LIMITS.results,
      items: scenarioResultSchema,
    },
  },
  ["id", "title", "question", "rationale", "claimRefs", "parameters", "results"],
);

/** Closed object schema for `submit_editorial_plan` (`hive.editorial-plan/1`). */
export const submitEditorialPlanParametersSchema = object(
  {
    schema: {
      type: "string",
      enum: [EDITORIAL_PLAN_SCHEMA],
      description: "Optional contract schema marker.",
    },
    audience: { type: "string", enum: ["CUSTOMER", "PRO"] },
    title: str("Report title.", WRITER_LIMITS.title),
    audienceObjective: str("Audience job-to-be-done for this report.", 600),
    summaryDetailLevel: { type: "string", enum: [...WRITER_SUMMARY_DETAIL_LEVELS] },
    insights: {
      type: "array",
      maxItems: 24,
      items: insightSchema,
    },
    priorityFindings: {
      type: "array",
      maxItems: 24,
      items: priorityFindingSchema,
    },
    summary: summaryPlanSchema,
    sections: {
      type: "array",
      minItems: 1,
      maxItems: WRITER_LIMITS.sections,
      items: sectionPlanSchema,
    },
    components: {
      type: "array",
      minItems: 1,
      maxItems: WRITER_LIMITS.viewComponents,
      items: componentPlanSchema,
    },
    scenarios: {
      type: "array",
      maxItems: WRITER_LIMITS.scenarios,
      items: scenarioItemSchema,
    },
  },
  [
    "audience",
    "title",
    "audienceObjective",
    "summaryDetailLevel",
    "priorityFindings",
    "summary",
    "sections",
    "components",
  ],
);

const componentPatchSchema = object(
  {
    index: {
      type: "integer",
      minimum: 0,
      maximum: WRITER_LIMITS.viewComponents - 1,
      description: "Zero-based component slot to replace.",
    },
    component: { type: "string", enum: [...A2UI_COMPONENTS] },
    sectionId: str("Section id for Narrative components.", 16),
    scenarioId: str("Scenario id for ScenarioExplorer.", 16),
    claimIds: claimIdsSchema("Supporting claim ids."),
    purpose: str("Component purpose.", 400),
    layout: componentLayoutSchema,
  },
  ["index", "component", "claimIds", "layout"],
);

/** Closed object schema for `patch_editorial_plan` partial repairs. */
export const patchEditorialPlanParametersSchema = object(
  {
    title: str("Optional corrected title.", WRITER_LIMITS.title),
    audienceObjective: str("Optional corrected audience objective.", 600),
    summaryDetailLevel: { type: "string", enum: [...WRITER_SUMMARY_DETAIL_LEVELS] },
    insights: {
      type: "array",
      maxItems: 24,
      items: insightSchema,
    },
    priorityFindings: {
      type: "array",
      maxItems: 24,
      items: priorityFindingSchema,
    },
    summary: summaryPlanSchema,
    sections: {
      type: "array",
      maxItems: WRITER_LIMITS.sections,
      items: sectionPlanSchema,
    },
    components: {
      type: "array",
      maxItems: WRITER_LIMITS.viewComponents,
      items: componentPatchSchema,
    },
    scenarios: {
      type: "array",
      maxItems: WRITER_LIMITS.scenarios,
      items: scenarioItemSchema,
    },
  },
  [],
);
