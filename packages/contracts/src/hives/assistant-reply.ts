import { ASSISTANT_BRIEFING_FIXED_RULES, type AssistantBriefing, type AssistantBriefingFact } from "./assistant-briefing";
import { isValidUuid } from "./hive-contracts";

export const ASSISTANT_REPLY_MAX_CHARS = 1200;
export const ASSISTANT_REPLY_PROMPT_ID = "hive-assistant-reply/3";
export const ASSISTANT_REPLY_PROMPT_VERSION = "3";
export const ASSISTANT_REPLY_LEGACY_PROMPT_ID = "hive-assistant-reply/2";

export const ASSISTANT_ROUTE_GUARD_PHRASES = [
  "you should",
  "you must",
  "you qualify",
  "you are eligible",
  "you're eligible",
  "i recommend",
  "i advise",
  "you will win",
  "you will lose",
  "legal advice",
] as const;

const ELIGIBILITY_GUARD_PHRASES = [
  "is eligible",
  "isn't eligible",
  "is not eligible",
  "qualifies",
  "doesn't qualify",
] as const;

const VERDICT_QUESTION_PATTERN = /eligib|qualif|approve|deny|win|lose|should i|must i/i;
const LEADING_YES_NO = /^(yes|no)\b[!.:,]?\s*/i;

const HIVE_NAVIGATION_QUESTION =
  /\b(where|how)\b.*\b(documents?|uploads?|files?|report|timeline|audit|messages?|team notes?)\b/i;

/** Product navigation — not answered from study facts; avoids evidence-based refusal. */
export function assistantHiveNavigationAnswer(question: string): string | null {
  const trimmed = question.trim();
  if (trimmed === "") return null;
  if (!HIVE_NAVIGATION_QUESTION.test(trimmed)) return null;
  if (/\bdocuments?\b|\buploads?\b|\bfiles?\b/i.test(trimmed)) {
    return "Open Documents in the left menu to see what is uploaded, what is still to come, and to add files.";
  }
  if (/\breport\b/i.test(trimmed)) {
    return "Open Report in the left menu for the written report from the accepted study.";
  }
  if (/\btimeline\b/i.test(trimmed)) {
    return "Open Timeline in the left menu for events in date order.";
  }
  if (/\baudit\b/i.test(trimmed)) {
    return "Open Audit trail in the left menu for the checks HiveForYou ran on these documents.";
  }
  if (/\bmessages?\b/i.test(trimmed)) {
    return "Open Home and use the conversation panel to message your team or the assistant.";
  }
  if (/\bteam notes?\b/i.test(trimmed)) {
    return "Open Team notes in the left menu for internal notes visible only to your firm.";
  }
  return null;
}

export type AssistantReplyIntent = "answer" | "ask_for_item" | "route_to_team";

export type AssistantReplyModelOutput = {
  intent?: string;
  reply?: string;
  claims?: { text?: string; factIds?: string[] }[];
  itemKey?: string | null;
};

export type AssistantSourceRef = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly shortLabel: string;
  readonly factId: string;
  readonly studyRevisionId: string;
  readonly itemKey?: string;
};

export type ValidatedAssistantReply = {
  readonly intent: AssistantReplyIntent;
  readonly reply: string;
  readonly sourceRefs: readonly AssistantSourceRef[];
  readonly itemKey: string | null;
  readonly routedOnly: boolean;
};

export type AssistantReplyFallbackInput = {
  readonly teamFirstName: string | null;
  /** When false, use owner-only hive copy (no firm team to route to). */
  readonly hasTeam?: boolean;
};

export function assistantAnswerNotFoundFallback(input: AssistantReplyFallbackInput): string {
  if (input.hasTeam === false) {
    return "I couldn't find that in the documents yet. Try adding the document it would be in, or ask me another way.";
  }
  const team = input.teamFirstName?.trim() || "the team";
  return `I couldn't find that in the documents yet. I've asked ${team} to take a look.`;
}

export function assistantRouteFallback(input: AssistantReplyFallbackInput): string {
  if (input.hasTeam === false) {
    return "That's a question for a professional. I can only tell you what your documents say.";
  }
  const team = input.teamFirstName?.trim() || "the team";
  return `That's a good question for ${team}. I've passed it on.`;
}

