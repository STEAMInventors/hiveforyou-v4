import { SOURCE_PAGES_PLACEHOLDER } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { buildPromptCatalog, extractSection, loadPromptCatalog, sha256Digest } from "./prompt-catalog";

describe("loadPromptCatalog", () => {
  it("loads the versioned preparation prompts from the repository", () => {
    const catalog = loadPromptCatalog();
    expect(Object.values(catalog.planner).map((prompt) => prompt.id)).toEqual([
      "hive.intent-analysis/1",
      "hive-domain/1",
      "hive-intent-intelligence/1",
    ]);
    for (const [task, prompt] of Object.entries(catalog.planner) as [keyof typeof catalog.planner, (typeof catalog.planner)["intent"]][]) {
      expect(prompt.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(prompt.systemPrompt.length).toBeGreaterThan(200);
      if (task !== "intent") {
        expect(prompt.systemPrompt).not.toMatch(/^## /m);
      }
    }
    expect(catalog.studyTemplate.id).toBe("hive-study-preview/1");
    expect(catalog.studyTemplate.text.split(SOURCE_PAGES_PLACEHOLDER)).toHaveLength(2);
    expect(() => JSON.parse(catalog.outputSchema.text)).not.toThrow();
    expect(catalog.writer.id).toBe("hive-writer/1");
    expect(catalog.writer.systemPrompt).toContain("writer_claim_kind");
    expect(catalog.writer.systemPrompt).toContain("writer_number_ungrounded");
    expect(catalog.writer.systemPrompt).toContain("Keep claim IDs in `claimRefs`, not prose.");
    expect(catalog.writer.systemPrompt).toContain("Avoid numbered lists inside report block text.");
    expect(catalog.writer.systemPrompt).toContain("GENERAL_KNOWLEDGE");
    expect(catalog.writer.systemPrompt).toContain("Never cite a broad question-level `ANSWER` claim");
  });
});

describe("buildPromptCatalog", () => {
  const files = (eol: string): Record<string, string> => {
    const planner = (id: string) => ["# Prompt", `Prompt id: \`${id}\``, "", "## System", "", "Be exact.", "", "---", "Notes"].join(eol);
    return {
      "hive-intent/HiveForYou-Intent-v1.md": [
        "# Hive Intent Analysis",
        "**Prompt ID:** `hive.intent-analysis/1`",
        "## 1. Your job",
        "Analyze faithfully.",
        "## 7. Example",
        "skip",
        "## 8. Final self-check",
        "Check.",
      ].join(eol),
      "hive-domain/HiveForYou-Domain-v1.md": planner("hive-domain/1"),
      "hive-intent-intelligence/HiveForYou-Intent-Intelligence-v1.md": planner("hive-intent-intelligence/1"),
      "hive-study/HiveForYou-Study-Preview-v1.md": ["Prompt id: `hive-study-preview/1`", "## Template", "Body {{SOURCE_PAGES}}"].join(eol),
      "hive-study/hive.study-investigation-1.schema.json": "{}",
      "hive-writer/HiveForYou-Writer-v1.md": planner("hive-writer/1"),
      "hive-writer/hive.writer-report-1.schema.json": "{}",
    };
  };

  it("digests LF-normalized text, so CRLF checkouts give the same digests", () => {
    const lf = buildPromptCatalog((file) => files("\n")[file]!);
    const crlf = buildPromptCatalog((file) => files("\r\n")[file]!);
    expect(crlf.planner.intent.digest).toBe(lf.planner.intent.digest);
    expect(crlf.studyTemplate.digest).toBe(lf.studyTemplate.digest);
    expect(lf.planner.intent.systemPrompt).toContain("Analyze faithfully.");
  });

  it("fails closed when a prompt file carries the wrong id", () => {
    const wrong = {
      ...files("\n"),
      "hive-domain/HiveForYou-Domain-v1.md": "Prompt id: `hive-domain/2`\n## System\nx",
    };
    expect(() => buildPromptCatalog((file) => wrong[file]!)).toThrow("prompt_id_mismatch:hive-domain/1");
  });
});

describe("extractSection", () => {
  it("stops at the next rule or heading and rejects missing sections", () => {
    expect(extractSection("## A\none\n## B\ntwo", "A")).toBe("one");
    expect(extractSection("## A\none\n---\ntwo", "A", true)).toBe("one\n---\ntwo");
    expect(() => extractSection("## A\none", "C")).toThrow("prompt_section_missing:C");
  });

  it("hashes UTF-8 text", () => {
    expect(sha256Digest("")).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
