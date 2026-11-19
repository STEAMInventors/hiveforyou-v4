import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadHiveAssistantReplyPrompt } from "@/server/hives/hive-assistant-prompt";
import { loadChecklistTailorPrompt } from "./checklist-tailor-prompt";
import { loadPromptCatalog, resetPromptCatalogCache, resolvePromptsRoot } from "./prompt-catalog";

const REPO_ROOT = path.resolve(__dirname, "../../../../../");
const APPS_WEB_CWD = path.resolve(__dirname, "../../..");

function minimalAssistantPrompt(): string {
  return ["# Hive assistant", "", "## System", "", "Reply briefly.", "", "## User", "", "Briefing."].join("\n");
}

function minimalChecklistTailorPrompt(): string {
  return ["# Checklist tailor", "", "## System", "", "Tailor rows.", "", "## User", "", "Pack."].join("\n");
}

describe("resolvePromptsRoot", () => {
  it("finds prompts two levels above a Vercel-style apps/web cwd", () => {
    const root = mkdtempSync(path.join(tmpdir(), "hfy-prompts-"));
    try {
      const promptsDir = path.join(root, "prompts");
      const appsWeb = path.join(root, "apps", "web");
      mkdirSync(path.join(promptsDir, "hive-assistant-reply"), { recursive: true });
      mkdirSync(path.join(promptsDir, "checklist-tailor"), { recursive: true });
      writeFileSync(path.join(promptsDir, "hive-assistant-reply/v2.md"), minimalAssistantPrompt());
      writeFileSync(path.join(promptsDir, "checklist-tailor/v1.md"), minimalChecklistTailorPrompt());
      mkdirSync(appsWeb, { recursive: true });

      expect(resolvePromptsRoot("hive-assistant-reply/v2.md", appsWeb)).toBe(promptsDir);
      expect(resolvePromptsRoot("checklist-tailor/v1.md", appsWeb)).toBe(promptsDir);
      expect(loadHiveAssistantReplyPrompt(appsWeb).id).toBe("hive-assistant-reply/2");
      expect(loadChecklistTailorPrompt(appsWeb).task).toBe("checklist_tailor");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds prompts beside the repo root cwd", () => {
    expect(resolvePromptsRoot("hive-assistant-reply/v2.md", REPO_ROOT)).toBe(path.join(REPO_ROOT, "prompts"));
    expect(loadHiveAssistantReplyPrompt(REPO_ROOT).digest).toMatch(/^sha256:/);
    expect(loadChecklistTailorPrompt(REPO_ROOT).digest).toMatch(/^sha256:/);
  });

  it("resolves from the default monorepo apps/web working directory", () => {
    expect(loadHiveAssistantReplyPrompt(APPS_WEB_CWD).task).toBe("assistant_reply");
    expect(loadChecklistTailorPrompt(APPS_WEB_CWD).task).toBe("checklist_tailor");
  });

  it("throws prompt_file_missing when no candidate contains the file", () => {
    const root = mkdtempSync(path.join(tmpdir(), "hfy-prompts-miss-"));
    try {
      const appsWeb = path.join(root, "apps", "web");
      mkdirSync(appsWeb, { recursive: true });
      expect(() => resolvePromptsRoot("missing-prompt/v1.md", appsWeb)).toThrow(
        "prompt_file_missing:missing-prompt/v1.md",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("loadPromptCatalog cwd", () => {
  it("loads from apps/web cwd via the shared resolver", () => {
    resetPromptCatalogCache();
    const catalog = loadPromptCatalog(APPS_WEB_CWD);
    expect(catalog.studyTemplate.id).toBe("hive-study-preview/1");
    resetPromptCatalogCache();
  });
});