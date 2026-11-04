import {
  buildActiveTemporalClaimIds,
  buildHistoricalTemporalMap,
  type CanonicalFindingResolution,
} from "../analysis/canonical-finding-resolver";
import { questionsWithAtomicFacts, type StudyClaim } from "../analysis/study-verification";
import { diagnosticFieldFromMessage } from "../errors/failure-diagnostic";
import {
  A2UI_COMPONENTS,
  type A2uiComponentName,
  BindRejection,
  buildReport,
  EVIDENCE_GRANULAR_KINDS,
  FINDING_GRANULAR_KINDS,
  validateViewComponentProposal,
  type ViewComponentValidationContext,
} from "./application-view-contracts";
import {
  EDITORIAL_PLAN_SCHEMA,
  EDITORIAL_SUPPORTED_COMPONENTS,
  type EditorialAuthoredUncertaintyUnit,
  type EditorialCompiledUncertaintyUnit,
  type EditorialComponentPlan,
  type EditorialPlan,
  type EditorialSectionPlan,
  type EditorialUncertaintyUnit,
} from "./editorial-plan-contracts";
import {
  INSIGHT_ID_PATTERN,
  PLAN_QUESTION_ID_PATTERN,
  type WriterPlannedComponent,
  type WriterPlannedSection,
  type WriterPresentationPlan,
  WriterAgentLedger,
} from "./writer-agent";
import {
  BINDING_TOKEN,
  DOCUMENTED_KINDS,
  INTERPRETATION_KINDS,
  type ReportBlock,
  type ReportSection,
  SECTION_ID_PATTERN as WRITER_SECTION_ID_PATTERN,
  UNCERTAINTY_KINDS,
  validateReportBlock,
  validateWriterReport,
  WRITER_LIMITS,
  WRITER_REPORT_SCHEMA,
  type WriterReport,
  WriterRejection,
  type WriterTemporalValidationContext,
} from "./writer-report-contracts";

export class EditorialPlanRejection extends Error {
  constructor(
    readonly diagnosticReason: string,
    message: string,
    readonly diagnosticField?: string,
    readonly ungroundedValue?: string,
  ) {
    super(message);
  }
}

function reject(
  diagnosticReason: string,
  message: string,
  diagnosticField = diagnosticFieldFromMessage(message),
  ungroundedValue?: string,
): never {
  throw new EditorialPlanRejection(diagnosticReason, message, diagnosticField, ungroundedValue);
}

export type EditorialPlanCompileContext = {
  readonly reportRunId: string;
  readonly claims: readonly StudyClaim[];
  readonly fileNames: ReadonlyMap<string, string>;
  readonly canonicalFindings?: CanonicalFindingResolution | null;
  readonly asOf?: string | Date | null;
};

export type EditorialPlanCompileSuccess = {
  readonly ok: true;
  readonly presentationPlan: WriterPresentationPlan;
  readonly writerReport: WriterReport;
  readonly editorialPlanJsonBytes: number;
  readonly compiledWriterReportJsonBytes: number;
};

export type EditorialPlanCompileFailure = {
  readonly ok: false;
  readonly message: string;
  readonly diagnosticReason: string;
  readonly diagnosticField?: string;
  readonly component?: "editorial" | "writer" | "scenario" | "a2ui";
};

export type EditorialPlanCompileResult = EditorialPlanCompileSuccess | EditorialPlanCompileFailure;

const HISTORICAL_DOCUMENTED_SENTENCE =
  "This documented period ended before the report date; whether a newer plan exists is not established in the record.";

function claimMap(claims: readonly StudyClaim[]): ReadonlyMap<string, StudyClaim> {
  return new Map(claims.map((claim) => [claim.id, claim]));
}

function buildTemporalContext(
  claims: readonly StudyClaim[],
  canonicalFindings: CanonicalFindingResolution | null | undefined,
  asOf: string | Date | null | undefined,
): WriterTemporalValidationContext {
  const historicalByClaimId = buildHistoricalTemporalMap(claims, { canonicalFindings, asOf });
  const activeClaimIds = buildActiveTemporalClaimIds(claims, { canonicalFindings, asOf });
  return { historicalByClaimId, activeClaimIds };
}

function assertKnownClaims(ids: readonly string[], claims: ReadonlyMap<string, StudyClaim>, path: string): void {
  ids.forEach((id, index) => {
    if (!claims.has(id)) {
      reject("editorial_plan_claim_unknown", `${path}[${index}] (${id}) is not a Study claim.`, `${path}[${index}]`);
    }
  });
}

