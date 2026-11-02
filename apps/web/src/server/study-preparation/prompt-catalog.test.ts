import { SOURCE_PAGES_PLACEHOLDER } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { buildPromptCatalog, extractSection, loadPromptCatalog, sha256Digest } from "./prompt-catalog";

describe("loadPromptCatalog", () => {
  it("loads the versioned preparation prompts from the repository", () => {
    const catalog = loadPromptCatalog();
    expect(Object.values(catalog.planner).map((prompt) => prompt.id)).toEqual([
      "hive-intent/1",
      "hive-domain/1",
      "hive-plan/1",
    ]);
    for (const prompt of Object.values(catalog.planner)) {
      expect(prompt.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(prompt.systemPrompt.length).toBeGreaterThan(200);
      expect(prompt.systemPrompt).not.toMatch(/^## /m);
    }
    expect(catalog.studyTemplate.id).toBe("hive-study-preview/1");
    expect(catalog.studyTemplate.text.split(SOURCE_PAGES_PLACEHOLDER)).toHaveLength(2);
    expect(() => JSON.parse(catalog.outputSchema.text)).not.toThrow();
  });
});

describe("buildPromptCatalog", () => {
  const files = (eol: string): Record<string, string> => {
    const planner = (id: string) => ["# Prompt", `Prompt id: \`${id}\``, "", "## System", "", "Be exact.", "", "---", "Notes"].join(eol);
    return {
      "hive-intent/HiveForYou-Intent-v1.md": planner("hive-intent/1"),
      "hive-domain/HiveForYou-Domain-v1.md": planner("hive-domain/1"),
      "hive-plan/HiveForYou-Plan-v1.md": planner("hive-plan/1"),
      "hive-study/HiveForYou-Study-Preview-v1.md": ["Prompt id: `hive-study-preview/1`", "## Template", "Body {{SOURCE_PAGES}}"].join(eol),
      "hive-study/hive.study-investigation-1.schema.json": "{}",
    };
  };

  it("digests LF-normalized text, so CRLF checkouts give the same digests", () => {
    const lf = buildPromptCatalog((file) => files("\n")[file]!);
    const crlf = buildPromptCatalog((file) => files("\r\n")[file]!);
    expect(crlf.planner.intent.digest).toBe(lf.planner.intent.digest);
    expect(crlf.studyTemplate.digest).toBe(lf.studyTemplate.digest);
    expect(lf.planner.intent.systemPrompt).toBe("Be exact.");
  });

  it("fails closed when a prompt file carries the wrong id", () => {
    const wrong = { ...files("\n"), "hive-plan/HiveForYou-Plan-v1.md": "Prompt id: `hive-plan/2`\n## System\nx" };
    expect(() => buildPromptCatalog((file) => wrong[file]!)).toThrow("prompt_id_mismatch:plan");
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
