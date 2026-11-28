/**
 * Synthetic Maya window execution. The planner is a local stand-in.
 * No external model is called.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocExtraction } from "@hiveforyou/contracts";
import { computeSha256Digest } from "@hiveforyou/contracts/document-read";
import {
  compileEffectiveDomainPack,
  resolveSyntheticExecutionFixtureId,
  specifyCaseInvestigation,
  verifyExtractionEvidence,
} from "@hiveforyou/contracts/study-engine";
import { prepareInvestigationStudy } from "@hiveforyou/contracts/investigation";
import { loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";
import { runInvestigationWindows } from "./investigation-window-runner";

const ROOT = join(import.meta.dirname, "../../../../../");
const V051 = join(ROOT, "packs/drafts/iep-us-federal/v0.5.1");
const V050 = join(ROOT, "packs/drafts/iep-us-federal/v0.5.0");
const PAGES = join(ROOT, "eval/corpora/special-ed-l001/reader-pages");
const HIVE = "11111111-1111-4111-8111-111111111111";

function load(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
}

function artifacts(): Parameters<typeof prepareInvestigationStudy>[0]["artifacts"] {
  return {
    ontology: load(V051, "iep-domain-ontology-spec.json"),
    authorityRegister: load(V050, "iep-domain-authority-register.json"),
    conflictPatterns: load(V050, "iep-domain-conflict-patterns.v1.json"),
    stateOverlays: load(V050, "iep-domain-state-overlays.v1.json"),
    factClasses: load(V050, "iep-domain-fact-classes.v1.json"),
    workflowCoverage: load(V050, "iep-domain-workflow-coverage.v1.json"),
    unsupportedOperators: load(V050, "iep-domain-unsupported-operators.v1.json"),
  };
}

function corpus() {
  const files = readdirSync(PAGES).filter((name) => name.endsWith(".txt")).sort();
  const byDocument = new Map<string, { fileName: string; pages: { pageNumber: number; text: string }[] }>();
  for (const file of files) {
    const match = /^(.+)\.p(\d+)\.txt$/.exec(file);
    if (!match) continue;
    const fileName = match[1] + ".pdf";
    const pageNumber = Number(match[2]);
    const text = readFileSync(join(PAGES, file), "utf8");
    const document = byDocument.get(fileName) ?? { fileName, pages: [] };
    document.pages.push({ pageNumber, text });
    byDocument.set(fileName, document);
  }
  const documents = [...byDocument.values()].sort((left, right) => left.fileName.localeCompare(right.fileName));
  const pages = documents.map((document, index) => ({
    documentId: `aaaaaaaa-aaaa-4aaa-8aaa-${(index + 1).toString(16).padStart(12, "0")}`,
    pages: document.pages.sort((left, right) => left.pageNumber - right.pageNumber),
  }));
  const extractions: DocExtraction[] = pages.map((document, index) => ({
    schema: "hive.doc-extraction/1",
    documentId: document.documentId,
    fileName: documents[index]?.fileName ?? "record.pdf",
    pageRange: null,
    document: {
      titleAsPrinted: documents[index]?.fileName ?? "record",
      documentType: (documents[index]?.fileName ?? "record").replace(/\.pdf$/, "").replace(/_/g, " "),
      domain: { label: "record", confidence: null },
      issuer: null,
      aboutPeople: [],
      keyDates: [],
      summary: "",
    },
    facts: [],
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
  }));
  return { pages, extractions };
}

describe("Maya window runner", () => {
  it("verifies tool submissions, pauses one window, and does not repeat a completed window", async () => {
    const source = load(V051, "iep-domain-pack-source.v0.5.1.json") as Parameters<typeof prepareInvestigationStudy>[0]["packSource"];
    const prepared = prepareInvestigationStudy({ packSource: source, artifacts: artifacts() });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const effective = compileEffectiveDomainPack({ base: prepared.prepared.pack });
    expect(effective.ok).toBe(true);
    if (!effective.ok) return;
    const specification = specifyCaseInvestigation({ pack: effective.value, hiveId: HIVE, attributes: [] });
    expect(specification.ok).toBe(true);
    if (!specification.ok) return;
    const { pages, extractions } = corpus();
    const fixturePages = pages.flatMap((document) => document.pages.map((page) => ({
      documentId: document.documentId,
      pageNumber: page.pageNumber,
      text: page.text,
      sourcePageDigest: computeSha256Digest(page.text),
    })));
    expect(resolveSyntheticExecutionFixtureId({ hiveId: HIVE, pages: fixturePages })).toBe("fixture:synthetic-maya");
    const evidence = verifyExtractionEvidence({ extractions, pages: fixturePages });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;
    const seen: string[] = [];
    let now = 0;
    const callTurn = async (_deps: unknown, turn: { request: { messages: { content?: string }[] } }) => {
      now += 30_000;
      const content = String(turn.request.messages[0]?.content ?? "");
      const windowId = content.split("\n")[0]?.replace("WINDOW ", "") ?? "";
      seen.push(windowId);
      const questions = (content.split("\n")[1] ?? "").replace("QUESTIONS ", "").split(" ").filter((id) => id !== "");
      const calls = [
        { id: `search-${seen.length}`, name: "search_case", arguments: JSON.stringify({ query: "record" }) },
        ...questions.map((questionId, index) => ({
          id: `answer-${seen.length}-${index}`,
          name: "propose_answer",
          arguments: JSON.stringify({ questionId, audience: "all", factIds: [], uncertainty: "The record does not settle this." }),
        })),
        {
          id: `relationship-${seen.length}`,
          name: "propose_relationship",
          arguments: JSON.stringify({
            documentId: "doc-1",
            extractionFactId: "missing-fact",
            relationshipId: "relationship:not-a-fact",
            fromInstanceId: "a",
            toInstanceId: "b",
          }),
        },
        {
          id: `assessment-${seen.length}`,
          name: "propose_assessment",
          arguments: JSON.stringify({ statement: "the school must change the plan", factIds: [] }),
        },
      ];
      return {
        content: null,
        toolCalls: calls,
        modelAlias: "heavy_lifter",
        resolvedModel: "stub",
        usage: { promptTokens: 20, completionTokens: 20, totalTokens: 40 },
        latencyMs: 5,
        finishReason: "tool_calls",
        roundTripMs: 5,
      };
    };
    const prompt = loadPromptCatalog().investigationV2;
    const first = await runInvestigationWindows({
      planner: { getConfig: () => ({ baseUrl: "http://127.0.0.1", serviceToken: "test", timeoutMs: 1000 }) },
      prompt,
      runId: "run-window",
      hiveId: HIVE,
      correlationId: "corr-window",
      intent: "What is written in the record?",
      pack: prepared.prepared.pack,
      effective: effective.value,
      specification: specification.value,
      evidence: evidence.value,
      plan: prepared.prepared.plan,
      extractions,
      pages,
      authorizedPages: [],
      deadline: 45_000,
      clock: () => now,
      callTurn: callTurn as never,
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.resumable).toBe(true);
    expect(first.error.diagnosticReason).toBe("investigation_window_paused");
    expect(first.error.diagnosticReason).not.toBe("mapping_agent_budget_exhausted");
    const completed = first.progress.windows.filter((window) => window.status === "complete").map((window) => window.windowId);
    expect(completed.length).toBeGreaterThan(0);
    expect(first.progress.windows.some((window) => window.missingDocumentIds.length > 0)).toBe(true);
    expect(first.progress.windows.every((window) => window.acceptedFactIds.length === 0)).toBe(true);
    expect(first.progress.windows.some((window) => window.replay.some((call) => call.name === "propose_relationship"))).toBe(true);
    const before = [...seen];
    const second = await runInvestigationWindows({
      planner: { getConfig: () => ({ baseUrl: "http://127.0.0.1", serviceToken: "test", timeoutMs: 1000 }) },
      prompt,
      runId: "run-window",
      hiveId: HIVE,
      correlationId: "corr-window",
      intent: "What is written in the record?",
      pack: prepared.prepared.pack,
      effective: effective.value,
      specification: specification.value,
      evidence: evidence.value,
      plan: prepared.prepared.plan,
      extractions,
      pages,
      authorizedPages: [],
      saved: first.progress,
      deadline: now + 45_000,
      clock: () => now,
      callTurn: callTurn as never,
    });
    const resumedCalls = seen.slice(before.length);
    for (const windowId of completed) expect(resumedCalls).not.toContain(windowId);
    if (!second.ok) {
      expect(second.resumable || second.error.diagnosticReason === "investigation_incomplete").toBe(true);
    }
  });

  it("sends a window's tool result back to that window and refuses a non-synthetic case", async () => {
    const source = load(V051, "iep-domain-pack-source.v0.5.1.json") as Parameters<typeof prepareInvestigationStudy>[0]["packSource"];
    const prepared = prepareInvestigationStudy({ packSource: source, artifacts: artifacts() });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const effective = compileEffectiveDomainPack({ base: prepared.prepared.pack });
    expect(effective.ok).toBe(true);
    if (!effective.ok) return;
    const specification = specifyCaseInvestigation({ pack: effective.value, hiveId: HIVE, attributes: [] });
    expect(specification.ok).toBe(true);
    if (!specification.ok) return;
    const { pages, extractions } = corpus();
    const evidence = verifyExtractionEvidence({
      extractions,
      pages: pages.flatMap((document) => document.pages.map((page) => ({
        documentId: document.documentId,
        pageNumber: page.pageNumber,
        text: page.text,
        sourcePageDigest: computeSha256Digest(page.text),
      }))),
    });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;
    const prompt = loadPromptCatalog().investigationV2;
    const base = {
      planner: { getConfig: () => ({ baseUrl: "http://127.0.0.1", serviceToken: "test", timeoutMs: 1000 }) },
      prompt,
      runId: "run-window",
      correlationId: "corr-window",
      intent: "What is written in the record?",
      pack: prepared.prepared.pack,
      effective: effective.value,
      specification: specification.value,
      evidence: evidence.value,
      plan: prepared.prepared.plan,
      extractions,
      pages,
      authorizedPages: [] as { documentId: string; pageNumber: number; sourcePageDigest: string }[],
    };
    let calls = 0;
    const altered = pages.map((document, index) => index === 0
      ? { ...document, pages: document.pages.map((page, pageIndex) => pageIndex === 0 ? { ...page, text: page.text + "\nnot the fixture" } : page) }
      : document);
    const refused = await runInvestigationWindows({
      ...base,
      hiveId: HIVE,
      pages: altered,
      deadline: 120_000,
      clock: () => 0,
      callTurn: (async () => {
        calls += 1;
        return { content: null, toolCalls: [], modelAlias: null, resolvedModel: null, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, latencyMs: 0, finishReason: null, roundTripMs: 0 };
      }) as never,
    });
    expect(calls).toBe(0);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.diagnosticReason).toBe("privacy_denied");

    const seenToolResult = new Map<string, boolean>();
    let now = 0;
    const continued = await runInvestigationWindows({
      ...base,
      hiveId: HIVE,
      deadline: 200_000,
      clock: () => now,
      callTurn: (async (_deps: unknown, turn: { request: { messages: { role: string; content?: string }[] } }) => {
        now += 1_000;
        const messages = turn.request.messages;
        const windowId = String(messages[0]?.content ?? "").split("\n")[0]?.replace("WINDOW ", "") ?? "";
        if (messages.some((message) => message.role === "tool")) seenToolResult.set(windowId, true);
        const questions = (String(messages[0]?.content ?? "").split("\n")[1] ?? "").replace("QUESTIONS ", "").split(" ").filter((id) => id !== "");
        const answer = seenToolResult.get(windowId) === true;
        return {
          content: null,
          toolCalls: answer
            ? questions.map((questionId, index) => ({
                id: `answer-${windowId}-${index}`,
                name: "propose_answer",
                arguments: JSON.stringify({ questionId, audience: "all", factIds: [], uncertainty: "The record does not settle this." }),
              }))
            : [{ id: `search-${windowId}-${now}`, name: "search_case", arguments: JSON.stringify({ query: "record" }) }],
          modelAlias: "heavy_lifter",
          resolvedModel: "stub",
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          latencyMs: 1,
          finishReason: "tool_calls",
          roundTripMs: 1,
        };
      }) as never,
    });
    expect(seenToolResult.size).toBeGreaterThan(0);
    expect([...seenToolResult.values()].some((value) => value)).toBe(true);
    if (!continued.ok) expect(continued.error.diagnosticReason).not.toBe("mapping_agent_budget_exhausted");
  });
});