function assertDocumentedKinds(ids: readonly string[], claims: ReadonlyMap<string, StudyClaim>, path: string): void {
  ids.forEach((id, index) => {
    const claim = claims.get(id)!;
    if (!DOCUMENTED_KINDS.has(claim.kind)) {
      reject(
        "editorial_plan_claim_kind",
        `${path}[${index}] cites ${id}, which cannot support deterministic DOCUMENTED content.`,
        `${path}[${index}]`,
      );
    }
    if (claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED") {
      reject(
        "editorial_plan_claim_kind",
        `${path}[${index}] cites unverified calculation ${id}.`,
        `${path}[${index}]`,
      );
    }
  });
}

function assertInterpretationKinds(ids: readonly string[], claims: ReadonlyMap<string, StudyClaim>, path: string): void {
  ids.forEach((id, index) => {
    const claim = claims.get(id)!;
    if (!INTERPRETATION_KINDS.has(claim.kind)) {
      reject(
        "editorial_plan_claim_kind",
        `${path}[${index}] cites ${id}, which cannot support INTERPRETATION content.`,
        `${path}[${index}]`,
      );
    }
    if (claim.kind === "CALCULATION" && claim.numericStatus !== "VERIFIED") {
      reject(
        "editorial_plan_claim_kind",
        `${path}[${index}] cites unverified calculation ${id}.`,
        `${path}[${index}]`,
      );
    }
  });
}

function assertUncertaintyKinds(ids: readonly string[], claims: ReadonlyMap<string, StudyClaim>, path: string): void {
  ids.forEach((id, index) => {
    const claim = claims.get(id)!;
    if (!UNCERTAINTY_KINDS.has(claim.kind)) {
      reject(
        "editorial_plan_claim_kind",
        `${path}[${index}] cites ${id}, which cannot support UNCERTAINTY content.`,
        `${path}[${index}]`,
      );
    }
  });
}

function ensureSentencePunctuation(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return /[.!?][)"'\]]*$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function normalizeExactPhraseKey(value: string): string {
  return ensureSentencePunctuation(value).toLowerCase();
}

function hasExplicitHistoricalFraming(value: string): boolean {
  return /\bended before\b/i.test(value) || /\bnot established in the record\b/i.test(value);
}

function documentedPhraseForClaim(claim: StudyClaim): string {
  return ensureSentencePunctuation(claim.text);
}

function joinDocumentedPhrases(
  claimIds: readonly string[],
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext?: WriterTemporalValidationContext,
): string {
  const historicalByClaimId = temporalContext?.historicalByClaimId;
  const entries: { phrase: string; claimIds: string[] }[] = [];
  const entryByKey = new Map<string, { phrase: string; claimIds: string[] }>();

  for (const id of claimIds) {
    const phrase = documentedPhraseForClaim(claims.get(id)!);
    if (!phrase) continue;
    const key = normalizeExactPhraseKey(phrase);
    const existing = entryByKey.get(key);
    if (existing) {
      existing.claimIds.push(id);
    } else {
      const entry = { phrase, claimIds: [id] };
      entryByKey.set(key, entry);
      entries.push(entry);
    }
  }

  const framedPeriodKeys = new Set<string>();
  if (historicalByClaimId && historicalByClaimId.size > 0) {
    for (const entry of entries) {
      if (!hasExplicitHistoricalFraming(entry.phrase)) continue;
      for (const id of entry.claimIds) {
        const historical = historicalByClaimId.get(id);
        if (historical) {
          framedPeriodKeys.add(`${historical.startDate ?? ""}..${historical.endDate ?? ""}`);
        }
      }
    }
  }

  const parts: string[] = [];
  for (const entry of entries) {
    if (historicalByClaimId && historicalByClaimId.size > 0 && !hasExplicitHistoricalFraming(entry.phrase)) {
      const historical = entry.claimIds
        .map((id) => historicalByClaimId.get(id))
        .find((item) => item !== undefined && !framedPeriodKeys.has(`${item.startDate ?? ""}..${item.endDate ?? ""}`));
      if (historical) {
        const periodKey = `${historical.startDate ?? ""}..${historical.endDate ?? ""}`;
        framedPeriodKeys.add(periodKey);
        parts.push(`${entry.phrase} ${HISTORICAL_DOCUMENTED_SENTENCE}`);
        continue;
      }
    }
    parts.push(entry.phrase);
  }
  return parts.join(" ");
}

