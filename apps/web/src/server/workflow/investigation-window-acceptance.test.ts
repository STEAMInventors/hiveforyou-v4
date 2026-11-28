/**
 * Synthetic Maya rebuild through every investigation window.
 * The planner is a local stand-in. No external model is called.
 * Acceptance is the Canonical Study, not a count of windows.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocExtraction, ExtractionFact, ProcessingRun } from "@hiveforyou/contracts";
import {
  planInvestigationWindows,
  prepareInvestigationStudy,
  presentDocumentKindIds,
} from "@hiveforyou/contracts/investigation";
import type { InvestigationWindowProgress } from "@hiveforyou/contracts/investigation";
import { loadSyntheticMayaProfilePack, resolvePublishedDomainPack } from "./domain-pack-selection";
import { runPackGuidedStudy } from "./pack-guided-rebuild";

const ROOT = join(import.meta.dirname, "../../../../../");
const PAGES = join(ROOT, "eval/corpora/special-ed-l001/reader-pages");
const HIVE = "11111111-1111-4111-8111-111111111111";
const INTENT = "What is written in this initial IEP? Which needs and services are shown?";

type Mapped = {
  id: string;
  file: string;
  page: number;
  quote: string;
  written: string;
  entityId: string;
  instanceId: string;
  fieldId: string;
  valueType: "TEXT" | "NUMBER" | "DATE" | "QUANTITY";
};

const MAPPED: Mapped[] = [
  { id: "F-iep-type", file: "08_initial_iep.pdf", page: 1, quote: "Initial Individualized Education Program (IEP)", written: "Initial Individualized Education Program (IEP)", entityId: "entity:iep", instanceId: "iep-doc", fieldId: "iepType", valueType: "TEXT" },
  { id: "F-start", file: "08_initial_iep.pdf", page: 1, quote: "2024-11-12 through 2025-11-11", written: "2024-11-12", entityId: "entity:iep", instanceId: "iep-doc", fieldId: "effectiveStartDate", valueType: "DATE" },
  { id: "F-end", file: "08_initial_iep.pdf", page: 1, quote: "2024-11-12 through 2025-11-11", written: "2025-11-11", entityId: "entity:iep", instanceId: "iep-doc", fieldId: "effectiveEndDate", valueType: "DATE" },
  { id: "F-category", file: "08_initial_iep.pdf", page: 1, quote: "Specific Learning Disability (SLD) - Reading", written: "Specific Learning Disability (SLD) - Reading", entityId: "entity:eligibility-determination", instanceId: "elig", fieldId: "category", valueType: "TEXT" },
  { id: "F-need", file: "08_initial_iep.pdf", page: 1, quote: "The primary educational need is Reading Fluency", written: "The primary educational need is Reading Fluency", entityId: "entity:present-level", instanceId: "present", fieldId: "statementText", valueType: "TEXT" },
  { id: "F-goal", file: "08_initial_iep.pdf", page: 1, quote: "Maya will read at least 75 words correct per minute", written: "Maya will read at least 75 words correct per minute", entityId: "entity:annual-goal", instanceId: "goal", fieldId: "goalText", valueType: "TEXT" },
  { id: "F-speech", file: "06_speech_language_evaluation.pdf", page: 1, quote: "No separate speech-language educational need is identified from this evaluation", written: "No separate speech-language educational need is identified from this evaluation", entityId: "entity:evaluation-finding", instanceId: "speech", fieldId: "findingText", valueType: "TEXT" },
  { id: "F-academic", file: "05_academic_evaluation.pdf", page: 1, quote: "explicit systematic reading instruction", written: "explicit systematic reading instruction", entityId: "entity:evaluation-recommendation", instanceId: "academic-rec", fieldId: "recommendationText", valueType: "TEXT" },
];

type PageDocument = { documentId: string; fileName: string; pages: { pageNumber: number; text: string }[] };

function collapsed(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function corpus(): { pages: PageDocument[]; extractions: DocExtraction[] } {
  const files = readdirSync(PAGES).filter((name) => name.endsWith(".txt")).sort();
  const byDocument = new Map<string, { fileName: string; pages: { pageNumber: number; text: string }[] }>();
  for (const file of files) {
    const match = /^(.+)\.p(\d+)\.txt$/.exec(file);
    if (!match) continue;
    const fileName = `${match[1]}.pdf`;
    const pageNumber = Number(match[2]);
    const text = readFileSync(join(PAGES, file), "utf8");
    const document = byDocument.get(fileName) ?? { fileName, pages: [] };
    document.pages.push({ pageNumber, text });
    byDocument.set(fileName, document);
  }
  const documents = [...byDocument.values()].sort((left, right) => left.fileName.localeCompare(right.fileName));
  const pages: PageDocument[] = documents.map((document, index) => ({
    documentId: `aaaaaaaa-aaaa-4aaa-8aaa-${(index + 1).toString(16).padStart(12, "0")}`,
    fileName: document.fileName,
    pages: document.pages.sort((left, right) => left.pageNumber - right.pageNumber),
  }));
  const extractions: DocExtraction[] = pages.map((document) => {
    const facts: ExtractionFact[] = MAPPED.filter((row) => row.file === document.fileName).flatMap((row) => {
      const page = document.pages.find((item) => item.pageNumber === row.page);
      if (!page || !collapsed(page.text).includes(collapsed(row.quote))) return [];
      if (!collapsed(row.quote).includes(collapsed(row.written))) return [];
      return [{
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
        modality: "stated" as const,
        attributedTo: null,
        aboutPersonRef: null,
        tableContext: null,
        evidence: [{ page: row.page, printedPageLabel: null, quote: row.quote }],
        confidence: "high" as const,
        entityId: row.entityId,
        instanceId: row.instanceId,
        fieldId: row.fieldId,
        valueType: row.valueType,
      } as ExtractionFact & Mapped];
    });
    return {
      schema: "hive.doc-extraction/1",
      documentId: document.documentId,
      fileName: document.fileName,
      pageRange: null,
      document: {
        titleAsPrinted: document.fileName,
        documentType: document.fileName.replace(/\.pdf$/, "").replace(/_/g, " "),
        domain: { label: "record", confidence: null },
        issuer: null,
        aboutPeople: [],
        keyDates: [],
        summary: "",
      },
      facts: facts.map(({ entityId: _entity, instanceId: _instance, fieldId: _field, valueType: _type, ...fact }) => fact),
      emptyFields: [],
      referencedDocuments: [],
      glossary: [],
      instructionsIgnored: [],
      coverage: {
        pageCount: document.pages.length,
        pagesRead: document.pages.map((page) => page.pageNumber),
        pagesBlankOrUnreadable: [],
        truncated: false,
        lastPageCompleted: document.pages.length,
      },
    };
  });
  return { pages, extractions };
}

type WireCall = { id: string; name: string; arguments: string };
type WireMessage = { role: string; content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };

function priorCalls(messages: readonly WireMessage[]): WireCall[] {
  const calls: WireCall[] = [];
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      calls.push({ id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
  }
  return calls;
}

function toolText(messages: readonly WireMessage[]): string {
  return messages.filter((message) => message.role === "tool").map((message) => message.content ?? "").join("\n");
}

function seen(calls: readonly WireCall[], name: string, argumentsText: string): boolean {
  return calls.some((call) => call.name === name && call.arguments === argumentsText);
}

function quoteLine(text: string): string | null {
  const line = text.split(/\n/).map((item) => item.trim()).find((item) => item.length >= 20 && item.length <= 180);
  return line ?? null;
}

function parsedTools(text: string): Record<string, unknown>[] {
  return text.split("\n").flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as unknown;
      return parsed && typeof parsed === "object" ? [parsed as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

function pageReads(text: string): Map<string, { page: number; text: string }> {
  const found = new Map<string, { page: number; text: string }>();
  for (const parsed of parsedTools(text)) {
    if (parsed.kind !== "pages" || typeof parsed.documentId !== "string" || !Array.isArray(parsed.pages)) continue;
    const page = parsed.pages.find((item) => item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string");
    if (!page || typeof page !== "object") continue;
    const row = page as { page?: unknown; text?: unknown };
    if (typeof row.page !== "number" || typeof row.text !== "string" || row.text.trim() === "") continue;
    found.set(parsed.documentId, { page: row.page, text: row.text });
  }
  return found;
}

function acceptedIds(text: string, kind: string, field: string): Set<string> {
  const ids = new Set<string>();
  for (const parsed of parsedTools(text)) {
    if (parsed.ok === false || parsed.kind !== kind) continue;
    const value = parsed[field];
    if (typeof value === "string") ids.add(value);
  }
  return ids;
}

describe("synthetic Maya accepted study", () => {
  it("resumes across invocations and accepts one Canonical Study", async () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "packs/published/domain-pack-catalog.json"), "utf8")) as {
      editions: { version: string; publication: string }[];
    };
    expect(catalog.editions.map((edition) => `${edition.publication}:${edition.version}`)).toEqual([
      "PUBLISHED:0.5.0",
      "PUBLISHED:0.5.1",
    ]);
    const { pages, extractions } = corpus();
    expect(extractions.flatMap((extraction) => extraction.facts).length).toBeGreaterThan(0);
    const published = resolvePublishedDomainPack({
      intentText: INTENT,
      documents: extractions.flatMap((extraction) => [extraction.fileName, extraction.document.documentType]),
    }, ROOT);
    expect(published.status).toBe("selected");
    if (published.status !== "selected") return;
    expect(published.pack.candidate.version).toBe("0.5.1");
    expect(published.pack.source.identity.version).toBe("0.5.1");
    expect(loadSyntheticMayaProfilePack(published.pack, ROOT)).toBeNull();
    const profile = published.pack;

    const run = { id: "run-window-accept", hiveId: HIVE } as ProcessingRun;
    const submissions: string[] = [];
    const windowsSeen: string[] = [];
    let rejectedRelationship = false;
    let now = 0;
    let timeoutMs = 50_000;
    const callTurn = async (_deps: unknown, turn: { request: { messages: WireMessage[] } }) => {
      now += timeoutMs <= 50_000 ? 30_000 : 1_000;
      const messages = turn.request.messages;
      const content = messages.filter((message) => message.role === "user").map((message) => message.content ?? "").join("\n");
      const windowId = content.split("\n")[0]?.replace("WINDOW ", "") ?? "";
      windowsSeen.push(windowId);
      const questions = (content.split("\n").find((line) => line.startsWith("QUESTIONS ")) ?? "").replace("QUESTIONS ", "").split(" ").filter((id) => id !== "");
      const earlier = priorCalls(messages);
      const tools = toolText(messages);
      const reads = pageReads(tools);
      const calls: WireCall[] = [];
      const push = (name: string, args: Record<string, unknown>) => {
        const argumentsText = JSON.stringify(args);
        if (seen(earlier, name, argumentsText) || seen(calls, name, argumentsText)) return;
        if (calls.length >= 24) return;
        calls.push({ id: `${name}-${windowId}-${submissions.length + calls.length}`, name, arguments: argumentsText });
      };
      push("search_case", { query: "record" });
      if (!rejectedRelationship) {
        rejectedRelationship = true;
        push("propose_relationship", {
          documentId: "01",
          extractionFactId: "missing-fact",
          relationshipId: "relationship:not-a-fact",
          fromInstanceId: "a",
          toInstanceId: "b",
        });
      }
      for (const questionId of questions) {
        const answer = JSON.stringify({ questionId, audience: "all", factIds: [], uncertainty: "The saved record does not settle this." });
        if (seen(earlier, "propose_answer", answer) || tools.includes(`"questionId":"${questionId}"`)) continue;
        push("propose_answer", { questionId, audience: "all", factIds: [], uncertainty: "The saved record does not settle this." });
      }
      const closing = content.includes("last open window");
      if (closing) {
        const roles = acceptedIds(tools, "document_role", "documentId");
        const fields = acceptedIds(tools, "field", "extractionFactId");
        for (const document of pages) {
          if (roles.has(document.documentId)) continue;
          const read = reads.get(document.documentId);
          const line = read ? quoteLine(read.text) : null;
          if (!read || !line) {
            push("read_pages", { documentId: document.documentId, startPage: 1, endPage: 1 });
            continue;
          }
          push("propose_document_role", { documentId: document.documentId, role: "SUPPORTING", page: read.page, quote: line });
        }
        for (const row of MAPPED) {
          const document = pages.find((item) => item.fileName === row.file);
          if (!document || fields.has(row.id) || !extractions.some((extraction) => extraction.facts.some((fact) => fact.id === row.id))) continue;
          push("propose_field", {
            documentId: document.documentId,
            extractionFactId: row.id,
            entityId: row.entityId,
            instanceId: row.instanceId,
            fieldId: row.fieldId,
            valueType: row.valueType,
            value: row.written,
          });
        }
        if (fields.size > 0) {
          push("propose_answer", { questionId: "question:customer:L1", audience: "customer", factIds: ["F-iep-type"] });
          push("propose_answer", { questionId: "question:professional:L1", audience: "professional", factIds: ["F-speech"] });
        }
        const rolesReady = pages.every((document) => roles.has(document.documentId));
        if ((rolesReady && fields.size > 0) || tools.includes("completion checks are done")) {
          push("finish_investigation", { ready: true });
        }
      }
      for (const call of calls) submissions.push(`${windowId}\n${call.name}\n${call.arguments}`);
      return {
        content: null,
        toolCalls: calls,
        modelAlias: "heavy_lifter",
        resolvedModel: "stub",
        usage: { promptTokens: 30, completionTokens: 30, totalTokens: 60 },
        latencyMs: 1,
        finishReason: "tool_calls",
        roundTripMs: 1,
      };
    };

    let saved: InvestigationWindowProgress | null = null;
    let accepted: Awaited<ReturnType<typeof runPackGuidedStudy>> | null = null;
    const completedBeforeResume = new Set<string>();
    for (let invocation = 0; invocation < 8 && !accepted?.ok; invocation += 1) {
      const seenBefore = windowsSeen.length;
      const result = await runPackGuidedStudy({
        planner: { getConfig: () => ({ baseUrl: "http://127.0.0.1", serviceToken: "test", timeoutMs: 1000 }) },
        run,
        extractions,
        pages,
        requestText: INTENT,
        correlationId: "corr-window-accept",
        stageAttempt: invocation + 1,
        now: () => new Date("2026-11-27T12:00:00.000Z"),
        packsCwd: ROOT,
        savedWindowProgress: saved,
        onWindowProgress: async (progress) => {
          saved = progress;
        },
        resolvePlannerTimeoutMs: () => timeoutMs,
        clock: () => now,
        callTurn: callTurn as never,
      });
      if (invocation === 0) {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.diagnosticReason).toBe("investigation_window_paused");
          expect(result.error.safeMessage).toContain("0.5.1");
          expect(result.error.safeMessage).toContain("CANONICALIZING");
          expect(result.error.safeMessage).toContain("windows complete");
          expect(result.error.safeMessage).toContain("investigation_window_paused");
          expect(result.error.diagnosticField).toContain("windows@");
          expect(result.error.diagnosticField).toContain("code@investigation_window_paused");
        }
        for (const window of saved?.windows ?? []) {
          if (window.status === "complete") completedBeforeResume.add(window.windowId);
        }
        expect(completedBeforeResume.size).toBeGreaterThan(0);
        timeoutMs = 250_000;
      }
      const resumedWindows = windowsSeen.slice(seenBefore);
      if (invocation > 0) {
        for (const windowId of completedBeforeResume) expect(resumedWindows).not.toContain(windowId);
      }
      if (result.ok) accepted = result;
    }
    expect(submissions.length).toBe(new Set(submissions).size);
    expect(rejectedRelationship).toBe(true);
    expect(accepted?.ok, accepted && !accepted.ok ? accepted.error.diagnosticReason : "").toBe(true);
    if (!accepted?.ok) return;
    expect(accepted.study.schema).toBe("hive.canonical-study/1");
    expect(accepted.study.questionOrder).toEqual(expect.arrayContaining(["pack-version:0.5.1"]));
    expect(accepted.study.questionOrder?.some((item) => item === "pack-version:0.5.0")).toBe(false);
    const coverage = accepted.study.personaCoverage ?? [];
    expect(coverage.some((item) => item.audience === "customer")).toBe(true);
    expect(coverage.some((item) => item.audience === "professional")).toBe(true);
    expect(catalog.editions.map((edition) => edition.version)).toEqual(["0.5.0", "0.5.1"]);

    const prepared = prepareInvestigationStudy({
      packSource: profile!.source,
      artifacts: profile!.artifacts,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok || !profile) return;
    const present = presentDocumentKindIds(
      prepared.prepared.pack.definitions,
      extractions.flatMap((extraction) => [extraction.fileName, extraction.document.documentType, extraction.document.titleAsPrinted]),
    );
    const plan = planInvestigationWindows({ intent: INTENT, plan: prepared.prepared.plan, presentDocumentIds: present });
    const investigated: string[] = [];
    const uncertain: string[] = [];
    const notApplicable: string[] = [];
    for (const item of plan.windows.flatMap((window) => window.obligations)) {
      if (item.disposition === "NOT_APPLICABLE") {
        notApplicable.push(item.objectiveId);
        continue;
      }
      if (item.disposition === "EVIDENCE_MISSING" || item.missingDocumentIds.length > 0) {
        uncertain.push(item.objectiveId);
        continue;
      }
      const rows = coverage.filter((row) => item.questionIds.includes(row.questionId) && row.audience === item.audience);
      if (rows.some((row) => row.status === "ANSWERABLE" && row.factIds.length > 0)) investigated.push(item.objectiveId);
      else uncertain.push(item.objectiveId);
    }
    const report = {
      investigated: investigated.sort(),
      uncertain: uncertain.sort(),
      notApplicable: notApplicable.sort(),
    };
    expect(report.notApplicable).toContain("objective:customer:prior-iep-changes");
    expect(report.investigated.some((id) => id.startsWith("objective:customer:"))).toBe(true);
    expect(report.investigated.some((id) => id.startsWith("objective:professional:")) || report.uncertain.some((id) => id.startsWith("objective:professional:"))).toBe(true);
    expect(report.uncertain.some((id) => id.startsWith("objective:customer:"))).toBe(true);
    expect(report, JSON.stringify(report, null, 2)).toMatchObject({
      investigated: expect.arrayContaining([expect.stringContaining("objective:customer:")]),
      notApplicable: expect.arrayContaining(["objective:customer:prior-iep-changes"]),
    });
  }, 120_000);
});
