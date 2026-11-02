import {
  type Decimal,
  decimalFromPlain,
  evaluateFormula,
  type FormulaNode,
  formatDecimal,
  formulaLeaves,
  parseFormula,
} from "../analysis/decimal-formula";
import type { StudyClaim } from "../analysis/study-verification";
import { diagnosticFieldFromMessage } from "../errors/failure-diagnostic";
import type { ContractValidation } from "../source-documents/source-document-contracts";

/**
 * `hive.writer-report/1` (D-041): one Writer model call per audience proposes report text, scenario
 * definitions and an A2UI composition over an accepted Canonical Study. Trusted code validates it
 * against the Study's claim catalog (every claim reference resolves, numbers are grounded,
 * unverified calculations never appear as documented findings, uncertainties are surfaced),
 * computes every scenario result itself, and binds the view only to verified values.
 */

export const WRITER_REPORT_SCHEMA = "hive.writer-report/1";
export const SCENARIO_ANALYSIS_SCHEMA = "hive.scenario-analysis/1";

export const REPORT_AUDIENCES = ["CUSTOMER", "PRO"] as const;
export type ReportAudience = (typeof REPORT_AUDIENCES)[number];

export const REPORT_BLOCK_TYPES = [
  "DOCUMENTED",
  "INTERPRETATION",
  "UNCERTAINTY",
  "GENERAL_INFORMATION",
  "QUESTION",
  "NEXT_STEP",
] as const;
export type ReportBlockType = (typeof REPORT_BLOCK_TYPES)[number];

export type ReportBlock = { type: ReportBlockType; text: string; claimRefs: string[] };
export type ReportSection = { id: string; heading: string; blocks: ReportBlock[] };

export type ScenarioParameter = {
  name: string;
  label: string;
  value: string;
  unit: string | null;
  basis: "DOCUMENTED" | "ASSUMPTION";
  claimRef: string | null;
};
export type ScenarioResultDefinition = { id: string; label: string; unit: string | null; formula: FormulaNode };
export type ScenarioDefinition = {
  id: string;
  title: string;
  question: string;
  rationale: string;
  claimRefs: string[];
  parameters: ScenarioParameter[];
  results: ScenarioResultDefinition[];
};

export type ViewComponentProposal = { component: string; props: Record<string, unknown> };

export type WriterReport = {
  schema: typeof WRITER_REPORT_SCHEMA;
  audience: ReportAudience;
  title: string;
  summary: ReportBlock[];
  sections: ReportSection[];
  scenarios: ScenarioDefinition[];
  view: ViewComponentProposal[];
};

export const SCENARIO_RESULT_STATUSES = ["CALCULATED", "NONCALCULABLE"] as const;
export type ScenarioResultStatus = (typeof SCENARIO_RESULT_STATUSES)[number];

export type ScenarioResult = {
  id: string;
  scenarioId: string;
  label: string;
  unit: string | null;
  status: ScenarioResultStatus;
  value: string | null;
  reason: "DIVISION_BY_ZERO" | "UNRESOLVED_INPUT" | "OUT_OF_RANGE" | null;
  usesAssumptions: boolean;
};

export type ScenarioAnalysis = {
  schema: typeof SCENARIO_ANALYSIS_SCHEMA;
  scenarios: (Omit<ScenarioDefinition, "results"> & { results: (ScenarioResult & { formula: FormulaNode })[] })[];
};

export const WRITER_LIMITS = {
  title: 160,
  heading: 160,
  blockText: 2000,
  sections: 12,
  blocksPerSection: 20,
  summaryBlocks: 6,
  claimRefsPerBlock: 24,
  scenarios: 5,
  parameters: 8,
  results: 6,
  viewComponents: 30,
} as const;

/** `{{calc:P3.C1}}` binds a VERIFIED Study calculation; `{{result:S1.R1}}` binds a scenario result. */
export const BINDING_TOKEN = /\{\{(calc|result):([A-Za-z0-9.]{1,32})\}\}/g;

const SECTION_ID = /^s[1-9][0-9]?$/;
const SCENARIO_ID = /^S[1-9]$/;
const RESULT_ID = /^R[1-9]$/;
const PARAM_NAME = /^[a-z][a-zA-Z0-9]{0,31}$/;

class WriterRejection extends Error {
  constructor(
    readonly diagnosticReason: string,
    message: string,
    readonly diagnosticField?: string,
  ) {
    super(message);
  }
}

