import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  PLANNER_TASK_PROMPT_IDS,
  WRITER_SEMANTIC_REVIEW_PROMPT_ID,
  type PlannerCompletionTask,
  type PreparationPlannerTask,
} from "@hiveforyou/contracts";

/**
 * Loads the versioned preparation prompts from the repository `prompts/` folder (bundled with the
 * route through `outputFileTracingIncludes`). Each file is digested at load time over its LF-normalized
 * text, so the digest does not depend on the checkout's line endings.
 */

export const STUDY_PREVIEW_PROMPT_ID = "hive-study-preview/1";
export const STUDY_PREVIEW_PROMPT_VERSION = "1";

const PROMPT_FILES: Record<PreparationPlannerTask, string> = {
  intent: "hive-intent/HiveForYou-Intent-v1.md",
  domain: "hive-domain/HiveForYou-Domain-v1.md",
  intelligence: "hive-intent-intelligence/HiveForYou-Intent-Intelligence-v1.md",
};
const STUDY_TEMPLATE_FILE = "hive-study/HiveForYou-Study-Preview-v1.md";
const OUTPUT_SCHEMA_FILE = "hive-study/hive.study-investigation-1.schema.json";
const WRITER_PROMPT_FILE = "hive-writer/HiveForYou-Writer-v1.md";
const WRITER_SEMANTIC_REVIEW_PROMPT_FILE = "hive-writer/HiveForYou-Writer-Semantic-Review-v1.md";
const WRITER_SCHEMA_FILE = "hive-writer/hive.writer-report-1.schema.json";
const EXTRACT_PROMPT_FILE = "hive-extract/HiveForYou-Extract-v1.md";
const CANONICALIZE_PROMPT_FILE = "hive-canonicalize/HiveForYou-Canonicalize-v1.md";
const WRITE_PROMPT_FILE = "hive-write/HiveForYou-Write-v1.md";

export type PlannerPrompt = {
  readonly task: PlannerCompletionTask;
  readonly id: string;
  readonly digest: string;
  readonly systemPrompt: string;
};

export type WriterPrompt = {
  readonly task: "writer";
  readonly id: string;
  readonly digest: string;
  readonly systemPrompt: string;
  readonly schemaDigest: string;
};

export type WriterSemanticReviewPrompt = {
  readonly task: "writer";
  readonly id: typeof WRITER_SEMANTIC_REVIEW_PROMPT_ID;
  readonly digest: string;
  readonly systemPrompt: string;
};

/** `hive-extract/1`: System section as the system prompt, User (template) section rendered per call. */
export type ExtractPrompt = PlannerPrompt & { readonly task: "extract"; readonly userTemplate: string };

/** `hive-canonicalize/1`: System and Output sections joined as the system prompt; the case goes in the user payload. */
export type CanonicalizePrompt = PlannerPrompt & { readonly task: "canonicalize" };

/** `hive-write/1`: System and Output sections joined as the system prompt; the case goes in the user payload. */
export type WritePrompt = PlannerPrompt & { readonly task: "write" };

export type PromptCatalog = {
  readonly planner: Record<PreparationPlannerTask, PlannerPrompt>;
  readonly extract: ExtractPrompt;
  readonly canonicalize: CanonicalizePrompt;
  readonly write: WritePrompt;
  readonly studyTemplate: { readonly id: string; readonly version: string; readonly digest: string; readonly text: string };
  readonly outputSchema: { readonly digest: string; readonly text: string };
  readonly writer: WriterPrompt;
  readonly writerSemanticReview: WriterSemanticReviewPrompt;
};

export function sha256Digest(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Text between `## <heading>` and the next `---` rule or `## ` heading (or end of file). */
export function extractSection(markdown: string, heading: string, untilEnd = false): string {
  const lines = normalize(markdown).split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) {
    throw new Error(`prompt_section_missing:${heading}`);
  }
  const body = lines.slice(start + 1);
  const end = untilEnd ? -1 : body.findIndex((line) => line.trim() === "---" || line.startsWith("## "));
  const section = (end < 0 ? body : body.slice(0, end)).join("\n").trim();
  if (!section) {
    throw new Error(`prompt_section_empty:${heading}`);
  }
  return section;
}

function promptsRoot(cwd: string): string {
  for (const candidate of [path.join(cwd, "../../prompts"), path.join(cwd, "prompts")]) {
    if (existsSync(path.join(candidate, STUDY_TEMPLATE_FILE))) {
      return candidate;
    }
  }
  throw new Error("prompt_files_missing");
}

function readPromptId(markdown: string, expectedId: string): void {
  const escaped = expectedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`Prompt id:\\s*\`${escaped}\``, "i"),
    new RegExp(`\\*\\*Prompt ID:\\*\\*\\s*\`${escaped}\``, "i"),
  ];
  if (!patterns.some((pattern) => pattern.test(markdown))) {
    throw new Error(`prompt_id_mismatch:${expectedId}`);
  }
}

