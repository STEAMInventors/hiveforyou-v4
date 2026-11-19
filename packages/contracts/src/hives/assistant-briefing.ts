import type {
  CanonicalStudy,
  CanonicalConflict,
  CanonicalGap,
  TimelineEntry,
} from "../pipeline/canonical-study-contracts";
import type { Pack, PackPersona } from "../pipeline/pack-contracts";
import type { StudyViewSources } from "../pipeline/study-view-contracts";
import { matchTokens } from "../pipeline/study-view-reference-match";
import type { RequestItem } from "./hive-request-contracts";
import type { HiveMessage } from "./hive-conversation";

export const ASSISTANT_BRIEFING_DEFAULT_BUDGET_BYTES = 120 * 1024;
export const ASSISTANT_BRIEFING_HARD_CAP_BYTES = 192 * 1024;

export const ASSISTANT_BRIEFING_FIXED_RULES = [
  "Use only facts listed in the briefing.",
  "Never give legal advice or predict outcomes.",
  "Never state eligibility or tell someone what they must do.",
  "If the documents do not support an answer, hand the question to the team.",
  "Every document claim must cite fact ids from the briefing.",
] as const;

export type AssistantBriefingAskerRole = "client" | "staff" | "owner" | "professional";

export type AssistantBriefingChecklistStatus =
  | "in"
  | "missing"
  | "wrong_period"
  | "unreadable"
  | "not_needed";

export type AssistantBriefingFact = {
  readonly id: string;
  readonly statement: string;
  readonly sourceLabel: string;
  readonly page: number | null;
};

export type AssistantBriefingGap = { readonly id: string; readonly title: string; readonly why: string };
export type AssistantBriefingConflict = { readonly id: string; readonly statement: string; readonly factIds: readonly string[] };
export type AssistantBriefingTimeline = { readonly date: string | null; readonly statement: string; readonly factIds: readonly string[] };

export type AssistantBriefingChecklistItem = {
  readonly key: string;
  readonly title: string;
  readonly status: AssistantBriefingChecklistStatus;
  readonly note: string | null;
};

export type AssistantBriefingDocument = {
  readonly label: string;
  readonly pages: number | null;
  readonly readState: string;
  readonly unreadablePages: readonly number[];
};

export type AssistantBriefingConversationMessage = {
  readonly by: string;
  readonly isAssistant: boolean;
  readonly body: string;
};

export type AssistantBriefing = {
  readonly asker: {
    readonly role: AssistantBriefingAskerRole;
    readonly roleLabel: string;
    readonly firstName: string;
  };
  readonly audiencePersona: Record<string, string> | null;
  readonly assistantName: string;
  readonly hive: {
    readonly name: string;
    readonly purpose: string | null;
    readonly matterType: string | null;
    readonly stage: string | null;
  };
  readonly checklist: readonly AssistantBriefingChecklistItem[];
  readonly study: {
    readonly revisionId: string | null;
    readonly revisionNumber: number | null;
    readonly facts: readonly AssistantBriefingFact[];
    readonly gaps: readonly AssistantBriefingGap[];
    readonly conflicts: readonly AssistantBriefingConflict[];
    readonly timeline: readonly AssistantBriefingTimeline[];
  };
  readonly documents: readonly AssistantBriefingDocument[];
  readonly conversation: {
    readonly recent: readonly AssistantBriefingConversationMessage[];
    readonly olderSummary: string | null;
  };
  readonly rules: readonly string[];
  readonly question: string;
};