function compileSummaryBlock(
  plan: EditorialPlan["summary"],
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext: WriterTemporalValidationContext,
): ReportBlock {
  const path = "summary[0]";
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.documentedClaimIds) || plan.documentedClaimIds.length === 0) {
    reject(
      "editorial_plan_shape",
      "summary.documentedClaimIds must be a non-empty list of Study claim IDs.",
      "summary.documentedClaimIds",
    );
  }
  assertKnownClaims(plan.documentedClaimIds, claims, "summary.documentedClaimIds");
  assertDocumentedKinds(plan.documentedClaimIds, claims, "summary.documentedClaimIds");
  const claimRefs = [...plan.documentedClaimIds];
  const calcTokens: string[] = [];
  for (const binding of plan.calculationBindings ?? []) {
    if (!claims.has(binding.calcId)) {
      reject("editorial_plan_claim_unknown", `summary.calculationBindings calcId ${binding.calcId} is not a Study claim.`);
    }
    const calc = claims.get(binding.calcId)!;
    if (calc.kind !== "CALCULATION" || calc.numericStatus !== "VERIFIED") {
      reject(
        "editorial_plan_claim_kind",
        `summary.calculationBindings calcId ${binding.calcId} must be a verified calculation.`,
      );
    }
    if (!claimRefs.includes(binding.calcId)) claimRefs.push(binding.calcId);
    calcTokens.push(`({{calc:${binding.calcId}}}${binding.suffix ?? ""})`);
  }
  let text = joinDocumentedPhrases(plan.documentedClaimIds, claims, temporalContext);
  if (calcTokens.length > 0) {
    text = `${text} ${calcTokens.join(" ")}`;
  }
  return validateReportBlock(
    { type: "DOCUMENTED", text, claimRefs },
    path,
    claims,
    temporalContext,
  ).block;
}

function compileInterpretationBlock(
  unit: { text: string; claimRefs: readonly string[] },
  path: string,
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext: WriterTemporalValidationContext,
): ReportBlock {
  assertKnownClaims(unit.claimRefs, claims, `${path}.claimRefs`);
  assertInterpretationKinds(unit.claimRefs, claims, `${path}.claimRefs`);
  if (unit.text.trim() === "" || unit.text.length > WRITER_LIMITS.blockText) {
    reject("editorial_plan_shape", `${path}.text must be non-empty text up to ${WRITER_LIMITS.blockText} characters.`, `${path}.text`);
  }
  return validateReportBlock(
    { type: "INTERPRETATION", text: unit.text.trim(), claimRefs: [...unit.claimRefs] },
    path,
    claims,
    temporalContext,
  ).block;
}

function compileUncertaintyBlock(
  unit: EditorialUncertaintyUnit,
  path: string,
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext: WriterTemporalValidationContext,
): ReportBlock {
  if ("mode" in unit && unit.mode === "compiled") {
    const compiled = unit as EditorialCompiledUncertaintyUnit;
    assertKnownClaims(compiled.claimIds, claims, `${path}.claimIds`);
    assertUncertaintyKinds(compiled.claimIds, claims, `${path}.claimIds`);
    const text = joinDocumentedPhrases(compiled.claimIds, claims);
    return validateReportBlock(
      { type: "UNCERTAINTY", text, claimRefs: [...compiled.claimIds] },
      path,
      claims,
      temporalContext,
    ).block;
  }
  const authored = unit as EditorialAuthoredUncertaintyUnit;
  assertKnownClaims(authored.claimRefs, claims, `${path}.claimRefs`);
  assertUncertaintyKinds(authored.claimRefs, claims, `${path}.claimRefs`);
  if (authored.text.trim() === "" || authored.text.length > WRITER_LIMITS.blockText) {
    reject("editorial_plan_shape", `${path}.text must be non-empty text up to ${WRITER_LIMITS.blockText} characters.`, `${path}.text`);
  }
  return validateReportBlock(
    { type: "UNCERTAINTY", text: authored.text.trim(), claimRefs: [...authored.claimRefs] },
    path,
    claims,
    temporalContext,
  ).block;
}

function compileDocumentedBlock(
  claimIds: readonly string[],
  path: string,
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext: WriterTemporalValidationContext,
): ReportBlock {
  assertKnownClaims(claimIds, claims, path);
  assertDocumentedKinds(claimIds, claims, path);
  const text = joinDocumentedPhrases(claimIds, claims, temporalContext);
  return validateReportBlock({ type: "DOCUMENTED", text, claimRefs: [...claimIds] }, path, claims, temporalContext).block;
}

function normalizeCellValueKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function formatCellFromClaims(cellClaimIds: readonly string[], claims: ReadonlyMap<string, StudyClaim>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const id of cellClaimIds) {
    const claim = claims.get(id)!;
    const value = claim.documentFinding?.valueAsWritten?.trim();
    const display = (value && value.length > 0 ? value : claim.text.trim()).replace(/\s+/g, " ").trim();
    if (!display) continue;
    const key = normalizeCellValueKey(display);
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(display);
  }
  return parts.join(" · ");
}

function compileViewProps(
  component: EditorialComponentPlan,
  componentIndex: number,
  claims: ReadonlyMap<string, StudyClaim>,
  temporalContext: WriterTemporalValidationContext,
  sectionIds: ReadonlySet<string>,
  scenarioIds: ReadonlySet<string>,
  hasOutline: boolean,
): Record<string, unknown> {
  const compPath = `components[${componentIndex}]`;
  if (!(EDITORIAL_SUPPORTED_COMPONENTS as readonly string[]).includes(component.component)) {
    reject(
      "editorial_plan_shape",
      `Component ${String(component.component)} at ${compPath}.component is not supported by the editorial compiler. Supported components: ${EDITORIAL_SUPPORTED_COMPONENTS.join(", ")}.`,
      `${compPath}.component`,
    );
  }
  const layout = component.layout;
  if (!layout || typeof layout !== "object") {
    reject("editorial_plan_shape", `${compPath}.layout must be an object.`, `${compPath}.layout`);
  }
  switch (component.component) {
    case "Narrative": {
      if (layout.kind !== "Narrative") {
        reject("editorial_plan_shape", `${compPath}.layout must be Narrative.`, `${compPath}.layout`);
      }
      if (component.sectionId === "summary") return { sectionId: "summary" };
      if (typeof component.sectionId !== "string" || !sectionIds.has(component.sectionId)) {
        reject("editorial_plan_shape", "Narrative components require a valid sectionId.", `${compPath}.sectionId`);
      }
      return { sectionId: component.sectionId };
    }
    case "RecordTable": {
      if (layout.kind !== "RecordTable") reject("editorial_plan_shape", "RecordTable layout mismatch.", `${compPath}.layout`);
      const rows = layout.rows.map((row, rowIndex) => {
        if (row.cellClaimIds.length !== layout.columns.length) {
          reject(
            "editorial_plan_shape",
            `RecordTable row ${rowIndex} must provide one cellClaimIds entry per column.`,
            `${compPath}.layout.rows[${rowIndex}]`,
          );
        }
        const cells = row.cellClaimIds.map((cellClaimIds, cellIndex) => {
          assertKnownClaims(cellClaimIds, claims, `RecordTable.rows[${rowIndex}].cells[${cellIndex}]`);
          assertDocumentedKinds(cellClaimIds, claims, `RecordTable.rows[${rowIndex}].cells[${cellIndex}]`);
          return formatCellFromClaims(cellClaimIds, claims);
        });
        const claimRefs = [...new Set(row.cellClaimIds.flat())];
        return { cells, claimRefs };
      });
      return { title: layout.title, columns: [...layout.columns], rows };
    }
    case "Comparison": {
      if (layout.kind !== "Comparison") reject("editorial_plan_shape", "Comparison layout mismatch.", `${compPath}.layout`);
      const items = layout.items.map((item, index) => {
        assertKnownClaims(item.leftClaimIds, claims, `Comparison.items[${index}].leftClaimIds`);
        assertKnownClaims(item.rightClaimIds, claims, `Comparison.items[${index}].rightClaimIds`);
        assertDocumentedKinds(item.leftClaimIds, claims, `Comparison.items[${index}].leftClaimIds`);
        assertDocumentedKinds(item.rightClaimIds, claims, `Comparison.items[${index}].rightClaimIds`);
        const left = formatCellFromClaims(item.leftClaimIds, claims);
        const right = formatCellFromClaims(item.rightClaimIds, claims);
        const claimRefs = [...new Set([...item.leftClaimIds, ...item.rightClaimIds])];
        return { label: item.label, left, right, claimRefs };
      });
      return {
        title: layout.title,
        leftLabel: layout.leftLabel,
        rightLabel: layout.rightLabel,
        items,
      };
    }
    case "Timeline": {
      if (layout.kind !== "Timeline") reject("editorial_plan_shape", "Timeline layout mismatch.", `${compPath}.layout`);
      const events = layout.events.map((event, index) => {
        assertKnownClaims(event.dateClaimIds, claims, `Timeline.events[${index}].dateClaimIds`);
        assertKnownClaims(event.textClaimIds, claims, `Timeline.events[${index}].textClaimIds`);
        assertDocumentedKinds(event.dateClaimIds, claims, `Timeline.events[${index}].dateClaimIds`);
        assertDocumentedKinds(event.textClaimIds, claims, `Timeline.events[${index}].textClaimIds`);
        const date = formatCellFromClaims(event.dateClaimIds, claims);
        const text = formatCellFromClaims(event.textClaimIds, claims);
        const claimRefs = [...new Set([...event.dateClaimIds, ...event.textClaimIds])];
        return { date, text, claimRefs };
      });
      return { title: layout.title, events };
    }
    case "Metric": {
      if (layout.kind !== "Metric") reject("editorial_plan_shape", "Metric layout mismatch.", `${compPath}.layout`);
      assertKnownClaims(layout.claimIds, claims, "Metric.claimIds");
      assertDocumentedKinds(layout.claimIds, claims, "Metric.claimIds");
      if (!/^\{\{calc:[A-Za-z0-9.]{1,32}\}\}$/.test(layout.binding)) {
        reject("editorial_plan_shape", "Metric.binding must be a single {{calc:…}} token.", `${compPath}.layout.binding`);
      }
      return {
        label: layout.label,
        binding: layout.binding,
        ...(layout.unit !== undefined ? { unit: layout.unit } : {}),
      };
    }
    case "KeyFindings": {
      if (layout.kind !== "KeyFindings") reject("editorial_plan_shape", "KeyFindings layout mismatch.", `${compPath}.layout`);
      assertKnownClaims(layout.claimIds, claims, "KeyFindings.claimIds");
      for (const [index, id] of layout.claimIds.entries()) {
        const claim = claims.get(id)!;
        if (!FINDING_GRANULAR_KINDS.has(claim.kind)) {
          reject("editorial_plan_claim_kind", `KeyFindings.claimIds[${index}] cites ${id}, which is not allowed.`);
        }
      }
      return { title: layout.title, claimIds: [...layout.claimIds] };
    }
    case "EvidencePanel": {
      if (layout.kind !== "EvidencePanel") reject("editorial_plan_shape", "EvidencePanel layout mismatch.", `${compPath}.layout`);
      assertKnownClaims(layout.claimIds, claims, "EvidencePanel.claimIds");
      for (const [index, id] of layout.claimIds.entries()) {
        const claim = claims.get(id)!;
        if (!EVIDENCE_GRANULAR_KINDS.has(claim.kind)) {
          reject("editorial_plan_claim_kind", `EvidencePanel.claimIds[${index}] cites ${id}, which is not allowed.`);
        }
      }
      return { title: layout.title, claimIds: [...layout.claimIds] };
    }
    case "ScenarioExplorer": {
      if (layout.kind !== "ScenarioExplorer" && layout.kind !== "Narrative") {
        reject("editorial_plan_shape", `${compPath}.layout must be ScenarioExplorer.`, `${compPath}.layout`);
      }
      if (typeof component.scenarioId !== "string" || !scenarioIds.has(component.scenarioId)) {
        reject("editorial_plan_shape", "ScenarioExplorer requires a recorded scenarioId.", `${compPath}.scenarioId`);
      }
      return { scenarioId: component.scenarioId };
    }
    default:
      reject(
        "editorial_plan_shape",
        `Component ${String(component.component)} is not supported by the editorial compiler.`,
        `${compPath}.component`,
      );
  }
}

