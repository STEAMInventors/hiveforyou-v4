/**
 * Full published-pack schedule check. Scripted tool calls only: no live model, no network.
 * The synthetic Maya corpus is the L001 fixture. Invalid extraction quotations stay unmapped.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  STUDY_AGENT_BUDGET,
  STUDY_AGENT_TURN_CONTRACT_VERSION,
  type DocExtraction,
  type DomainPackSource,
  type ExtractionFact,
} from "@hiveforyou/contracts";
import {
  acceptCanonicalInvestigation,
  prepareInvestigationStudy,
  runInvestigationStudyEngine,
  type SupplementalArtifacts,
} from "@hiveforyou/contracts/investigation";
import { extractText } from "unpdf";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { runDomainMappingInvestigation } from "./domain-mapping-investigation";

const ROOT = join(import.meta.dirname, "../../../../../");
const BAD_QUOTE = "quotation-not-on-maya-page";
const INTENT = [
  "What is the initial IEP, and when is it in effect?",
  "What did the evaluations find about reading?",
  "What goal, services, and accommodations does the IEP provide?",
  "What progress evidence is in the file, and is the plan current?",
  "What should a parent ask before a meeting?",
].join(" ");
const PROGRESS_UNCERTAINTY = "Progress is not shown by the baseline and the target. Currentness comes from the written effective period. No later measurement was found in the authorized corpus.";
const MEETING_UNCERTAINTY = "What a parent should ask before a meeting stays open.";
const OPEN_UNCERTAINTY = "Not answered from the accepted facts.";
const FILES = [
  "01_initial_referral.pdf",
  "02_evaluation_plan.pdf",
  "03_parent_evaluation_consent.pdf",
  "04_psychoeducational_evaluation.pdf",
  "05_academic_evaluation.pdf",
  "06_speech_language_evaluation.pdf",
  "07_eligibility_determination.pdf",
  "08_initial_iep.pdf",
] as const;
const INTENT_FACTS: Record<string, readonly string[]> = {
  "intent:1": ["F-iep-type", "F-start", "F-end"],
  "intent:2": ["F-accuracy", "F-speech", "F-cognitive"],
  "intent:3": ["F-goal", "F-frequency", "F-extended", "F-directions"],
};
const SEARCH_CLAIM = /\bsearch(?:ed|ing)?\b|\bnot found\b/i;

type Mapped = {
  id: string;
  file: string;
  written: string;
  entityId: string;
  instanceId: string;
  fieldId: string;
  valueType: "TEXT" | "NUMBER" | "DATE" | "QUANTITY";
};

const MAPPED: Mapped[] = [
  { id: "F-iep-type", file: "08_initial_iep.pdf", written: "Initial Individualized Education Program (IEP)", entityId: "entity:iep", instanceId: "iep-doc", fieldId: "iepType", valueType: "TEXT" },
  { id: "F-start", file: "08_initial_iep.pdf", written: "2024-11-12", entityId: "entity:iep", instanceId: "iep-doc", fieldId: "effectiveStartDate", valueType: "DATE" },
  { id: "F-end", file: "08_initial_iep.pdf", written: "2025-11-11", entityId: "entity:iep", instanceId: "iep-doc", fieldId: "effectiveEndDate", valueType: "DATE" },
  { id: "F-category", file: "08_initial_iep.pdf", written: "Specific Learning Disability (SLD) - Reading", entityId: "entity:eligibility-determination", instanceId: "elig", fieldId: "category", valueType: "TEXT" },
  { id: "F-determined", file: "08_initial_iep.pdf", written: "2024-11-01", entityId: "entity:eligibility-determination", instanceId: "elig", fieldId: "determinationDate", valueType: "DATE" },
  { id: "F-need", file: "08_initial_iep.pdf", written: "The primary educational need is Reading Fluency", entityId: "entity:present-level", instanceId: "present", fieldId: "statementText", valueType: "TEXT" },
  { id: "F-area", file: "08_initial_iep.pdf", written: "Reading Fluency", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "area", valueType: "TEXT" },
  { id: "F-baseline", file: "08_initial_iep.pdf", written: "42", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "baselineValue", valueType: "NUMBER" },
  { id: "F-accuracy", file: "08_initial_iep.pdf", written: "oral reading accuracy of 86%", entityId: "entity:evaluation-finding", instanceId: "accuracy", fieldId: "findingText", valueType: "TEXT" },
  { id: "F-accuracy-domain", file: "08_initial_iep.pdf", written: "reading", entityId: "entity:evaluation-finding", instanceId: "accuracy", fieldId: "domain", valueType: "TEXT" },
  { id: "F-goal", file: "08_initial_iep.pdf", written: "Maya will read at least 75 words correct per minute", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "goalText", valueType: "TEXT" },
  { id: "F-mastery", file: "08_initial_iep.pdf", written: "at least 95% accuracy across three consecutive probes", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "masteryCriterion", valueType: "TEXT" },
  { id: "F-target", file: "08_initial_iep.pdf", written: "75", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "targetValue", valueType: "NUMBER" },
  { id: "F-service", file: "08_initial_iep.pdf", written: "Specialized reading instruction", entityId: "entity:service", instanceId: "reading", fieldId: "serviceName", valueType: "TEXT" },
  { id: "F-setting", file: "08_initial_iep.pdf", written: "special education", entityId: "entity:service", instanceId: "reading", fieldId: "serviceCategory", valueType: "TEXT" },
  { id: "F-frequency", file: "08_initial_iep.pdf", written: "150 minutes weekly", entityId: "entity:service", instanceId: "reading", fieldId: "frequencyAsWritten", valueType: "TEXT" },
  { id: "F-minutes", file: "08_initial_iep.pdf", written: "150", entityId: "entity:service", instanceId: "reading-minutes", fieldId: "minutesPerWeek", valueType: "QUANTITY" },
  { id: "F-extended", file: "08_initial_iep.pdf", written: "Extended time for classroom reading assessments", entityId: "entity:accommodation", instanceId: "extended", fieldId: "text", valueType: "TEXT" },
  { id: "F-extended-context", file: "08_initial_iep.pdf", written: "classroom reading assessments", entityId: "entity:accommodation", instanceId: "extended", fieldId: "context", valueType: "TEXT" },
  { id: "F-directions", file: "08_initial_iep.pdf", written: "Directions read aloud when reading ability is not being assessed", entityId: "entity:accommodation", instanceId: "directions", fieldId: "text", valueType: "TEXT" },
  { id: "F-directions-context", file: "08_initial_iep.pdf", written: "reading ability", entityId: "entity:accommodation", instanceId: "directions", fieldId: "context", valueType: "TEXT" },
  { id: "F-quarterly", file: "08_initial_iep.pdf", written: "reported quarterly", entityId: "entity:progress-reporting-plan", instanceId: "progress-plan", fieldId: "reportingFrequencyAsWritten", valueType: "TEXT" },
  { id: "F-speech", file: "06_speech_language_evaluation.pdf", written: "No separate speech-language educational need is identified from this evaluation", entityId: "entity:evaluation-finding", instanceId: "speech", fieldId: "findingText", valueType: "TEXT" },
  { id: "F-speech-domain", file: "06_speech_language_evaluation.pdf", written: "speech-language", entityId: "entity:evaluation-finding", instanceId: "speech", fieldId: "domain", valueType: "TEXT" },
  { id: "F-speech-service", file: "06_speech_language_evaluation.pdf", written: "No speech-language service is recommended", entityId: "entity:evaluation-recommendation", instanceId: "speech-rec", fieldId: "recommendationText", valueType: "TEXT" },
  { id: "F-cognitive", file: "04_psychoeducational_evaluation.pdf", written: "No global cognitive limitation is identified as the primary explanation", entityId: "entity:evaluation-finding", instanceId: "cognitive", fieldId: "findingText", valueType: "TEXT" },
  { id: "F-cognitive-domain", file: "04_psychoeducational_evaluation.pdf", written: "cognitive", entityId: "entity:evaluation-finding", instanceId: "cognitive", fieldId: "domain", valueType: "TEXT" },
  { id: "F-academic", file: "05_academic_evaluation.pdf", written: "explicit systematic reading instruction", entityId: "entity:evaluation-recommendation", instanceId: "academic-rec", fieldId: "recommendationText", valueType: "TEXT" },
  { id: "F-psych-rec", file: "04_psychoeducational_evaluation.pdf", written: "Academic assessment of reading achievement and fluency should be completed next", entityId: "entity:evaluation-recommendation", instanceId: "psych-rec", fieldId: "recommendationText", valueType: "TEXT" },
];

const QUOTES = new Map<string, { page: number; quote: string }>([
  ["F-iep-type", { page: 1, quote: "Initial Individualized Education Program (IEP)" }],
  ["F-start", { page: 1, quote: "2024-11-12 through 2025-11-11" }],
  ["F-end", { page: 1, quote: "2024-11-12 through 2025-11-11" }],
  ["F-category", { page: 1, quote: "Specific Learning Disability (SLD) - Reading" }],
  ["F-determined", { page: 1, quote: "Determination Date:\n2024-11-01" }],
  ["F-need", { page: 1, quote: "The primary educational need is Reading Fluency" }],
  ["F-area", { page: 1, quote: "The primary educational need is Reading Fluency" }],
  ["F-baseline", { page: 1, quote: "reading fluency baseline of 42 WCPM" }],
  ["F-accuracy", { page: 1, quote: "oral reading accuracy of 86%" }],
  ["F-accuracy-domain", { page: 1, quote: "oral reading accuracy of 86%" }],
  ["F-goal", { page: 1, quote: "Maya will read at least 75 words correct per minute" }],
  ["F-mastery", { page: 1, quote: "at least 95% accuracy across three consecutive probes" }],
  ["F-target", { page: 2, quote: "Target:\n75 WCPM" }],
  ["F-service", { page: 2, quote: "Specialized reading instruction is provided 150 minutes weekly" }],
  ["F-setting", { page: 2, quote: "in the special education setting" }],
  ["F-frequency", { page: 2, quote: "150 minutes weekly" }],
  ["F-minutes", { page: 2, quote: "150 minutes weekly" }],
  ["F-extended", { page: 2, quote: "Extended time for classroom reading assessments" }],
  ["F-extended-context", { page: 2, quote: "Extended time for classroom reading assessments" }],
  ["F-directions", { page: 2, quote: "Directions read aloud when reading ability is not being assessed" }],
  ["F-directions-context", { page: 2, quote: "Directions read aloud when reading ability is not being assessed" }],
  ["F-quarterly", { page: 2, quote: "reported quarterly" }],
  ["F-speech", { page: 1, quote: "No separate speech-language educational need is identified from this evaluation" }],
  ["F-speech-domain", { page: 1, quote: "No separate speech-language educational need is identified from this evaluation" }],
  ["F-speech-service", { page: 1, quote: "No speech-language service is recommended" }],
  ["F-cognitive", { page: 2, quote: "No global cognitive limitation is identified as the primary explanation" }],
  ["F-cognitive-domain", { page: 2, quote: "No global cognitive limitation is identified as the primary explanation" }],
  ["F-academic", { page: 1, quote: "explicit systematic reading instruction" }],
  ["F-psych-rec", { page: 2, quote: "Academic assessment of reading achievement and fluency should be completed next" }],
]);

type ToolCall = { id: string; name: string; arguments: string };
type CorpusDoc = { file: string; id: string; pages: string[] };

function loadJson(directory: string, name: string): unknown {
  return JSON.parse(readFileSync(join(directory, name), "utf8")) as unknown;
}

function publishedPackDirectory(): string {
  const catalog = JSON.parse(readFileSync(join(ROOT, "packs/published/domain-pack-catalog.json"), "utf8")) as {
    editions: { packId: string; version: string; directory: string; publication: string; approval: string }[];
  };
  const edition = catalog.editions.find((item) => item.publication === "PUBLISHED" && item.approval === "APPROVED");
  if (!edition || edition.packId !== "iep-us-federal" || edition.version !== "0.5.0") {
    throw new Error("The published catalog does not name the expected edition.");
  }
  return join(ROOT, "packs", edition.directory);
}

async function pageText(directory: string, file: string): Promise<string[]> {
  const bytes = new Uint8Array(readFileSync(join(directory, file)));
  const extracted = await extractText(bytes, { mergePages: false });
  return extracted.text;
}

function fact(row: Mapped): ExtractionFact {
  const evidence = QUOTES.get(row.id);
  if (!evidence) throw new Error(`missing quote for ${row.id}`);
  return {
    id: row.id,
    modelId: row.id,
    category: "record",
    subject: "record",
    attribute: row.written,
    value: row.written,
    valueAsWritten: row.written,
    unit: null,
    per: null,
    timeframe: { from: null, to: null, asWritten: null },
    modality: "stated",
    attributedTo: null,
    aboutPersonRef: null,
    tableContext: null,
    evidence: [{ page: evidence.page, printedPageLabel: null, quote: evidence.quote }],
    confidence: "high",
  };
}

function badFact(id: string): ExtractionFact {
  return {
    id,
    modelId: id,
    category: "record",
    subject: "record",
    attribute: "unverified",
    value: `Unverified ${id}`,
    valueAsWritten: `Unverified ${id}`,
    unit: null,
    per: null,
    timeframe: { from: null, to: null, asWritten: null },
    modality: "stated",
    attributedTo: null,
    aboutPersonRef: null,
    tableContext: null,
    evidence: [{ page: 1, printedPageLabel: null, quote: BAD_QUOTE }],
    confidence: "high",
  };
}

function extraction(document: CorpusDoc): DocExtraction {
  const facts = MAPPED.filter((row) => row.file === document.file).map(fact);
  const extras = document.id === "08"
    ? ["F-bad-1", "F-bad-2", "F-bad-3", "F-bad-4"].map(badFact)
    : [];
  return {
    schema: "hive.doc-extraction/1",
    documentId: document.id,
    fileName: document.file,
    pageRange: null,
    document: {
      titleAsPrinted: document.file,
      documentType: "record",
      domain: { label: "record", confidence: null },
      issuer: null,
      aboutPeople: [],
      keyDates: [],
      summary: "",
    },
    facts: [...facts, ...extras],
    emptyFields: [],
    referencedDocuments: [],
    glossary: [],
    instructionsIgnored: [],
    coverage: {
      pageCount: document.pages.length,
      pagesRead: document.pages.map((_, index) => index + 1),
      pagesBlankOrUnreadable: [],
      truncated: false,
      lastPageCompleted: document.pages.length,
    },
  };
}

function tool(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function response(calls: ToolCall[]) {
  return new Response(JSON.stringify({
    contract_version: STUDY_AGENT_TURN_CONTRACT_VERSION,
    model_alias: "heavy_lifter",
    resolved_model: "claude-synthetic",
    message: { content: null, tool_calls: calls },
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    latency_ms: 5,
    finish_reason: "stop",
  }), { status: 200 });
}

function lastUser(body: string): string {
  const parsed = JSON.parse(body) as { messages: { role: string; content?: string }[] };
  const users = parsed.messages.filter((message) => message.role === "user");
  return users[users.length - 1]?.content ?? "";
}

function roleQuote(document: CorpusDoc): { page: number; quote: string } {
  if (document.file === "08_initial_iep.pdf") {
    return { page: 1, quote: "Initial Individualized Education Program (IEP)" };
  }
  for (let index = 0; index < document.pages.length; index += 1) {
    const text = document.pages[index]!.replace(/\s+/g, " ").trim();
    if (text.length >= 20) return { page: index + 1, quote: text.slice(0, 60) };
  }
  throw new Error(`no role quote for ${document.file}`);
}

describe("published pack investigation schedule", () => {
  let corpus: CorpusDoc[] = [];
  let packDirectory = "";

  beforeAll(async () => {
    packDirectory = publishedPackDirectory();
    const docs = join(ROOT, "eval/corpora/special-ed-l001/docs");
    corpus = await Promise.all(FILES.map(async (file) => ({
      file,
      id: file.slice(0, 2),
      pages: await pageText(docs, file),
    })));
  }, 60_000);

  it("answers every shown question and every request question inside the existing limits", async () => {
    const prepared = prepareInvestigationStudy({
      packSource: loadJson(packDirectory, "iep-domain-pack-source.v0.5.0.json") as DomainPackSource,
      artifacts: {
        ontology: loadJson(packDirectory, "iep-domain-ontology-spec.json"),
        authorityRegister: loadJson(packDirectory, "iep-domain-authority-register.json"),
        conflictPatterns: loadJson(packDirectory, "iep-domain-conflict-patterns.v1.json"),
        stateOverlays: loadJson(packDirectory, "iep-domain-state-overlays.v1.json"),
        factClasses: loadJson(packDirectory, "iep-domain-fact-classes.v1.json"),
        workflowCoverage: loadJson(packDirectory, "iep-domain-workflow-coverage.v1.json"),
        unsupportedOperators: loadJson(packDirectory, "iep-domain-unsupported-operators.v1.json"),
      } as SupplementalArtifacts,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const pack = prepared.prepared.pack;
    const catalogIds = pack.definitions.flatMap((definition) => definition.kind === "question" ? [definition.id] : []);
    expect(catalogIds.length).toBeGreaterThan(8);
    const audiences = new Map(pack.definitions.flatMap((definition) =>
      definition.kind === "question" ? [[definition.id, definition.audience] as const] : []));
    const priority = new Set(Object.values(INTENT_FACTS).flat());
    const queue = [
      ...MAPPED.filter((row) => priority.has(row.id)),
      ...MAPPED.filter((row) => !priority.has(row.id)),
    ];
    const proposed = new Set<string>();
    const rolesDone = new Set<string>();
    let anchorRead = false;
    const intentState = new Map<string, "facts" | "uncertainty">();
    const catalogAnswered = new Set<string>();
    let serial = 0;
    const nextId = (name: string) => `${name}-${serial += 1}`;
    const fieldCall = (row: Mapped): ToolCall => tool(nextId("field"), "propose_field", {
      documentId: row.file.slice(0, 2),
      extractionFactId: row.id,
      entityId: row.entityId,
      instanceId: row.instanceId,
      fieldId: row.fieldId,
      valueType: row.valueType,
      value: row.written,
    });
    const intentCalls = (known: ReadonlySet<string>): ToolCall[] => {
      const calls: ToolCall[] = [];
      for (let index = 1; index <= 5; index += 1) {
        const questionId = `intent:${index}`;
        const factIds = INTENT_FACTS[questionId];
        if (factIds && factIds.every((id) => known.has(id)) && intentState.get(questionId) !== "facts") {
          calls.push(tool(nextId("intent"), "propose_answer", {
            questionId,
            audience: "customer",
            factIds,
          }));
          continue;
        }
        if (!intentState.has(questionId)) {
          const uncertainty = questionId === "intent:4"
            ? PROGRESS_UNCERTAINTY
            : questionId === "intent:5"
              ? MEETING_UNCERTAINTY
              : OPEN_UNCERTAINTY;
          calls.push(tool(nextId("intent"), "propose_answer", {
            questionId,
            audience: "customer",
            factIds: [],
            uncertainty,
          }));
        }
      }
      return calls;
    };
    const bodies: string[] = [];
    let scriptError = "";
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body);
      bodies.push(body);
      const last = lastUser(body);
      try {
      const calls: ToolCall[] = [];
      const assignment = last.includes("Answer the request questions first") || last.includes("questions are still open");
      const repair = last.includes("evidence-backed role") || last.includes("anchor page");
      const windowTurn = last.includes("\"schema\":\"hive.field-mapping-window/1\"");
      const answerTurn = !windowTurn && (
        assignment
        || last.includes("Questions with no answer")
        || last.includes("question from the request")
        || last.includes("Phase F is still open")
      );
      if (last.includes("The completion checks are done.")) {
        calls.push(tool(nextId("finish"), "finish_investigation", { ready: true }));
      } else if (windowTurn || repair || answerTurn || last.includes("No tool was called")) {
        if (windowTurn || repair || last.includes("evidence-backed role") || last.includes("anchor page")) {
          for (const document of corpus) {
            if (rolesDone.has(document.id)) continue;
            const quote = roleQuote(document);
            calls.push(tool(nextId(`role-${document.id}`), "propose_document_role", {
              documentId: document.id,
              role: document.id === "08" ? "ANCHOR" : "SUPPORTING",
              page: quote.page,
              quote: quote.quote,
            }));
          }
          if (!anchorRead) {
            const anchor = corpus.find((document) => document.id === "08");
            const pageCount = anchor?.pages.length ?? 0;
            for (let start = 1; start <= pageCount; start += 3) {
              calls.push(tool(nextId(`read-${start}`), "read_pages", {
                documentId: "08",
                startPage: start,
                endPage: Math.min(pageCount, start + 2),
              }));
            }
          }
        }
        if (windowTurn || answerTurn) {
          for (const row of queue) {
            if (proposed.has(row.id)) continue;
            calls.push(fieldCall(row));
          }
        }
        if (answerTurn) {
          const known = new Set(proposed);
          for (const call of calls.slice(0, 32)) {
            if (call.name !== "propose_field") continue;
            const factId = (JSON.parse(call.arguments) as { extractionFactId?: string }).extractionFactId;
            if (factId) known.add(factId);
          }
          calls.push(...intentCalls(known));
          for (const questionId of catalogIds) {
            if (catalogAnswered.has(questionId) || !last.includes(questionId)) continue;
            calls.push(tool(nextId("answer"), "propose_answer", {
              questionId,
              audience: audiences.get(questionId) ?? "customer",
              factIds: [],
              uncertainty: OPEN_UNCERTAINTY,
            }));
          }
        }
      } else {
        scriptError = last.slice(0, 500);
        throw new Error(`unscripted investigation turn: ${scriptError}`);
      }
      if (calls.length === 0) {
        calls.push(tool(nextId("hold"), "read_pages", { documentId: "08", startPage: 1, endPage: 1 }));
      }
      const sent = calls.slice(0, 32);
      for (const call of sent) {
        const args = JSON.parse(call.arguments) as { extractionFactId?: string; documentId?: string; questionId?: string; factIds?: string[] };
        if (call.name === "propose_field" && args.extractionFactId) proposed.add(args.extractionFactId);
        if (call.name === "propose_document_role" && args.documentId) rolesDone.add(args.documentId);
        if (call.name === "read_pages") anchorRead = true;
        if (call.name === "propose_answer" && args.questionId?.startsWith("intent:")) {
          intentState.set(args.questionId, (args.factIds?.length ?? 0) > 0 ? "facts" : "uncertainty");
        }
        if (call.name === "propose_answer" && args.questionId?.startsWith("question:")) catalogAnswered.add(args.questionId);
      }
      return response(sent);
      } catch (error) {
        scriptError = error instanceof Error ? error.message : "script failed";
        throw error;
      }
    });
    const pages = corpus.map((document) => ({
      documentId: document.id,
      pages: document.pages.map((text, index) => ({ pageNumber: index + 1, text })),
    }));
    const result = await runDomainMappingInvestigation({
      planner: {
        getConfig: () => ({ baseUrl: "https://planner.test", serviceToken: "token", timeoutMs: 1000 }),
        fetchFn: fetchFn as unknown as typeof fetch,
      },
      runId: "run-maya-schedule",
      hiveId: "hive-maya-schedule",
      correlationId: "corr-maya-schedule",
      prompt: { id: "hive.domain-investigation/2", digest: "sha256:test", systemPrompt: "Investigate the record." },
      plan: prepared.prepared.plan,
      pack,
      extractions: corpus.map(extraction),
      pages,
      intentText: INTENT,
      clock: () => 1_700_000_000_000,
    });
    expect(result.ok, result.ok ? "" : `${scriptError} ${result.error.diagnosticReason} ${result.error.diagnosticField ?? ""}`).toBe(true);
    if (!result.ok) return;
    const users = bodies.map(lastUser);
    const assignmentAt = users.findIndex((text) =>
      text.includes("Answer the request questions first") || text.includes("questions are still open"));
    const laterWindowAt = users.findIndex((text) => text.includes("\"windowIndex\":1"));
    expect(assignmentAt).toBeGreaterThanOrEqual(0);
    expect(laterWindowAt).toBeGreaterThan(assignmentAt);
    expect(users.at(-1)).toContain("The completion checks are done.");
    expect(assignmentAt).toBeLessThan(users.length - 1);
    expect(result.totals.rounds).toBeLessThanOrEqual(result.totals.roundsAllowed);
    expect(result.totals.roundsAllowed).toBeLessThanOrEqual(STUDY_AGENT_BUDGET.maxRounds);
    expect(result.totals.toolCalls).toBeLessThanOrEqual(STUDY_AGENT_BUDGET.maxToolCalls);
    expect(result.totals.roundsAllowed).toBeGreaterThanOrEqual(
      result.totals.windowCount + Math.ceil(catalogIds.length / 8),
    );
    expect([...(result.record.shownQuestionIds ?? [])].sort()).toEqual([...catalogIds].sort());
    const accepted = new Set(result.proposal.mappings.map((row) => row.extractionFactId));
    for (const questionId of catalogIds) {
      const answer = result.record.answers.find((item) => item.questionId === questionId);
      expect(answer, questionId).toBeTruthy();
      expect((answer?.factIds.length ?? 0) > 0 || Boolean(answer?.uncertainty)).toBe(true);
      expect(answer?.uncertainty ?? "").not.toMatch(SEARCH_CLAIM);
      for (const factId of answer?.factIds ?? []) expect(accepted.has(factId)).toBe(true);
    }
    expect(result.record.answers.find((item) => item.questionId === "intent:1")?.factIds).toEqual(["F-iep-type", "F-start", "F-end"]);
    expect(result.record.answers.find((item) => item.questionId === "intent:2")?.factIds).toEqual(["F-accuracy", "F-speech", "F-cognitive"]);
    expect(result.record.answers.find((item) => item.questionId === "intent:3")?.factIds).toEqual(["F-goal", "F-frequency", "F-extended", "F-directions"]);
    expect(result.record.answers.find((item) => item.questionId === "intent:4")?.uncertainty).toBe(PROGRESS_UNCERTAINTY);
    expect(result.record.answers.find((item) => item.questionId === "intent:4")?.factIds).toEqual([]);
    expect(result.record.answers.find((item) => item.questionId === "intent:5")?.uncertainty).toBe(MEETING_UNCERTAINTY);
    for (const factId of ["F-bad-1", "F-bad-2", "F-bad-3", "F-bad-4"]) {
      expect(accepted.has(factId)).toBe(false);
      expect(result.record.answers.some((answer) => answer.factIds.includes(factId))).toBe(false);
    }
    expect(bodies.join("\n")).not.toContain(BAD_QUOTE);
    const study = runInvestigationStudyEngine({
      prepared: prepared.prepared,
      extractions: corpus.map(extraction),
      pages,
      proposal: result.proposal,
      investigation: result.record,
      studyDate: "2026-11-26",
    });
    expect(study.ok, study.ok ? "" : study.code).toBe(true);
    if (!study.ok) return;
    expect(study.completeness.complete, study.completeness.unfinished.join(", ")).toBe(true);
    expect(acceptCanonicalInvestigation(study).ok).toBe(true);
  }, 60_000);
});