export type BuildAssistantBriefingInput = {
  readonly titleAsPrintedById?: Readonly<Record<string, string>>;
  readonly viewer: {
    role: AssistantBriefingAskerRole;
    roleLabel: string;
    firstName: string;
  };
  readonly hive: {
    name: string;
    purpose: string | null;
    matterType: string | null;
    stage: string | null;
  };
  readonly pack: Pack | null;
  readonly checklist: readonly RequestItem[];
  readonly study: {
    revisionId: string | null;
    revisionNumber: number | null;
    canonical: CanonicalStudy | null;
    sources: StudyViewSources | null;
  };
  readonly documents: readonly {
    label: string;
    pages: number | null;
    readState: string;
    unreadablePages: readonly number[];
  }[];
  readonly messages: readonly HiveMessage[];
  readonly question: string;
  readonly assistantName: string;
  readonly budgetBytes?: number;
};

function personaForRole(pack: Pack | null, role: AssistantBriefingAskerRole): Record<string, string> | null {
  if (!pack) return null;
  const audience = role === "client" ? "customer" : "professional";
  const persona: PackPersona | undefined = pack.personas.find((p) => p.audience === audience);
  if (!persona) return null;
  return {
    who: persona.who,
    situation: persona.situation,
    knows: persona.knows,
    doesNotKnow: persona.doesNotKnow,
    decisions: persona.decisions,
    usefulWhen: persona.usefulWhen,
    leaveOut: persona.leaveOut,
  };
}

function packNeverSayRules(pack: Pack | null): string[] {
  if (!pack) return [];
  const rules = [...pack.rules];
  for (const persona of pack.personas) {
    if (persona.leaveOut.trim()) rules.push(persona.leaveOut.trim());
  }
  for (const question of pack.standingQuestions) {
    if (question.question.trim()) rules.push(question.question.trim());
  }
  return rules.filter((rule, index, all) => rule !== "" && all.indexOf(rule) === index);
}

function requestStatus(item: RequestItem): AssistantBriefingChecklistStatus {
  if (item.state === "NOT_NEEDED") return "not_needed";
  if (item.state === "CHECKED") return "in";
  const verdict = item.latestCheck?.verdict;
  if (verdict === "WRONG_PERIOD") return "wrong_period";
  if (item.state === "NEEDS_FIX" || item.state === "DOESNT_MATCH") return "wrong_period";
  if (item.documents.some((doc) => doc.fileName.toLowerCase().includes("unreadable"))) return "unreadable";
  if (item.state === "WAITING") return "missing";
  if (item.state === "RECEIVED" || item.state === "READING") return "missing";
  return "missing";
}

function checklistFromRequests(requests: readonly RequestItem[]): AssistantBriefingChecklistItem[] {
  return requests
    .filter((row) => row.state !== "NOT_NEEDED")
    .map((row) => ({
      key: row.packRowKey?.trim() || row.title.trim().toLowerCase().replace(/\s+/g, " "),
      title: row.title.trim(),
      status: requestStatus(row),
      note: row.stateNote?.trim() || row.latestCheck?.sentence?.trim() || null,
    }));
}

export type StudyDocumentRoleLabelOptions = {
  readonly sources?: StudyViewSources | null;
  readonly titleAsPrintedById?: Readonly<Record<string, string>>;
};

export function canonicalStudyDocumentRoleLabel(
  study: CanonicalStudy,
  sourceDocumentId: string,
  options?: StudyDocumentRoleLabelOptions,
): string {
  const id = sourceDocumentId.toLowerCase();
  const doc = study.documents.find((d) => d.sourceDocumentId.toLowerCase() === id);
  const type = doc?.typeInPlainWords?.trim();
  if (type) return type;
  const fromSources = options?.sources?.documents[id]?.typeInPlainWords?.trim();
  if (fromSources) return fromSources;
  const printed = options?.titleAsPrintedById?.[id]?.trim();
  if (printed) return printed;
  const index = study.documents.findIndex((d) => d.sourceDocumentId.toLowerCase() === id);
  return `Document ${index >= 0 ? index + 1 : study.documents.length + 1}`;
}

function documentLabel(
  study: CanonicalStudy,
  sourceDocumentId: string,
  sources: StudyViewSources | null,
  titleAsPrintedById?: Readonly<Record<string, string>>,
): string {
  return canonicalStudyDocumentRoleLabel(study, sourceDocumentId, { sources, titleAsPrintedById });
}