function sectionClaimUnion(section: EditorialSectionPlan): string[] {
  const ids = new Set<string>();
  for (const id of section.documentedClaimIds ?? []) ids.add(id);
  if (section.interpretation) for (const id of section.interpretation.claimRefs) ids.add(id);
  if (section.uncertainty) {
    if ("mode" in section.uncertainty) {
      for (const id of section.uncertainty.claimIds) ids.add(id);
    } else {
      for (const id of section.uncertainty.claimRefs) ids.add(id);
    }
  }
  return [...ids];
}

/** Editorial content selections that must appear in compiled writer output (not presentation-only metadata). */
function collectRequiredRenderedClaimSelections(plan: EditorialPlan): Set<string> {
  const selected = new Set<string>();
  for (const id of plan.summary.documentedClaimIds) selected.add(id);
  for (const binding of plan.summary.calculationBindings ?? []) selected.add(binding.calcId);
  for (const section of plan.sections) {
    for (const id of section.documentedClaimIds ?? []) selected.add(id);
    if (section.interpretation) for (const id of section.interpretation.claimRefs) selected.add(id);
    if (section.uncertainty) {
      if ("mode" in section.uncertainty) {
        for (const id of section.uncertainty.claimIds) selected.add(id);
      } else {
        for (const id of section.uncertainty.claimRefs) selected.add(id);
      }
    }
  }
  for (const component of plan.components) {
    if (component.layout.kind === "RecordTable") {
      for (const row of component.layout.rows) {
        for (const cell of row.cellClaimIds) for (const id of cell) selected.add(id);
      }
    }
    if (component.layout.kind === "Comparison") {
      for (const item of component.layout.items) {
        for (const id of item.leftClaimIds) selected.add(id);
        for (const id of item.rightClaimIds) selected.add(id);
      }
    }
    if (component.layout.kind === "Timeline") {
      for (const event of component.layout.events) {
        for (const id of event.dateClaimIds) selected.add(id);
        for (const id of event.textClaimIds) selected.add(id);
      }
    }
    if (component.layout.kind === "Metric") for (const id of component.layout.claimIds) selected.add(id);
    if (component.layout.kind === "KeyFindings") for (const id of component.layout.claimIds) selected.add(id);
    if (component.layout.kind === "EvidencePanel") for (const id of component.layout.claimIds) selected.add(id);
  }
  return selected;
}