const ASK_ITEM_LINE = "You can add it here: Documents → What we asked for.";

function parseIntent(value: unknown): AssistantReplyIntent {
  if (value === "answer" || value === "ask_for_item" || value === "route_to_team") return value;
  return "route_to_team";
}

function factMap(briefing: AssistantBriefing): Map<string, AssistantBriefingFact> {
  return new Map(briefing.study.facts.map((fact) => [fact.id, fact]));
}

function checklistKeys(briefing: AssistantBriefing): Set<string> {
  return new Set(briefing.checklist.map((row) => row.key));
}

function stripUrls(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s]+/gi, "").replace(/\bwww\.[^\s]+/gi, "");
}

function sentenceCitesDocument(sentence: string): boolean {
  return /\b(records|states|lists|found)\b/i.test(sentence);
}

function replyHasBlockedEligibilityPhrase(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((part) => part.trim() !== "");
  const parts = sentences.length > 0 ? sentences : [text];
  for (const sentence of parts) {
    const lower = sentence.toLowerCase();
    for (const phrase of ELIGIBILITY_GUARD_PHRASES) {
      if (!lower.includes(phrase)) continue;
      if (sentenceCitesDocument(sentence)) continue;
      return true;
    }
  }
  return false;
}

function containsGuardPhrase(text: string, extra: readonly string[]): boolean {
  const lower = text.toLowerCase();
  const phrases = [...ASSISTANT_ROUTE_GUARD_PHRASES, ...extra.map((p) => p.toLowerCase())];
  return phrases.some((phrase) => lower.includes(phrase)) || replyHasBlockedEligibilityPhrase(text);
}

export function stripLeadingVerdictYesNo(question: string, reply: string): string {
  if (!VERDICT_QUESTION_PATTERN.test(question)) return reply;
  return reply.replace(LEADING_YES_NO, "").trim();
}

const DATE_IN_TEXT =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i;
const NUMBER_IN_TEXT = /\d[\d,.%]*/;
const LIST_PREFIX = /^(\d+\.\s+|[-•]\s+)/;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function fourWordRunInSentence(sentence: string, statement: string): boolean {
  const words = tokenize(statement);
  const lower = sentence.toLowerCase();
  for (let index = 0; index <= words.length - 4; index += 1) {
    const phrase = words.slice(index, index + 4).join(" ");
    if (lower.includes(phrase)) return true;
  }
  return false;
}

function matchingFactsForSentence(sentence: string, facts: readonly AssistantBriefingFact[]): AssistantBriefingFact[] {
  const matched: AssistantBriefingFact[] = [];
  for (const fact of facts) {
    if (fourWordRunInSentence(sentence, fact.statement)) {
      matched.push(fact);
      continue;
    }
    const nums = sentence.match(/\d[\d,.%]*/g) ?? [];
    if (nums.some((value) => fact.statement.includes(value))) {
      matched.push(fact);
      continue;
    }
    if (DATE_IN_TEXT.test(sentence)) {
      const date = sentence.match(DATE_IN_TEXT)?.[0]?.toLowerCase();
      if (date && fact.statement.toLowerCase().includes(date)) matched.push(fact);
    }
  }
  return matched;
}

function sentenceNeedsCitation(sentence: string, facts: readonly AssistantBriefingFact[]): boolean {
  if (NUMBER_IN_TEXT.test(sentence)) return true;
  if (DATE_IN_TEXT.test(sentence)) return true;
  return facts.some((fact) => fourWordRunInSentence(sentence, fact.statement));
}

export function replySegments(text: string): string[] {
  const segments: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (LIST_PREFIX.test(trimmed)) {
      segments.push(trimmed);
      continue;
    }
    const parts = trimmed.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
    segments.push(...(parts.length > 0 ? parts : [trimmed]));
  }
  return segments;
}

