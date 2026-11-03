import type { NumericStatus, StudyClaim } from "../analysis/study-verification";
import { diagnosticFieldFromMessage, type FailureComponent } from "../errors/failure-diagnostic";
import {
  BINDING_TOKEN,
  evaluateScenarios,
  firstUngroundedNumericToken,
  groundingNumbersForClaims,
  numbersIn,
  numericDiagnosticField,
  type ReportAudience,
  type ReportBlockType,
  type ScenarioAnalysis,
  validateWriterReport,
  type WriterReport,
} from "./writer-report-contracts";

/**
 * `hive-application-view/1` (D-041): the A2UI view a report renders. The Writer proposes components
 * from an allowlisted catalog; this binder validates each proposal and binds it to validated data
 * only (Study claims, VERIFIED calculations, code-computed scenario results). The UI renders the
 * bound view and never sees model-computed numbers.
 */

export const APPLICATION_VIEW_SCHEMA = "hive-application-view/1";

export const A2UI_COMPONENTS = [
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
] as const;
export type A2uiComponentName = (typeof A2UI_COMPONENTS)[number];

export type BoundRef = { sourceDocumentId: string; pageNumber: number; fileName: string };
export type BoundBlock = {
  type: ReportBlockType;
  text: string;
  claimIds: string[];
  refs: BoundRef[];
  criterion?: string | null;
  criterionSource?: StudyClaim["criterionSource"] | null;
};
export type BoundClaim = {
  id: string;
  kind: StudyClaim["kind"];
  text: string;
  refs: BoundRef[];
  quotes: string[];
  numericStatus: NumericStatus | null;
  criterion?: string | null;
  criterionSource?: StudyClaim["criterionSource"] | null;
};
export type BoundValue = {
  value: string | null;
  unit: string | null;
  status: "VERIFIED" | "CALCULATED" | "NONCALCULABLE";
  usesAssumptions: boolean;
  refs: BoundRef[];
};

export type ApplicationViewComponent = { id: string } & (
  | { component: "Narrative"; heading: string | null; blocks: BoundBlock[] }
  | { component: "KeyFindings"; title: string; items: BoundClaim[] }
  | ({ component: "Metric"; label: string } & BoundValue)
  | { component: "RecordTable"; title: string; columns: string[]; rows: { cells: string[]; refs: BoundRef[] }[] }
  | {
      component: "Comparison";
      title: string;
      leftLabel: string;
      rightLabel: string;
      items: { label: string; left: string; right: string; refs: BoundRef[] }[];
    }
  | { component: "Timeline"; title: string; events: { date: string; text: string; refs: BoundRef[] }[] }
  | { component: "IssueList"; title: string; issues: { text: string; severity: "HIGH" | "MEDIUM" | "LOW"; refs: BoundRef[] }[] }
  | { component: "QuestionList"; title: string; questions: { text: string; refs: BoundRef[] }[] }
  | { component: "EvidencePanel"; title: string; claims: BoundClaim[] }
  | { component: "Chart"; title: string; kind: "bar" | "line"; unit: string | null; points: ({ label: string } & BoundValue)[] }
  | { component: "Checklist"; title: string; items: { text: string; refs: BoundRef[] }[] }
  | {
      component: "ScenarioExplorer";
      scenario: ScenarioAnalysis["scenarios"][number];
      verifiedInputs: { id: string; computedValue: string }[];
      refs: BoundRef[];
    }
  | { component: "SourceReferences"; title: string; sources: { sourceDocumentId: string; fileName: string; pageNumbers: number[] }[] }
);

type UnboundComponent = ApplicationViewComponent extends infer C ? (C extends unknown ? Omit<C, "id"> : never) : never;

export type ApplicationView = {
  schema: typeof APPLICATION_VIEW_SCHEMA;
  audience: ReportAudience;
  title: string;
  layout: "PROPOSED" | "FALLBACK";
  components: ApplicationViewComponent[];
};

export type BuiltReport = { writerOutput: WriterReport; scenarioAnalysis: ScenarioAnalysis; view: ApplicationView };

export type ReportBuildContext = {
  readonly audience: ReportAudience;
  readonly claims: readonly StudyClaim[];
  /** File names by lowercase source document id, for display only. */
  readonly fileNames: ReadonlyMap<string, string>;
};

const LIMITS = { label: 200, cell: 600, rows: 40, columns: 8, items: 30 };