function collectRenderedClaimRefs(report: WriterReport): Set<string> {
  const rendered = new Set<string>();
  const scanBlock = (block: ReportBlock) => {
    for (const ref of block.claimRefs) rendered.add(ref);
    for (const match of block.text.matchAll(BINDING_TOKEN)) {
      if (match[1] === "calc") rendered.add(match[2]!);
    }
  };
  for (const block of report.summary) scanBlock(block);
  for (const section of report.sections) for (const block of section.blocks) scanBlock(block);
  for (const view of report.view) {
    const props = view.props;
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.claimRefs)) {
        for (const ref of record.claimRefs) if (typeof ref === "string") rendered.add(ref);
      }
      if (Array.isArray(record.claimIds)) {
        for (const ref of record.claimIds) if (typeof ref === "string") rendered.add(ref);
      }
      for (const nested of Object.values(record)) walk(nested);
    };
    walk(props);
  }
  return rendered;
}

function buildPresentationPlan(plan: EditorialPlan): WriterPresentationPlan {
  const sections: WriterPlannedSection[] = plan.sections.map((section) => ({
    id: section.id,
    heading: section.heading,
    priority: section.priority,
    claimIds: sectionClaimUnion(section),
    ...(section.insightIds ? { insightIds: [...section.insightIds] } : {}),
    ...(section.purpose ? { purpose: section.purpose } : {}),
  }));
  const components: WriterPlannedComponent[] = plan.components.map((component) => ({
    component: component.component,
    claimIds: [...component.claimIds],
    ...(component.sectionId !== undefined ? { sectionId: component.sectionId } : {}),
    ...(component.scenarioId !== undefined ? { scenarioId: component.scenarioId } : {}),
    ...(component.purpose ? { purpose: component.purpose } : {}),
  }));
  return {
    schema: "hive.writer-presentation-plan/1",
    audienceObjective: plan.audienceObjective,
    summaryDetailLevel: plan.summaryDetailLevel,
    ...(plan.insights ? { insights: plan.insights.map((insight) => ({ ...insight })) } : {}),
    priorityFindings: plan.priorityFindings.map((entry) => ({ ...entry })),
    sections,
    components,
  };
}