export function sanitizeTeamMentionsInReply(reply: string, fallback: AssistantReplyFallbackInput): string {
  if (fallback.hasTeam !== false) return reply;
  if (!/\bteam\b/i.test(reply)) return reply;
  return replySegments(reply)
    .map((segment) => (/\bteam\b/i.test(segment) ? assistantRouteFallback(fallback) : segment))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type AssistantFactMapper = (
  fact: AssistantBriefingFact,
) => Omit<AssistantSourceRef, "itemKey"> | readonly Omit<AssistantSourceRef, "itemKey">[] | null;

function stripRejectedClaimText(reply: string, claimText: string): string {
  if (claimText === "" || !reply.includes(claimText)) return reply;
  const cleaned = reply
    .split(claimText)
    .join("")
    .replace(/([.!?])\s*[.,;!?]+/g, "$1")
    .replace(/(^|\n)\s*[.,;!?]+\s*/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return /^[.,;!?]+$/.test(cleaned) ? "" : cleaned;
}

function appendMappedRefs(
  fact: AssistantBriefingFact,
  mapped: ReturnType<AssistantFactMapper>,
  revisionId: string,
  usedFactIds: Set<string>,
  sourceRefs: AssistantSourceRef[],
): boolean {
  const normalizedRevisionId = typeof revisionId === "string" ? revisionId.trim().toLowerCase() : "";
  if (!isValidUuid(normalizedRevisionId)) return false;
  if (!mapped) return false;
  const list = Array.isArray(mapped) ? mapped : [mapped];
  let added = false;
  for (const ref of list) {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) continue;
    const docId = typeof ref.sourceDocumentId === "string" ? ref.sourceDocumentId.trim().toLowerCase() : "";
    const shortLabel = typeof ref.shortLabel === "string" ? ref.shortLabel.trim() : "";
    const refFactId = typeof ref.factId === "string" ? ref.factId.trim() : "";
    const refRevisionId = typeof ref.studyRevisionId === "string" ? ref.studyRevisionId.trim().toLowerCase() : "";
    if (
      !isValidUuid(docId) ||
      typeof ref.pageNumber !== "number" ||
      !Number.isInteger(ref.pageNumber) ||
      ref.pageNumber < 1 ||
      shortLabel === "" ||
      refFactId !== fact.id ||
      refRevisionId !== normalizedRevisionId
    ) {
      continue;
    }
    const alreadyPresent = sourceRefs.some(
      (existing) =>
        existing.sourceDocumentId === docId &&
        existing.pageNumber === ref.pageNumber &&
        existing.factId === fact.id &&
        existing.studyRevisionId === normalizedRevisionId,
    );
    if (!alreadyPresent) {
      sourceRefs.push({
        sourceDocumentId: docId,
        pageNumber: ref.pageNumber,
        shortLabel,
        factId: fact.id,
        studyRevisionId: normalizedRevisionId,
      });
    }
    added = true;
  }
  if (added) usedFactIds.add(fact.id);
  return added;
}

function enforceReplyFactCitations(
  reply: string,
  facts: readonly AssistantBriefingFact[],
  usedFactIds: Set<string>,
  sourceRefs: AssistantSourceRef[],
  mapFact: AssistantFactMapper,
  revisionId: string,
): { reply: string; keptFactual: boolean } {
  const kept: string[] = [];
  let keptFactual = false;
  for (const segment of replySegments(reply)) {
    const needsCitation = sentenceNeedsCitation(segment, facts);
    const matches = needsCitation ? matchingFactsForSentence(segment, facts) : [];
    if (needsCitation && matches.length === 0) continue;
    if (matches.length > 0) {
      if (matches.some((fact) => usedFactIds.has(fact.id))) {
        kept.push(segment);
        keptFactual = true;
        continue;
      }
      let resolved = false;
      for (const fact of matches) {
        if (appendMappedRefs(fact, mapFact(fact), revisionId, usedFactIds, sourceRefs)) {
          resolved = true;
        }
      }
      if (!resolved) continue;
      kept.push(segment);
      keptFactual = true;
    } else {
      kept.push(segment);
    }
  }
  const rebuilt = kept.join(" ").replace(/\s{2,}/g, " ").trim();
  return { reply: rebuilt, keptFactual };
}

export function validateAssistantReply(
  raw: unknown,
  briefing: AssistantBriefing,
  sourceRefsInput: {
    revisionId: string;
    mapFact: AssistantFactMapper;
  },
  fallback: AssistantReplyFallbackInput,
): ValidatedAssistantReply {
  const navigationAnswer = assistantHiveNavigationAnswer(briefing.question);
  if (navigationAnswer) {
    return {
      intent: "answer",
      reply: navigationAnswer,
      sourceRefs: [],
      itemKey: null,
      routedOnly: false,
    };
  }

  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as AssistantReplyModelOutput) : {};
  let intent = parseIntent(record.intent);
  let reply = typeof record.reply === "string" ? record.reply.trim() : "";
  reply = stripLeadingVerdictYesNo(briefing.question, reply);
  const packNeverSay = briefing.rules.filter((rule) => !(ASSISTANT_BRIEFING_FIXED_RULES as readonly string[]).includes(rule));

  if (containsGuardPhrase(reply, packNeverSay)) {
    intent = "route_to_team";
    reply = assistantRouteFallback(fallback);
  }

  const facts = factMap(briefing);
  const claims = Array.isArray(record.claims) ? record.claims : [];
  const keptClaims: string[] = [];
  const sourceRefs: AssistantSourceRef[] = [];
  const usedFactIds = new Set<string>();

  for (const claim of claims) {
    const text = typeof claim?.text === "string" ? claim.text.trim() : "";
    const ids = Array.isArray(claim?.factIds)
      ? claim.factIds.filter((id): id is string => typeof id === "string" && facts.has(id))
      : [];
    if (text === "" || ids.length === 0) {
      reply = stripRejectedClaimText(reply, text);
      continue;
    }
    let claimResolved = false;
    for (const id of ids) {
      if (usedFactIds.has(id)) {
        claimResolved = true;
        continue;
      }
      const fact = facts.get(id)!;
      if (appendMappedRefs(fact, sourceRefsInput.mapFact(fact), sourceRefsInput.revisionId, usedFactIds, sourceRefs)) {
        claimResolved = true;
      }
    }
    if (!claimResolved) {
      reply = stripRejectedClaimText(reply, text);
      continue;
    }
    keptClaims.push(text);
  }

  let itemKey: string | null = typeof record.itemKey === "string" ? record.itemKey.trim() : null;
  if (itemKey && !checklistKeys(briefing).has(itemKey)) itemKey = null;

  const enforced = enforceReplyFactCitations(
    reply,
    briefing.study.facts,
    usedFactIds,
    sourceRefs,
    sourceRefsInput.mapFact,
    sourceRefsInput.revisionId,
  );
  reply = enforced.reply;
  reply = sanitizeTeamMentionsInReply(reply, fallback);

  const hasDocumentSupport =
    sourceRefs.length > 0 && (enforced.keptFactual || keptClaims.length > 0) && reply !== "";

  if (intent === "answer" && !hasDocumentSupport) {
    sourceRefs.length = 0;
    if (!reply) {
      intent = "route_to_team";
      reply = assistantAnswerNotFoundFallback(fallback);
    } else if (VERDICT_QUESTION_PATTERN.test(briefing.question)) {
      intent = "route_to_team";
      reply = assistantRouteFallback(fallback);
    } else {
      reply = assistantAnswerNotFoundFallback(fallback);
    }
  }

  if (intent === "route_to_team" && !reply) {
    reply = assistantRouteFallback(fallback);
  }

  if (intent === "ask_for_item" && itemKey) {
    if (!reply.includes(ASK_ITEM_LINE)) {
      reply = `${reply.replace(/\s+$/, "")} ${ASK_ITEM_LINE}`.trim();
    }
  }

  reply = stripUrls(reply).trim();
  if (reply.length > ASSISTANT_REPLY_MAX_CHARS) {
    reply = reply.slice(0, ASSISTANT_REPLY_MAX_CHARS).trim();
  }

  const routedOnly = intent === "route_to_team";
  return { intent, reply, sourceRefs, itemKey, routedOnly };
}

export function parseAssistantReplyModelOutput(raw: unknown): AssistantReplyModelOutput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as AssistantReplyModelOutput;
}

export function revisionIdForAssistant(studyRevisionId: string | null): string {
  const trimmed = studyRevisionId?.trim().toLowerCase() ?? "";
  return isValidUuid(trimmed) ? trimmed : "00000000-0000-4000-8000-000000000001";
}