import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { CHECKLIST_TAILOR_PROMPT_ID, type AuxiliaryPlannerTask } from "@hiveforyou/contracts";

import type { PlannerPrompt } from "./prompt-catalog";

const PROMPT_FILE = "checklist-tailor/v1.md";

function repoPath(...parts: string[]): string {
  return path.join(process.cwd(), ...parts);
}

function digestOf(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  return `sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

export function loadChecklistTailorPrompt(): PlannerPrompt & { readonly task: AuxiliaryPlannerTask } {
  const absolute = repoPath("prompts", PROMPT_FILE);
  const raw = readFileSync(absolute, "utf8");
  const systemStart = raw.indexOf("## System");
  const systemEnd = raw.indexOf("## User", systemStart);
  const systemPrompt =
    systemStart >= 0 && systemEnd > systemStart
      ? raw.slice(systemStart + "## System".length, systemEnd).trim()
      : raw.trim();
  return {
    task: "checklist_tailor",
    id: CHECKLIST_TAILOR_PROMPT_ID,
    digest: digestOf(raw),
    systemPrompt,
  };
}