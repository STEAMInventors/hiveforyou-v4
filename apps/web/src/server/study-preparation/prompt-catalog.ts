import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { PLANNER_TASK_PROMPT_IDS, type PlannerTask, type PreparationPlannerTask } from "@hiveforyou/contracts";

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
const WRITER_SCHEMA_FILE = "hive-writer/hive.writer-report-1.schema.json";

export type PlannerPrompt = {
  readonly task: PlannerTask;
  readonly id: string;
  readonly digest: string;
  readonly systemPrompt: string;
};

export type PromptCatalog = {
  readonly planner: Record<PreparationPlannerTask, PlannerPrompt>;
  readonly studyTemplate: { readonly id: string; readonly version: string; readonly digest: string; readonly text: string };
  readonly outputSchema: { readonly digest: string; readonly text: string };
  readonly writer: PlannerPrompt & { readonly schemaDigest: string };
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
  const writerSchema = normalize(readText(WRITER_SCHEMA_FILE));
  return {
    planner,
    writer: {
      task: "writer",
      id: PLANNER_TASK_PROMPT_IDS.writer,
      digest: sha256Digest(writerFile),
      systemPrompt: `${extractSection(writerFile, "System")}\n\n## Output schema\n\n${writerSchema}`,
      schemaDigest: sha256Digest(writerSchema),
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