class BindRejection extends Error {
  constructor(
    readonly diagnosticReason: string,
    message: string,
    readonly diagnosticField?: string,
  ) {
    super(message);
  }
}

function reject(diagnosticReason: string, message: string, diagnosticField = diagnosticFieldFromMessage(message)): never {
  throw new BindRejection(diagnosticReason, message, diagnosticField);
}

export type ReportBuildResult =
  | { ok: true; value: BuiltReport }
  | {
      ok: false;
      message: string;
      diagnosticReason: string;
      diagnosticField?: string;
      component: Extract<FailureComponent, "writer" | "scenario" | "a2ui">;
    };

function reportLayer(diagnosticReason: string): "writer" | "scenario" {
  if (diagnosticReason.startsWith("writer_scenario") || diagnosticReason === "writer_formula_invalid") return "scenario";
  return "writer";
}

/** Validates a Writer output, computes its scenarios and binds its view. Any failure rejects the draft. */
export function buildReport(raw: unknown, context: ReportBuildContext): ReportBuildResult {
  const validated = validateWriterReport(raw, { audience: context.audience, claims: context.claims });
  if (!validated.ok) {
    return {
      ok: false,
      message: validated.message,
      diagnosticReason: validated.diagnosticReason,
      ...(validated.diagnosticField ? { diagnosticField: validated.diagnosticField } : {}),
      component: reportLayer(validated.diagnosticReason),
    };
  }
  const report = validated.value;
  const scenarioAnalysis = evaluateScenarios(report, context.claims);
  try {
    return { ok: true, value: { writerOutput: report, scenarioAnalysis, view: bindApplicationView(report, scenarioAnalysis, context) } };
  } catch (error) {
    if (error instanceof BindRejection) {
      return {
        ok: false,
        message: "The report layout did not pass our checks.",
        diagnosticReason: error.diagnosticReason,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
        component: "a2ui",
      };
    }
    throw error;
  }
}

const DOCUMENTED_GRANULAR_KINDS = new Set<StudyClaim["kind"]>(["FACT", "CALCULATION", "CONFLICT", "ANSWER"]);
const FINDING_GRANULAR_KINDS = new Set<StudyClaim["kind"]>(["FACT", "CALCULATION", "ASSESSMENT", "CONFLICT", "ANSWER"]);
const EVIDENCE_GRANULAR_KINDS = new Set<StudyClaim["kind"]>([
  "FACT",
  "CALCULATION",
  "ASSESSMENT",
  "DETERMINATION",
  "CONFLICT",
  "ANSWER",
]);
const ISSUE_QUESTION_GRANULAR_KINDS = new Set<StudyClaim["kind"]>([
  "FACT",
  "CALCULATION",
  "ASSESSMENT",
  "DETERMINATION",
  "CONFLICT",
  "UNCERTAINTY",
  "LIMITATION",
  "ANSWER",
]);