function studyFacts(
  study: CanonicalStudy,
  sources: StudyViewSources | null,
  titleAsPrintedById?: Readonly<Record<string, string>>,
): AssistantBriefingFact[] {
  const byId = new Map<string, AssistantBriefingFact>();
  const add = (id: string, statement: string, sourceDocumentId: string, page: number | null) => {
    const text = statement.trim();
    if (text === "" || byId.has(id)) return;
    const source = sources?.facts[id];
    const docId = source?.sourceDocumentId ?? sourceDocumentId;
    const pageNumber = source?.pageNumber ?? page;
    byId.set(id, {
      id,
      statement: text,
      sourceLabel: documentLabel(study, docId, sources, titleAsPrintedById),
      page: pageNumber ?? null,
    });
  };
  for (const row of study.outsideSpine) {
    for (const factId of row.factIds) add(factId, row.statement, "", null);
  }
  for (const row of study.spine) {
    for (const factId of [...row.supportingFactIds, ...row.contradictingFactIds, ...row.updatingFactIds]) {
      add(factId, row.label, "", null);
    }
  }
  for (const entry of study.timeline) {
    for (const factId of entry.factIds) add(factId, entry.statement, "", null);
  }
  if (sources) {
    for (const [factId, ref] of Object.entries(sources.facts)) {
      const existing = byId.get(factId);
      if (existing) {
        byId.set(factId, {
          ...existing,
          sourceLabel: documentLabel(study, ref.sourceDocumentId, sources, titleAsPrintedById),
          page: ref.pageNumber,
        });
      }
    }
  }
  return [...byId.values()];
}

function gapsFromStudy(gaps: readonly CanonicalGap[]): AssistantBriefingGap[] {
  return gaps.map((gap) => ({
    id: gap.id,
    title: gap.title.trim() || gap.statement.trim(),
    why: gap.why.trim() || gap.statement.trim(),
  }));
}

function conflictsFromStudy(conflicts: readonly CanonicalConflict[]): AssistantBriefingConflict[] {
  return conflicts.map((row) => ({
    id: row.id,
    statement: row.statement.trim(),
    factIds: [...row.factIds],
  }));
}

function timelineFromStudy(timeline: readonly TimelineEntry[]): AssistantBriefingTimeline[] {
  return timeline.map((entry) => ({
    date: entry.date,
    statement: entry.statement.trim(),
    factIds: [...entry.factIds],
  }));
}

