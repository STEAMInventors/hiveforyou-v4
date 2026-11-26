/**
 * One pinned-rebuild investigation ledger.
 * The model may read bounded pages and propose mappings, roles, measurements, assessments,
 * open determinations, conflicts, gaps, and answers. This ledger admits a factual proposal
 * only when the catalog id, extraction fact, and written value already exist.
 * It does not compute a day count, a checklist verdict, or a canonical study.
 */
import type { StudyAgentToolCall } from "../analysis/study-agent";
import type { AuthorizedDocument } from "./domain-investigation-binder";
import type { DomainInvestigationPlan } from "./domain-investigation-plan";
import {
  DomainMappingLedger,
  type MappingWindow,
  selectMappingWindows,
} from "./domain-mapping-agent";
import type { CompiledDomainPack } from "./domain-pack-source";
import type { DocExtraction } from "./extraction-contracts";
import { normalizeQuoteText } from "./verify-quotes";

export { DOMAIN_INVESTIGATION_PROMPT_ID } from "./domain-investigation-prompt";
export const INVESTIGATION_WINDOW_SCHEMA = "hive.field-mapping-window/1" as const;

export const INVESTIGATION_AGENT_TOOL_NAMES = [
  "search_case",
  "read_pages",
  "propose_field",
  "propose_relationship",
  "propose_document_role",
  "propose_measurement",
  "propose_assessment",
  "propose_determination",
  "propose_conflict",
  "propose_gap",
  "propose_answer",
  "finish_investigation",
] as const;
export type InvestigationAgentToolName = (typeof INVESTIGATION_AGENT_TOOL_NAMES)[number];

export const INVESTIGATION_REJECTION_CODES = [
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
  "quote_not_on_page",
  "unknown_question",
  "page_not_authorized",
] as const;
export type InvestigationRejectionCode = (typeof INVESTIGATION_REJECTION_CODES)[number];

const REJECTION_CODES = new Set<string>(INVESTIGATION_REJECTION_CODES);
const TOOL_NAMES = new Set<string>(INVESTIGATION_AGENT_TOOL_NAMES);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ROLES = new Set(["ANCHOR", "SUPPORTING", "REFERENCE"]);
const MEASUREMENT_ROLES = new Set(["BASELINE", "TARGET", "ACTUAL"]);
const AUDIENCES = new Set(["customer", "professional", "all"]);
const GAP_KINDS = new Set(["MISSING_DOCUMENT", "MISSING_INFORMATION"]);
const CLOSED_LEGAL = /\b(violation|illegal|the school must|the agency must)\b/i;

export type InvestigationAgentToolDefinition = {
  type: "function";
  function: { name: InvestigationAgentToolName; description: string; parameters: Record<string, unknown> };
};

const str = (description: string, maxLength = 128) => ({ type: "string", description, maxLength });
const closed = (properties: Record<string, unknown>, required: readonly string[]) => ({
  type: "object",
  properties,
  required: [...required],
  additionalProperties: false,
});