function reject(diagnosticReason: string, message: string): never {
  throw new WriterRejection(diagnosticReason, message, diagnosticFieldFromMessage(message));
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("writer_output_shape", `${path} must be an object.`);
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    reject("writer_output_shape", `${path} must be a list of ${min}–${max} items.`);
  }
  return value;
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    reject("writer_output_shape", `${path} must be text up to ${max} characters.`);
  }
  return value;
}

function optionalText(value: unknown, path: string, max: number): string | null {
  return value === null || value === undefined ? null : text(value, path, max);
}

/** Numbers in prose, normalized: "1,234.50" → "1234.5", "03" → "3"; "4,5" is two numbers. */
export function numbersIn(value: string): string[] {
  const numbers: string[] = [];
  for (const raw of value.match(/\d(?:[\d,]*\d)?(?:\.\d+)?/g) ?? []) {
    const [whole, fraction] = raw.split(".");
    const parts = /^\d{1,3}(,\d{3})+$/.test(whole) ? [whole.replace(/,/g, "")] : whole.split(",");
    parts.forEach((part, index) => {
      const plain = index === parts.length - 1 && fraction !== undefined ? `${part}.${fraction}` : part;
      const parsed = decimalFromPlain(plain);
      if (parsed) numbers.push(formatDecimal(parsed));
    });
  }
  return numbers;
}

export type WriterValidationContext = {
  readonly audience: ReportAudience;
  readonly claims: readonly StudyClaim[];
};

const DOCUMENTED_KINDS = new Set(["ANSWER", "FACT", "CALCULATION", "CONFLICT"]);
const INTERPRETATION_KINDS = new Set(["ANSWER", "FACT", "ASSESSMENT", "DETERMINATION", "CALCULATION", "CONFLICT"]);
const UNCERTAINTY_KINDS = new Set(["UNCERTAINTY", "CONFLICT", "LIMITATION", "ANSWER", "CALCULATION", "DETERMINATION", "FACT"]);

function stripTokens(value: string): string {
  return value.replace(BINDING_TOKEN, " ");
}

