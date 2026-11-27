/**
 * Domain Pack mapping ledger. The model proposes field and relationship rows through three
 * closed tools. This ledger admits a row only when the catalog id, extraction fact, instance,
 * and written value already exist. It assembles `hive.field-mapping-proposal/1` for the
 * investigation engine. It does not read pages itself beyond the quotes already on the fact,
 * and it does not compute a finding.
 */
import type { StudyAgentToolCall } from "../analysis/study-agent";
import { calendarDayIndex } from "./domain-pack-rules";
import type { DomainInvestigationPlan } from "./domain-investigation-plan";
import type { AuthorizedDocument } from "./domain-investigation-binder";
import type { CompiledDomainPack, FieldValueType } from "./domain-pack-source";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import { FIELD_MAPPING_PROPOSAL_SCHEMA } from "./investigation-study-engine";
import { normalizeQuoteText } from "./verify-quotes";

export const MAPPING_AGENT_TOOL_NAMES = ["propose_field", "propose_relationship", "finish_mapping"] as const;
export type MappingAgentToolName = (typeof MAPPING_AGENT_TOOL_NAMES)[number];

export const MAPPING_WINDOW_SCHEMA = "hive.field-mapping-window/1" as const;
export const MAPPING_WINDOW_LIMITS = { maxFields: 24, maxRelationships: 8, maxFacts: 32 } as const;

export const MAPPING_REJECTION_CODES = [
  "unknown_tool",
  "invalid_arguments",
  "unknown_catalog_id",
  "unknown_fact",
  "unauthorized_evidence",
  "invented_value",
  "duplicate_fact",
  "instance_entity_conflict",
  "mapping_incomplete",
  "mapping_finished",
  "tool_call_conflict",
  "too_many_calls",
  "no_tool_call",
] as const;
export type MappingRejectionCode = (typeof MAPPING_REJECTION_CODES)[number];

const REJECTION_CODES: ReadonlySet<string> = new Set(MAPPING_REJECTION_CODES);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALUE_TYPES = new Set<FieldValueType>(["TEXT", "NUMBER", "DATE", "BOOLEAN", "MONEY", "QUANTITY"]);
const FIELD_KEYS = ["documentId", "extractionFactId", "entityId", "instanceId", "fieldId", "valueType", "value"] as const;
const RELATIONSHIP_KEYS = ["documentId", "extractionFactId", "relationshipId", "fromInstanceId", "toInstanceId"] as const;

export type MappingAgentToolDefinition = {
  type: "function";
  function: { name: MappingAgentToolName; description: string; parameters: Record<string, unknown> };
};

const str = (description: string) => ({ type: "string", description, maxLength: 128 });
const closed = (properties: Record<string, unknown>, required: readonly string[]) => ({
  type: "object",
  properties,
  required: [...required],
  additionalProperties: false,
});

export const MAPPING_AGENT_TOOLS: readonly MappingAgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "propose_field",
      description: "Propose one extracted fact as the written value of one catalog field. Copy the value exactly. If that fact was already accepted, reuse its fact id and do not propose it again.",
      parameters: closed(
        {
          documentId: str("Document id of the fact."),
          extractionFactId: str("Fact id from the window."),
          entityId: str("Entity id from the window."),
          instanceId: str("Instance id you are grouping. Reuse it for the same entity instance."),
          fieldId: str("Field id from the window."),
          valueType: { type: "string", enum: [...VALUE_TYPES] },
          value: { type: "string", description: "The fact's value as written. Do not convert it.", maxLength: 2000 },
        },
        FIELD_KEYS,
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "propose_relationship",
      description: "Offer one extracted fact as evidence for one catalog relationship. Do not conclude that the relationship holds.",
      parameters: closed(
        {
          documentId: str("Document id of the fact."),
          extractionFactId: str("Fact id from the window."),
          relationshipId: str("Relationship id from the window."),
          fromInstanceId: str("Instance id for the relationship's from entity."),
          toInstanceId: str("Instance id for the relationship's to entity."),
        },
        RELATIONSHIP_KEYS,
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "finish_mapping",
      description: "Finish after the windows are mapped, or when nothing in them applies. Requires at least one accepted field.",
      parameters: closed({ ready: { type: "boolean", description: "True when mapping should stop." } }, ["ready"]),
    },
  },
];