function validateEditorialPlanShape(plan: EditorialPlan, claims: ReadonlyMap<string, StudyClaim>): void {
  if (plan.audience !== "CUSTOMER" && plan.audience !== "PRO") {
    reject("editorial_plan_shape", "audience must be CUSTOMER or PRO.", "audience");
  }
  if (plan.title.trim() === "" || plan.title.length > WRITER_LIMITS.title) {
    reject("editorial_plan_shape", "title must be non-empty text.", "title");
  }
  if (plan.audienceObjective.trim() === "" || plan.audienceObjective.length > 600) {
    reject("editorial_plan_shape", "audienceObjective must be non-empty text up to 600 characters.", "audienceObjective");
  }
  if (plan.sections.length === 0 || plan.sections.length > WRITER_LIMITS.sections) {
    reject("editorial_plan_shape", "sections must contain 1–12 items.", "sections");
  }
  const sectionIds = new Set<string>();
  for (const [index, section] of plan.sections.entries()) {
    const path = `sections[${index}]`;
    if (!WRITER_SECTION_ID_PATTERN.test(section.id) || sectionIds.has(section.id)) {
      reject("editorial_plan_shape", `${path}.id must be a unique s1…s99 id.`, `${path}.id`);
    }
    sectionIds.add(section.id);
    if (section.heading.trim() === "" || section.heading.length > WRITER_LIMITS.heading) {
      reject("editorial_plan_shape", `${path}.heading must be non-empty text.`, `${path}.heading`);
    }
    const hasDocumented = (section.documentedClaimIds?.length ?? 0) > 0;
    const hasInterpretation = Boolean(section.interpretation);
    const hasUncertainty = Boolean(section.uncertainty);
    if (!hasDocumented && !hasInterpretation && !hasUncertainty) {
      reject("editorial_plan_shape", `${path} must include documented, interpretation, or uncertainty content.`, path);
    }
  }
  if (plan.components.length === 0 || plan.components.length > WRITER_LIMITS.viewComponents) {
    reject("editorial_plan_shape", "components must contain 1–30 items.", "components");
  }
  for (const [index, component] of plan.components.entries()) {
    if (!(A2UI_COMPONENTS as readonly string[]).includes(component.component)) {
      reject(
        "editorial_plan_shape",
        `components[${index}].component (${String(component.component)}) is not in the A2UI catalog. Supported editorial components: ${EDITORIAL_SUPPORTED_COMPONENTS.join(", ")}.`,
        `components[${index}].component`,
      );
    }
    if (!(EDITORIAL_SUPPORTED_COMPONENTS as readonly string[]).includes(component.component)) {
      reject(
        "editorial_plan_shape",
        `Component ${String(component.component)} at components[${index}].component is not supported by the editorial compiler. Supported components: ${EDITORIAL_SUPPORTED_COMPONENTS.join(", ")}.`,
        `components[${index}].component`,
      );
    }
    assertKnownClaims(component.claimIds, claims, `components[${index}].claimIds`);
  }
  for (const [index, finding] of plan.priorityFindings.entries()) {
    assertKnownClaims([finding.claimId], claims, `priorityFindings[${index}].claimId`);
  }
  for (const [index, insight] of (plan.insights ?? []).entries()) {
    if (!INSIGHT_ID_PATTERN.test(insight.id)) {
      reject("editorial_plan_shape", `insights[${index}].id is invalid.`, `insights[${index}].id`);
    }
    assertKnownClaims(insight.claimIds, claims, `insights[${index}].claimIds`);
    for (const qId of insight.questionIds) {
      if (!PLAN_QUESTION_ID_PATTERN.test(qId)) {
        reject("editorial_plan_shape", `insights[${index}].questionIds contains invalid id ${qId}.`);
      }
    }
  }
}

/**
 * Validates editorial selections, compiles deterministic DOCUMENTED content and A2UI props,
 * preserves model-authored INTERPRETATION / UNCERTAINTY prose, assembles `hive.writer-report/1`
 * and `hive.writer-presentation-plan/1`, and runs existing Writer validation plus `buildReport()`.
 */
