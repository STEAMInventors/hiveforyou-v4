import type { StudyAgentBudgetDimension } from "../analysis/study-agent";
import type { StudyClaim } from "../analysis/study-verification";
import {
  A2UI_COMPONENTS,
  type A2uiComponentName,
  BindRejection,
  buildReport,
  DOCUMENTED_GRANULAR_KINDS,
  EVIDENCE_GRANULAR_KINDS,
  FINDING_GRANULAR_KINDS,
  ISSUE_QUESTION_GRANULAR_KINDS,
  validateViewComponentProposal,
  type ViewComponentValidationContext,
} from "./application-view-contracts";
import {
  collectVisibleStructuredUncertainties,
  DOCUMENTED_KINDS,
  evaluateScenarios,
  firstUngroundedNumericToken,
  groundingNumbersForClaims,
  INTERPRETATION_KINDS,
  mustSurfaceClaims,
  numericDiagnosticField,
  REPORT_BLOCK_TYPES,
  type ReportAudience,
  type ReportBlock,
  type ReportBlockType,
  type ReportSection,
  SCENARIO_ID_PATTERN,
  type ScenarioDefinition,
  SECTION_ID_PATTERN,
  UNCERTAINTY_KINDS,
  validateReportBlock,
  validateScenarioDefinition,
  validateWriterReport,
  type ViewComponentProposal,
  visiblyPresentsUncertainty,
  WRITER_LIMITS,
  WRITER_REPORT_SCHEMA,
  type WriterReport,
  WriterRejection,
} from "./writer-report-contracts";

/**
 * Application-orchestrated Writer compiler and validator (D-047; retains D-045 ledger compatibility).
 *
 * Three logical responsibilities:
 *   A. Presentation planning (`hive.writer-presentation-plan/1`): model determines priority findings,
 *      narrative organization/headings, summary/detail level, approved A2UI components, and supporting
 *      verified claim IDs without copying evidence payloads.
 *   B. Content generation: structured model output (`composeWriterReport` or segmented section/unit
 *      generation) with targeted unit-level repair (`applyWriterCorrection`) that preserves accepted
 *      sections, scenarios, summary and view components.
 *   C. Validation and compilation (`WriterCompiler`): verifies claim IDs and claim-kind compatibility,
 *      enforces source provenance and strict claim-level numerical grounding, resolves scenario
 *      calculations deterministically, validates and binds A2UI components from authorized Canonical
 *      Study records, and assembles `hive.writer-report/1` and `hive-application-view/1`.
 */

export const WRITER_PRESENTATION_PLAN_SCHEMA = "hive.writer-presentation-plan/1" as const;

export const WRITER_SUMMARY_DETAIL_LEVELS = ["CONCISE", "BALANCED", "COMPREHENSIVE"] as const;
export type WriterSummaryDetailLevel = (typeof WRITER_SUMMARY_DETAIL_LEVELS)[number];

export const WRITER_FINDING_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type WriterFindingPriority = (typeof WRITER_FINDING_PRIORITIES)[number];

export type WriterPriorityFinding = {
  readonly claimId: string;
  readonly priority: WriterFindingPriority;
};

export type WriterPlannedSection = {
  readonly id: string;
  readonly heading: string;
  readonly priority: WriterFindingPriority;
  readonly claimIds: readonly string[];
};

export type WriterPlannedComponent = {
  readonly component: A2uiComponentName;
  readonly sectionId?: string | null;
  readonly scenarioId?: string | null;
  readonly claimIds: readonly string[];
};

export type WriterPresentationPlan = {
  readonly schema?: typeof WRITER_PRESENTATION_PLAN_SCHEMA;
  readonly summaryDetailLevel: WriterSummaryDetailLevel;
  readonly priorityFindings: readonly WriterPriorityFinding[];
  readonly sections: readonly WriterPlannedSection[];
  readonly components: readonly WriterPlannedComponent[];
};

export type WriterRejectedUnitKind = "title" | "summary" | "section" | "scenario" | "view" | "uncertainty";

export type WriterRejectedUnit = {
  readonly unit: WriterRejectedUnitKind;
  readonly id?: string;
  readonly index?: number;
  readonly error: string;
  readonly field?: string;
  readonly ungroundedValue?: string;
  readonly message: string;
  readonly hint?: string;
  readonly candidateClaimIds?: readonly string[];
};

export type WriterPendingDependency = {
  readonly kind: "summary" | "section" | "scenario";
  readonly id: string;
};

export type WriterPendingViewComponent = {
  readonly index: number;
  readonly component: string;
  readonly waitingOn: WriterPendingDependency;
};

export type WriterCorrectionPatch = {
  readonly title?: string;
  readonly summary?: readonly ReportBlock[];
  readonly sections?: readonly ReportSection[];
  readonly scenarios?: readonly ScenarioDefinition[];
  readonly view?: readonly (ViewComponentProposal & { readonly index?: number })[];
};

export type WriterCompileState = {
  readonly ok: boolean;
  readonly presentationPlan: WriterPresentationPlan | null;
  readonly report: WriterReport | null;
  readonly acceptedSectionIds: readonly string[];
  readonly acceptedScenarioIds: readonly string[];
  readonly acceptedViewComponentCount: number;
  readonly pendingViewComponents: readonly WriterPendingViewComponent[];
  readonly unsurfacedClaimIds: readonly string[];
  readonly rejectedUnits: number;
  readonly rejections: readonly WriterRejectedUnit[];
};

export const WRITER_COMPOSE_TOOL_NAMES = [
  "compose_writer_report",
  "apply_writer_correction",
] as const;
export type WriterComposeToolName = (typeof WRITER_COMPOSE_TOOL_NAMES)[number];

export const WRITER_LEGACY_TOOL_NAMES = [
  "set_report_outline",
  "record_section",
  "record_scenario",
  "record_view_component",
  "finish_report",
] as const;

export const WRITER_AGENT_TOOL_NAMES = [
  ...WRITER_LEGACY_TOOL_NAMES,
] as const;
export type WriterAgentToolName = (typeof WRITER_AGENT_TOOL_NAMES)[number] | WriterComposeToolName;

export const WRITER_ALL_TOOL_NAMES = [
  ...WRITER_COMPOSE_TOOL_NAMES,
  ...WRITER_LEGACY_TOOL_NAMES,
] as const;

/** Execution ceilings for one Writer report-run attempt (`harvester` model profile). */
export const WRITER_AGENT_BUDGET = {
  /** Measured from the start of the invocation; reserves 65 s of the 300 s lease for validation and persistence. */
  wallClockMs: 235_000,
  /** Longest single model turn; below the proxy read timeout. */
  maxTurnMs: 150_000,
  /** A turn that cannot get this long is not started. */
  minTurnMs: 20_000,
  /** The web call aborts this long after the planner's own model timeout. */
  turnAbortMarginMs: 5_000,
  maxRounds: 5,
  /** Maximum accepted (successful) tool calls per Writer attempt. */
  maxToolCalls: 48,
  maxCallsPerTurn: 32,
  maxInputTokens: 200_000,
  maxOutputTokens: 24_000,
  turnOutputTokens: 8_000,
  minTurnOutputTokens: 1_000,
  /** Conservative `harvester` (Claude Sonnet class) rates (USD per million tokens) for circuit breaking. */
  inputUsdPerMillion: 3,
  outputUsdPerMillion: 15,
  maxEstimatedUsd: 1.5,
  maxRequestBytes: 768 * 1024,
} as const;

export const WRITER_AGENT_BUDGET_DIMENSIONS = [
  "rounds",
  "tool_calls",
  "output_tokens",
  "wall_clock",
  "request_bytes",
  "input_tokens",
  "estimated_cost",
] as const;
export type WriterAgentBudgetDimension = (typeof WRITER_AGENT_BUDGET_DIMENSIONS)[number];

export const WRITER_AGENT_LIMITS = {
  argumentsChars: 32_000,
  toolResultChars: 32_000,
} as const;

export type WriterAgentBudgetDiagnostic = {
  readonly dimension: WriterAgentBudgetDimension | StudyAgentBudgetDimension;
  readonly roundsUsed: number;
  readonly roundsAllowed: number;
  readonly toolCalls: number;
  readonly rejectedUnits: number;
  readonly sectionsRecorded: number;
  readonly viewComponentsRecorded: number;
};

const WRITER_BUDGET_FIELD_RE =
  /^budget\.(rounds|tool_calls|invalid_calls|output_tokens|wall_clock|request_bytes|input_tokens|estimated_cost):r([0-9]{1,4})\/([0-9]{1,4}):tc([0-9]{1,4}):(?:inv|rej)([0-9]{1,4}):s([0-9]{1,4}):v([0-9]{1,4})$/;

/**
 * Formats safe, non-content Writer budget progress counters into `diagnosticField` (`failure-diagnostic@1`),
 * compatible with `FIELD` in `failure-diagnostic.ts` and `ck_report_runs__failure_diagnostic` without a migration.
 */
export function formatWriterAgentBudgetDiagnosticField(input: WriterAgentBudgetDiagnostic): string {
  const clamp = (value: number) => Math.min(9999, Math.max(0, Math.trunc(value)));
  return [
    `budget.${input.dimension}`,
    `r${clamp(input.roundsUsed)}/${clamp(input.roundsAllowed)}`,
    `tc${clamp(input.toolCalls)}`,
    `inv${clamp(input.rejectedUnits)}`,
    `s${clamp(input.sectionsRecorded)}`,
    `v${clamp(input.viewComponentsRecorded)}`,
  ].join(":");
}

export function parseWriterAgentBudgetDiagnosticField(
  field: string | null | undefined,
): WriterAgentBudgetDiagnostic | null {
  if (typeof field !== "string") return null;
  const match = WRITER_BUDGET_FIELD_RE.exec(field);
  if (!match) return null;
  return {
    dimension: match[1] as WriterAgentBudgetDimension | StudyAgentBudgetDimension,
    roundsUsed: Number(match[2]),
    roundsAllowed: Number(match[3]),
    toolCalls: Number(match[4]),
    rejectedUnits: Number(match[5]),
    sectionsRecorded: Number(match[6]),
    viewComponentsRecorded: Number(match[7]),
  };
}

export function estimateWriterAgentUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * WRITER_AGENT_BUDGET.inputUsdPerMillion +
      outputTokens * WRITER_AGENT_BUDGET.outputUsdPerMillion) /
    1_000_000
  );
}

export type WriterAgentToolDefinition = {
  type: "function";
  function: { name: WriterAgentToolName; description: string; parameters: Record<string, unknown> };
};