function normalizeProse(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function bindApplicationView(report: WriterReport, analysis: ScenarioAnalysis, context: ReportBuildContext): ApplicationView {
  const claims = new Map(context.claims.map((claim) => [claim.id, claim]));
  const questionsWithFacts = new Set(context.claims.filter((claim) => claim.kind === "FACT").map((claim) => claim.planQuestionId));
  const mustSurfaceIds = new Set(
    context.claims
      .filter(
        (claim) =>
          claim.kind === "CONFLICT" ||
          claim.kind === "UNCERTAINTY" ||
          (claim.kind === "ANSWER" && (claim.answerStatus === "MISSING_EVIDENCE" || claim.answerStatus === "CONFLICTING")),
      )
      .map((claim) => claim.id),
  );
  const results = new Map<string, ScenarioAnalysis["scenarios"][number]["results"][number]>(
    analysis.scenarios.flatMap((scenario) => scenario.results.map((result) => [`${scenario.id}.${result.id}`, result] as const)),
  );
  const fileName = (id: string) => context.fileNames.get(id.toLowerCase()) ?? "Document";
  const bindRefs = (claimIds: readonly string[]): BoundRef[] => {
    const seen = new Set<string>();
    const refs: BoundRef[] = [];
    for (const id of claimIds) {
      for (const ref of claims.get(id)?.refs ?? []) {
        const key = `${ref.sourceDocumentId}:${ref.pageNumber}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push({ ...ref, fileName: fileName(ref.sourceDocumentId) });
        }
      }
    }
    return refs;
  };
  const bindClaim = (id: string): BoundClaim => {
    const claim = claims.get(id) as StudyClaim;
    return {
      id,
      kind: claim.kind,
      text: claim.text,
      refs: bindRefs([id]),
      quotes: claim.quotes.slice(0, 6),
      numericStatus: claim.numericStatus ?? null,
      ...(claim.criterion ? { criterion: claim.criterion } : {}),
      ...(claim.criterionSource ? { criterionSource: claim.criterionSource } : {}),
    };
  };
  const formatValue = (value: string | null, unit: string | null) => (value === null ? "not calculable" : unit ? `${value} ${unit}` : value);
  const resolveTokens = (value: string): string =>
    value.replace(BINDING_TOKEN, (_match, kind: string, id: string) => {
      if (kind === "calc") return claims.get(id)?.computedValue ?? "not verified";
      const result = results.get(id);
      return result ? formatValue(result.value, result.unit) : "not calculable";
    });

  const grounded = (value: string, claimIds: readonly string[], path: string) => {
    const ungrounded = firstUngroundedNumericToken(value, groundingNumbersForClaims(claims, claimIds));
    if (ungrounded) {
      reject(
        "writer_number_ungrounded",
        `${path} states a number its sources do not contain.`,
        numericDiagnosticField(path, ungrounded),
      );
    }
  };
  const str = (value: unknown, path: string, max = LIMITS.label): string => {
    if (typeof value !== "string" || value.trim() === "" || value.length > max) reject("view_props_invalid", `${path} must be short text.`);
    return value;
  };
  const arr = (value: unknown, path: string, max = LIMITS.items, min = 1): unknown[] => {
    if (!Array.isArray(value) || value.length < min || value.length > max) reject("view_props_invalid", `${path} must be a list.`);
    return value;
  };
  const obj = (value: unknown, path: string): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) reject("view_props_invalid", `${path} must be an object.`);
    return value as Record<string, unknown>;
  };
  const granularClaims = (
    value: unknown,
    path: string,
    options: {
      readonly allowedKinds: ReadonlySet<StudyClaim["kind"]>;
      readonly requireRefs: boolean;
      readonly allowMissingEvidenceAnswer?: boolean;
      readonly unverifiedForUnsupported?: boolean;
    },
  ): string[] => {
    if (!Array.isArray(value)) reject("view_props_invalid", `${path} must be a list.`);
    if (value.length === 0) reject("writer_claim_missing", `${path} needs at least one Study claim.`);
    if (value.length > 24) reject("view_props_invalid", `${path} must be a list.`);
    const ids = value.map((id, i) => {
      if (typeof id !== "string" || !claims.has(id)) reject("writer_claim_unknown", `${path}[${i}] is not a Study claim.`);
      const claim = claims.get(id) as StudyClaim;
      if (claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED") {
        reject("writer_unverified_number", `${path}[${i}] cites ${id}, which was not verified.`);
      }
      if (!options.allowedKinds.has(claim.kind)) {
        if (options.unverifiedForUnsupported && (claim.kind === "UNCERTAINTY" || claim.kind === "LIMITATION")) {
          reject("writer_unverified_number", `${path}[${i}] lists ${id} as a finding.`);
        }
        reject("writer_claim_kind", `${path}[${i}] cites ${id}, which cannot support this item.`);
      }
      if (claim.kind === "ANSWER" && questionsWithFacts.has(claim.planQuestionId)) {
        const allowedMissingAnswer =
          options.allowMissingEvidenceAnswer === true &&
          (claim.answerStatus === "MISSING_EVIDENCE" || claim.answerStatus === "CONFLICTING");
        if (!allowedMissingAnswer) {
          reject("writer_claim_kind", `${path}[${i}] cites broad answer ${id} when specific facts exist.`);
        }
      }
      if (options.requireRefs && claim.refs.length === 0) {
        reject("writer_claim_missing", `${path}[${i}] cites ${id}, which has no source page reference.`);
      }
      return id;
    });
    return [...new Set(ids)];
  };
  const boundValue = (binding: unknown, unit: string | null, path: string): (BoundValue & { claimIds: string[] }) => {
    const match = typeof binding === "string" ? /^\{\{(calc|result):([A-Za-z0-9.]{1,32})\}\}$/.exec(binding) : null;
    if (!match) reject("writer_binding_invalid", `${path} must be one binding token.`);
    const [, kind, id] = match;
    if (kind === "calc") {
      const claim = claims.get(id);
      if (!claim || claim.kind !== "CALCULATION" || claim.numericStatus !== "VERIFIED") {
        reject("writer_unverified_number", `${path} binds a calculation that was not verified.`);
      }
      return { value: claim.computedValue ?? null, unit, status: "VERIFIED", usesAssumptions: false, refs: bindRefs([id]), claimIds: [id] };
    }
    const result = results.get(id);
    if (!result) reject("writer_binding_invalid", `${path} binds an unknown scenario result.`);
    const scenario = analysis.scenarios.find((item) => item.id === result.scenarioId);
    const scenarioClaims = scenario?.claimRefs ?? [];
    return {
      value: result.value,
      unit: unit ?? result.unit,
      status: result.status,
      usesAssumptions: result.usesAssumptions,
      refs: bindRefs(scenarioClaims),
      claimIds: [...scenarioClaims],
    };
  };
  const sectionBlocks = (blocks: WriterReport["summary"]): BoundBlock[] =>
    blocks.map((block) => {
      const assessment = block.claimRefs
        .map((id) => claims.get(id))
        .find((claim): claim is StudyClaim => claim?.kind === "ASSESSMENT" && !!claim.criterionSource);
      return {
        type: block.type,
        text: resolveTokens(block.text),
        claimIds: block.claimRefs,
        refs: bindRefs(block.claimRefs),
        ...(assessment?.criterion ? { criterion: assessment.criterion } : {}),
        ...(assessment?.criterionSource ? { criterionSource: assessment.criterionSource } : {}),
      };
    });

  const sections = new Map(report.sections.map((section) => [section.id, section]));
  const usedSections = new Set<string>();
  const usedScenarios = new Set<string>();
  const structuredTexts = new Set<string>();
  const structuredClaims = new Set<string>();
  const questionListClaims = new Set<string>();
  const checklistClaims = new Set<string>();
  const structuredSurfaced = new Set<string>();
  const components: ApplicationViewComponent[] = [];
  const add = (component: UnboundComponent) =>
    components.push({ id: `c${components.length + 1}`, ...component } as ApplicationViewComponent);
  const recordStructured = (texts: readonly string[], claimIds: readonly string[], canSurfaceUncertainty = false) => {
    for (const item of texts) {
      const normalized = normalizeProse(item);
      if (normalized) structuredTexts.add(normalized);
    }
    for (const id of claimIds) {
      structuredClaims.add(id);
      if (canSurfaceUncertainty && mustSurfaceIds.has(id)) structuredSurfaced.add(id);
    }
  };

  report.view.forEach((proposal, index) => {
    const path = `view[${index}]`;
    const props = proposal.props;
    if (!(A2UI_COMPONENTS as readonly string[]).includes(proposal.component)) {
      reject("view_component_unknown", `${path} uses a component outside the allowed catalog.`);
    }
    switch (proposal.component as A2uiComponentName) {
      case "Narrative": {
        if (props.sectionId === "summary") {
          if (usedSections.has("summary")) break;
          add({ component: "Narrative", heading: null, blocks: sectionBlocks(report.summary) });
          usedSections.add("summary");
          break;
        }
        const section = typeof props.sectionId === "string" ? sections.get(props.sectionId) : undefined;
        if (!section) reject("view_props_invalid", `${path}.sectionId must name a section.`);
        if (usedSections.has(section.id)) break;
        usedSections.add(section.id);
        add({ component: "Narrative", heading: resolveTokens(section.heading), blocks: sectionBlocks(section.blocks) });
        break;
      }
      case "KeyFindings": {
        const ids = granularClaims(props.claimIds, `${path}.claimIds`, {
          allowedKinds: FINDING_GRANULAR_KINDS,
          requireRefs: true,
          unverifiedForUnsupported: true,
        });
        const items = ids.map(bindClaim);
        recordStructured(items.map((item) => item.text), ids, true);
        add({ component: "KeyFindings", title: str(props.title, `${path}.title`), items });
        break;
      }
      case "Metric": {
        const unit = props.unit === undefined || props.unit === null ? null : str(props.unit, `${path}.unit`, 40);
        const { claimIds, ...bound } = boundValue(props.binding, unit, `${path}.binding`);
        recordStructured([], claimIds);
        add({ component: "Metric", label: str(props.label, `${path}.label`), ...bound });
        break;
      }
      case "RecordTable": {
        const columns = arr(props.columns, `${path}.columns`, LIMITS.columns).map((c, i) => str(c, `${path}.columns[${i}]`));
        const rows = arr(props.rows, `${path}.rows`, LIMITS.rows).map((r, i) => {
          const row = obj(r, `${path}.rows[${i}]`);
          const claimIds = granularClaims(row.claimRefs, `${path}.rows[${i}].claimRefs`, {
            allowedKinds: DOCUMENTED_GRANULAR_KINDS,
            requireRefs: true,
          });
          const cells = arr(row.cells, `${path}.rows[${i}].cells`, columns.length).map((c, j) => {
            const cell = str(c, `${path}.rows[${i}].cells[${j}]`, LIMITS.cell);
            grounded(cell, claimIds, `${path}.rows[${i}].cells[${j}]`);
            return cell;
          });
          if (cells.length !== columns.length) reject("view_props_invalid", `${path}.rows[${i}] must fill every column.`);
          recordStructured([cells.join(" ")], claimIds);
          return { cells, refs: bindRefs(claimIds) };
        });
        add({ component: "RecordTable", title: str(props.title, `${path}.title`), columns, rows });
        break;
      }
      case "Comparison": {
        const items = arr(props.items, `${path}.items`).map((value, i) => {
          const item = obj(value, `${path}.items[${i}]`);
          const claimIds = granularClaims(item.claimRefs, `${path}.items[${i}].claimRefs`, {
            allowedKinds: DOCUMENTED_GRANULAR_KINDS,
            requireRefs: true,
          });
          const fields = ["label", "left", "right"].map((field) => {
            const text = str(item[field], `${path}.items[${i}].${field}`, LIMITS.cell);
            grounded(text, claimIds, `${path}.items[${i}].${field}`);
            return text;
          });
          recordStructured([fields.join(" ")], claimIds, true);
          return { label: fields[0], left: fields[1], right: fields[2], refs: bindRefs(claimIds) };
        });
        add({
          component: "Comparison",
          title: str(props.title, `${path}.title`),
          leftLabel: str(props.leftLabel, `${path}.leftLabel`),
          rightLabel: str(props.rightLabel, `${path}.rightLabel`),
          items,
        });
        break;
      }
      case "Timeline": {
        const events = arr(props.events, `${path}.events`).map((value, i) => {
          const item = obj(value, `${path}.events[${i}]`);
          const claimIds = granularClaims(item.claimRefs, `${path}.events[${i}].claimRefs`, {
            allowedKinds: DOCUMENTED_GRANULAR_KINDS,
            requireRefs: true,
          });
          const date = str(item.date, `${path}.events[${i}].date`, LIMITS.label);
          if (numbersIn(date).length === 0) {
            reject(
              "writer_number_ungrounded",
              `${path}.events[${i}].date states a date its sources do not contain.`,
              numericDiagnosticField(`${path}.events[${i}].date`, { position: 0, category: "date" }),
            );
          }
          grounded(date, claimIds, `${path}.events[${i}].date`);
          const text = str(item.text, `${path}.events[${i}].text`, LIMITS.cell);
          grounded(text, claimIds, `${path}.events[${i}].text`);
          recordStructured([text, `${date} ${text}`], claimIds);
          return { date, text, refs: bindRefs(claimIds) };
        });
        add({ component: "Timeline", title: str(props.title, `${path}.title`), events });
        break;
      }
      case "IssueList": {
        const issues = arr(props.issues, `${path}.issues`).map((value, i) => {
          const item = obj(value, `${path}.issues[${i}]`);
          const severity = item.severity;
          if (severity !== "HIGH" && severity !== "MEDIUM" && severity !== "LOW") reject("view_props_invalid", `${path}.issues[${i}].severity is not allowed.`);
          const claimIds = granularClaims(item.claimRefs, `${path}.issues[${i}].claimRefs`, {
            allowedKinds: ISSUE_QUESTION_GRANULAR_KINDS,
            requireRefs: false,
            allowMissingEvidenceAnswer: true,
          });
          const text = str(item.text, `${path}.issues[${i}].text`, LIMITS.cell);
          grounded(text, claimIds, `${path}.issues[${i}].text`);
          recordStructured([text], claimIds, true);
          return { text, severity: severity as "HIGH" | "MEDIUM" | "LOW", refs: bindRefs(claimIds) };
        });
        add({ component: "IssueList", title: str(props.title, `${path}.title`), issues });
        break;
      }
      case "QuestionList":
      case "Checklist": {
        const isQuestions = proposal.component === "QuestionList";
        const field = isQuestions ? "questions" : "items";
        const entries = arr(props[field], `${path}.${field}`).map((value, i) => {
          const item = obj(value, `${path}.${field}[${i}]`);
          const text = str(item.text, `${path}.${field}[${i}].text`, LIMITS.cell);
          const claimIds = granularClaims(item.claimRefs, `${path}.${field}[${i}].claimRefs`, {
            allowedKinds: isQuestions ? ISSUE_QUESTION_GRANULAR_KINDS : EVIDENCE_GRANULAR_KINDS,
            requireRefs: !isQuestions,
            allowMissingEvidenceAnswer: isQuestions,
          });
          grounded(text, claimIds, `${path}.${field}[${i}].text`);
          recordStructured([text], claimIds);
          for (const id of claimIds) {
            if (isQuestions) questionListClaims.add(id);
            else checklistClaims.add(id);
          }
          return { text, refs: bindRefs(claimIds) };
        });
        const title = str(props.title, `${path}.title`);
        if (isQuestions) add({ component: "QuestionList", title, questions: entries });
        else add({ component: "Checklist", title, items: entries });
        break;
      }
      case "EvidencePanel": {
        const ids = granularClaims(props.claimIds, `${path}.claimIds`, {
          allowedKinds: EVIDENCE_GRANULAR_KINDS,
          requireRefs: true,
        });
        const panelClaims = ids.map(bindClaim);
        recordStructured(panelClaims.map((item) => item.text), ids, true);
        add({
          component: "EvidencePanel",
          title: str(props.title, `${path}.title`),
          claims: panelClaims,
        });
        break;
      }
      case "Chart": {
        const kind = props.kind;
        if (kind !== "bar" && kind !== "line") reject("view_props_invalid", `${path}.kind must be bar or line.`);
        const unit = props.unit === undefined || props.unit === null ? null : str(props.unit, `${path}.unit`, 40);
        const points = arr(props.points, `${path}.points`, 24, 2).map((value, i) => {
          const point = obj(value, `${path}.points[${i}]`);
          const { claimIds, ...bound } = boundValue(point.binding, unit, `${path}.points[${i}].binding`);
          recordStructured([], claimIds);
          return { label: str(point.label, `${path}.points[${i}].label`), ...bound };
        });
        add({ component: "Chart", title: str(props.title, `${path}.title`), kind, unit, points });
        break;
      }
      case "ScenarioExplorer": {
        const scenario = analysis.scenarios.find((item) => item.id === props.scenarioId);
        if (!scenario) reject("view_props_invalid", `${path}.scenarioId must name a scenario.`);
        if (usedScenarios.has(scenario.id)) break;
        usedScenarios.add(scenario.id);
        add(scenarioComponent(scenario));
        break;
      }
      case "SourceReferences":
        break;
    }
  });

  function scenarioComponent(scenario: ScenarioAnalysis["scenarios"][number]) {
    const refIds = scenario.results.flatMap((result) =>
      collectRefs(result.formula).filter((id) => claims.get(id)?.kind === "CALCULATION"),
    );
    const scenarioClaimIds = [...scenario.claimRefs, ...scenario.parameters.flatMap((p) => (p.claimRef ? [p.claimRef] : []))];
    recordStructured([], scenarioClaimIds);
    return {
      component: "ScenarioExplorer" as const,
      scenario,
      verifiedInputs: [...new Set(refIds)].map((id) => ({ id, computedValue: claims.get(id)?.computedValue ?? "" })),
      refs: bindRefs(scenarioClaimIds),
    };
  }

  const layout: ApplicationView["layout"] = components.length === 0 ? "FALLBACK" : "PROPOSED";
  if (!usedSections.has("summary")) {
    components.unshift({ id: "c0", component: "Narrative", heading: null, blocks: sectionBlocks(report.summary) });
  }
  for (const section of report.sections) {
    if (!usedSections.has(section.id)) {
      const blocks = sectionBlocks(section.blocks);
      const allCoveredByStructured =
        layout === "PROPOSED" &&
        structuredClaims.size > 0 &&
        blocks.every(
          (block) =>
            (block.claimIds.length === 0 || block.claimIds.every((id) => structuredClaims.has(id))) &&
            !block.claimIds.some((id) => mustSurfaceIds.has(id) && !structuredSurfaced.has(id)),
        );
      if (!allCoveredByStructured) {
        add({ component: "Narrative", heading: resolveTokens(section.heading), blocks });
      }
    }
  }
  for (const scenario of analysis.scenarios) {
    if (!usedScenarios.has(scenario.id)) add(scenarioComponent(scenario));
  }

  const seenNarrativeTexts = new Set<string>();
  const surfacedSoFar = new Set<string>(structuredSurfaced);
  const deduplicated: ApplicationViewComponent[] = [];
  for (const component of components) {
    if (component.component !== "Narrative") {
      deduplicated.push(component);
      continue;
    }
    const keptBlocks = component.blocks.filter((block) => {
      const norm = normalizeProse(block.text);
      if (!norm || seenNarrativeTexts.has(norm)) return false;
      const neededForUncertainty = block.claimIds.some((id) => mustSurfaceIds.has(id) && !surfacedSoFar.has(id));
      if (!neededForUncertainty) {
        if (structuredTexts.has(norm)) return false;
        if (block.type === "QUESTION" && block.claimIds.length > 0 && block.claimIds.every((id) => questionListClaims.has(id))) {
          return false;
        }
        if (block.type === "NEXT_STEP" && block.claimIds.length > 0 && block.claimIds.every((id) => checklistClaims.has(id))) {
          return false;
        }
      }
      seenNarrativeTexts.add(norm);
      for (const id of block.claimIds) {
        if (mustSurfaceIds.has(id)) surfacedSoFar.add(id);
      }
      return true;
    });
    if (keptBlocks.length > 0) {
      deduplicated.push({ ...component, blocks: keptBlocks });
    }
  }

  const cited = new Map<string, Set<number>>();
  const collect = (refs: readonly BoundRef[]) => {
    for (const ref of refs) {
      const pages = cited.get(ref.sourceDocumentId) ?? new Set<number>();
      pages.add(ref.pageNumber);
      cited.set(ref.sourceDocumentId, pages);
    }
  };
  for (const component of deduplicated) collectComponentRefs(component, collect);
  deduplicated.push({
    id: `c${deduplicated.length + 1}`,
    component: "SourceReferences",
    title: "Sources",
    sources: [...cited.entries()].map(([sourceDocumentId, pages]) => ({
      sourceDocumentId,
      fileName: fileName(sourceDocumentId),
      pageNumbers: [...pages].sort((a, b) => a - b),
    })),
  });

  return {
    schema: APPLICATION_VIEW_SCHEMA,
    audience: report.audience,
    title: report.title,
    layout,
    components: deduplicated.map((component, index) => ({ ...component, id: `c${index + 1}` })),
  };
}

function collectRefs(node: import("../analysis/decimal-formula").FormulaNode): string[] {
  if ("op" in node) return node.args.flatMap(collectRefs);
  return "ref" in node ? [node.ref] : [];
}

function collectComponentRefs(component: ApplicationViewComponent, collect: (refs: readonly BoundRef[]) => void): void {
  switch (component.component) {
    case "Narrative":
      for (const block of component.blocks) collect(block.refs);
      break;
    case "KeyFindings":
      for (const item of component.items) collect(item.refs);
      break;
    case "EvidencePanel":
      for (const item of component.claims) collect(item.refs);
      break;
    case "Metric":
    case "ScenarioExplorer":
      collect(component.refs);
      break;
    case "RecordTable":
      for (const row of component.rows) collect(row.refs);
      break;
    case "Comparison":
      for (const item of component.items) collect(item.refs);
      break;
    case "Timeline":
      for (const event of component.events) collect(event.refs);
      break;
    case "IssueList":
      for (const issue of component.issues) collect(issue.refs);
      break;
    case "QuestionList":
      for (const question of component.questions) collect(question.refs);
      break;
    case "Checklist":
      for (const item of component.items) collect(item.refs);
      break;
    case "Chart":
      for (const point of component.points) collect(point.refs);
      break;
    case "SourceReferences":
      break;
  }
}

/** Read-back check for a stored view; the UI falls back for anything outside the catalog. */
export function isKnownViewComponent(component: { component?: unknown }): component is ApplicationViewComponent {
  return typeof component.component === "string" && (A2UI_COMPONENTS as readonly string[]).includes(component.component);
}
