import { ASSISTANT_BRIEFING_FIXED_RULES, type AssistantBriefing, type AssistantBriefingFact } from "./assistant-briefing";
import { isValidUuid } from "./hive-contracts";

export const ASSISTANT_REPLY_MAX_CHARS = 1200;
export const ASSISTANT_REPLY_PROMPT_ID = "hive-assistant-reply/2";
export const ASSISTANT_REPLY_PROMPT_VERSION = "2";

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

export function validateAssistantReply(
  raw: unknown,
  briefing: AssistantBriefing,
  sourceRefsInput: {
    revisionId: string;
    mapFact: (fact: AssistantBriefingFact) => Omit<AssistantSourceRef, "itemKey"> | null;
  },
  fallback: AssistantReplyFallbackInput,
): ValidatedAssistantReply {
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
      if (text !== "" && reply.includes(text)) {
        reply = reply.replace(text, "").replace(/\s{2,}/g, " ").trim();
      }
      continue;
    }
    keptClaims.push(text);
    for (const id of ids) {
      if (usedFactIds.has(id)) continue;
      const fact = facts.get(id)!;
      const mapped = sourceRefsInput.mapFact(fact);
      if (!mapped) continue;
      usedFactIds.add(id);
      sourceRefs.push({ ...mapped, factId: id, studyRevisionId: sourceRefsInput.revisionId });
    }
  }

  let itemKey: string | null = typeof record.itemKey === "string" ? record.itemKey.trim() : null;
  if (itemKey && !checklistKeys(briefing).has(itemKey)) itemKey = null;

  if (intent === "answer" && keptClaims.length === 0 && !reply) {
    intent = "route_to_team";
    reply = assistantAnswerNotFoundFallback(fallback);
  }

  if (intent === "answer" && keptClaims.length === 0) {
    if (VERDICT_QUESTION_PATTERN.test(briefing.question)) {
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
  if (routedOnly) {
    return { intent, reply, sourceRefs: [], itemKey, routedOnly: true };
  }

  return { intent, reply, sourceRefs, itemKey, routedOnly: false };
}

export function parseAssistantReplyModelOutput(raw: unknown): AssistantReplyModelOutput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as AssistantReplyModelOutput;
}

export function revisionIdForAssistant(studyRevisionId: string | null): string {
  const trimmed = studyRevisionId?.trim().toLowerCase() ?? "";
  return isValidUuid(trimmed) ? trimmed : "00000000-0000-4000-8000-000000000001";
}