const str = (description: string, maxLength: number) => ({ type: "string", description, maxLength });
const nullableStr = (description: string, maxLength: number) => ({
  type: ["string", "null"],
  description,
  maxLength,
});
const claimRefsSchema = (description: string) => ({
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

const blockItemSchema = object(
  {
    type: {
      type: "string",
      enum: [...REPORT_BLOCK_TYPES],
      description: "Block category: DOCUMENTED, INTERPRETATION, UNCERTAINTY, GENERAL_INFORMATION, QUESTION, or NEXT_STEP.",
    },
    text: str("Prose for this block (up to 2000 characters). Every number must be grounded in claimRefs.", WRITER_LIMITS.blockText),
    claimRefs: claimRefsSchema("Supporting Study claim ids (empty [] only for GENERAL_INFORMATION)."),
  },
  ["type", "text", "claimRefs"],
);

const scenarioParameterSchema = object(
  {
    name: str("Parameter identifier (camelCase, e.g. requiredMinutes).", 32),
    label: str("Human-readable label.", 200),
    value: str("Plain numeric value (e.g. \"480\" or \"12.5\").", 40),
    unit: nullableStr("Optional unit (e.g. \"minutes\") or null.", 40),
    basis: { type: "string", enum: ["DOCUMENTED", "ASSUMPTION"] },
    claimRef: nullableStr("Specific Study claim id for DOCUMENTED parameters; null for ASSUMPTION.", 16),
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
      description:
        'Formula tree: {"param":"name"} | {"ref":"P1.C0"|"R1"} | {"value":"12.5"} | {"op":"+"|"-"|"*"|"/"|"min"|"max","args":[...]} | {"op":"round","args":[one],"places":0-6}.',
    },
  },
  ["id", "label", "unit", "formula"],
);

const sectionItemSchema = object(
  {
    id: str("Section id: s1, s2, ..., s99.", 8),
    heading: str("Section heading (up to 160 characters).", WRITER_LIMITS.heading),
    blocks: {
      type: "array",
      description: "1 to 20 blocks in this section.",
      maxItems: WRITER_LIMITS.blocksPerSection,
      items: blockItemSchema,
    },
  },
  ["id", "heading", "blocks"],
);

const scenarioItemSchema = object(
  {
    id: str("Scenario id: S1 to S9.", 8),
    title: str("Scenario title (up to 160 characters).", WRITER_LIMITS.heading),
    question: str("Question the scenario explores (up to 600 characters).", 600),
    rationale: str("Why this scenario is useful (up to 1200 characters).", 1200),
    claimRefs: claimRefsSchema("Specific supporting Study claim ids (never broad ANSWER claims when atomic facts exist)."),
    parameters: {
      type: "array",
      description: "Up to 8 parameters.",
      maxItems: WRITER_LIMITS.parameters,
      items: scenarioParameterSchema,
    },
    results: {
      type: "array",
      description: "1 to 6 result definitions.",
      maxItems: WRITER_LIMITS.results,
      items: scenarioResultSchema,
    },
  },
  ["id", "title", "question", "rationale", "claimRefs", "parameters", "results"],
);

const viewComponentItemSchema = object(
  {
    index: {
      type: "integer",
      minimum: 0,
      description: "Optional zero-based index in view to replace; omit to append.",
    },
    component: {
      type: "string",
      enum: [...A2UI_COMPONENTS],
      description: "Component name from the 13-component A2UI catalog.",
    },
    props: {
      type: "object",
      description: "Component properties matching the chosen A2UI component.",
    },
  },
  ["component", "props"],
);

const presentationPlanSchema = object(
  {
    summaryDetailLevel: {
      type: "string",
      enum: [...WRITER_SUMMARY_DETAIL_LEVELS],
      description: "Appropriate summary/detail level for this audience: CONCISE, BALANCED, or COMPREHENSIVE.",
    },
    priorityFindings: {
      type: "array",
      description: "Important findings and their priority, referencing verified Canonical Study claim IDs.",
      maxItems: 24,
      items: object(
        {
          claimId: str("Verified Canonical Study claim ID.", 16),
          priority: { type: "string", enum: [...WRITER_FINDING_PRIORITIES] },
        },
        ["claimId", "priority"],
      ),
    },
    sections: {
      type: "array",
      description: "Planned narrative organization, section headings, priority, and supporting verified claim IDs.",
      maxItems: WRITER_LIMITS.sections,
      items: object(
        {
          id: str("Section id: s1, s2, ..., s99.", 8),
          heading: str("Section heading.", WRITER_LIMITS.heading),
          priority: { type: "string", enum: [...WRITER_FINDING_PRIORITIES] },
          claimIds: claimRefsSchema("Verified Study claim IDs supporting this section."),
        },
        ["id", "heading", "priority", "claimIds"],
      ),
    },
    components: {
      type: "array",
      description: "Approved A2UI components chosen to communicate the findings, with supporting verified claim IDs.",
      maxItems: WRITER_LIMITS.viewComponents,
      items: object(
        {
          component: { type: "string", enum: [...A2UI_COMPONENTS] },
          sectionId: nullableStr("Optional sectionId when component is Narrative.", 16),
          scenarioId: nullableStr("Optional scenarioId when component is ScenarioExplorer.", 16),
          claimIds: claimRefsSchema("Verified Study claim IDs supporting this component."),
        },
        ["component", "claimIds"],
      ),
    },
  },
  ["summaryDetailLevel", "priorityFindings", "sections", "components"],
);

/**
 * Provider-compatible closed tool schemas for structured Writer composition and targeted unit correction (D-047).
 */
export const WRITER_COMPOSE_TOOLS: readonly WriterAgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "compose_writer_report",
      description:
        "Plans presentation and composes the audience-specific report (or a batch of sections/components) in one structured call. Trusted code validates every unit independently and preserves accepted units.",
      parameters: object(
        {
          presentationPlan: {
            ...presentationPlanSchema,
            description:
              "Compact presentation plan: priority findings, narrative section organization, summary/detail level, chosen A2UI components, and supporting claim IDs.",
          },
          title: str("Report title (up to 160 characters).", WRITER_LIMITS.title),
          summary: {
            type: "array",
            description: "Summary blocks for this audience.",
            maxItems: WRITER_LIMITS.summaryBlocks,
            items: blockItemSchema,
          },
          sections: {
            type: "array",
            description: "Narrative sections in reading order.",
            maxItems: WRITER_LIMITS.sections,
            items: sectionItemSchema,
          },
          scenarios: {
            type: "array",
            description: "Optional deterministic scenarios (empty [] when none needed).",
            maxItems: WRITER_LIMITS.scenarios,
            items: scenarioItemSchema,
          },
          view: {
            type: "array",
            description: "Dynamic A2UI component composition from the 13-component catalog.",
            maxItems: WRITER_LIMITS.viewComponents,
            items: viewComponentItemSchema,
          },
        },
        ["title", "summary", "sections", "scenarios", "view"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "apply_writer_correction",
      description:
        "Applies a targeted correction to only the rejected content units (title, summary, specific sections by id, specific scenarios by id, or specific view components by index), preserving all previously accepted units.",
      parameters: object(
        {
          title: str("Optional corrected report title.", WRITER_LIMITS.title),
          summary: {
            type: "array",
            description: "Optional corrected summary blocks.",
            maxItems: WRITER_LIMITS.summaryBlocks,
            items: blockItemSchema,
          },
          sections: {
            type: "array",
            description: "Optional corrected or added sections (matched by id).",
            maxItems: WRITER_LIMITS.sections,
            items: sectionItemSchema,
          },
          scenarios: {
            type: "array",
            description: "Optional corrected or added scenarios (matched by id).",
            maxItems: WRITER_LIMITS.scenarios,
            items: scenarioItemSchema,
          },
          view: {
            type: "array",
            description: "Optional corrected or added A2UI view components (replace by index, sectionId or scenarioId, or omit index to append).",
            maxItems: WRITER_LIMITS.viewComponents,
            items: viewComponentItemSchema,
          },
        },
        [],
      ),
    },
  },
];

/** Provider-compatible closed tool schemas for the five Writer tools. */
export const WRITER_AGENT_TOOLS: readonly WriterAgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "set_report_outline",
      description:
        "Sets or replaces the report title and 1 to 6 summary blocks. Validated immediately for block-type vs claim-kind rules, verified calculation bindings, and claim-level numerical grounding.",
      parameters: object(
        {
          title: str("Report title (up to 160 characters).", WRITER_LIMITS.title),
          summary: {
            type: "array",
            description: "1 to 6 summary blocks.",
            maxItems: WRITER_LIMITS.summaryBlocks,
            items: blockItemSchema,
          },
        },
        ["title", "summary"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "record_section",
      description:
        "Records or replaces one narrative section (s1 to s99) with a heading and 1 to 20 blocks. Validated immediately for claim-kind compatibility, calculation bindings, and claim-level numerical grounding.",
      parameters: sectionItemSchema,
    },
  },
  {
    type: "function",
    function: {
      name: "record_scenario",
      description:
        "Records or replaces one deterministic scenario (S1 to S9). Validates documented parameters against their cited specific claim and computes results in code.",
      parameters: scenarioItemSchema,
    },
  },
  {
    type: "function",
    function: {
      name: "record_view_component",
      description:
        "Appends one A2UI component to the report view, or replaces the component at zero-based index when index is given. Referenced sections and scenarios must already be recorded.",
      parameters: viewComponentItemSchema,
    },
  },
  {
    type: "function",
    function: {
      name: "finish_report",
      description:
        "Finalizes the report after the outline, at least one section, any scenarios, and the view components are recorded and all mandatory uncertainties are visibly surfaced.",
      parameters: object({}, []),
    },
  },
];

export type WriterAgentContext = {
  readonly reportRunId: string;
  readonly audience: ReportAudience;
  readonly claims: readonly StudyClaim[];
  readonly fileNames?: ReadonlyMap<string, string>;
};

export type WriterAgentToolCall = { readonly id: string; readonly name: string; readonly arguments: string };
export type WriterAgentToolResult = { readonly toolCallId: string; readonly ok: boolean; readonly content: string };

type Args = Record<string, unknown>;

function allowedBlockTypesForClaimKind(kind: StudyClaim["kind"]): ReportBlockType[] {
  const allowed: ReportBlockType[] = [];
  if (DOCUMENTED_KINDS.has(kind)) allowed.push("DOCUMENTED");
  if (INTERPRETATION_KINDS.has(kind)) allowed.push("INTERPRETATION");
  if (UNCERTAINTY_KINDS.has(kind)) allowed.push("UNCERTAINTY");
  allowed.push("QUESTION", "NEXT_STEP");
  return allowed;
}