/** Accepts or rejects one Writer output. Rejection is MODEL_OUTPUT_INVALID (retryable for Writers). */
export function validateWriterReport(raw: unknown, context: WriterValidationContext): ContractValidation<WriterReport> {
  try {
    const claims = new Map(context.claims.map((claim) => [claim.id, claim]));
    const root = record(raw, "output");
    if (root.schema !== WRITER_REPORT_SCHEMA) reject("writer_output_schema", "The report schema is wrong.");
    if (root.audience !== context.audience) reject("writer_audience_mismatch", "The report is for the other audience.");

    const cited = new Set<string>();
    const resultTokens: { scenarioId: string; resultId: string; path: string }[] = [];

    const groundingFor = (refs: readonly string[]): Set<string> => {
      const numbers = new Set<string>();
      for (const ref of refs) {
        const claim = claims.get(ref);
        if (!claim) continue;
        for (const source of [claim.text, ...claim.quotes]) for (const n of numbersIn(source)) numbers.add(n);
        if (claim.numericStatus === "VERIFIED" && claim.computedValue) numbers.add(claim.computedValue);
      }
      return numbers;
    };

    const checkTokens = (value: string, path: string) => {
      for (const match of value.matchAll(BINDING_TOKEN)) {
        const [, kind, id] = match;
        if (kind === "calc") {
          const claim = claims.get(id);
          if (!claim || claim.kind !== "CALCULATION") reject("writer_binding_invalid", `${path} binds an unknown calculation.`);
          if (claim.numericStatus !== "VERIFIED") {
            reject("writer_unverified_number", `${path} binds a calculation that was not verified.`);
          }
          cited.add(id);
        } else {
          const [scenarioId, resultId] = id.split(".");
          if (!scenarioId || !resultId) reject("writer_binding_invalid", `${path} binds an unknown scenario result.`);
          resultTokens.push({ scenarioId, resultId, path });
        }
      }
    };

    const checkGrounded = (value: string, refs: readonly string[], path: string) => {
      const allowed = groundingFor(refs);
      for (const n of numbersIn(stripTokens(value))) {
        if (!allowed.has(n)) reject("writer_number_ungrounded", `${path} states a number its sources do not contain.`);
      }
    };

    const block = (value: unknown, path: string): ReportBlock => {
      const item = record(value, path);
      const type = item.type;
      if (!(REPORT_BLOCK_TYPES as readonly string[]).includes(type as string)) reject("writer_output_shape", `${path}.type is not allowed.`);
      const blockText = text(item.text, `${path}.text`, WRITER_LIMITS.blockText);
      const claimRefs = list(item.claimRefs, `${path}.claimRefs`, WRITER_LIMITS.claimRefsPerBlock).map((ref, i) => {
        if (typeof ref !== "string" || !claims.has(ref)) reject("writer_claim_unknown", `${path}.claimRefs[${i}] is not a Study claim.`);
        return ref;
      });
      const kinds = claimRefs.map((ref) => claims.get(ref) as StudyClaim);
      const blockType = type as ReportBlockType;
      if (blockType === "DOCUMENTED" || blockType === "INTERPRETATION" || blockType === "UNCERTAINTY") {
        if (claimRefs.length === 0) reject("writer_claim_missing", `${path} needs at least one Study claim.`);
      }
      const allowedKinds =
        blockType === "DOCUMENTED" ? DOCUMENTED_KINDS : blockType === "INTERPRETATION" ? INTERPRETATION_KINDS : UNCERTAINTY_KINDS;
      if (blockType === "DOCUMENTED" || blockType === "INTERPRETATION" || blockType === "UNCERTAINTY") {
        for (const claim of kinds) {
          if (!allowedKinds.has(claim.kind)) reject("writer_claim_kind", `${path} cites ${claim.id}, which cannot support this kind of text.`);
        }
      }
      if (blockType !== "UNCERTAINTY" && kinds.some((claim) => claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED")) {
        reject("writer_unverified_number", `${path} presents an unverified calculation outside an uncertainty.`);
      }
      checkTokens(blockText, path);
      if (blockType !== "GENERAL_INFORMATION") checkGrounded(blockText, claimRefs, path);
      for (const ref of claimRefs) cited.add(ref);
      return { type: blockType, text: blockText, claimRefs };
    };

    const title = text(root.title, "title", WRITER_LIMITS.title);
    const summary = list(root.summary, "summary", WRITER_LIMITS.summaryBlocks, 1).map((item, i) => block(item, `summary[${i}]`));
    const sectionIds = new Set<string>();
    const sections = list(root.sections, "sections", WRITER_LIMITS.sections, 1).map((value, index) => {
      const path = `sections[${index}]`;
      const item = record(value, path);
      const id = item.id;
      if (typeof id !== "string" || !SECTION_ID.test(id) || sectionIds.has(id)) reject("writer_output_shape", `${path}.id must be a new s1…s99 id.`);
      sectionIds.add(id);
      return {
        id,
        heading: text(item.heading, `${path}.heading`, WRITER_LIMITS.heading),
        blocks: list(item.blocks, `${path}.blocks`, WRITER_LIMITS.blocksPerSection, 1).map((b, i) => block(b, `${path}.blocks[${i}]`)),
      };
    });
    const allRefs = [...cited];
    checkGrounded(title, allRefs, "title");
    for (const section of sections) checkGrounded(section.heading, allRefs, `sections.${section.id}.heading`);

    const scenarioIds = new Set<string>();
    const scenarios = list(root.scenarios ?? [], "scenarios", WRITER_LIMITS.scenarios).map((value, index) => {
      const path = `scenarios[${index}]`;
      const item = record(value, path);
      const id = item.id;
      if (typeof id !== "string" || !SCENARIO_ID.test(id) || scenarioIds.has(id)) reject("writer_scenario_invalid", `${path}.id must be a new S1…S9 id.`);
      scenarioIds.add(id);
      const claimRefs = list(item.claimRefs, `${path}.claimRefs`, WRITER_LIMITS.claimRefsPerBlock, 1).map((ref, i) => {
        if (typeof ref !== "string" || !claims.has(ref)) reject("writer_claim_unknown", `${path}.claimRefs[${i}] is not a Study claim.`);
        cited.add(ref);
        return ref;
      });
      const names = new Set<string>();
      const parameters = list(item.parameters, `${path}.parameters`, WRITER_LIMITS.parameters).map((p, i) => {
        const pPath = `${path}.parameters[${i}]`;
        const param = record(p, pPath);
        const name = param.name;
        if (typeof name !== "string" || !PARAM_NAME.test(name) || names.has(name)) reject("writer_scenario_invalid", `${pPath}.name is invalid.`);
        names.add(name);
        const rawValue = param.value;
        if (typeof rawValue !== "string" || !decimalFromPlain(rawValue)) reject("writer_scenario_invalid", `${pPath}.value must be a plain number.`);
        const basis = param.basis;
        if (basis !== "DOCUMENTED" && basis !== "ASSUMPTION") reject("writer_scenario_invalid", `${pPath}.basis is not allowed.`);
        const claimRef = param.claimRef ?? null;
        if (basis === "DOCUMENTED") {
          const claim = typeof claimRef === "string" ? claims.get(claimRef) : undefined;
          if (!claim || (claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED")) {
            reject("writer_scenario_unsupported", `${pPath} is documented but cites no verified Study claim.`);
          }
          const formatted = formatDecimal(decimalFromPlain(rawValue) as Decimal);
          if (!groundingFor([claim.id]).has(formatted)) {
            reject("writer_number_ungrounded", `${pPath}.value does not appear in the claim it cites.`);
          }
          cited.add(claim.id);
        } else if (claimRef !== null) {
          reject("writer_scenario_invalid", `${pPath} is an assumption and cannot cite a claim.`);
        }
        return {
          name,
          label: text(param.label, `${pPath}.label`, 200),
          value: rawValue,
          unit: optionalText(param.unit, `${pPath}.unit`, 40),
          basis,
          claimRef: claimRef as string | null,
        };
      });
      const resultIds = new Set<string>();
      const results = list(item.results, `${path}.results`, WRITER_LIMITS.results, 1).map((r, i) => {
        const rPath = `${path}.results[${i}]`;
        const result = record(r, rPath);
        const resultId = result.id;
        if (typeof resultId !== "string" || !RESULT_ID.test(resultId) || resultIds.has(resultId)) {
          reject("writer_scenario_invalid", `${rPath}.id must be a new R1…R9 id.`);
        }
        const formula = parseFormula(result.formula);
        if (!formula.ok) reject("writer_formula_invalid", `${rPath}.formula is not an allowed formula.`);
        for (const leaf of formulaLeaves(formula.value)) {
          if ("input" in leaf) reject("writer_formula_invalid", `${rPath}.formula uses an input index.`);
          if ("param" in leaf && !names.has(leaf.param)) reject("writer_formula_invalid", `${rPath}.formula uses an unknown parameter.`);
          if ("ref" in leaf && !resultIds.has(leaf.ref)) {
            const claim = claims.get(leaf.ref);
            if (!claim || claim.kind !== "CALCULATION" || claim.numericStatus !== "VERIFIED") {
              reject("writer_unverified_number", `${rPath}.formula uses a calculation that was not verified.`);
            }
            cited.add(leaf.ref);
          }
        }
        resultIds.add(resultId);
        return {
          id: resultId,
          label: text(result.label, `${rPath}.label`, 200),
          unit: optionalText(result.unit, `${rPath}.unit`, 40),
          formula: formula.value,
        };
      });
      return {
        id,
        title: text(item.title, `${path}.title`, WRITER_LIMITS.heading),
        question: text(item.question, `${path}.question`, 600),
        rationale: text(item.rationale, `${path}.rationale`, 1200),
        claimRefs,
        parameters,
        results,
      };
    });

    for (const token of resultTokens) {
      const scenario = scenarios.find((item) => item.id === token.scenarioId);
      if (!scenario || !scenario.results.some((result) => result.id === token.resultId)) {
        reject("writer_binding_invalid", `${token.path} binds an unknown scenario result.`);
      }
    }

    const view = list(root.view, "view", WRITER_LIMITS.viewComponents).map((value, index) => {
      const item = record(value, `view[${index}]`);
      return {
        component: text(item.component, `view[${index}].component`, 40),
        props: item.props === undefined ? {} : record(item.props, `view[${index}].props`),
      };
    });

    const mustSurface = context.claims.filter(
      (claim) =>
        claim.kind === "CONFLICT" ||
        claim.kind === "UNCERTAINTY" ||
        (claim.kind === "ANSWER" && (claim.answerStatus === "MISSING_EVIDENCE" || claim.answerStatus === "CONFLICTING")),
    );
    const unsurfaced = mustSurface.filter((claim) => !cited.has(claim.id));
    if (unsurfaced.length > 0) {
      reject("writer_uncertainty_hidden", `The report leaves out ${unsurfaced.map((claim) => claim.id).join(", ")}.`);
    }

    return {
      ok: true,
      value: {
        schema: WRITER_REPORT_SCHEMA,
        audience: context.audience,
        title,
        summary,
        sections,
        scenarios: scenarios as ScenarioDefinition[],
        view,
      },
    };
  } catch (error) {
    if (error instanceof WriterRejection) {
      return {
        ok: false,
        message: "The report draft did not pass our checks against the Study.",
        diagnosticReason: error.diagnosticReason,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
      };
    }
    throw error;
  }
}

/**
 * Computes every scenario result in code. A result that cannot be computed is NONCALCULABLE with a
 * reason; the model's own arithmetic is never used.
 */
export function evaluateScenarios(report: WriterReport, claims: readonly StudyClaim[]): ScenarioAnalysis {
  const verified = new Map(
    claims
      .filter((claim) => claim.kind === "CALCULATION" && claim.numericStatus === "VERIFIED" && claim.computedValue)
      .map((claim) => [claim.id, decimalFromPlain(claim.computedValue as string)]),
  );
  return {
    schema: SCENARIO_ANALYSIS_SCHEMA,
    scenarios: report.scenarios.map((scenario) => {
      const params = new Map(scenario.parameters.map((p) => [p.name, decimalFromPlain(p.value)]));
      const assumptions = new Set(scenario.parameters.filter((p) => p.basis === "ASSUMPTION").map((p) => p.name));
      const computed = new Map<string, { value: Decimal | null; usesAssumptions: boolean }>();
      const results = scenario.results.map((definition) => {
        const leaves = formulaLeaves(definition.formula);
        const usesAssumptions = leaves.some(
          (leaf) =>
            ("param" in leaf && assumptions.has(leaf.param)) || ("ref" in leaf && computed.get(leaf.ref)?.usesAssumptions === true),
        );
        const evaluation = evaluateFormula(definition.formula, (leaf) => {
          if ("param" in leaf) return params.get(leaf.param) ?? null;
          if ("ref" in leaf) return computed.has(leaf.ref) ? (computed.get(leaf.ref)?.value ?? null) : (verified.get(leaf.ref) ?? null);
          return null;
        });
        computed.set(definition.id, { value: evaluation.ok ? evaluation.value : null, usesAssumptions });
        const reason = evaluation.ok
          ? null
          : evaluation.reason === "division_by_zero"
            ? "DIVISION_BY_ZERO"
            : evaluation.reason === "unresolved_input"
              ? "UNRESOLVED_INPUT"
              : "OUT_OF_RANGE";
        return {
          id: definition.id,
          scenarioId: scenario.id,
          label: definition.label,
          unit: definition.unit,
          status: evaluation.ok ? ("CALCULATED" as const) : ("NONCALCULABLE" as const),
          value: evaluation.ok ? formatDecimal(evaluation.value) : null,
          reason: reason as ScenarioResult["reason"],
          usesAssumptions,
          formula: definition.formula,
        };
      });
      return { ...scenario, results };
    }),
  };
}

/** Recomputes one scenario with person-edited assumption values (client what-if; never persisted). */
export function recomputeScenario(
  scenario: ScenarioAnalysis["scenarios"][number],
  overrides: Readonly<Record<string, string>>,
  claims: readonly Pick<StudyClaim, "id" | "kind" | "numericStatus" | "computedValue">[],
): ScenarioResult[] {
  const parameters = scenario.parameters.map((p) =>
    p.basis === "ASSUMPTION" && overrides[p.name] !== undefined && decimalFromPlain(overrides[p.name])
      ? { ...p, value: overrides[p.name] }
      : p,
  );
  const report: WriterReport = {
    schema: WRITER_REPORT_SCHEMA,
    audience: "CUSTOMER",
    title: "what-if",
    summary: [],
    sections: [],
    scenarios: [{ ...scenario, parameters, results: scenario.results.map(({ id, label, unit, formula }) => ({ id, label, unit, formula })) }],
    view: [],
  };
  return evaluateScenarios(report, claims as StudyClaim[]).scenarios[0].results.map(({ formula: _formula, ...result }) => result);
}