export function compileEditorialPlan(plan: EditorialPlan, context: EditorialPlanCompileContext): EditorialPlanCompileResult {
  const editorialPlanJsonBytes = Buffer.byteLength(JSON.stringify(plan), "utf8");
  try {
    if (plan.schema !== undefined && plan.schema !== EDITORIAL_PLAN_SCHEMA) {
      reject("editorial_plan_shape", "schema must be hive.editorial-plan/1 when provided.", "schema");
    }
    const claims = claimMap(context.claims);
    validateEditorialPlanShape(plan, claims);
    const temporalContext = buildTemporalContext(context.claims, context.canonicalFindings, context.asOf);
    const questionsWithFacts = questionsWithAtomicFacts(context.claims);

    const summaryBlock = compileSummaryBlock(plan.summary, claims, temporalContext);
    const sections: ReportSection[] = plan.sections.map((section, sectionIndex) => {
      const blocks: ReportBlock[] = [];
      if (section.documentedClaimIds && section.documentedClaimIds.length > 0) {
        blocks.push(
          compileDocumentedBlock(
            section.documentedClaimIds,
            `sections[${sectionIndex}].documented`,
            claims,
            temporalContext,
          ),
        );
      }
      if (section.interpretation) {
        blocks.push(
          compileInterpretationBlock(
            section.interpretation,
            `sections[${sectionIndex}].interpretation`,
            claims,
            temporalContext,
          ),
        );
      }
      if (section.uncertainty) {
        blocks.push(
          compileUncertaintyBlock(section.uncertainty, `sections[${sectionIndex}].uncertainty`, claims, temporalContext),
        );
      }
      return { id: section.id, heading: section.heading, blocks };
    });

    const scenarios = (plan.scenarios ?? []).map((scenario) => ({
      ...scenario,
      claimRefs: [...scenario.claimRefs],
      parameters: scenario.parameters.map((param) => ({ ...param })),
      results: scenario.results.map((result) => ({ ...result })),
    }));
    const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
    const scenarioResultIds = new Set<string>();
    for (const scenario of scenarios) {
      for (const result of scenario.results ?? []) {
        scenarioResultIds.add(`${scenario.id}.${result.id}`);
      }
    }
    const sectionIds = new Set(plan.sections.map((section) => section.id));

    const view = plan.components.map((component, index) => {
      const props = compileViewProps(
        component,
        index,
        claims,
        temporalContext,
        sectionIds,
        scenarioIds,
        true,
      );
      const path = `view[${index}]`;
      const validationContext: ViewComponentValidationContext = {
        claims,
        questionsWithFacts,
        hasOutline: true,
        sectionIds,
        scenarioResultIds,
        scenarioIds,
        temporalContext,
      };
      validateViewComponentProposal({ component: component.component, props }, path, validationContext);
      return { component: component.component, props };
    });

    const writerReport: WriterReport = {
      schema: WRITER_REPORT_SCHEMA,
      audience: plan.audience,
      title: plan.title.trim(),
      summary: [summaryBlock],
      sections,
      scenarios,
      view,
    };

    const selectedClaims = collectRequiredRenderedClaimSelections(plan);
    const renderedClaims = collectRenderedClaimRefs(writerReport);
    for (const id of selectedClaims) {
      if (!renderedClaims.has(id)) {
        reject(
          "editorial_plan_claim_missing",
          `Selected claim ${id} does not appear in compiled report output.`,
          "claimSelections",
        );
      }
    }

    const validated = validateWriterReport(writerReport, {
      audience: plan.audience,
      claims: context.claims,
      canonicalFindings: context.canonicalFindings,
      asOf: context.asOf,
    });
    if (!validated.ok) {
      return {
        ok: false,
        message: validated.message,
        diagnosticReason: validated.diagnosticReason,
        ...(validated.diagnosticField ? { diagnosticField: validated.diagnosticField } : {}),
        component: "writer",
      };
    }

    const presentationPlan = buildPresentationPlan(plan);
    const ledger = new WriterAgentLedger({
      reportRunId: context.reportRunId,
      audience: plan.audience,
      claims: context.claims,
      fileNames: context.fileNames,
      canonicalFindings: context.canonicalFindings ?? null,
      asOf: context.asOf ?? null,
    });
    try {
      ledger.recordPresentationPlan(presentationPlan);
    } catch (error) {
      if (error instanceof WriterRejection) {
        return {
          ok: false,
          message: error.message,
          diagnosticReason: error.diagnosticReason,
          ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
          component: "writer",
        };
      }
      throw error;
    }

    const built = buildReport(validated.value, {
      audience: plan.audience,
      claims: context.claims,
      fileNames: context.fileNames,
      canonicalFindings: context.canonicalFindings,
      asOf: context.asOf,
    });
    if (!built.ok) {
      return {
        ok: false,
        message: built.message,
        diagnosticReason: built.diagnosticReason,
        ...(built.diagnosticField ? { diagnosticField: built.diagnosticField } : {}),
        component: built.component,
      };
    }

    return {
      ok: true,
      presentationPlan,
      writerReport: validated.value,
      editorialPlanJsonBytes,
      compiledWriterReportJsonBytes: Buffer.byteLength(JSON.stringify(validated.value), "utf8"),
    };
  } catch (error) {
    if (error instanceof EditorialPlanRejection) {
      return {
        ok: false,
        message: error.message,
        diagnosticReason: error.diagnosticReason,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
        component: "editorial",
      };
    }
    if (error instanceof WriterRejection) {
      return {
        ok: false,
        message: error.message,
        diagnosticReason: error.diagnosticReason,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
        component: "writer",
      };
    }
    if (error instanceof BindRejection) {
      return {
        ok: false,
        message: error.message,
        diagnosticReason: error.diagnosticReason,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
        component: "a2ui",
      };
    }
    throw error;
  }
}