export function formatMappingRejectionSummary(counts: Readonly<Record<string, number>> | null | undefined): string | null {
  if (!counts) return null;
  const entries = Object.entries(counts)
    .filter(([code, count]) => REJECTION_CODES.has(code) && Number.isInteger(count) && count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (entries.length === 0) return null;
  return entries.map(([code, count]) => `${code}:${Math.min(9999, count)}`).join(",").slice(0, 120);
}

type ObjectMap = Record<string, unknown>;
type LocatedFact = { documentId: string; fact: ExtractionFact };
type FieldRow = {
  documentId: string;
  extractionFactId: string;
  entityId: string;
  instanceId: string;
  fieldId: string;
  valueType: FieldValueType;
  value: string;
};
type RelationshipRow = {
  documentId: string;
  extractionFactId: string;
  relationshipId: string;
  fromInstanceId: string;
  toInstanceId: string;
};
type CatalogField = { entityId: string; fieldId: string; valueType: FieldValueType };
type CatalogRelationship = { relationshipId: string; fromEntityId: string; toEntityId: string };
type ToolResult = { toolCallId: string; ok: boolean; content: string };

export type MappingWindow = {
  readonly index: number;
  readonly count: number;
  readonly fields: readonly CatalogField[];
  readonly relationships: readonly CatalogRelationship[];
  readonly facts: readonly {
    documentId: string;
    extractionFactId: string;
    attribute: string;
    valueAsWritten: string;
    pageNumbers: readonly number[];
  }[];
};

const isObject = (value: unknown): value is ObjectMap => !!value && typeof value === "object" && !Array.isArray(value);

class MappingRejection extends Error {
  constructor(readonly code: MappingRejectionCode, message: string) {
    super(message);
  }
}

function refuse(code: MappingRejectionCode, message: string): never {
  throw new MappingRejection(code, message);
}

function exactKeys(value: ObjectMap, allowed: readonly string[]): boolean {
  const ok = new Set<string>(allowed);
  return Object.keys(value).every((key) => ok.has(key));
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

function factKey(documentId: string, factId: string): string {
  return `${documentId}\0${factId}`;
}

function tokens(value: string): Set<string> {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return new Set(spaced.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 3));
}

function phraseInQuote(quote: string, phrase: string): boolean {
  const needle = normalizeQuoteText(phrase);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(normalizeQuoteText(quote));
}

function valueAlreadyWritten(valueType: FieldValueType, written: string, proposed: string): boolean {
  if (proposed !== written) return false;
  if (valueType === "TEXT") return written.length > 0;
  if (valueType === "BOOLEAN") return written === "true" || written === "false";
  if (valueType === "DATE") return ISO_DATE.test(written) && calendarDayIndex(written) !== null;
  if (valueType === "NUMBER" || valueType === "MONEY" || valueType === "QUANTITY") return /^[0-9]+(?:\.[0-9]+)?$/.test(written);
  return false;
}

function quoteOnAuthorizedPage(pages: readonly AuthorizedDocument[], documentId: string, pageNumber: number, quote: string): boolean {
  const document = pages.find((item) => item.documentId === documentId);
  const page = document?.pages.find((item) => item.pageNumber === pageNumber);
  if (!page) return false;
  const haystack = normalizeQuoteText(page.text);
  const needle = normalizeQuoteText(quote);
  return needle.length > 0 && haystack.includes(needle);
}

function indexFacts(extractions: readonly DocExtraction[]): Map<string, LocatedFact> {
  const index = new Map<string, LocatedFact>();
  for (const extraction of extractions) {
    if (extraction.schema !== "hive.doc-extraction/1") continue;
    for (const fact of extraction.facts) {
      const key = factKey(extraction.documentId, fact.id);
      if (index.has(key)) index.set(key, { documentId: extraction.documentId, fact: { ...fact, evidence: [] } });
      else index.set(key, { documentId: extraction.documentId, fact });
    }
  }
  return index;
}

function catalogFrom(pack: CompiledDomainPack): { fields: Map<string, CatalogField>; relationships: Map<string, CatalogRelationship> } {
  const fields = new Map<string, CatalogField>();
  const relationships = new Map<string, CatalogRelationship>();
  for (const definition of pack.definitions) {
    if (definition.kind === "entity") {
      for (const field of definition.fields) {
        fields.set(`${definition.id}\0${field.id}`, { entityId: definition.id, fieldId: field.id, valueType: field.valueType });
      }
    }
    if (definition.kind === "relationship") {
      relationships.set(definition.id, {
        relationshipId: definition.id,
        fromEntityId: definition.fromEntityId,
        toEntityId: definition.toEntityId,
      });
    }
  }
  return { fields, relationships };
}

/** Bounded catalog slices from the investigation plan's bind tasks. A turn never receives the whole catalog. */
export function selectMappingWindows(input: {
  plan: Pick<DomainInvestigationPlan, "tasks">;
  pack: CompiledDomainPack;
  extractions: readonly DocExtraction[];
}): MappingWindow[] {
  const { fields, relationships } = catalogFrom(input.pack);
  const fieldRows: CatalogField[] = [];
  for (const task of input.plan.tasks) {
    if (task.taskKind !== "BIND_ENTITY") continue;
    for (const field of fields.values()) {
      if (field.entityId === task.definitionId) fieldRows.push(field);
    }
  }
  const relationshipRows: CatalogRelationship[] = [];
  for (const task of input.plan.tasks) {
    if (task.taskKind !== "BIND_RELATIONSHIP") continue;
    const relationship = relationships.get(task.definitionId);
    if (relationship) relationshipRows.push(relationship);
  }
  const facts = [...input.extractions]
    .filter((extraction) => extraction.schema === "hive.doc-extraction/1")
    .sort((left, right) => left.documentId.localeCompare(right.documentId))
    .flatMap((extraction) => [...extraction.facts]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((fact) => ({
        documentId: extraction.documentId,
        extractionFactId: fact.id,
        attribute: fact.attribute,
        valueAsWritten: fact.valueAsWritten,
        pageNumbers: fact.evidence.map((item) => item.page),
        tokens: tokens([fact.attribute, fact.category, fact.subject].filter(Boolean).join(" ")),
      })));
  const corpus = new Set<string>();
  for (const fact of facts) for (const token of fact.tokens) corpus.add(token);
  const scored = fieldRows.map((field) => ({
    field,
    score: [...tokens(`${field.entityId} ${field.fieldId}`)].filter((token) => corpus.has(token)).length,
  }));
  const relevant = scored.filter((item) => item.score > 0).sort((left, right) =>
    right.score - left.score || left.field.entityId.localeCompare(right.field.entityId) || left.field.fieldId.localeCompare(right.field.fieldId));
  const chosen = (relevant.length > 0 ? relevant.map((item) => item.field) : fieldRows);
  const slices: CatalogField[][] = [];
  for (let index = 0; index < Math.max(chosen.length, 1); index += MAPPING_WINDOW_LIMITS.maxFields) {
    slices.push(chosen.slice(index, index + MAPPING_WINDOW_LIMITS.maxFields));
    if (chosen.length === 0) break;
  }
  const drafts = slices.map((slice) => {
    const entities = new Set(slice.map((field) => field.entityId));
    return {
      fields: slice,
      relationships: relationshipRows
        .filter((relationship) => entities.has(relationship.fromEntityId) && entities.has(relationship.toEntityId))
        .slice(0, MAPPING_WINDOW_LIMITS.maxRelationships),
      facts: [] as MappingWindow["facts"][number][],
    };
  });
  const assigned = new Set<string>();
  drafts.forEach((draft, draftIndex) => {
    const fieldTokens = new Set<string>();
    for (const field of draft.fields) for (const token of tokens(`${field.entityId} ${field.fieldId}`)) fieldTokens.add(token);
    const matching = facts.filter((fact) => !assigned.has(factKey(fact.documentId, fact.extractionFactId)) && [...fact.tokens].some((token) => fieldTokens.has(token)));
    const pool = matching.length > 0 || draftIndex > 0
      ? matching
      : facts.filter((fact) => !assigned.has(factKey(fact.documentId, fact.extractionFactId)));
    for (const fact of pool.slice(0, MAPPING_WINDOW_LIMITS.maxFacts)) {
      assigned.add(factKey(fact.documentId, fact.extractionFactId));
      draft.facts.push({
        documentId: fact.documentId,
        extractionFactId: fact.extractionFactId,
        attribute: fact.attribute,
        valueAsWritten: fact.valueAsWritten,
        pageNumbers: fact.pageNumbers,
      });
    }
  });
  const leftover = facts.filter((fact) => !assigned.has(factKey(fact.documentId, fact.extractionFactId)));
  while (leftover.length > 0) {
    drafts.push({
      fields: [],
      relationships: [],
      facts: leftover.splice(0, MAPPING_WINDOW_LIMITS.maxFacts).map((fact) => ({
        documentId: fact.documentId,
        extractionFactId: fact.extractionFactId,
        attribute: fact.attribute,
        valueAsWritten: fact.valueAsWritten,
        pageNumbers: fact.pageNumbers,
      })),
    });
  }
  return drafts.map((draft, index) => ({ ...draft, index, count: drafts.length }));
}

export function renderMappingWindow(window: MappingWindow): Record<string, unknown> {
  return {
    schema: MAPPING_WINDOW_SCHEMA,
    windowIndex: window.index,
    windowCount: window.count,
    instruction: "Propose field and relationship mappings for this subset only. Copy values exactly. Do not state findings, calculations, or legal conclusions.",
    fields: window.fields,
    relationships: window.relationships,
    facts: window.facts,
  };
}

export class DomainMappingLedger {
  private readonly facts: Map<string, LocatedFact>;
  private readonly fields: Map<string, CatalogField>;
  private readonly relationships: Map<string, CatalogRelationship>;
  private readonly calls = new Map<string, { name: string; arguments: string; result: ToolResult }>();
  private readonly usedFacts = new Set<string>();
  private readonly instances = new Map<string, string>();
  private readonly rejectionCountsByCode = new Map<string, number>();
  private readonly turnRejectionCounts = new Map<string, number>();
  private readonly acceptedFields: FieldRow[] = [];
  private readonly acceptedRelationships: RelationshipRow[] = [];
  private readonly unverifiable = new Set<string>();
  private toolCallCount = 0;
  private invalidCallCount = 0;
  private invalidBudgetCount = 0;
  private inTurn = false;
  private turnHasRejection = false;
  private done = false;

  constructor(
    private readonly runId: string,
    pack: CompiledDomainPack,
    extractions: readonly DocExtraction[],
    private readonly pages: readonly AuthorizedDocument[] = [],
  ) {
    const catalog = catalogFrom(pack);
    this.fields = catalog.fields;
    this.relationships = catalog.relationships;
    this.facts = indexFacts(extractions);
  }

  get finished(): boolean {
    return this.done;
  }

  get toolCalls(): number {
    return this.toolCallCount;
  }

  get invalidCalls(): number {
    return this.invalidCallCount;
  }

  get invalidBudgetUsed(): number {
    return this.invalidBudgetCount;
  }

  get acceptedFieldCount(): number {
    return this.acceptedFields.length;
  }

  /** Extraction facts whose saved quotation cannot be verified. A model citation is not one of these. */
  get unverifiableFactCount(): number {
    return this.unverifiable.size;
  }

  unverifiableFactIds(): string[] {
    return [...this.unverifiable].map((key) => {
      const splitAt = key.lastIndexOf("\0");
      return `${key.slice(0, splitAt)}/${key.slice(splitAt + 1)}`;
    }).sort();
  }

  /** Accepted rows before finish. The investigation loop uses these to check later proposals. */
  acceptedMappings(): FieldRow[] {
    return this.acceptedFields.map((row) => ({ ...row }));
  }

  get rejectionCounts(): Record<string, number> {
    return Object.fromEntries(this.rejectionCountsByCode);
  }

  get lastTurnRejectionCounts(): Record<string, number> {
    return Object.fromEntries(this.turnRejectionCounts);
  }

  beginTurn(): void {
    this.inTurn = true;
    this.turnHasRejection = false;
    this.turnRejectionCounts.clear();
  }

  noteInvalidTurn(): void {
    this.inTurn = false;
    this.turnHasRejection = true;
    this.turnRejectionCounts.clear();
    this.invalidCallCount += 1;
    this.invalidBudgetCount += 1;
    this.rejectionCountsByCode.set("no_tool_call", (this.rejectionCountsByCode.get("no_tool_call") ?? 0) + 1);
    this.turnRejectionCounts.set("no_tool_call", 1);
  }

  decline(call: StudyAgentToolCall, code: MappingRejectionCode, message: string): ToolResult {
    this.toolCallCount += 1;
    if (!this.done) this.recordRejection(code);
    return { toolCallId: call.id, ok: false, content: JSON.stringify({ ok: false, error: code, message }) };
  }

  execute(call: StudyAgentToolCall): ToolResult {
    const key = `${this.runId.toLowerCase()}:${call.id}`;
    const previous = this.calls.get(key);
    if (previous) {
      if (previous.name === call.name && previous.arguments === call.arguments) return previous.result;
      return this.decline(call, "tool_call_conflict", "This tool call id was already used for a different call.");
    }
    this.toolCallCount += 1;
    let result: ToolResult;
    try {
      if (this.done) refuse("mapping_finished", "Mapping is already finished.");
      const args = this.parse(call);
      const content = JSON.stringify({ ok: true, ...this.dispatch(call.name as MappingAgentToolName, args) });
      result = { toolCallId: call.id, ok: true, content };
    } catch (error) {
      if (!(error instanceof MappingRejection)) throw error;
      if (!this.done) this.recordRejection(error.code);
      result = { toolCallId: call.id, ok: false, content: JSON.stringify({ ok: false, error: error.code, message: error.message }) };
    }
    this.calls.set(key, { name: call.name, arguments: call.arguments, result });
    return result;
  }

  draft(): { schema: typeof FIELD_MAPPING_PROPOSAL_SCHEMA; mappings: FieldRow[]; relationships: RelationshipRow[] } {
    return {
      schema: FIELD_MAPPING_PROPOSAL_SCHEMA,
      mappings: this.acceptedFields.map((row) => ({ ...row })),
      relationships: this.acceptedRelationships.map((row) => ({ ...row })),
    };
  }

  assemble(): { schema: typeof FIELD_MAPPING_PROPOSAL_SCHEMA; mappings: FieldRow[]; relationships: RelationshipRow[] } | null {
    if (!this.done) return null;
    return this.draft();
  }

  private recordRejection(code: string): void {
    const safe = REJECTION_CODES.has(code) ? code : "invalid_arguments";
    this.invalidCallCount += 1;
    this.rejectionCountsByCode.set(safe, (this.rejectionCountsByCode.get(safe) ?? 0) + 1);
    this.turnRejectionCounts.set(safe, (this.turnRejectionCounts.get(safe) ?? 0) + 1);
    if (this.inTurn) {
      if (!this.turnHasRejection) {
        this.turnHasRejection = true;
        this.invalidBudgetCount += 1;
      }
    } else this.invalidBudgetCount += 1;
  }

  private parse(call: StudyAgentToolCall): ObjectMap {
    if (!(MAPPING_AGENT_TOOL_NAMES as readonly string[]).includes(call.name)) refuse("unknown_tool", "There is no mapping tool with that name.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.arguments || "{}");
    } catch {
      refuse("invalid_arguments", "The arguments are not valid JSON.");
    }
    if (!isObject(parsed)) refuse("invalid_arguments", "The arguments must be an object.");
    return parsed;
  }

  private dispatch(name: MappingAgentToolName, args: ObjectMap): Record<string, unknown> {
    if (name === "propose_field") return this.proposeField(args);
    if (name === "propose_relationship") return this.proposeRelationship(args);
    return this.finish(args);
  }

  private refuseUnverifiable(documentId: string, extractionFactId: string, message: string): never {
    this.unverifiable.add(factKey(documentId, extractionFactId));
    refuse("unauthorized_evidence", message);
  }

  private located(documentId: string, extractionFactId: string): LocatedFact {
    const located = this.facts.get(factKey(documentId, extractionFactId));
    if (!located || located.documentId !== documentId) refuse("unknown_fact", "That fact is not in the authorized extraction.");
    if (located.fact.evidence.length === 0 || located.fact.evidence.some((item) => item.quote.trim() === "")) {
      this.refuseUnverifiable(documentId, extractionFactId, `The saved extraction has no quotation for ${extractionFactId}. Leave it unmapped and do not propose it again.`);
    }
    for (const item of located.fact.evidence) {
      if (this.pages.length > 0 && !quoteOnAuthorizedPage(this.pages, documentId, item.page, item.quote)) {
        this.refuseUnverifiable(documentId, extractionFactId, `The saved extraction quotation for ${extractionFactId} is not on the authorized page. Leave it unmapped and do not propose it again.`);
      }
    }
    return located;
  }

  private assertInstance(instanceId: string, entityId: string): void {
    const bound = this.instances.get(instanceId);
    if (bound && bound !== entityId) refuse("instance_entity_conflict", "That instance id is already used for another entity.");
  }

  private claimFact(documentId: string, extractionFactId: string): void {
    const key = factKey(documentId, extractionFactId);
    if (this.usedFacts.has(key)) refuse("duplicate_fact", "That fact was already mapped. Reuse its fact id and do not map it again.");
    this.usedFacts.add(key);
  }

  private sameField(existing: FieldRow, proposed: { entityId: string; instanceId: string; fieldId: string; valueType: FieldValueType; value: string }): boolean {
    return existing.entityId === proposed.entityId
      && existing.instanceId === proposed.instanceId
      && existing.fieldId === proposed.fieldId
      && existing.valueType === proposed.valueType
      && existing.value === proposed.value;
  }

  private proposeField(args: ObjectMap): Record<string, unknown> {
    if (!exactKeys(args, FIELD_KEYS)) refuse("invalid_arguments", "The field proposal has unexpected arguments.");
    const documentId = identifier(args.documentId);
    const extractionFactId = identifier(args.extractionFactId);
    const entityId = identifier(args.entityId);
    const instanceId = identifier(args.instanceId);
    const fieldId = identifier(args.fieldId);
    const valueType = typeof args.valueType === "string" && VALUE_TYPES.has(args.valueType as FieldValueType)
      ? args.valueType as FieldValueType
      : null;
    if (!documentId || !extractionFactId || !entityId || !instanceId || !fieldId || !valueType || typeof args.value !== "string") {
      refuse("invalid_arguments", "The field proposal is missing a required id or value.");
    }
    const catalog = this.fields.get(`${entityId}\0${fieldId}`);
    if (!catalog) refuse("unknown_catalog_id", "That field is not in the catalog.");
    const located = this.located(documentId, extractionFactId);
    if (catalog.valueType !== valueType || !valueAlreadyWritten(valueType, located.fact.valueAsWritten, args.value)) {
      refuse("invented_value", "The value must be the source-written value and the catalog type.");
    }
    if (!located.fact.evidence.some((item) => phraseInQuote(item.quote, located.fact.valueAsWritten))) {
      this.refuseUnverifiable(documentId, extractionFactId, `The written value is not in the saved extraction quotation for ${extractionFactId}. Leave it unmapped and do not propose it again.`);
    }
    this.assertInstance(instanceId, entityId);
    const existing = this.acceptedFields.find((row) => row.documentId === documentId && row.extractionFactId === extractionFactId);
    if (existing) {
      if (this.sameField(existing, { entityId, instanceId, fieldId, valueType, value: located.fact.valueAsWritten })) {
        return { kind: "field", extractionFactId, fieldId, reused: true };
      }
      refuse("duplicate_fact", "That fact was already mapped. Reuse its fact id and do not map it again.");
    }
    this.claimFact(documentId, extractionFactId);
    this.instances.set(instanceId, entityId);
    this.acceptedFields.push({
      documentId,
      extractionFactId,
      entityId,
      instanceId,
      fieldId,
      valueType,
      value: located.fact.valueAsWritten,
    });
    return { kind: "field", extractionFactId, fieldId };
  }

  private proposeRelationship(args: ObjectMap): Record<string, unknown> {
    if (!exactKeys(args, RELATIONSHIP_KEYS)) refuse("invalid_arguments", "The relationship proposal has unexpected arguments.");
    const documentId = identifier(args.documentId);
    const extractionFactId = identifier(args.extractionFactId);
    const relationshipId = identifier(args.relationshipId);
    const fromInstanceId = identifier(args.fromInstanceId);
    const toInstanceId = identifier(args.toInstanceId);
    if (!documentId || !extractionFactId || !relationshipId || !fromInstanceId || !toInstanceId) {
      refuse("invalid_arguments", "The relationship proposal is missing a required id.");
    }
    const catalog = this.relationships.get(relationshipId);
    if (!catalog) refuse("unknown_catalog_id", "That relationship is not in the catalog.");
    this.located(documentId, extractionFactId);
    if (fromInstanceId === toInstanceId && catalog.fromEntityId !== catalog.toEntityId) {
      refuse("instance_entity_conflict", "That instance id is already used for another entity.");
    }
    this.assertInstance(fromInstanceId, catalog.fromEntityId);
    this.assertInstance(toInstanceId, catalog.toEntityId);
    const existing = this.acceptedRelationships.find((row) => row.documentId === documentId && row.extractionFactId === extractionFactId);
    if (existing) {
      if (existing.relationshipId === relationshipId && existing.fromInstanceId === fromInstanceId && existing.toInstanceId === toInstanceId) {
        return { kind: "relationship", extractionFactId, relationshipId, reused: true };
      }
      refuse("duplicate_fact", "That fact was already mapped. Reuse its fact id and do not map it again.");
    }
    this.claimFact(documentId, extractionFactId);
    this.instances.set(fromInstanceId, catalog.fromEntityId);
    this.instances.set(toInstanceId, catalog.toEntityId);
    this.acceptedRelationships.push({ documentId, extractionFactId, relationshipId, fromInstanceId, toInstanceId });
    return { kind: "relationship", extractionFactId, relationshipId };
  }

  private finish(args: ObjectMap): Record<string, unknown> {
    if (!exactKeys(args, ["ready"]) || args.ready !== true) refuse("invalid_arguments", "finish_mapping requires ready true.");
    if (this.acceptedFields.length === 0) refuse("mapping_incomplete", "Mapping has no accepted field.");
    this.done = true;
    return { kind: "finished", fields: this.acceptedFields.length, relationships: this.acceptedRelationships.length };
  }
}
