import {
  normalizeSemanticReviewFindings,
  SEMANTIC_REVIEW_SCHEMA,
  semanticReviewInvalidReviewerResponseFinding,
  type SemanticReviewFinding,
  type WriterSemanticReviewer,
  type WriterSemanticReviewerInput,
  WRITER_AGENT_BUDGET,
  WRITER_SEMANTIC_REVIEW_PROMPT_ID,
} from "@hiveforyou/contracts";

import { callStudyAgentTurn, type PlannerDeps } from "@/server/study-preparation/planner-client";
import { loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";

const SEMANTIC_REVIEW_MAX_OUTPUT_TOKENS = 4_000;
const SEMANTIC_REVIEW_TURN_ABORT_MARGIN_MS = WRITER_AGENT_BUDGET.turnAbortMarginMs;

function parseReviewerContent(content: string | null): SemanticReviewFinding[] | null {
  if (!content || !content.trim()) return null;
  try {
    const parsed = JSON.parse(content) as { schema?: unknown; findings?: unknown };
    if (parsed.schema !== SEMANTIC_REVIEW_SCHEMA && parsed.schema !== undefined) return null;
    if (!Array.isArray(parsed.findings)) return null;
    return normalizeSemanticReviewFindings(parsed.findings as SemanticReviewFinding[]);
  } catch {
    return null;
  }
}

export type CreateWriterSemanticReviewerInput = {
  readonly planner: PlannerDeps;
  readonly correlationId: string;
  readonly reportRunId: string;
  readonly deadlineMs: number;
  readonly clock?: () => number;
  readonly loadCatalog?: typeof loadPromptCatalog;
};

/** Frontier-model semantic reviewer relayed through tool-free `study-agent-turn@1` JSON completion. */
export function createWriterSemanticReviewer(input: CreateWriterSemanticReviewerInput): WriterSemanticReviewer {
  const clock = input.clock ?? Date.now;
  const catalog = (input.loadCatalog ?? loadPromptCatalog)();
  const prompt = catalog.writerSemanticReview;
  if (prompt.id !== WRITER_SEMANTIC_REVIEW_PROMPT_ID) {
    throw new Error("writer_semantic_review_prompt_id_mismatch");
  }

  return async (reviewInput: WriterSemanticReviewerInput): Promise<SemanticReviewFinding[]> => {
    const remainingMs = input.deadlineMs - clock();
    const turnMs = Math.min(WRITER_AGENT_BUDGET.maxTurnMs, remainingMs);
    if (turnMs < WRITER_AGENT_BUDGET.minTurnMs) {
      return [semanticReviewInvalidReviewerResponseFinding("Semantic review exceeded the Writer wall-clock budget.")];
    }
    const maxOutputTokens = Math.min(
      SEMANTIC_REVIEW_MAX_OUTPUT_TOKENS,
      WRITER_AGENT_BUDGET.maxOutputTokens,
      WRITER_AGENT_BUDGET.turnOutputTokens,
    );
    const abortMs = Math.max(WRITER_AGENT_BUDGET.minTurnMs, turnMs);
    const timeoutSeconds = Math.max(
      5,
      Math.floor((abortMs - SEMANTIC_REVIEW_TURN_ABORT_MARGIN_MS) / 1000),
    );

    const payload = JSON.stringify({
      schema: SEMANTIC_REVIEW_SCHEMA,
      audience: reviewInput.audience,
      assertions: reviewInput.assertions,
      claims: reviewInput.claims,
    });

    let turn: Awaited<ReturnType<typeof callStudyAgentTurn>>;
    try {
      turn = await callStudyAgentTurn(input.planner, {
        request: {
          task: "writer",
          prompt_id: prompt.id,
          prompt_digest: prompt.digest,
          system_prompt: prompt.systemPrompt,
          messages: [{ role: "user", content: payload }],
          tools: [],
          max_output_tokens: maxOutputTokens,
          timeout_seconds: timeoutSeconds,
        },
        abortMs,
        correlationId: input.correlationId,
        processingRunId: input.reportRunId,
      });
    } catch {
      return [
        semanticReviewInvalidReviewerResponseFinding(
          "The independent semantic reviewer call failed before returning structured findings.",
        ),
      ];
    }

    const findings = parseReviewerContent(turn.content);
    if (findings === null) {
      return [
        semanticReviewInvalidReviewerResponseFinding(
          "The independent semantic reviewer returned empty or invalid hive.writer-semantic-review/1 JSON.",
        ),
      ];
    }
    return findings;
  };
}

export { WRITER_SEMANTIC_REVIEW_PROMPT_ID };