function conversationSlice(messages: readonly HiveMessage[]): {
  recent: AssistantBriefingConversationMessage[];
  olderSummary: string | null;
} {
  const chronological = [...messages].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (chronological.length <= 20) {
    return {
      recent: chronological.map((message) => ({
        by: message.authorRoleLabel ?? message.authorDisplayName,
        isAssistant: message.authorKind === "assistant",
        body: message.body,
      })),
      olderSummary: null,
    };
  }
  const older = chronological.slice(0, chronological.length - 20);
  const recent = chronological.slice(-20);
  const counts = new Map<string, number>();
  for (const message of older) {
    const label = message.authorRoleLabel ?? message.authorDisplayName;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${count} from ${label}`);
  return {
    recent: recent.map((message) => ({
      by: message.authorRoleLabel ?? message.authorDisplayName,
      isAssistant: message.authorKind === "assistant",
      body: message.body,
    })),
    olderSummary: `Earlier in this hive: ${older.length} messages (${parts.join("; ")}).`,
  };
}

function topicScore(question: string, text: string): number {
  const q = matchTokens(question);
  const t = [...matchTokens(text)];
  if (t.length === 0) return 0;
  const shared = t.filter((token) => q.has(token)).length;
  return shared;
}

function trimStudyFacts(
  briefing: AssistantBriefing,
  question: string,
  budgetBytes: number,
): AssistantBriefingFact[] {
  const base = JSON.stringify({ ...briefing, study: { ...briefing.study, facts: [] } }).length;
  const gapsJson = JSON.stringify(briefing.study.gaps).length;
  const conflictsJson = JSON.stringify(briefing.study.conflicts).length;
  const timelineJson = JSON.stringify(briefing.study.timeline).length;
  let remaining = budgetBytes - base - gapsJson - conflictsJson - timelineJson - 512;
  if (remaining <= 0) return [];

  const scores = new Map<string, number>();
  for (const fact of briefing.study.facts) {
    scores.set(fact.id, topicScore(question, fact.statement));
  }

  const ordered = [...briefing.study.facts].sort((a, b) => {
    const diff = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const kept: AssistantBriefingFact[] = [];
  for (const fact of ordered) {
    const slice = JSON.stringify(fact).length + 2;
    if (slice > remaining) break;
    kept.push(fact);
    remaining -= slice;
  }
  return kept;
}

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const FILE_EXT_PATTERN = /\b[\w-]+\.(pdf|png|jpe?g|tif|tiff|docx?|xlsx?)\b/gi;

export function sanitizeBriefingPayload(briefing: AssistantBriefing): AssistantBriefing {
  const strip = (text: string) => text.replace(EMAIL_PATTERN, "").replace(FILE_EXT_PATTERN, "").trim();
  return {
    ...briefing,
    question: strip(briefing.question),
    conversation: {
      recent: briefing.conversation.recent.map((row) => ({ ...row, body: strip(row.body) })),
      olderSummary: briefing.conversation.olderSummary ? strip(briefing.conversation.olderSummary) : null,
    },
    study: {
      ...briefing.study,
      facts: briefing.study.facts.map((fact) => ({ ...fact, statement: strip(fact.statement) })),
    },
  };
}

export function briefingByteSize(briefing: AssistantBriefing): number {
  return new TextEncoder().encode(JSON.stringify(briefing)).length;
}

export function buildAssistantBriefing(input: BuildAssistantBriefingInput): AssistantBriefing {
  const budget = Math.min(
    input.budgetBytes ?? ASSISTANT_BRIEFING_DEFAULT_BUDGET_BYTES,
    ASSISTANT_BRIEFING_HARD_CAP_BYTES,
  );
  const canonical = input.study.canonical;
  const facts = canonical ? studyFacts(canonical, input.study.sources, input.titleAsPrintedById) : [];
  const rules = [...ASSISTANT_BRIEFING_FIXED_RULES, ...packNeverSayRules(input.pack)];

  let briefing: AssistantBriefing = sanitizeBriefingPayload({
    asker: {
      role: input.viewer.role,
      roleLabel: input.viewer.roleLabel,
      firstName: input.viewer.firstName,
    },
    audiencePersona: personaForRole(input.pack, input.viewer.role),
    assistantName: input.assistantName.trim() || "HiveForYou",
    hive: {
      name: input.hive.name.trim(),
      purpose: input.hive.purpose?.trim() || null,
      matterType: input.hive.matterType?.trim() || null,
      stage: input.hive.stage?.trim() || null,
    },
    checklist: checklistFromRequests(input.checklist),
    study: {
      revisionId: input.study.revisionId,
      revisionNumber: input.study.revisionNumber,
      facts,
      gaps: canonical ? gapsFromStudy(canonical.gaps) : [],
      conflicts: canonical ? conflictsFromStudy(canonical.conflicts) : [],
      timeline: canonical ? timelineFromStudy(canonical.timeline) : [],
    },
    documents: input.documents.map((doc) => ({ ...doc })),
    conversation: conversationSlice(input.messages),
    rules,
    question: input.question.trim(),
  });

  if (briefingByteSize(briefing) > budget) {
    briefing = {
      ...briefing,
      study: {
        ...briefing.study,
        facts: trimStudyFacts(briefing, input.question, budget),
      },
    };
  }
  return briefing;
}