export const INVESTIGATION_AGENT_TOOLS: readonly InvestigationAgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_case",
      description: "Find short snippets on authorized pages. A snippet is not evidence and cannot be quoted as a fact.",
      parameters: closed({ query: str("Words to find.", 200), documentId: str("Optional document id.") }, ["query"]),
    },
  },
  {
    type: "function",
    function: {
      name: "read_pages",
      description: "Read up to three authorized pages from one document.",
      parameters: closed(
        {
          documentId: str("Document id from the manifest."),
          startPage: { type: "integer", minimum: 1 },
          endPage: { type: "integer", minimum: 1 },
        },
        ["documentId", "startPage", "endPage"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "propose_field",
      description: "Propose one extracted fact as the written value of one catalog field. Copy the value exactly.",
      parameters: closed(
        {
          documentId: str("Document id of the fact."),
          extractionFactId: str("Fact id from the window."),
          entityId: str("Entity id from the window."),
          instanceId: str("Instance id you are grouping."),
          fieldId: str("Field id from the window."),
          valueType: { type: "string", enum: ["TEXT", "NUMBER", "DATE", "BOOLEAN", "MONEY", "QUANTITY"] },
          value: str("The fact's value as written. Do not convert it.", 2000),
        },
        ["documentId", "extractionFactId", "entityId", "instanceId", "fieldId", "valueType", "value"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "propose_relationship",
      description: "Offer one extracted fact as evidence for one catalog relationship. Do not conclude that it holds.",
      parameters: closed(
        {
          documentId: str("Document id of the fact."),
          extractionFactId: str("Fact id from the window."),
          relationshipId: str("Relationship id from the window."),
          fromInstanceId: str("Instance id for the from entity."),
          toInstanceId: str("Instance id for the to entity."),
        },
        ["documentId", "extractionFactId", "relationshipId", "fromInstanceId", "toInstanceId"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "propose_document_role",
      description: "Propose ANCHOR, SUPPORTING, or REFERENCE for one document, with a quote from that document.",
      parameters: closed(
        {
          documentId: str("Document id."),
          role: { type: "string", enum: ["ANCHOR", "SUPPORTING", "REFERENCE"] },
          page: { type: "integer", minimum: 1 },
          quote: str("Contiguous quote from that page.", 500),
        },
        ["documentId", "role", "page", "quote"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "propose_measurement",
      description: "Label an already accepted numeric fact as BASELINE, TARGET, or ACTUAL. The field name must say the same role.",
      parameters: closed(
        {
          documentId: str("Document id."),
          extractionFactId: str("Accepted fact id."),
          role: { type: "string", enum: ["BASELINE", "TARGET", "ACTUAL"] },
        },
        ["documentId", "extractionFactId", "role"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "propose_assessment",
      description: "Propose an evidence-backed analytical statement. Cite accepted fact ids. Do not state a legal conclusion.",
      parameters: closed(
        {
          statement: str("The analytical statement.", 500),
          factIds: { type: "array", items: str("Accepted fact id."), maxItems: 8 },
        },
        ["statement", "factIds"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "propose_determination",
      description: "Record a question a professional still has to decide. It stays open and is not a finding.",
      parameters: closed({ statement: str("The open question.", 500) }, ["statement"]),
    },
  },
  {
    type: "function",
    function: {
      name: "propose_conflict",
      description: "Propose that two accepted facts disagree. Hive publishes it only when they are different values of the same field.",
      parameters: closed(
        {
          statement: str("What disagrees.", 500),
          factIds: { type: "array", items: str("Fact id."), minItems: 2, maxItems: 4 },
        },
        ["statement", "factIds"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "propose_gap",
      description: "Propose a missing named record, or missing information on a record that is already present.",
      parameters: closed(
        {
          kind: { type: "string", enum: ["MISSING_DOCUMENT", "MISSING_INFORMATION"] },
          statement: str("What is missing.", 500),
          documentKindId: str("Catalog document id, when the gap is a missing record."),
          entityId: str("Entity id, when a field on a present record is blank."),
          fieldId: str("Field id, when a field on a present record is blank."),
        },
        ["kind", "statement"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "propose_answer",
      description: "Answer one catalog question, or one question from the person's request that is not in the catalog.",
      parameters: closed(
        {
          questionId: str("Catalog question id, or intent:<n> for a question in the request."),
          audience: { type: "string", enum: ["customer", "professional", "all"] },
          factIds: { type: "array", items: str("Accepted fact id."), maxItems: 8 },
          uncertainty: str("Say what the pages do not settle. Empty when the facts answer it.", 300),
        },
        ["questionId", "audience", "factIds"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "finish_investigation",
      description: "Finish after the windows are investigated. Requires at least one accepted field.",
      parameters: closed({ ready: { type: "boolean", description: "True when investigation should stop." } }, ["ready"]),
    },
  },
];

export type DocumentRoleProposal = {
  documentId: string;
  role: "ANCHOR" | "SUPPORTING" | "REFERENCE";
  page: number;
  quote: string;
};
export type MeasurementProposal = {
  documentId: string;
  extractionFactId: string;
  role: "BASELINE" | "TARGET" | "ACTUAL";
};
export type AssessmentProposal = { statement: string; factIds: string[] };
export type DeterminationProposal = { statement: string };
export type ConflictProposal = { statement: string; factIds: string[] };
export type GapProposal = {
  kind: "MISSING_DOCUMENT" | "MISSING_INFORMATION";
  statement: string;
  documentKindId?: string;
  entityId?: string;
  fieldId?: string;
};
export type AnswerProposal = {
  questionId: string;
  audience: "customer" | "professional" | "all";
  factIds: string[];
  uncertainty?: string;
};

export type CoordinatedInvestigationRecord = {
  intentText: string;
  documentRoles: DocumentRoleProposal[];
  measurements: MeasurementProposal[];
  assessments: AssessmentProposal[];
  determinations: DeterminationProposal[];
  conflicts: ConflictProposal[];
  gaps: GapProposal[];
  answers: AnswerProposal[];
};

type ObjectMap = Record<string, unknown>;
type ToolResult = { toolCallId: string; ok: boolean; content: string };

const isObject = (value: unknown): value is ObjectMap => !!value && typeof value === "object" && !Array.isArray(value);

class InvestigationRejection extends Error {
  constructor(readonly code: InvestigationRejectionCode, message: string) {
    super(message);
  }
}

function refuse(code: InvestigationRejectionCode, message: string): never {
  throw new InvestigationRejection(code, message);
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

export function formatInvestigationRejectionSummary(counts: Readonly<Record<string, number>> | null | undefined): string | null {
  if (!counts) return null;
  const entries = Object.entries(counts)
    .filter(([code, count]) => REJECTION_CODES.has(code) && Number.isInteger(count) && count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (entries.length === 0) return null;
  return entries.map(([code, count]) => `${code}:${Math.min(9999, count)}`).join(",").slice(0, 120);
}

export function measurementRoleForField(entityLabel: string, fieldId: string): MeasurementProposal["role"] | null {
  const field = fieldId.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  if (/\bbaseline\b/.test(field)) return "BASELINE";
  if (/\btarget\b/.test(field)) return "TARGET";
  if (/\b(actual|observed|measured)\b/.test(field)) return "ACTUAL";
  if (/\bprogress\b/.test(entityLabel.toLowerCase()) && /\bvalue\b/.test(field)) return "ACTUAL";
  return null;
}

type CatalogSlice = {
  questions: { id: string; audience: string; text: string }[];
  checks: { id: string; label: string }[];
  documents: { id: string; label: string; aliases: string[] }[];
  personas: { id: string; audience: string; questionIds: string[] }[];
};

function catalogSlice(pack: CompiledDomainPack): CatalogSlice {
  const questions = pack.definitions.flatMap((definition) =>
    definition.kind === "question" ? [{ id: definition.id, audience: definition.audience, text: definition.text }] : []);
  const checks = pack.definitions.flatMap((definition) =>
    definition.kind === "check" ? [{ id: definition.id, label: definition.label }] : []);
  const documents = pack.definitions.flatMap((definition) =>
    definition.kind === "document" ? [{ id: definition.id, label: definition.label, aliases: definition.aliases }] : []);
  const personas = pack.definitions.flatMap((definition) =>
    definition.kind === "persona" ? [{ id: definition.id, audience: definition.audience, questionIds: definition.questionIds }] : []);
  return { questions, checks, documents, personas };
}

export type InvestigationWindow = MappingWindow & { readonly slice: CatalogSlice };

/** Mapping windows plus a rotating slice of questions, checks, document kinds, and personas. */
export function selectInvestigationWindows(input: {
  plan: Pick<DomainInvestigationPlan, "tasks">;
  pack: CompiledDomainPack;
  extractions: readonly DocExtraction[];
}): InvestigationWindow[] {
  const slice = catalogSlice(input.pack);
  const windows = selectMappingWindows(input);
  const count = Math.max(windows.length, 1);
  return windows.map((window) => ({ ...window, count, slice }));
}

export function renderInvestigationWindow(input: {
  window: InvestigationWindow;
  extractions: readonly DocExtraction[];
  intentText: string;
}): Record<string, unknown> {
  const { window, extractions, intentText } = input;
  const start = window.index;
  const questions = window.slice.questions.slice(start * 8, start * 8 + 8).map((item) => ({
    id: item.id,
    audience: item.audience,
    question: item.text,
  }));
  const checks = window.slice.checks.slice(start * 8, start * 8 + 8).map((check) => ({ id: check.id, label: check.label }));
  const documents = window.slice.documents.slice(start * 8, start * 8 + 8);
  const manifest = [...extractions]
    .sort((left, right) => left.documentId.localeCompare(right.documentId))
    .map((extraction) => ({
      documentId: extraction.documentId,
      fileName: extraction.fileName,
      documentType: extraction.document.documentType,
      pageCount: extraction.coverage.pageCount,
    }));
  return {
    schema: INVESTIGATION_WINDOW_SCHEMA,
    windowIndex: window.index,
    windowCount: window.count,
    instruction: "Investigate this subset. Copy written values exactly. Read pages before quoting them. Do not state a legal conclusion or a progress result without a later measurement.",
    ...(window.index === 0 ? { intent: intentText.slice(0, 2000), personas: window.slice.personas.slice(0, 6) } : {}),
    manifest,
    questions,
    checks,
    documentKinds: documents,
    fields: window.fields,
    relationships: window.relationships,
    facts: window.facts,
  };
}

function quoteOnPage(pages: readonly AuthorizedDocument[], documentId: string, pageNumber: number, quote: string): boolean {
  const document = pages.find((item) => item.documentId === documentId);
  const page = document?.pages.find((item) => item.pageNumber === pageNumber);
  if (!page) return false;
  const needle = normalizeQuoteText(quote);
  return needle.length > 0 && normalizeQuoteText(page.text).includes(needle);
}

export class CoordinatedInvestigationLedger {
  private readonly mapping: DomainMappingLedger;
  private readonly calls = new Map<string, { name: string; arguments: string; result: ToolResult }>();
  private readonly rejectionCountsByCode = new Map<string, number>();
  private readonly turnRejectionCounts = new Map<string, number>();
  private readonly documentRoles: DocumentRoleProposal[] = [];
  private readonly measurements: MeasurementProposal[] = [];
  private readonly assessments: AssessmentProposal[] = [];
  private readonly determinations: DeterminationProposal[] = [];
  private readonly conflicts: ConflictProposal[] = [];
  private readonly gaps: GapProposal[] = [];
  private readonly answers: AnswerProposal[] = [];
  private toolCallCount = 0;
  private invalidCallCount = 0;
  private invalidBudgetCount = 0;
  private inTurn = false;
  private turnHasRejection = false;
  private readonly questionIds: Set<string>;
  private readonly fieldRoles: Map<string, MeasurementProposal["role"] | null>;

  constructor(
    runId: string,
    private readonly pack: CompiledDomainPack,
    extractions: readonly DocExtraction[],
    private readonly pages: readonly AuthorizedDocument[],
    private readonly intentText: string,
  ) {
    this.mapping = new DomainMappingLedger(runId, pack, extractions, pages);
    this.questionIds = new Set(pack.definitions.flatMap((definition) => definition.kind === "question" ? [definition.id] : []));
    this.fieldRoles = new Map();
    for (const definition of pack.definitions) {
      if (definition.kind !== "entity") continue;
      for (const field of definition.fields) {
        this.fieldRoles.set(`${definition.id}\0${field.id}`, measurementRoleForField(definition.label, field.id));
      }
    }
  }

  get finished(): boolean {
    return this.mapping.finished;
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
    return this.mapping.acceptedFieldCount;
  }

  get lastTurnRejectionCounts(): Record<string, number> {
    return Object.fromEntries(this.turnRejectionCounts);
  }

  beginTurn(): void {
    this.inTurn = true;
    this.turnHasRejection = false;
    this.turnRejectionCounts.clear();
    this.mapping.beginTurn();
  }

  noteInvalidTurn(): void {
    this.inTurn = false;
    this.turnHasRejection = true;
    this.turnRejectionCounts.clear();
    this.invalidCallCount += 1;
    this.invalidBudgetCount += 1;
    this.rejectionCountsByCode.set("no_tool_call", (this.rejectionCountsByCode.get("no_tool_call") ?? 0) + 1);
    this.turnRejectionCounts.set("no_tool_call", 1);
    this.mapping.noteInvalidTurn();
  }

  decline(call: StudyAgentToolCall, code: InvestigationRejectionCode, message: string): ToolResult {
    this.toolCallCount += 1;
    if (!this.finished) this.recordRejection(code);
    return { toolCallId: call.id, ok: false, content: JSON.stringify({ ok: false, error: code, message }) };
  }

  execute(call: StudyAgentToolCall): ToolResult {
    const key = call.id;
    const previous = this.calls.get(key);
    if (previous) {
      if (previous.name === call.name && previous.arguments === call.arguments) return previous.result;
      return this.decline(call, "tool_call_conflict", "This tool call id was already used for a different call.");
    }
    this.toolCallCount += 1;
    let result: ToolResult;
    try {
      if (this.finished) refuse("mapping_finished", "Investigation is already finished.");
      if (!TOOL_NAMES.has(call.name)) refuse("unknown_tool", "There is no investigation tool with that name.");
      if (call.name === "propose_field" || call.name === "propose_relationship") {
        const mapped = this.mapping.execute(call);
        if (!mapped.ok) {
          const parsed = JSON.parse(mapped.content) as { error?: string };
          if (parsed.error) this.recordRejection(parsed.error);
        }
        result = mapped;
      } else {
        const args = this.parse(call.arguments || "{}");
        const content = JSON.stringify({ ok: true, ...this.dispatch(call.name as InvestigationAgentToolName, args) });
        result = { toolCallId: call.id, ok: true, content };
      }
    } catch (error) {
      if (!(error instanceof InvestigationRejection)) throw error;
      if (!this.finished) this.recordRejection(error.code);
      result = { toolCallId: call.id, ok: false, content: JSON.stringify({ ok: false, error: error.code, message: error.message }) };
    }
    this.calls.set(key, { name: call.name, arguments: call.arguments, result });
    return result;
  }

  assemble(): { proposal: NonNullable<ReturnType<DomainMappingLedger["assemble"]>>; record: CoordinatedInvestigationRecord } | null {
    const proposal = this.mapping.assemble();
    if (!proposal) return null;
    return {
      proposal,
      record: {
        intentText: this.intentText,
        documentRoles: this.documentRoles.map((row) => ({ ...row })),
        measurements: this.measurements.map((row) => ({ ...row })),
        assessments: this.assessments.map((row) => ({ ...row, factIds: [...row.factIds] })),
        determinations: this.determinations.map((row) => ({ ...row })),
        conflicts: this.conflicts.map((row) => ({ ...row, factIds: [...row.factIds] })),
        gaps: this.gaps.map((row) => ({ ...row })),
        answers: this.answers.map((row) => ({ ...row, factIds: [...row.factIds] })),
      },
    };
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

  private parse(raw: string): ObjectMap {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      refuse("invalid_arguments", "The arguments are not valid JSON.");
    }
    if (!isObject(parsed)) refuse("invalid_arguments", "The arguments must be an object.");
    return parsed;
  }

  private dispatch(name: InvestigationAgentToolName, args: ObjectMap): Record<string, unknown> {
    if (name === "search_case") return this.searchCase(args);
    if (name === "read_pages") return this.readPages(args);
    if (name === "propose_document_role") return this.proposeDocumentRole(args);
    if (name === "propose_measurement") return this.proposeMeasurement(args);
    if (name === "propose_assessment") return this.proposeAssessment(args);
    if (name === "propose_determination") return this.proposeDetermination(args);
    if (name === "propose_conflict") return this.proposeConflict(args);
    if (name === "propose_gap") return this.proposeGap(args);
    if (name === "propose_answer") return this.proposeAnswer(args);
    if (name === "finish_investigation") return this.finish(args);
    refuse("unknown_tool", "There is no investigation tool with that name.");
  }

  private searchCase(args: ObjectMap): Record<string, unknown> {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (query.length < 2) refuse("invalid_arguments", "The search needs at least two characters.");
    const documentId = args.documentId === undefined ? null : identifier(args.documentId);
    if (args.documentId !== undefined && !documentId) refuse("invalid_arguments", "The document id is not valid.");
    const needle = normalizeQuoteText(query);
    const hits: { documentId: string; page: number; snippet: string }[] = [];
    for (const document of this.pages) {
      if (documentId && document.documentId !== documentId) continue;
      for (const page of document.pages) {
        const text = page.text;
        const index = normalizeQuoteText(text).indexOf(needle);
        if (index < 0) continue;
        const start = Math.max(0, index - 40);
        hits.push({
          documentId: document.documentId,
          page: page.pageNumber,
          snippet: text.slice(start, start + 180),
        });
        if (hits.length >= 8) return { kind: "search", hits, evidence: false };
      }
    }
    return { kind: "search", hits, evidence: false };
  }

  private readPages(args: ObjectMap): Record<string, unknown> {
    const documentId = identifier(args.documentId);
    const startPage = args.startPage;
    const endPage = args.endPage;
    if (!documentId || typeof startPage !== "number" || typeof endPage !== "number" || !Number.isInteger(startPage) || !Number.isInteger(endPage)) {
      refuse("invalid_arguments", "The page read is missing a document or a page number.");
    }
    if (endPage < startPage || endPage - startPage > 2) refuse("invalid_arguments", "Read at most three pages at a time.");
    const document = this.pages.find((item) => item.documentId === documentId);
    if (!document) refuse("page_not_authorized", "That document is not in the authorized corpus.");
    const pages = [];
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      const page = document.pages.find((item) => item.pageNumber === pageNumber);
      if (!page) refuse("page_not_authorized", "That page is not in the authorized corpus.");
      pages.push({ page: pageNumber, text: page.text });
    }
    return { kind: "pages", documentId, pages };
  }

  private proposeDocumentRole(args: ObjectMap): Record<string, unknown> {
    const documentId = identifier(args.documentId);
    const role = typeof args.role === "string" ? args.role : "";
    const page = args.page;
    const quote = typeof args.quote === "string" ? args.quote.trim() : "";
    if (!documentId || !ROLES.has(role) || typeof page !== "number" || !Number.isInteger(page) || quote.length === 0) {
      refuse("invalid_arguments", "The document role is missing a document, role, page, or quote.");
    }
    if (!quoteOnPage(this.pages, documentId, page, quote)) refuse("quote_not_on_page", "That quote is not on the authorized page.");
    const proposal = { documentId, role: role as DocumentRoleProposal["role"], page, quote };
    const existing = this.documentRoles.findIndex((item) => item.documentId === documentId);
    if (existing >= 0) this.documentRoles[existing] = proposal;
    else this.documentRoles.push(proposal);
    return { kind: "document_role", documentId, role };
  }

  private proposeMeasurement(args: ObjectMap): Record<string, unknown> {
    const documentId = identifier(args.documentId);
    const extractionFactId = identifier(args.extractionFactId);
    const role = typeof args.role === "string" ? args.role : "";
    if (!documentId || !extractionFactId || !MEASUREMENT_ROLES.has(role)) {
      refuse("invalid_arguments", "The measurement is missing a fact or a role.");
    }
    const mapped = this.mapping.acceptedMappings().find((row) => row.documentId === documentId && row.extractionFactId === extractionFactId);
    if (!mapped) refuse("unknown_fact", "Accept the field before labeling its measurement role.");
    const expected = this.fieldRoles.get(`${mapped.entityId}\0${mapped.fieldId}`);
    if (expected !== role) refuse("invalid_arguments", "That field does not use this measurement role.");
    const proposal = { documentId, extractionFactId, role: role as MeasurementProposal["role"] };
    const existing = this.measurements.findIndex((item) => item.documentId === documentId && item.extractionFactId === extractionFactId);
    if (existing >= 0) this.measurements[existing] = proposal;
    else this.measurements.push(proposal);
    return { kind: "measurement", extractionFactId, role };
  }

  private factIsKnown(id: string): boolean {
    return this.mapping.acceptedMappings().some((row) => row.extractionFactId === id);
  }

  private factIds(value: unknown, requireAccepted: boolean): string[] {
    if (!Array.isArray(value)) refuse("invalid_arguments", "Fact ids must be a list.");
    const ids = value.map((item) => identifier(item));
    if (ids.some((id) => !id)) refuse("invalid_arguments", "A fact id is not valid.");
    const unique = [...new Set(ids as string[])];
    if (requireAccepted && unique.some((id) => !this.factIsKnown(id))) refuse("unknown_fact", "Cite a fact that was already accepted.");
    return unique;
  }

  private proposeAssessment(args: ObjectMap): Record<string, unknown> {
    const statement = typeof args.statement === "string" ? args.statement.trim() : "";
    if (statement.length === 0 || CLOSED_LEGAL.test(statement)) refuse("invalid_arguments", "An assessment cannot state a legal conclusion.");
    const factIds = this.factIds(args.factIds, true);
    if (factIds.length === 0) refuse("unknown_fact", "An assessment needs an accepted fact.");
    this.assessments.push({ statement, factIds });
    return { kind: "assessment", open: false };
  }

  private proposeDetermination(args: ObjectMap): Record<string, unknown> {
    const statement = typeof args.statement === "string" ? args.statement.trim() : "";
    if (statement.length === 0) refuse("invalid_arguments", "The determination needs a statement.");
    this.determinations.push({ statement: statement.replace(CLOSED_LEGAL, "a professional decision") });
    return { kind: "determination", status: "OPEN" };
  }

  private proposeConflict(args: ObjectMap): Record<string, unknown> {
    const statement = typeof args.statement === "string" ? args.statement.trim() : "";
    const factIds = this.factIds(args.factIds, true);
    if (statement.length === 0 || factIds.length < 2) refuse("invalid_arguments", "A conflict needs a statement and two facts.");
    this.conflicts.push({ statement, factIds });
    return { kind: "conflict", factIds };
  }

  private proposeGap(args: ObjectMap): Record<string, unknown> {
    const kind = typeof args.kind === "string" ? args.kind : "";
    const statement = typeof args.statement === "string" ? args.statement.trim() : "";
    if (!GAP_KINDS.has(kind) || statement.length === 0) refuse("invalid_arguments", "The gap needs a kind and a statement.");
    const documentKindId = args.documentKindId === undefined ? undefined : identifier(args.documentKindId) ?? undefined;
    const entityId = args.entityId === undefined ? undefined : identifier(args.entityId) ?? undefined;
    const fieldId = args.fieldId === undefined ? undefined : identifier(args.fieldId) ?? undefined;
    if (args.documentKindId !== undefined && !documentKindId) refuse("unknown_catalog_id", "That document kind is not valid.");
    if (documentKindId && !this.pack.definitions.some((definition) => definition.kind === "document" && definition.id === documentKindId)) {
      refuse("unknown_catalog_id", "That document kind is not in the catalog.");
    }
    this.gaps.push({ kind: kind as GapProposal["kind"], statement, documentKindId, entityId, fieldId });
    return { kind: "gap", gapKind: kind };
  }

  private proposeAnswer(args: ObjectMap): Record<string, unknown> {
    const questionId = typeof args.questionId === "string" ? args.questionId.trim() : "";
    const audience = typeof args.audience === "string" ? args.audience : "";
    if (!AUDIENCES.has(audience) || questionId.length === 0) refuse("invalid_arguments", "The answer needs a question and an audience.");
    const intentQuestion = /^intent:[1-9][0-9]{0,2}$/.test(questionId);
    if (!intentQuestion && !this.questionIds.has(questionId)) refuse("unknown_question", "That question is not in the catalog or the request.");
    const factIds = this.factIds(args.factIds, true);
    const uncertainty = typeof args.uncertainty === "string" && args.uncertainty.trim() !== "" ? args.uncertainty.trim() : undefined;
    if (factIds.length === 0 && !uncertainty) refuse("invalid_arguments", "An unanswered question must say what is uncertain.");
    this.answers.push({ questionId, audience: audience as AnswerProposal["audience"], factIds, uncertainty });
    return { kind: "answer", questionId };
  }

  private finish(args: ObjectMap): Record<string, unknown> {
    if (args.ready !== true) refuse("invalid_arguments", "finish_investigation requires ready true.");
    const done = this.mapping.execute({
      id: `finish:${this.toolCallCount}`,
      name: "finish_mapping",
      arguments: JSON.stringify({ ready: true }),
    });
    if (!done.ok) {
      const parsed = JSON.parse(done.content) as { error?: string; message?: string };
      refuse((REJECTION_CODES.has(parsed.error ?? "") ? parsed.error : "mapping_incomplete") as InvestigationRejectionCode, parsed.message ?? "Investigation is incomplete.");
    }
    return { kind: "finished", fields: this.mapping.acceptedFieldCount };
  }
}