type ComponentClaimRules = {
  readonly allowedKinds: ReadonlySet<StudyClaim["kind"]>;
  readonly requireRefs: boolean;
  readonly allowMissingEvidenceAnswer?: boolean;
};

function componentClaimRulesFor(componentName: string | undefined): ComponentClaimRules | null {
  switch (componentName as A2uiComponentName | undefined) {
    case "KeyFindings":
      return { allowedKinds: FINDING_GRANULAR_KINDS, requireRefs: true };
    case "RecordTable":
    case "Comparison":
    case "Timeline":
      return { allowedKinds: DOCUMENTED_GRANULAR_KINDS, requireRefs: true };
    case "Checklist":
    case "EvidencePanel":
      return { allowedKinds: EVIDENCE_GRANULAR_KINDS, requireRefs: true };
    case "IssueList":
    case "QuestionList":
      return { allowedKinds: ISSUE_QUESTION_GRANULAR_KINDS, requireRefs: false, allowMissingEvidenceAnswer: true };
    default:
      return null;
  }
}

function blockTypeFromField(field: string | null | undefined, parsed: unknown): ReportBlockType | undefined {
  if (!field || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const blockMatch = /blocks\[(\d+)\]/.exec(field);
  if (blockMatch && Array.isArray(record.blocks)) {
    const idx = Number(blockMatch[1]);
    const block = record.blocks[idx] as { type?: unknown } | undefined;
    if (typeof block?.type === "string" && (REPORT_BLOCK_TYPES as readonly string[]).includes(block.type)) {
      return block.type as ReportBlockType;
    }
  }
  const summaryMatch = /summary\[(\d+)\]/.exec(field);
  if (summaryMatch && Array.isArray(record.summary)) {
    const idx = Number(summaryMatch[1]);
    const block = record.summary[idx] as { type?: unknown } | undefined;
    if (typeof block?.type === "string" && (REPORT_BLOCK_TYPES as readonly string[]).includes(block.type)) {
      return block.type as ReportBlockType;
    }
  }
  if (typeof record.type === "string" && (REPORT_BLOCK_TYPES as readonly string[]).includes(record.type)) {
    return record.type as ReportBlockType;
  }
  return undefined;
}

function allowedClaimKindsForBlockType(blockType: ReportBlockType | undefined): ReadonlySet<StudyClaim["kind"]> | null {
  switch (blockType) {
    case "DOCUMENTED":
      return DOCUMENTED_KINDS;
    case "INTERPRETATION":
      return INTERPRETATION_KINDS;
    case "UNCERTAINTY":
      return UNCERTAINTY_KINDS;
    default:
      return null;
  }
}

export class WriterAgentLedger {
  private readonly claims: ReadonlyMap<string, StudyClaim>;
  private readonly questionsWithFacts: ReadonlySet<string>;
  private readonly allCatalogNumbers: ReadonlySet<string>;
  private readonly fileNames: ReadonlyMap<string, string>;
  private readonly calls = new Map<string, { name: string; arguments: string; result: WriterAgentToolResult }>();
  private presentationPlan: WriterPresentationPlan | null = null;
  private outline: { title: string; summary: ReportBlock[] } | null = null;
  private readonly sections = new Map<string, ReportSection>();
  private readonly sectionOrder: string[] = [];
  private readonly scenarios = new Map<string, ScenarioDefinition>();
  private readonly scenarioOrder: string[] = [];
  private readonly viewSlots: (ViewComponentProposal | null)[] = [];
  private readonly pendingViewSlots = new Map<
    number,
    { proposal: ViewComponentProposal; waitingOn: WriterPendingDependency }
  >();
  private readonly unresolvedSlots = new Map<string, string>();
  private finishedReport: WriterReport | null = null;
  private acceptedCallCount = 0;
  private rejectedUnitCount = 0;

  constructor(private readonly context: WriterAgentContext) {
    this.claims = new Map(context.claims.map((claim) => [claim.id, claim]));
    this.questionsWithFacts = new Set(
      context.claims.filter((claim) => claim.kind === "FACT").map((claim) => claim.planQuestionId),
    );
    this.allCatalogNumbers = groundingNumbersForClaims(
      this.claims,
      context.claims.map((claim) => claim.id),
    );
    this.fileNames = context.fileNames ?? new Map<string, string>();
  }

  get finished(): boolean {
    return this.finishedReport !== null;
  }

  /** Number of accepted (successful) tool calls or structured compositions executed on this ledger. */
  get toolCalls(): number {
    return this.acceptedCallCount;
  }

  /** Number of rejected report units (or turns without tool calls) on this ledger for observability. */
  get rejectedUnits(): number {
    return this.rejectedUnitCount;
  }

  /** Alias retained for backward compatibility with existing callers/tests. */
  get invalidCalls(): number {
    return this.rejectedUnitCount;
  }

  get completedSectionCount(): number {
    return this.sections.size;
  }

  get recordedViewComponentCount(): number {
    let count = 0;
    for (const slot of this.viewSlots) {
      if (slot !== null) count += 1;
    }
    return count;
  }

  get pendingViewComponentCount(): number {
    return this.pendingViewSlots.size;
  }

  get pendingViewComponents(): WriterPendingViewComponent[] {
    return [...this.pendingViewSlots.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, entry]) => ({
        index,
        component: entry.proposal.component,
        waitingOn: entry.waitingOn,
      }));
  }

  get recordedScenarioCount(): number {
    return this.scenarios.size;
  }

  get acceptedSectionIds(): string[] {
    return this.sectionOrder.filter((id) => this.sections.has(id));
  }

  get acceptedScenarioIds(): string[] {
    return this.scenarioOrder.filter((id) => this.scenarios.has(id));
  }

  get currentPresentationPlan(): WriterPresentationPlan | null {
    return this.presentationPlan;
  }

  private registerSectionOrder(id: string): void {
    if (SECTION_ID_PATTERN.test(id) && !this.sectionOrder.includes(id)) {
      this.sectionOrder.push(id);
    }
  }

  private registerScenarioOrder(id: string): void {
    if (SCENARIO_ID_PATTERN.test(id) && !this.scenarioOrder.includes(id)) {
      this.scenarioOrder.push(id);
    }
  }

  private orderedSections(): ReportSection[] {
    const ordered: ReportSection[] = [];
    const seen = new Set<string>();
    for (const id of this.sectionOrder) {
      const sec = this.sections.get(id);
      if (sec) {
        ordered.push(sec);
        seen.add(id);
      }
    }
    for (const [id, sec] of this.sections.entries()) {
      if (!seen.has(id)) ordered.push(sec);
    }
    return ordered;
  }

  private orderedScenarios(): ScenarioDefinition[] {
    const ordered: ScenarioDefinition[] = [];
    const seen = new Set<string>();
    for (const id of this.scenarioOrder) {
      const scen = this.scenarios.get(id);
      if (scen) {
        ordered.push(scen);
        seen.add(id);
      }
    }
    for (const [id, scen] of this.scenarios.entries()) {
      if (!seen.has(id)) ordered.push(scen);
    }
    return ordered;
  }

  private orderedViewComponents(): ViewComponentProposal[] {
    const ordered: ViewComponentProposal[] = [];
    for (const slot of this.viewSlots) {
      if (slot !== null) ordered.push(slot);
    }
    return ordered;
  }

  private ensureViewSlotCapacity(targetIndex: number): void {
    while (this.viewSlots.length <= targetIndex) {
      this.viewSlots.push(null);
    }
  }

  private findViewSlotIndexForDependency(component: string, props: Record<string, unknown>): number {
    if (component === "Narrative" && typeof props.sectionId === "string") {
      for (let i = 0; i < this.viewSlots.length; i += 1) {
        const accepted = this.viewSlots[i];
        if (accepted?.component === "Narrative" && accepted.props.sectionId === props.sectionId) return i;
        const pending = this.pendingViewSlots.get(i);
        if (pending?.proposal.component === "Narrative" && pending.proposal.props.sectionId === props.sectionId) return i;
      }
    } else if (component === "ScenarioExplorer" && typeof props.scenarioId === "string") {
      for (let i = 0; i < this.viewSlots.length; i += 1) {
        const accepted = this.viewSlots[i];
        if (accepted?.component === "ScenarioExplorer" && accepted.props.scenarioId === props.scenarioId) return i;
        const pending = this.pendingViewSlots.get(i);
        if (pending?.proposal.component === "ScenarioExplorer" && pending.proposal.props.scenarioId === props.scenarioId) return i;
      }
    }
    return -1;
  }

  private detectMissingDependency(
    component: string,
    props: Record<string, unknown>,
    failedDependencies: ReadonlySet<string>,
  ): WriterPendingDependency | null {
    if (component === "Narrative") {
      const sectionId = props.sectionId;
      if (sectionId === "summary") {
        if (!this.outline && failedDependencies.has("summary")) {
          return { kind: "summary", id: "summary" };
        }
      } else if (
        typeof sectionId === "string" &&
        SECTION_ID_PATTERN.test(sectionId) &&
        !this.sections.has(sectionId) &&
        (failedDependencies.has(`section:${sectionId}`) || this.sectionOrder.includes(sectionId))
      ) {
        return { kind: "section", id: sectionId };
      }
    } else if (component === "ScenarioExplorer") {
      const scenarioId = props.scenarioId;
      if (
        typeof scenarioId === "string" &&
        SCENARIO_ID_PATTERN.test(scenarioId) &&
        !this.scenarios.has(scenarioId) &&
        (failedDependencies.has(`scenario:${scenarioId}`) || this.scenarioOrder.includes(scenarioId))
      ) {
        return { kind: "scenario", id: scenarioId };
      }
    } else if (component === "Metric") {
      const binding = typeof props.binding === "string" ? props.binding : "";
      const match = /^\{\{result:(S[1-9])\.R[1-9]\}\}$/.exec(binding);
      if (
        match &&
        !this.scenarios.has(match[1]!) &&
        (failedDependencies.has(`scenario:${match[1]!}`) || this.scenarioOrder.includes(match[1]!))
      ) {
        return { kind: "scenario", id: match[1]! };
      }
    } else if (component === "Chart" && Array.isArray(props.points)) {
      for (const point of props.points) {
        if (!point || typeof point !== "object" || Array.isArray(point)) continue;
        const binding = typeof (point as { binding?: unknown }).binding === "string" ? (point as { binding: string }).binding : "";
        const match = /^\{\{result:(S[1-9])\.R[1-9]\}\}$/.exec(binding);
        if (
          match &&
          !this.scenarios.has(match[1]!) &&
          (failedDependencies.has(`scenario:${match[1]!}`) || this.scenarioOrder.includes(match[1]!))
        ) {
          return { kind: "scenario", id: match[1]! };
        }
      }
    }
    return null;
  }

  private dependencySatisfied(dep: WriterPendingDependency): boolean {
    if (dep.kind === "summary") return this.outline !== null;
    if (dep.kind === "section") return this.sections.has(dep.id);
    return this.scenarios.has(dep.id);
  }

  private revalidatePendingViewComponents(
    onRejected?: (index: number, proposal: ViewComponentProposal, error: WriterRejection | BindRejection) => void,
  ): void {
    for (const [index, pending] of [...this.pendingViewSlots.entries()].sort(([a], [b]) => a - b)) {
      if (!this.dependencySatisfied(pending.waitingOn)) continue;
      this.pendingViewSlots.delete(index);
      try {
        this.recordViewComponent({
          index,
          component: pending.proposal.component,
          props: pending.proposal.props,
        });
        this.acceptedCallCount += 1;
      } catch (error) {
        if (!(error instanceof WriterRejection || error instanceof BindRejection)) throw error;
        if (onRejected) {
          onRejected(index, pending.proposal, error);
        } else {
          this.rejectedUnitCount += 1;
          this.unresolvedSlots.set(`view:${index}`, error.diagnosticReason);
        }
      }
    }
  }

  /**
   * Validates and records a compact `hive.writer-presentation-plan/1` (D-047 Responsibility A).
   * Verifies every referenced claim ID against the accepted Canonical Study and checks component names.
   */
  recordPresentationPlan(raw: unknown): WriterPresentationPlan {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new WriterRejection("writer_output_shape", "presentationPlan must be an object.", "presentationPlan");
    }
    const plan = raw as Record<string, unknown>;
    const detailLevel = plan.summaryDetailLevel;
    if (
      typeof detailLevel !== "string" ||
      !(WRITER_SUMMARY_DETAIL_LEVELS as readonly string[]).includes(detailLevel)
    ) {
      throw new WriterRejection(
        "writer_output_shape",
        "presentationPlan.summaryDetailLevel must be CONCISE, BALANCED, or COMPREHENSIVE.",
        "presentationPlan.summaryDetailLevel",
      );
    }
    if (!Array.isArray(plan.priorityFindings) || plan.priorityFindings.length > 24) {
      throw new WriterRejection(
        "writer_output_shape",
        "presentationPlan.priorityFindings must be a list of up to 24 items.",
        "presentationPlan.priorityFindings",
      );
    }
    const priorityFindings: WriterPriorityFinding[] = plan.priorityFindings.map((item, index) => {
      const path = `presentationPlan.priorityFindings[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new WriterRejection("writer_output_shape", `${path} must be an object.`, path);
      }
      const entry = item as Record<string, unknown>;
      if (typeof entry.claimId !== "string" || !this.claims.has(entry.claimId)) {
        throw new WriterRejection("writer_claim_unknown", `${path}.claimId is not a Study claim.`, `${path}.claimId`);
      }
      if (typeof entry.priority !== "string" || !(WRITER_FINDING_PRIORITIES as readonly string[]).includes(entry.priority)) {
        throw new WriterRejection("writer_output_shape", `${path}.priority is invalid.`, `${path}.priority`);
      }
      return { claimId: entry.claimId, priority: entry.priority as WriterFindingPriority };
    });

    if (!Array.isArray(plan.sections) || plan.sections.length > WRITER_LIMITS.sections) {
      throw new WriterRejection(
        "writer_output_shape",
        `presentationPlan.sections must be a list of up to ${WRITER_LIMITS.sections} items.`,
        "presentationPlan.sections",
      );
    }
    const plannedSections: WriterPlannedSection[] = plan.sections.map((item, index) => {
      const path = `presentationPlan.sections[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new WriterRejection("writer_output_shape", `${path} must be an object.`, path);
      }
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== "string" || !SECTION_ID_PATTERN.test(entry.id)) {
        throw new WriterRejection("writer_output_shape", `${path}.id must be s1…s99.`, `${path}.id`);
      }
      if (typeof entry.heading !== "string" || entry.heading.trim() === "" || entry.heading.length > WRITER_LIMITS.heading) {
        throw new WriterRejection("writer_output_shape", `${path}.heading must be short text.`, `${path}.heading`);
      }
      if (typeof entry.priority !== "string" || !(WRITER_FINDING_PRIORITIES as readonly string[]).includes(entry.priority)) {
        throw new WriterRejection("writer_output_shape", `${path}.priority is invalid.`, `${path}.priority`);
      }
      if (!Array.isArray(entry.claimIds) || entry.claimIds.length > WRITER_LIMITS.claimRefsPerBlock) {
        throw new WriterRejection("writer_output_shape", `${path}.claimIds must be a list.`, `${path}.claimIds`);
      }
      const claimIds = entry.claimIds.map((claimId, cIdx) => {
        if (typeof claimId !== "string" || !this.claims.has(claimId)) {
          throw new WriterRejection("writer_claim_unknown", `${path}.claimIds[${cIdx}] is not a Study claim.`, `${path}.claimIds[${cIdx}]`);
        }
        return claimId;
      });
      return {
        id: entry.id,
        heading: entry.heading,
        priority: entry.priority as WriterFindingPriority,
        claimIds,
      };
    });

    if (!Array.isArray(plan.components) || plan.components.length > WRITER_LIMITS.viewComponents) {
      throw new WriterRejection(
        "writer_output_shape",
        `presentationPlan.components must be a list of up to ${WRITER_LIMITS.viewComponents} items.`,
        "presentationPlan.components",
      );
    }
    const plannedComponents: WriterPlannedComponent[] = plan.components.map((item, index) => {
      const path = `presentationPlan.components[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new WriterRejection("writer_output_shape", `${path} must be an object.`, path);
      }
      const entry = item as Record<string, unknown>;
      if (typeof entry.component !== "string" || !(A2UI_COMPONENTS as readonly string[]).includes(entry.component)) {
        throw new WriterRejection("view_component_unknown", `${path}.component is outside the allowed catalog.`, `${path}.component`);
      }
      if (!Array.isArray(entry.claimIds) || entry.claimIds.length > WRITER_LIMITS.claimRefsPerBlock) {
        throw new WriterRejection("writer_output_shape", `${path}.claimIds must be a list.`, `${path}.claimIds`);
      }
      const claimIds = entry.claimIds.map((claimId, cIdx) => {
        if (typeof claimId !== "string" || !this.claims.has(claimId)) {
          throw new WriterRejection("writer_claim_unknown", `${path}.claimIds[${cIdx}] is not a Study claim.`, `${path}.claimIds[${cIdx}]`);
        }
        return claimId;
      });
      return {
        component: entry.component as A2uiComponentName,
        ...(typeof entry.sectionId === "string" ? { sectionId: entry.sectionId } : {}),
        ...(typeof entry.scenarioId === "string" ? { scenarioId: entry.scenarioId } : {}),
        claimIds,
      };
    });

    const normalized: WriterPresentationPlan = {
      schema: WRITER_PRESENTATION_PLAN_SCHEMA,
      summaryDetailLevel: detailLevel as WriterSummaryDetailLevel,
      priorityFindings,
      sections: plannedSections,
      components: plannedComponents,
    };
    this.presentationPlan = normalized;
    return normalized;
  }

  /**
   * Application-controlled unit-by-unit compilation and targeted correction (D-047 Responsibilities B & C).
   * Validates each unit (presentationPlan, outline, each section, each scenario, each view component)
   * independently so valid units are preserved in state while rejected units return structured diagnostics
   * without mutating previously accepted units.
   */
  compileUnits(raw: unknown): WriterCompileState {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      this.rejectedUnitCount += 1;
      return {
        ok: false,
        presentationPlan: this.presentationPlan,
        report: null,
        acceptedSectionIds: this.acceptedSectionIds,
        acceptedScenarioIds: this.acceptedScenarioIds,
        acceptedViewComponentCount: this.recordedViewComponentCount,
        pendingViewComponents: this.pendingViewComponents,
        unsurfacedClaimIds: this.unsurfacedClaimIds(),
        rejectedUnits: this.rejectedUnitCount,
        rejections: [
          {
            unit: "summary",
            error: "writer_output_shape",
            field: "output",
            message: "Writer output must be a JSON object.",
          },
        ],
      };
    }

    const input = raw as Record<string, unknown>;
    const rejections: WriterRejectedUnit[] = [];
    const failedDependencies = new Set<string>();
    this.beginTurn();

    const recordUnitRejection = (
      unit: WriterRejectedUnitKind,
      error: WriterRejection | BindRejection,
      unitPayload: unknown,
      meta: { id?: string; index?: number; slot: string },
    ) => {
      this.rejectedUnitCount += 1;
      this.unresolvedSlots.set(meta.slot, error.diagnosticReason);
      const described = this.describeRejection(error, {
        id: "unit",
        name: "compose_writer_report",
        arguments: JSON.stringify(unitPayload ?? {}),
      });
      rejections.push({
        unit,
        ...(meta.id !== undefined ? { id: meta.id } : {}),
        ...(meta.index !== undefined ? { index: meta.index } : {}),
        error: String(described.error ?? error.diagnosticReason),
        ...(typeof described.field === "string" ? { field: described.field } : {}),
        ...(typeof described.ungroundedValue === "string" ? { ungroundedValue: described.ungroundedValue } : {}),
        message: String(described.message ?? error.message),
        ...(typeof described.hint === "string" ? { hint: described.hint } : {}),
        ...(Array.isArray(described.candidateClaimIds)
          ? { candidateClaimIds: described.candidateClaimIds as string[] }
          : {}),
      });
    };

    if (input.presentationPlan !== undefined && input.presentationPlan !== null) {
      try {
        this.recordPresentationPlan(input.presentationPlan);
      } catch (error) {
        if (!(error instanceof WriterRejection || error instanceof BindRejection)) throw error;
        recordUnitRejection("summary", error, input.presentationPlan, { slot: "presentationPlan" });
      }
    }

    if (input.title !== undefined || input.summary !== undefined) {
      const nextTitle = typeof input.title === "string" ? input.title : this.outline?.title;
      const nextSummary = input.summary !== undefined ? input.summary : this.outline?.summary;
      try {
        this.setReportOutline({ title: nextTitle, summary: nextSummary });
        this.acceptedCallCount += 1;
      } catch (error) {
        if (!(error instanceof WriterRejection || error instanceof BindRejection)) throw error;
        const isTitle = error.diagnosticField === "title" || error.diagnosticField?.startsWith("title@") === true;
        if (!isTitle) failedDependencies.add("summary");
        recordUnitRejection(
          isTitle ? "title" : "summary",
          error,
          { title: nextTitle, summary: nextSummary },
          { slot: "outline" },
        );
      }
    }

    if (input.sections !== undefined) {
      if (!Array.isArray(input.sections) || (input.sections.length === 0 && this.sections.size === 0)) {
        const err = new WriterRejection(
          "writer_output_shape",
          `sections must be a list of 1–${WRITER_LIMITS.sections} items.`,
          "sections",
        );
        recordUnitRejection("section", err, input.sections, { slot: "section:invalid" });
      } else {
        input.sections.forEach((sec, idx) => {
          const secObj = sec && typeof sec === "object" && !Array.isArray(sec) ? (sec as Args) : {};
          const secId = typeof secObj.id === "string" ? secObj.id : undefined;
          if (secId) this.registerSectionOrder(secId);
          try {
            this.recordSection(secObj);
            this.acceptedCallCount += 1;
          } catch (error) {
            if (!(error instanceof WriterRejection || error instanceof BindRejection)) throw error;
            if (secId && SECTION_ID_PATTERN.test(secId)) {
              failedDependencies.add(`section:${secId}`);
            }
            recordUnitRejection("section", error, sec, {
              id: secId,
              index: idx,
              slot: secId && SECTION_ID_PATTERN.test(secId) ? `section:${secId}` : `section:${idx}`,
            });
          }
        });
      }
    }

    if (input.scenarios !== undefined) {
      if (!Array.isArray(input.scenarios)) {
        const err = new WriterRejection(
          "writer_output_shape",
          `scenarios must be a list of 0–${WRITER_LIMITS.scenarios} items.`,
          "scenarios",
        );
        recordUnitRejection("scenario", err, input.scenarios, { slot: "scenario:invalid" });
      } else {
        input.scenarios.forEach((scen, idx) => {
          const scenObj = scen && typeof scen === "object" && !Array.isArray(scen) ? (scen as Args) : {};
          const scenId = typeof scenObj.id === "string" ? scenObj.id : undefined;
          if (scenId) this.registerScenarioOrder(scenId);
          try {
            this.recordScenario(scenObj);
            this.acceptedCallCount += 1;
          } catch (error) {
            if (!(error instanceof WriterRejection || error instanceof BindRejection)) throw error;
            if (scenId && SCENARIO_ID_PATTERN.test(scenId)) {
              failedDependencies.add(`scenario:${scenId}`);
            }
            recordUnitRejection("scenario", error, scen, {
              id: scenId,
              index: idx,
              slot: scenId && SCENARIO_ID_PATTERN.test(scenId) ? `scenario:${scenId}` : `scenario:${idx}`,
            });
          }
        });
      }
    }

    const isInitialBatchView = input.presentationPlan !== undefined && this.viewSlots.length === 0;

    if (input.view !== undefined) {
      if (!Array.isArray(input.view)) {
        const err = new WriterRejection(
          "writer_output_shape",
          `view must be a list of 0–${WRITER_LIMITS.viewComponents} items.`,
          "view",
        );
        recordUnitRejection("view", err, input.view, { slot: "view:invalid" });
      } else {
        input.view.forEach((comp, idx) => {
          const compObj = comp && typeof comp === "object" && !Array.isArray(comp) ? (comp as Args) : {};
          const explicitIndex =
            typeof compObj.index === "number" && Number.isInteger(compObj.index) && compObj.index >= 0
              ? compObj.index
              : undefined;
          const componentName = typeof compObj.component === "string" ? compObj.component : "";
          const props =
            compObj.props && typeof compObj.props === "object" && !Array.isArray(compObj.props)
              ? (compObj.props as Record<string, unknown>)
              : {};
          let targetIndex: number;
          if (explicitIndex !== undefined) {
            targetIndex = explicitIndex;
          } else if (isInitialBatchView) {
            targetIndex = idx;
          } else {
            const matched = this.findViewSlotIndexForDependency(componentName, props);
            targetIndex = matched >= 0 ? matched : this.viewSlots.length;
          }
          const missingDep = this.detectMissingDependency(componentName, props, failedDependencies);
          if (missingDep) {
            this.ensureViewSlotCapacity(targetIndex);
            this.pendingViewSlots.set(targetIndex, {
              proposal: { component: componentName, props },
              waitingOn: missingDep,
            });
            return;
          }
          try {
            this.recordViewComponent({ ...compObj, index: targetIndex });
            this.acceptedCallCount += 1;
          } catch (error) {
            if (!(error instanceof WriterRejection || error instanceof BindRejection)) throw error;
            this.ensureViewSlotCapacity(targetIndex);
            recordUnitRejection("view", error, comp, {
              index: targetIndex,
              slot: `view:${targetIndex}`,
            });
          }
        });
      }
    }

    this.revalidatePendingViewComponents((index, proposal, error) => {
      recordUnitRejection("view", error, proposal, {
        index,
        slot: `view:${index}`,
      });
    });

    if (rejections.length === 0) {
      try {
        this.finishReport({});
        this.acceptedCallCount += 1;
      } catch (error) {
        if (!(error instanceof WriterRejection || error instanceof BindRejection)) throw error;
        const unitKind: WriterRejectedUnitKind =
          error.diagnosticReason === "writer_uncertainty_hidden"
            ? "uncertainty"
            : error.diagnosticField?.startsWith("view")
              ? "view"
              : error.diagnosticField?.startsWith("scenarios")
                ? "scenario"
                : error.diagnosticField?.startsWith("sections")
                  ? "section"
                  : "summary";
        recordUnitRejection(unitKind, error, {}, { slot: "finish" });
      }
    }

    return {
      ok: this.finished && rejections.length === 0 && this.pendingViewSlots.size === 0,
      presentationPlan: this.presentationPlan,
      report: this.finished ? this.assemble() : null,
      acceptedSectionIds: this.acceptedSectionIds,
      acceptedScenarioIds: this.acceptedScenarioIds,
      acceptedViewComponentCount: this.recordedViewComponentCount,
      pendingViewComponents: this.pendingViewComponents,
      unsurfacedClaimIds: this.unsurfacedClaimIds(),
      rejectedUnits: this.rejectedUnitCount,
      rejections,
    };
  }

  /** Clears per-turn unresolved rejection tracking at the start of a new model turn. */
  beginTurn(): void {
    this.unresolvedSlots.clear();
  }

  /** Counts a model turn that issued no tool call. */
  noteInvalidTurn(): void {
    this.rejectedUnitCount += 1;
  }

  /** Answers a call without executing it (per-turn cap, budget cap, or after `finish_report`). */
  decline(call: WriterAgentToolCall, code: string, message: string): WriterAgentToolResult {
    if (!this.finished) this.rejectedUnitCount += 1;
    return { toolCallId: call.id, ok: false, content: JSON.stringify({ ok: false, error: code, message }) };
  }

  /**
   * Executes one tool call. Idempotent on `(reportRunId, toolCallId)`: the same call replays its
   * first result; the same id with different content is rejected. Rejected calls never mutate state.
   */
  execute(call: WriterAgentToolCall): WriterAgentToolResult {
    const key = `${this.context.reportRunId.toLowerCase()}:${call.id}`;
    const previous = this.calls.get(key);
    if (previous) {
      if (previous.name === call.name && previous.arguments === call.arguments) return previous.result;
      return this.decline(call, "tool_call_conflict", "This tool call id was already used for a different call.");
    }
    if (call.name === "compose_writer_report" || call.name === "apply_writer_correction") {
      if (this.finished) {
        const result: WriterAgentToolResult = {
          toolCallId: call.id,
          ok: false,
          content: JSON.stringify({ ok: false, error: "report_finished", message: "The report is already finished." }),
        };
        this.calls.set(key, { name: call.name, arguments: call.arguments, result });
        return result;
      }
      let parsed: Args;
      try {
        parsed = this.parse(call);
      } catch (error) {
        if (!(error instanceof WriterRejection)) throw error;
        this.rejectedUnitCount += 1;
        const result: WriterAgentToolResult = {
          toolCallId: call.id,
          ok: false,
          content: JSON.stringify({ ok: false, error: error.diagnosticReason, message: error.message }),
        };
        this.calls.set(key, { name: call.name, arguments: call.arguments, result });
        return result;
      }
      const compiled = this.compileUnits(parsed);
      const firstRejection = compiled.rejections[0];
      const payload = compiled.ok
        ? {
            ok: true,
            finished: true,
            sectionCount: this.sections.size,
            scenarioCount: this.scenarios.size,
            viewComponentCount: this.recordedViewComponentCount,
            rejectedUnits: compiled.rejectedUnits,
          }
        : {
            ok: false,
            error: firstRejection?.error ?? "writer_output_shape",
            ...(firstRejection?.field ? { field: firstRejection.field } : {}),
            ...(firstRejection?.ungroundedValue ? { ungroundedValue: firstRejection.ungroundedValue } : {}),
            message: firstRejection?.message ?? "One or more units did not pass validation.",
            ...(firstRejection?.hint ? { hint: firstRejection.hint } : {}),
            ...(firstRejection?.candidateClaimIds ? { candidateClaimIds: firstRejection.candidateClaimIds } : {}),
            acceptedSectionIds: compiled.acceptedSectionIds,
            acceptedScenarioIds: compiled.acceptedScenarioIds,
            acceptedViewComponentCount: compiled.acceptedViewComponentCount,
            pendingViewComponents: compiled.pendingViewComponents,
            unsurfacedClaims: compiled.unsurfacedClaimIds,
            rejectedUnits: compiled.rejectedUnits,
            rejections: compiled.rejections,
          };
      const result: WriterAgentToolResult = {
        toolCallId: call.id,
        ok: compiled.ok,
        content: JSON.stringify(payload),
      };
      this.calls.set(key, { name: call.name, arguments: call.arguments, result });
      return result;
    }
    let slot = `tool:${call.name}`;
    let isFinishAttempt = false;
    let blockedByEarlierRejection = false;
    let result: WriterAgentToolResult;
    try {
      if (this.finished) {
        throw new WriterRejection("report_finished", "The report is already finished.");
      }
      const args = this.parse(call);
      slot = this.slotForCall(call.name as WriterAgentToolName, args);
      isFinishAttempt = call.name === "finish_report";
      if (isFinishAttempt && this.unresolvedSlots.size > 0) {
        blockedByEarlierRejection = true;
      }
      if (call.name === "record_view_component") {
        const componentName = typeof args.component === "string" ? args.component : "";
        const props =
          args.props && typeof args.props === "object" && !Array.isArray(args.props)
            ? (args.props as Record<string, unknown>)
            : {};
        const failedDeps = new Set<string>(this.unresolvedSlots.keys());
        if (this.unresolvedSlots.has("outline")) failedDeps.add("summary");
        const missingDep = this.detectMissingDependency(componentName, props, failedDeps);
        if (missingDep) {
          const explicitIndex =
            typeof args.index === "number" && Number.isInteger(args.index) && args.index >= 0
              ? args.index
              : undefined;
          const matched = this.findViewSlotIndexForDependency(componentName, props);
          const targetIndex = explicitIndex ?? (matched >= 0 ? matched : this.viewSlots.length);
          this.ensureViewSlotCapacity(targetIndex);
          this.pendingViewSlots.set(targetIndex, {
            proposal: { component: componentName, props },
            waitingOn: missingDep,
          });
          this.unresolvedSlots.set(slot, "view_pending_dependency");
          const pendingResult: WriterAgentToolResult = {
            toolCallId: call.id,
            ok: false,
            content: JSON.stringify({
              ok: false,
              pending: true,
              error: "view_props_invalid",
              index: targetIndex,
              component: componentName,
              waitingOn: missingDep,
              message: `Component at view[${targetIndex}] references ${missingDep.kind} "${missingDep.id}" which is awaiting correction.`,
            }),
          };
          this.calls.set(key, { name: call.name, arguments: call.arguments, result: pendingResult });
          return pendingResult;
        }
      }
      const payload = this.dispatch(call.name as WriterAgentToolName, args);
      if (
        call.name === "set_report_outline" ||
        call.name === "record_section" ||
        call.name === "record_scenario"
      ) {
        this.revalidatePendingViewComponents();
      }
      const content = JSON.stringify({ ok: true, ...payload });
      if (content.length > WRITER_AGENT_LIMITS.toolResultChars) {
        throw new WriterRejection("result_too_large", "The tool result is too large.");
      }
      this.unresolvedSlots.delete(slot);
      this.acceptedCallCount += 1;
      result = { toolCallId: call.id, ok: true, content };
    } catch (error) {
      if (!(error instanceof WriterRejection || error instanceof BindRejection)) throw error;
      if (!this.finished) {
        if (!blockedByEarlierRejection) {
          this.rejectedUnitCount += 1;
        }
        if (!isFinishAttempt) {
          this.unresolvedSlots.set(slot, error.diagnosticReason);
        }
      }
      const details = this.describeRejection(error, call);
      result = { toolCallId: call.id, ok: false, content: JSON.stringify({ ok: false, ...details }) };
    }
    this.calls.set(key, { name: call.name, arguments: call.arguments, result });
    return result;
  }

  private parse(call: WriterAgentToolCall): Args {
    if (!(WRITER_ALL_TOOL_NAMES as readonly string[]).includes(call.name)) {
      throw new WriterRejection("unknown_tool", "There is no Writer tool with that name.");
    }
    if (call.arguments.length > WRITER_AGENT_LIMITS.argumentsChars) {
      throw new WriterRejection("invalid_arguments", "The arguments are too long.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.arguments || "{}");
    } catch {
      throw new WriterRejection("invalid_arguments", "The arguments are not valid JSON.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new WriterRejection("invalid_arguments", "The arguments must be a JSON object.");
    }
    return parsed as Args;
  }

  private slotForCall(name: WriterAgentToolName, args: Args): string {
    switch (name) {
      case "compose_writer_report":
      case "apply_writer_correction":
        return "compose";
      case "set_report_outline":
        return "outline";
      case "record_section":
        return typeof args.id === "string" && SECTION_ID_PATTERN.test(args.id) ? `section:${args.id}` : "section:invalid";
      case "record_scenario":
        return typeof args.id === "string" && SCENARIO_ID_PATTERN.test(args.id) ? `scenario:${args.id}` : "scenario:invalid";
      case "record_view_component": {
        const props = args.props && typeof args.props === "object" && !Array.isArray(args.props)
          ? (args.props as Record<string, unknown>)
          : null;
        if (args.component === "Narrative" && typeof props?.sectionId === "string") {
          return `view:Narrative:${props.sectionId}`;
        }
        if (args.component === "ScenarioExplorer" && typeof props?.scenarioId === "string") {
          return `view:ScenarioExplorer:${props.scenarioId}`;
        }
        if (typeof args.index === "number" && Number.isInteger(args.index)) {
          return `view:${args.index}`;
        }
        return `view:${typeof args.component === "string" ? args.component : "invalid"}`;
      }
      case "finish_report":
        return "finish";
    }
  }

  private only(args: Args, allowed: readonly string[]): void {
    const extra = Object.keys(args).filter((key) => !allowed.includes(key));
    if (extra.length > 0) {
      throw new WriterRejection("invalid_arguments", `Unexpected argument ${extra[0]!.slice(0, 40)}.`);
    }
  }

  private dispatch(name: WriterAgentToolName, args: Args): Record<string, unknown> {
    switch (name) {
      case "compose_writer_report":
      case "apply_writer_correction":
        return this.compileUnits(args) as unknown as Record<string, unknown>;
      case "set_report_outline":
        return this.setReportOutline(args);
      case "record_section":
        return this.recordSection(args);
      case "record_scenario":
        return this.recordScenario(args);
      case "record_view_component":
        return this.recordViewComponent(args);
      case "finish_report":
        return this.finishReport(args);
    }
  }

  private setReportOutline(args: Args): Record<string, unknown> {
    this.only(args, ["title", "summary"]);
    if (typeof args.title !== "string" || args.title.trim() === "" || args.title.length > WRITER_LIMITS.title) {
      throw new WriterRejection("writer_output_shape", `title must be text up to ${WRITER_LIMITS.title} characters.`, "title");
    }
    const ungroundedTitle = firstUngroundedNumericToken(args.title, this.allCatalogNumbers);
    if (ungroundedTitle) {
      throw new WriterRejection(
        "writer_number_ungrounded",
        `title states an unsupported number (${ungroundedTitle.normalized}) that its cited claims do not contain.`,
        numericDiagnosticField("title", ungroundedTitle),
        ungroundedTitle.normalized,
      );
    }
    if (!Array.isArray(args.summary) || args.summary.length < 1 || args.summary.length > WRITER_LIMITS.summaryBlocks) {
      throw new WriterRejection(
        "writer_output_shape",
        `summary must be a list of 1–${WRITER_LIMITS.summaryBlocks} items.`,
        "summary",
      );
    }
    const summary = args.summary.map((item, index) => validateReportBlock(item, `summary[${index}]`, this.claims).block);
    this.outline = { title: args.title, summary };
    this.unresolvedSlots.delete("outline");
    return {
      title: args.title,
      summaryBlockCount: summary.length,
      unsurfacedClaims: this.unsurfacedClaimIds(),
    };
  }

  private recordSection(args: Args): Record<string, unknown> {
    this.only(args, ["id", "heading", "blocks"]);
    const id = args.id;
    if (typeof id === "string") this.registerSectionOrder(id);
    const existingIndex = typeof id === "string" ? this.sectionOrder.indexOf(id) : -1;
    const sectionIndex = existingIndex >= 0 ? existingIndex : this.sections.size;
    const path = `sections[${sectionIndex}]`;
    if (typeof id !== "string" || !SECTION_ID_PATTERN.test(id)) {
      throw new WriterRejection("writer_output_shape", `${path}.id must be a new s1…s99 id.`, `${path}.id`);
    }
    if (!this.sections.has(id) && this.sections.size >= WRITER_LIMITS.sections) {
      throw new WriterRejection(
        "writer_output_shape",
        `sections must be a list of 1–${WRITER_LIMITS.sections} items.`,
        "sections",
      );
    }
    if (typeof args.heading !== "string" || args.heading.trim() === "" || args.heading.length > WRITER_LIMITS.heading) {
      throw new WriterRejection(
        "writer_output_shape",
        `${path}.heading must be text up to ${WRITER_LIMITS.heading} characters.`,
        `${path}.heading`,
      );
    }
    const ungroundedHeading = firstUngroundedNumericToken(args.heading, this.allCatalogNumbers);
    if (ungroundedHeading) {
      throw new WriterRejection(
        "writer_number_ungrounded",
        `sections.${id}.heading states an unsupported number (${ungroundedHeading.normalized}) that its cited claims do not contain.`,
        numericDiagnosticField(`sections.${id}.heading`, ungroundedHeading),
        ungroundedHeading.normalized,
      );
    }
    if (!Array.isArray(args.blocks) || args.blocks.length < 1 || args.blocks.length > WRITER_LIMITS.blocksPerSection) {
      throw new WriterRejection(
        "writer_output_shape",
        `${path}.blocks must be a list of 1–${WRITER_LIMITS.blocksPerSection} items.`,
        `${path}.blocks`,
      );
    }
    const blocks = args.blocks.map((block, index) => validateReportBlock(block, `${path}.blocks[${index}]`, this.claims).block);
    this.sections.set(id, { id, heading: args.heading, blocks });
    this.unresolvedSlots.delete("section:invalid");
    this.unresolvedSlots.delete(`section:${id}`);
    return {
      sectionId: id,
      blockCount: blocks.length,
      sectionCount: this.sections.size,
      unsurfacedClaims: this.unsurfacedClaimIds(),
    };
  }

  private recordScenario(args: Args): Record<string, unknown> {
    this.only(args, ["id", "title", "question", "rationale", "claimRefs", "parameters", "results"]);
    const id = args.id;
    if (typeof id === "string") this.registerScenarioOrder(id);
    const existingIndex = typeof id === "string" ? this.scenarioOrder.indexOf(id) : -1;
    const scenarioIndex = existingIndex >= 0 ? existingIndex : this.scenarios.size;
    const path = `scenarios[${scenarioIndex}]`;
    if (typeof id === "string" && !this.scenarios.has(id) && this.scenarios.size >= WRITER_LIMITS.scenarios) {
      throw new WriterRejection(
        "writer_output_shape",
        `scenarios must be a list of 0–${WRITER_LIMITS.scenarios} items.`,
        "scenarios",
      );
    }
    const validated = validateScenarioDefinition(args, path, this.claims, this.questionsWithFacts);
    const evaluation = evaluateScenarios(
      {
        schema: WRITER_REPORT_SCHEMA,
        audience: this.context.audience,
        title: "scenario-preview",
        summary: [],
        sections: [],
        scenarios: [validated.scenario],
        view: [],
      },
      this.context.claims,
    ).scenarios[0]!;
    this.scenarios.set(validated.scenario.id, validated.scenario);
    this.unresolvedSlots.delete("scenario:invalid");
    this.unresolvedSlots.delete(`scenario:${validated.scenario.id}`);
    return {
      scenarioId: validated.scenario.id,
      results: evaluation.results.map(({ id: resultId, label, unit, status, value, reason, usesAssumptions }) => ({
        id: resultId,
        label,
        unit,
        status,
        value,
        reason,
        usesAssumptions,
      })),
    };
  }

  private scenarioResultIds(): Set<string> {
    const ids = new Set<string>();
    for (const scenario of this.scenarios.values()) {
      for (const result of scenario.results) {
        ids.add(`${scenario.id}.${result.id}`);
      }
    }
    return ids;
  }

  private recordViewComponent(args: Args): Record<string, unknown> {
    this.only(args, ["index", "component", "props"]);
    const component = args.component;
    if (typeof component !== "string" || component.trim() === "" || component.length > 40) {
      throw new WriterRejection("view_component_unknown", "view component must be a valid catalog component name.");
    }
    if (!args.props || typeof args.props !== "object" || Array.isArray(args.props)) {
      throw new WriterRejection("view_props_invalid", "view.props must be an object.");
    }
    const props = args.props as Record<string, unknown>;
    let targetIndex = this.viewSlots.length;
    if (args.index !== undefined && args.index !== null) {
      if (
        typeof args.index !== "number" ||
        !Number.isInteger(args.index) ||
        args.index < 0 ||
        args.index >= WRITER_LIMITS.viewComponents
      ) {
        throw new WriterRejection(
          "view_props_invalid",
          `view index must be an integer between 0 and ${WRITER_LIMITS.viewComponents - 1}.`,
        );
      }
      targetIndex = args.index;
    } else {
      const matched = this.findViewSlotIndexForDependency(component, props);
      if (matched >= 0) targetIndex = matched;
    }
    const isReplacingExistingSlot =
      targetIndex < this.viewSlots.length &&
      (this.viewSlots[targetIndex] !== null || this.pendingViewSlots.has(targetIndex));
    if (!isReplacingExistingSlot && this.recordedViewComponentCount >= WRITER_LIMITS.viewComponents) {
      throw new WriterRejection(
        "writer_output_shape",
        `view must be a list of 0–${WRITER_LIMITS.viewComponents} items.`,
        "view",
      );
    }
    const path = `view[${targetIndex}]`;
    const validationContext: ViewComponentValidationContext = {
      claims: this.claims,
      questionsWithFacts: this.questionsWithFacts,
      hasOutline: this.outline !== null,
      sectionIds: new Set(this.sections.keys()),
      scenarioResultIds: this.scenarioResultIds(),
      scenarioIds: new Set(this.scenarios.keys()),
    };
    validateViewComponentProposal({ component, props }, path, validationContext);
    this.ensureViewSlotCapacity(targetIndex);
    this.viewSlots[targetIndex] = { component, props };
    this.pendingViewSlots.delete(targetIndex);
    this.unresolvedSlots.delete(`view:${component}`);
    this.unresolvedSlots.delete(`view:${targetIndex}`);
    if (component === "Narrative" && typeof props.sectionId === "string") {
      this.unresolvedSlots.delete(`view:Narrative:${props.sectionId}`);
    }
    if (component === "ScenarioExplorer" && typeof props.scenarioId === "string") {
      this.unresolvedSlots.delete(`view:ScenarioExplorer:${props.scenarioId}`);
    }
    return {
      index: targetIndex,
      component,
      viewCount: this.recordedViewComponentCount,
      unsurfacedClaims: this.unsurfacedClaimIds(),
    };
  }

  private finishReport(args: Args): Record<string, unknown> {
    this.only(args, []);
    if (this.unresolvedSlots.size > 0) {
      const failedSlots = [...this.unresolvedSlots.keys()].join(", ");
      throw new WriterRejection(
        "turn_had_rejected_calls",
        `Earlier tool calls failed (${failedSlots}). Fix the rejected items and call finish_report again.`,
      );
    }
    if (this.pendingViewSlots.size > 0) {
      const pendingDesc = [...this.pendingViewSlots.entries()]
        .sort(([a], [b]) => a - b)
        .map(([idx, p]) => `view[${idx}] (${p.proposal.component} waiting on ${p.waitingOn.kind} ${p.waitingOn.id})`)
        .join(", ");
      const firstIdx = [...this.pendingViewSlots.keys()].sort((a, b) => a - b)[0]!;
      throw new WriterRejection(
        "view_props_invalid",
        `Pending view components have unresolved dependencies: ${pendingDesc}.`,
        `view[${firstIdx}]`,
      );
    }
    if (!this.outline) {
      throw new WriterRejection("writer_output_shape", "Call set_report_outline before finish_report.", "summary");
    }
    if (this.sections.size === 0) {
      throw new WriterRejection("writer_output_shape", "Record at least one section before finish_report.", "sections");
    }
    const orderedSections = this.orderedSections();
    const orderedScenarios = this.orderedScenarios();
    const orderedView = this.orderedViewComponents();
    const candidate: WriterReport = {
      schema: WRITER_REPORT_SCHEMA,
      audience: this.context.audience,
      title: this.outline.title,
      summary: this.outline.summary.map((block) => ({ ...block, claimRefs: [...block.claimRefs] })),
      sections: orderedSections.map((section) => ({
        id: section.id,
        heading: section.heading,
        blocks: section.blocks.map((block) => ({ ...block, claimRefs: [...block.claimRefs] })),
      })),
      scenarios: orderedScenarios.map((scenario) => ({
        ...scenario,
        claimRefs: [...scenario.claimRefs],
        parameters: scenario.parameters.map((param) => ({ ...param })),
        results: scenario.results.map((result) => ({ ...result })),
      })),
      view: orderedView.map((component) => ({ component: component.component, props: { ...component.props } })),
    };
    const validated = validateWriterReport(candidate, {
      audience: this.context.audience,
      claims: this.context.claims,
    });
    if (!validated.ok) {
      throw new WriterRejection(validated.diagnosticReason, validated.message, validated.diagnosticField);
    }
    const built = buildReport(validated.value, {
      audience: this.context.audience,
      claims: this.context.claims,
      fileNames: this.fileNames,
    });
    if (!built.ok) {
      throw new BindRejection(built.diagnosticReason, built.message, built.diagnosticField);
    }
    this.finishedReport = built.value.writerOutput;
    return {
      finished: true,
      sectionCount: this.sections.size,
      scenarioCount: this.scenarios.size,
      viewComponentCount: this.recordedViewComponentCount,
    };
  }

  private surfacedClaimIds(): Set<string> {
    const surfaced = new Set<string>();
    const scanBlocks = (blocks: readonly ReportBlock[]) => {
      for (const block of blocks) {
        for (const ref of block.claimRefs) {
          const claim = this.claims.get(ref);
          if (!claim) continue;
          if (block.type === "UNCERTAINTY") {
            surfaced.add(ref);
          } else if (
            (block.type === "DOCUMENTED" || block.type === "INTERPRETATION") &&
            (claim.kind === "CONFLICT" || visiblyPresentsUncertainty(block.text, claim))
          ) {
            surfaced.add(ref);
          }
        }
      }
    };
    if (this.outline) scanBlocks(this.outline.summary);
    for (const section of this.sections.values()) scanBlocks(section.blocks);
    for (const item of this.orderedViewComponents()) {
      collectVisibleStructuredUncertainties(item.component, item.props, this.claims, surfaced);
    }
    return surfaced;
  }

  private unsurfacedClaimIds(): string[] {
    const surfaced = this.surfacedClaimIds();
    return mustSurfaceClaims(this.context.claims)
      .filter((claim) => !surfaced.has(claim.id))
      .map((claim) => claim.id);
  }

  private parseCallArgs(call: WriterAgentToolCall): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(call.arguments || "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private filterCompatibleCandidates(
    claims: readonly StudyClaim[],
    options: {
      readonly componentName?: string;
      readonly blockType?: ReportBlockType;
      readonly questionId?: string;
      readonly requireRefs?: boolean;
    },
  ): string[] {
    const compRules = componentClaimRulesFor(options.componentName);
    const blockKinds = allowedClaimKindsForBlockType(options.blockType);
    const requireRefs = options.requireRefs ?? compRules?.requireRefs ?? false;
    return claims
      .filter((claim) => {
        if (options.questionId && claim.planQuestionId !== options.questionId) return false;
        if (claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED") return false;
        if (claim.kind === "ANSWER" && this.questionsWithFacts.has(claim.planQuestionId)) {
          const allowMissing =
            compRules?.allowMissingEvidenceAnswer === true &&
            (claim.answerStatus === "MISSING_EVIDENCE" || claim.answerStatus === "CONFLICTING");
          if (!allowMissing) return false;
        }
        if (requireRefs && claim.refs.length === 0) return false;
        if (compRules && !compRules.allowedKinds.has(claim.kind)) return false;
        if (blockKinds && !blockKinds.has(claim.kind)) return false;
        return true;
      })
      .map((claim) => claim.id);
  }

  private describeRejection(
    error: WriterRejection | BindRejection,
    call: WriterAgentToolCall,
  ): Record<string, unknown> {
    const reason = error.diagnosticReason;
    const field = error.diagnosticField ?? null;
    const ungroundedValue = error.ungroundedValue;
    const parsedArgs = this.parseCallArgs(call);
    const componentName = typeof parsedArgs?.component === "string" ? parsedArgs.component : undefined;
    const blockType = blockTypeFromField(field, parsedArgs);
    const compRules = componentClaimRulesFor(componentName);
    const base: Record<string, unknown> = {
      error: reason,
      ...(field ? { field } : {}),
      ...(ungroundedValue ? { ungroundedValue } : {}),
      message: error.message,
    };

    if (reason === "writer_uncertainty_hidden") {
      const missing = this.unsurfacedClaimIds();
      return {
        ...base,
        candidateClaimIds: missing,
        hint: `Visibly surface [${missing.join(", ")}] in an UNCERTAINTY block (or an IssueList, Comparison, RecordTable, KeyFindings or EvidencePanel whose prose states the uncertainty or conflict), then call finish_report again.`,
      };
    }

    if (reason === "writer_claim_kind") {
      const broadMatch = /cites broad answer (P[1-9][0-9]{0,2})\b/.exec(error.message);
      if (broadMatch) {
        const questionId = broadMatch[1]!;
        const atomicIds = this.filterCompatibleCandidates(this.context.claims, {
          componentName,
          blockType,
          questionId,
        });
        const allowedDesc = compRules
          ? `Allowed claim kinds for ${componentName}: ${[...compRules.allowedKinds].join(", ")}${compRules.requireRefs ? " (with source pages)" : ""}. `
          : "";
        return {
          ...base,
          candidateClaimIds: atomicIds,
          hint: `${allowedDesc}Do not cite broad question answer ${questionId} when atomic facts exist. Cite the specific compatible claim(s) for this item instead: ${atomicIds.join(", ")}.`,
        };
      }
      const claimMatch = /cites (P[1-9][0-9]{0,2}(?:\.[FCAUKDL][0-9]{1,3})?)\b/.exec(error.message);
      const claim = claimMatch ? this.claims.get(claimMatch[1]!) : undefined;
      if (claim) {
        if (compRules && componentName) {
          const allowedKindsList = [...compRules.allowedKinds].join(", ");
          const sameQuestionCandidates = this.filterCompatibleCandidates(this.context.claims, {
            componentName,
            questionId: claim.planQuestionId,
          });
          const candidateClaimIds =
            sameQuestionCandidates.length > 0
              ? sameQuestionCandidates
              : this.filterCompatibleCandidates(this.context.claims, { componentName });
          return {
            ...base,
            candidateClaimIds,
            hint: `Claim ${claim.id} has kind ${claim.kind}, which is not allowed in ${componentName}. Allowed claim kinds for ${componentName}: ${allowedKindsList}${compRules.requireRefs ? " (each must have source page references)" : ""}. Replace ${claim.id} with a compatible claim such as [${candidateClaimIds.join(", ")}] or move ${claim.id} to a compatible component.`,
          };
        }
        const allowedBlocks = allowedBlockTypesForClaimKind(claim.kind);
        const compatibleInQuestion = blockType
          ? this.filterCompatibleCandidates(this.context.claims, {
              blockType,
              questionId: claim.planQuestionId,
            })
          : [];
        return {
          ...base,
          ...(compatibleInQuestion.length > 0 ? { candidateClaimIds: compatibleInQuestion } : {}),
          hint: `Claim ${claim.id} has kind ${claim.kind}, which is not allowed in this${blockType ? ` ${blockType}` : ""} block or component. Allowed block types for ${claim.kind}: ${allowedBlocks.join(", ")}. If combining an ASSESSMENT (.A) with an UNCERTAINTY (.U) or LIMITATION (.L), split them into separate blocks.`,
        };
      }
    }

    if (reason === "writer_number_ungrounded") {
      const candidateClaimIds = this.findCandidateClaimsForUngroundedCall(call, ungroundedValue, {
        componentName,
        blockType,
      });
      const valueDesc = ungroundedValue ? ` "${ungroundedValue}"` : "";
      const fieldDesc = field ? ` at ${field}` : "";
      return {
        ...base,
        candidateClaimIds,
        hint:
          candidateClaimIds.length > 0
            ? `Unsupported numerical value${valueDesc}${fieldDesc}: every number or date in prose must appear in the specific claims cited by that block or item. Either add the compatible supporting claim(s) [${candidateClaimIds.join(", ")}] to claimRefs, or remove${valueDesc || " the ungrounded number"} from the text.`
            : `Unsupported numerical value${valueDesc}${fieldDesc}: this number does not appear in any compatible Study claim. Remove${valueDesc || " the unsupported number"} from the text; never invent counts, dates, or mental arithmetic.`,
      };
    }

    if (reason === "writer_unverified_number") {
      const listMatch = /lists (P[1-9][0-9]{0,2}(?:\.[FCAUKDL][0-9]{1,3})?) as a finding/.exec(error.message);
      if (listMatch && compRules && componentName) {
        const badClaim = this.claims.get(listMatch[1]!);
        const candidateClaimIds = this.filterCompatibleCandidates(this.context.claims, {
          componentName,
          questionId: badClaim?.planQuestionId,
        });
        return {
          ...base,
          candidateClaimIds,
          hint: `Claim ${listMatch[1]} (${badClaim?.kind ?? "UNCERTAINTY"}) cannot be listed as a finding in ${componentName}. Allowed claim kinds for ${componentName}: ${[...compRules.allowedKinds].join(", ")} (with source pages). Present uncertainties in an UNCERTAINTY block or IssueList instead.`,
        };
      }
      return {
        ...base,
        hint: "Unverified or noncalculable calculations may only be cited in an UNCERTAINTY block without {{calc:...}} binding tokens, and never in DOCUMENTED/INTERPRETATION blocks, scenarios, or A2UI metrics/charts/tables.",
      };
    }

    if (reason === "writer_claim_missing" || reason === "writer_claim_unknown") {
      const noPageMatch = /cites (P[1-9][0-9]{0,2}(?:\.[FCAUKDL][0-9]{1,3})?), which has no source page reference/.exec(
        error.message,
      );
      if (noPageMatch) {
        const pagelessClaim = this.claims.get(noPageMatch[1]!);
        const sameQuestionPageBacked = this.filterCompatibleCandidates(this.context.claims, {
          componentName,
          blockType,
          questionId: pagelessClaim?.planQuestionId,
          requireRefs: true,
        });
        const pageBackedCandidates =
          sameQuestionPageBacked.length > 0
            ? sameQuestionPageBacked
            : this.filterCompatibleCandidates(this.context.claims, {
                componentName,
                blockType,
                requireRefs: true,
              });
        return {
          ...base,
          candidateClaimIds: pageBackedCandidates,
          hint: `Claim ${noPageMatch[1]} has no source page reference and cannot be cited in ${componentName ?? "this component"}. Cite page-backed Study claim(s) instead: [${pageBackedCandidates.join(", ")}].`,
        };
      }
      const candidateClaimIds = this.filterCompatibleCandidates(this.context.claims, {
        componentName,
        blockType,
        requireRefs: compRules?.requireRefs ?? false,
      });
      return {
        ...base,
        ...(candidateClaimIds.length > 0 ? { candidateClaimIds } : {}),
        hint: `Cite only valid Study claim ids from the user message${compRules ? ` (allowed kinds for ${componentName}: ${[...compRules.allowedKinds].join(", ")}${compRules.requireRefs ? ", with source pages" : ""})` : " (and ensure claims cited in Timeline, Checklist, RecordTable, Comparison, KeyFindings and EvidencePanel have source pages)"}.`,
      };
    }

    return base;
  }

  private findCandidateClaimsForUngroundedCall(
    call: WriterAgentToolCall,
    explicitUngroundedValue?: string,
    context?: { readonly componentName?: string; readonly blockType?: ReportBlockType },
  ): string[] {
    const ungroundedNumbers = new Set<string>();
    if (explicitUngroundedValue) {
      ungroundedNumbers.add(explicitUngroundedValue);
    }
    const parsed = this.parseCallArgs(call);
    if (parsed) {
      for (const token of firstUngroundedTokensInObject(parsed, this.claims)) {
        ungroundedNumbers.add(token);
      }
      if (ungroundedNumbers.size === 0) {
        const fallback = firstUngroundedNumericToken(JSON.stringify(parsed), new Set());
        if (fallback) ungroundedNumbers.add(fallback.normalized);
      }
    }
    if (ungroundedNumbers.size === 0) return [];
    const compRules = componentClaimRulesFor(context?.componentName);
    const blockKinds = allowedClaimKindsForBlockType(context?.blockType);
    const candidates: string[] = [];
    for (const claim of this.context.claims) {
      if (claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED") continue;
      if (claim.kind === "ANSWER" && this.questionsWithFacts.has(claim.planQuestionId)) continue;
      if (compRules) {
        if (!compRules.allowedKinds.has(claim.kind)) continue;
        if (compRules.requireRefs && claim.refs.length === 0) continue;
      }
      if (blockKinds && !blockKinds.has(claim.kind)) continue;
      const claimNumbers = groundingNumbersForClaims(this.claims, [claim.id]);
      if ([...ungroundedNumbers].some((num) => claimNumbers.has(num))) {
        candidates.push(claim.id);
      }
    }
    return candidates;
  }

  /** Deterministic assembly of the exact `hive.writer-report/1` shape. Only after `finish_report`. */
  assemble(): WriterReport {
    if (!this.finishedReport) throw new Error("writer_agent_unfinished");
    return {
      schema: WRITER_REPORT_SCHEMA,
      audience: this.finishedReport.audience,
      title: this.finishedReport.title,
      summary: this.finishedReport.summary.map((block) => ({ ...block, claimRefs: [...block.claimRefs] })),
      sections: this.finishedReport.sections.map((section) => ({
        id: section.id,
        heading: section.heading,
        blocks: section.blocks.map((block) => ({ ...block, claimRefs: [...block.claimRefs] })),
      })),
      scenarios: this.finishedReport.scenarios.map((scenario) => ({
        ...scenario,
        claimRefs: [...scenario.claimRefs],
        parameters: scenario.parameters.map((param) => ({ ...param })),
        results: scenario.results.map((result) => ({ ...result })),
      })),
      view: this.finishedReport.view.map((component) => ({
        component: component.component,
        props: { ...component.props },
      })),
    };
  }
}

/** Alias for the application-orchestrated Writer compiler (D-047). */
export const WriterCompiler = WriterAgentLedger;
export type WriterCompiler = WriterAgentLedger;

function firstUngroundedTokensInObject(
  node: unknown,
  claims: ReadonlyMap<string, StudyClaim>,
): string[] {
  const found: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    const refs = Array.isArray(record.claimRefs)
      ? record.claimRefs.filter((r): r is string => typeof r === "string")
      : typeof record.claimRef === "string"
        ? [record.claimRef]
        : null;
    if (refs) {
      const allowed = groundingNumbersForClaims(claims, refs);
      for (const field of ["text", "date", "label", "left", "right", "value"]) {
        if (typeof record[field] === "string") {
          const token = firstUngroundedNumericToken(record[field] as string, allowed);
          if (token) found.push(token.normalized);
        }
      }
      if (Array.isArray(record.cells)) {
        for (const cell of record.cells) {
          if (typeof cell === "string") {
            const token = firstUngroundedNumericToken(cell, allowed);
            if (token) found.push(token.normalized);
          }
        }
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(node);
  return found;
}
