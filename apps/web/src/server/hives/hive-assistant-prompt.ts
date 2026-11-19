import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ASSISTANT_REPLY_PROMPT_ID, type AuxiliaryPlannerTask } from "@hiveforyou/contracts";

import { resolvePromptsRoot, type PlannerPrompt } from "@/server/study-preparation/prompt-catalog";

const PROMPT_FILE = "hive-assistant-reply/v3.md";

function digestOf(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  return `sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

export function loadHiveAssistantReplyPrompt(cwd: string = process.cwd()): PlannerPrompt & { readonly task: AuxiliaryPlannerTask } {
  const root = resolvePromptsRoot(PROMPT_FILE, cwd);
  const absolute = path.join(root, PROMPT_FILE);
  const raw = readFileSync(absolute, "utf8");
  const systemStart = raw.indexOf("## System");
  const systemEnd = raw.indexOf("## User", systemStart);
  const systemPrompt =
    systemStart >= 0 && systemEnd > systemStart
      ? raw.slice(systemStart + "## System".length, systemEnd).trim()
      : raw.trim();
  return {
    task: "assistant_reply",
    id: ASSISTANT_REPLY_PROMPT_ID,
    digest: digestOf(raw),
    systemPrompt,
  };
}