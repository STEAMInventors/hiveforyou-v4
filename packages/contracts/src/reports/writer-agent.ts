import type { StudyAgentBudgetDimension } from "../analysis/study-agent";
import type { StudyClaim } from "../analysis/study-verification";
import {
  A2UI_COMPONENTS,
  BindRejection,
  buildReport,
  validateViewComponentProposal,
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
 * Agentic Writer ledger (D-045). The model writes one audience report over an accepted Canonical
 * Study's claim catalog through five fixed tools; this ledger is the trusted executor. Each block,
 * scenario and A2UI component is validated immediately using the shared Writer and A2UI validators.
 * Rejected tool calls never mutate accepted state and return actionable diagnostics for targeted
 * correction. Nothing is repaired or auto-cited in code. After `finish_report`, `assemble()`
 * returns the unchanged `hive.writer-report/1` object and `buildReport()` remains the final authority.
 */

export const WRITER_AGENT_TOOL_NAMES = [
  "set_report_outline",
  "record_section",
  "record_scenario",
  "record_view_component",
  "finish_report",
] as const;
export type WriterAgentToolName = (typeof WRITER_AGENT_TOOL_NAMES)[number];

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
  /** Maximum rejected tool calls (or empty turns) per Writer attempt. */
  maxInvalidCalls: 8,
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

export const WRITER_AGENT_LIMITS = {
  argumentsChars: 32_000,
  toolResultChars: 32_000,
} as const;

export type WriterAgentBudgetDiagnostic = {
  readonly dimension: StudyAgentBudgetDimension;
  readonly roundsUsed: number;
  readonly roundsAllowed: number;
  readonly toolCalls: number;
  readonly invalidCalls: number;
  readonly sectionsRecorded: number;
  readonly viewComponentsRecorded: number;
};

const WRITER_BUDGET_FIELD_RE =
  /^budget\.(rounds|tool_calls|invalid_calls|output_tokens|wall_clock|request_bytes|input_tokens|estimated_cost):r([0-9]{1,4})\/([0-9]{1,4}):tc([0-9]{1,4}):inv([0-9]{1,4}):s([0-9]{1,4}):v([0-9]{1,4})$/;

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
    `inv${clamp(input.invalidCalls)}`,
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
    dimension: match[1] as StudyAgentBudgetDimension,
    roundsUsed: Number(match[2]),
    roundsAllowed: Number(match[3]),
    toolCalls: Number(match[4]),
    invalidCalls: Number(match[5]),
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
      parameters: object(
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
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "record_scenario",
      description:
        "Records or replaces one deterministic scenario (S1 to S9). Validates documented parameters against their cited specific claim and computes results in code.",
      parameters: object(
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
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "record_view_component",
      description:
        "Appends one A2UI component to the report view, or replaces the component at zero-based index when index is given. Referenced sections and scenarios must already be recorded.",
      parameters: object(
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
      ),
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

export class WriterAgentLedger {
  private readonly claims: ReadonlyMap<string, StudyClaim>;
  private readonly questionsWithFacts: ReadonlySet<string>;
  private readonly allCatalogNumbers: ReadonlySet<string>;
  private readonly fileNames: ReadonlyMap<string, string>;
  private readonly calls = new Map<string, { name: string; arguments: string; result: WriterAgentToolResult }>();
  private outline: { title: string; summary: ReportBlock[] } | null = null;
  private readonly sections = new Map<string, ReportSection>();
  private readonly scenarios = new Map<string, ScenarioDefinition>();
  private readonly view: ViewComponentProposal[] = [];
  private readonly unresolvedSlots = new Map<string, string>();
  private finishedReport: WriterReport | null = null;
  private acceptedCallCount = 0;
  private invalidCallCount = 0;

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

  /** Number of accepted (successful) tool calls executed on this ledger. */
  get toolCalls(): number {
    return this.acceptedCallCount;
  }

  /** Number of rejected tool calls (or turns without tool calls) on this ledger. */
  get invalidCalls(): number {
    return this.invalidCallCount;
  }

  get completedSectionCount(): number {
    return this.sections.size;
  }

  get recordedViewComponentCount(): number {
    return this.view.length;
  }

  /** Clears per-turn unresolved rejection tracking at the start of a new model turn. */
  beginTurn(): void {
    this.unresolvedSlots.clear();
  }

  /** Counts a model turn that issued no tool call. */
  noteInvalidTurn(): void {
    this.invalidCallCount += 1;
  }

  /** Answers a call without executing it (per-turn cap, budget cap, or after `finish_report`). */
  decline(call: WriterAgentToolCall, code: string, message: string): WriterAgentToolResult {
    if (!this.finished) this.invalidCallCount += 1;
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
      const payload = this.dispatch(call.name as WriterAgentToolName, args);
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
          this.invalidCallCount += 1;
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
    if (!(WRITER_AGENT_TOOL_NAMES as readonly string[]).includes(call.name)) {
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
        "title states a number its sources do not contain.",
        numericDiagnosticField("title", ungroundedTitle),
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
    return {
      title: args.title,
      summaryBlockCount: summary.length,
      unsurfacedClaims: this.unsurfacedClaimIds(),
    };
  }

  private recordSection(args: Args): Record<string, unknown> {
    this.only(args, ["id", "heading", "blocks"]);
    const id = args.id;
    const existingIndex = typeof id === "string" ? [...this.sections.keys()].indexOf(id) : -1;
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
        `sections.${id}.heading states a number its sources do not contain.`,
        numericDiagnosticField(`sections.${id}.heading`, ungroundedHeading),
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
    const existingIndex = typeof id === "string" ? [...this.scenarios.keys()].indexOf(id) : -1;
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
    let targetIndex = this.view.length;
    if (args.index !== undefined && args.index !== null) {
      if (typeof args.index !== "number" || !Number.isInteger(args.index) || args.index < 0 || args.index > this.view.length) {
        throw new WriterRejection("view_props_invalid", `view index must be an integer between 0 and ${this.view.length}.`);
      }
      targetIndex = args.index;
    } else if (component === "Narrative" && typeof props.sectionId === "string") {
      const existing = this.view.findIndex((item) => item.component === "Narrative" && item.props.sectionId === props.sectionId);
      if (existing >= 0) targetIndex = existing;
    } else if (component === "ScenarioExplorer" && typeof props.scenarioId === "string") {
      const existing = this.view.findIndex(
        (item) => item.component === "ScenarioExplorer" && item.props.scenarioId === props.scenarioId,
      );
      if (existing >= 0) targetIndex = existing;
    }
    if (targetIndex === this.view.length && this.view.length >= WRITER_LIMITS.viewComponents) {
      throw new WriterRejection(
        "writer_output_shape",
        `view must be a list of 0–${WRITER_LIMITS.viewComponents} items.`,
        "view",
      );
    }
    const path = `view[${targetIndex}]`;
    validateViewComponentProposal(
      { component, props },
      path,
      {
        claims: this.claims,
        questionsWithFacts: this.questionsWithFacts,
        hasOutline: this.outline !== null,
        sectionIds: new Set(this.sections.keys()),
        scenarioResultIds: this.scenarioResultIds(),
        scenarioIds: new Set(this.scenarios.keys()),
      },
    );
    this.view[targetIndex] = { component, props };
    this.unresolvedSlots.delete(`view:${component}`);
    this.unresolvedSlots.delete(`view:${targetIndex}`);
    return {
      index: targetIndex,
      component,
      viewCount: this.view.length,
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
    if (!this.outline) {
      throw new WriterRejection("writer_output_shape", "Call set_report_outline before finish_report.", "summary");
    }
    if (this.sections.size === 0) {
      throw new WriterRejection("writer_output_shape", "Record at least one section before finish_report.", "sections");
    }
    const candidate: WriterReport = {
      schema: WRITER_REPORT_SCHEMA,
      audience: this.context.audience,
      title: this.outline.title,
      summary: this.outline.summary.map((block) => ({ ...block, claimRefs: [...block.claimRefs] })),
      sections: [...this.sections.values()].map((section) => ({
        id: section.id,
        heading: section.heading,
        blocks: section.blocks.map((block) => ({ ...block, claimRefs: [...block.claimRefs] })),
      })),
      scenarios: [...this.scenarios.values()].map((scenario) => ({
        ...scenario,
        claimRefs: [...scenario.claimRefs],
        parameters: scenario.parameters.map((param) => ({ ...param })),
        results: scenario.results.map((result) => ({ ...result })),
      })),
      view: this.view.map((component) => ({ component: component.component, props: { ...component.props } })),
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
      viewComponentCount: this.view.length,
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
    for (const item of this.view) {
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

  private describeRejection(
    error: WriterRejection | BindRejection,
    call: WriterAgentToolCall,
  ): Record<string, unknown> {
    const reason = error.diagnosticReason;
    const field = error.diagnosticField ?? null;
    const base: Record<string, unknown> = {
      error: reason,
      ...(field ? { field } : {}),
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
        const atomicIds = this.context.claims
          .filter(
            (claim) =>
              claim.planQuestionId === questionId &&
              claim.id !== questionId &&
              (claim.kind !== "CALCULATION" || claim.numericStatus === "VERIFIED"),
          )
          .map((claim) => claim.id);
        return {
          ...base,
          candidateClaimIds: atomicIds,
          hint: `Do not cite broad question answer ${questionId} when atomic facts exist. Cite the specific claim(s) for this item instead: ${atomicIds.join(", ")}.`,
        };
      }
      const claimMatch = /cites (P[1-9][0-9]{0,2}(?:\.[FCAUKDL][0-9]{1,3})?)\b/.exec(error.message);
      const claim = claimMatch ? this.claims.get(claimMatch[1]!) : undefined;
      if (claim) {
        const allowedBlocks = allowedBlockTypesForClaimKind(claim.kind);
        return {
          ...base,
          hint: `Claim ${claim.id} has kind ${claim.kind}, which is not allowed in this block or component. Allowed block types for ${claim.kind}: ${allowedBlocks.join(", ")}. If combining an ASSESSMENT (.A) with an UNCERTAINTY (.U) or LIMITATION (.L), split them into separate blocks.`,
        };
      }
    }

    if (reason === "writer_number_ungrounded") {
      const candidateClaimIds = this.findCandidateClaimsForUngroundedCall(call);
      return {
        ...base,
        candidateClaimIds,
        hint:
          candidateClaimIds.length > 0
            ? `Every number or date in prose must appear in the specific claims cited by that block or item. Either add the compatible supporting claim(s) [${candidateClaimIds.join(", ")}] to claimRefs, or remove the ungrounded number from the text.`
            : "This number does not appear in any Study claim. Remove the unsupported number from the text; never invent counts, dates, or mental arithmetic.",
      };
    }

    if (reason === "writer_unverified_number") {
      return {
        ...base,
        hint: "Unverified or noncalculable calculations may only be cited in an UNCERTAINTY block without {{calc:...}} binding tokens, and never in DOCUMENTED/INTERPRETATION blocks, scenarios, or A2UI metrics/charts/tables.",
      };
    }

    if (reason === "writer_claim_missing" || reason === "writer_claim_unknown") {
      return {
        ...base,
        hint: "Cite only valid Study claim ids from the user message (and ensure claims cited in Timeline, Checklist, RecordTable, Comparison, KeyFindings and EvidencePanel have source pages).",
      };
    }

    return base;
  }

  private findCandidateClaimsForUngroundedCall(call: WriterAgentToolCall): string[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.arguments || "{}");
    } catch {
      return [];
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const raw = JSON.stringify(parsed);
    const ungroundedNumbers = new Set<string>();
    for (const token of firstUngroundedTokensInObject(parsed, this.claims)) {
      ungroundedNumbers.add(token);
    }
    if (ungroundedNumbers.size === 0) {
      const fallback = firstUngroundedNumericToken(raw, new Set());
      if (fallback) ungroundedNumbers.add(fallback.normalized);
    }
    const candidates: string[] = [];
    for (const claim of this.context.claims) {
      if (claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED") continue;
      if (claim.kind === "ANSWER" && this.questionsWithFacts.has(claim.planQuestionId)) continue;
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