/** Intent analysis prompt uses numbered sections instead of `## System`. */
export function extractIntentAnalysisSystemPrompt(markdown: string): string {
  const normalized = normalize(markdown);
  const start = normalized.indexOf("## 1. Your job");
  if (start < 0) {
    throw new Error("prompt_section_missing:intent");
  }
  const exampleStart = normalized.indexOf("## 7. Example");
  const finalStart = normalized.indexOf("## 8. Final self-check");
  const beforeExample = exampleStart >= 0 ? normalized.slice(start, exampleStart).trim() : normalized.slice(start).trim();
  const finalCheck = finalStart >= 0 ? normalized.slice(finalStart).trim() : "";
  const combined = finalCheck ? `${beforeExample}\n\n${finalCheck}` : beforeExample;
  if (!combined) {
    throw new Error("prompt_section_empty:intent");
  }
  return combined;
}

export function buildPromptCatalog(readText: (relativePath: string) => string): PromptCatalog {
  const planner = {} as Record<PreparationPlannerTask, PlannerPrompt>;
  for (const task of Object.keys(PROMPT_FILES) as PreparationPlannerTask[]) {
    const file = normalize(readText(PROMPT_FILES[task]));
    const expectedId = PLANNER_TASK_PROMPT_IDS[task];
    readPromptId(file, expectedId);
    planner[task] = {
      task,
      id: expectedId,
      digest: sha256Digest(file),
      systemPrompt: task === "intent" ? extractIntentAnalysisSystemPrompt(file) : extractSection(file, "System"),
    };
  }
  const template = normalize(readText(STUDY_TEMPLATE_FILE));
  if (!template.includes(`Prompt id: \`${STUDY_PREVIEW_PROMPT_ID}\``)) {
    throw new Error("prompt_id_mismatch:study");
  }
  const schema = normalize(readText(OUTPUT_SCHEMA_FILE));
  const writerFile = normalize(readText(WRITER_PROMPT_FILE));
  readPromptId(writerFile, PLANNER_TASK_PROMPT_IDS.writer);
  const writerSemanticReviewFile = normalize(readText(WRITER_SEMANTIC_REVIEW_PROMPT_FILE));
  readPromptId(writerSemanticReviewFile, WRITER_SEMANTIC_REVIEW_PROMPT_ID);
  const writerSchema = normalize(readText(WRITER_SCHEMA_FILE));
  const extractFile = normalize(readText(EXTRACT_PROMPT_FILE));
  readPromptId(extractFile, PLANNER_TASK_PROMPT_IDS.extract);
  const canonicalizeFile = normalize(readText(CANONICALIZE_PROMPT_FILE));
  readPromptId(canonicalizeFile, PLANNER_TASK_PROMPT_IDS.canonicalize);
  const writeFile = normalize(readText(WRITE_PROMPT_FILE));
  readPromptId(writeFile, PLANNER_TASK_PROMPT_IDS.write);
  return {
    planner,
    extract: {
      task: "extract",
      id: PLANNER_TASK_PROMPT_IDS.extract,
      digest: sha256Digest(extractFile),
      systemPrompt: extractSection(extractFile, "System"),
      userTemplate: extractSection(extractFile, "User (template)", true),
    },
    canonicalize: {
      task: "canonicalize",
      id: PLANNER_TASK_PROMPT_IDS.canonicalize,
      digest: sha256Digest(canonicalizeFile),
      systemPrompt: `${extractSection(canonicalizeFile, "System")}\n\n${extractSection(canonicalizeFile, "Output", true)}`,
    },
    write: {
      task: "write",
      id: PLANNER_TASK_PROMPT_IDS.write,
      digest: sha256Digest(writeFile),
      systemPrompt: `${extractSection(writeFile, "System")}\n\n${extractSection(writeFile, "Output", true)}`,
    },
    writer: {
      task: "writer",
      id: PLANNER_TASK_PROMPT_IDS.writer,
      digest: sha256Digest(writerFile),
      systemPrompt: extractSection(writerFile, "System"),
      schemaDigest: sha256Digest(writerSchema),
    },
    writerSemanticReview: {
      task: "writer",
      id: WRITER_SEMANTIC_REVIEW_PROMPT_ID,
      digest: sha256Digest(writerSemanticReviewFile),
      systemPrompt: extractSection(writerSemanticReviewFile, "System"),
    },
    studyTemplate: {
      id: STUDY_PREVIEW_PROMPT_ID,
      version: STUDY_PREVIEW_PROMPT_VERSION,
      digest: sha256Digest(template),
      text: extractSection(template, "Template", true),
    },
    outputSchema: { digest: sha256Digest(schema), text: schema },
  };
}

let cached: PromptCatalog | null = null;

export function resetPromptCatalogCache(): void {
  cached = null;
}

export function loadPromptCatalog(cwd: string = process.cwd()): PromptCatalog {
  if (!cached) {
    const root = promptsRoot(cwd);
    cached = buildPromptCatalog((relativePath) => readFileSync(path.join(root, relativePath), "utf8"));
  }
  return cached;
}
