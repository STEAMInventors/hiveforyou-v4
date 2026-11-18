import { describe, expect, it } from "vitest";

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parsePackMarkdown } from "../pipeline/pack-contracts";
import {
  applyChecklistTailorRules,
  checklistTailorWithoutModel,
  packRowsForTailor,
  quoteAppearsInText,
  reasonFailsGuard,
} from "./checklist-tailor";
import { newClientPackHolderLabel } from "./pack-holder-labels";

const PACKS = join(import.meta.dirname, "../../../../packs");

function firstPackWithConditionalRow() {
  for (const name of readdirSync(PACKS)) {
    if (!name.endsWith(".md")) continue;
    const parsed = parsePackMarkdown(readFileSync(join(PACKS, name), "utf8"));
    if (!parsed.ok) continue;
    const conditional = parsed.value.documentsUsuallyNeeded.find((row) => row.appliesWhen);
    if (conditional) return { pack: parsed.value, conditional };
  }
  return null;
}

describe("pack applies when", () => {
  it("parses Applies when from packs that define it", () => {
    const found = firstPackWithConditionalRow();
    expect(found).not.toBeNull();
    expect(found?.conditional.appliesWhen?.length).toBeGreaterThan(0);
  });

  it("loads packs without Applies when column", () => {
    const fixture = join(import.meta.dirname, "../testing/fixtures/widget-review-pack.md");
    const parsed = parsePackMarkdown(readFileSync(fixture, "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.documentsUsuallyNeeded.every((row) => row.appliesWhen === null)).toBe(true);
  });
});

describe("newClientPackHolderLabel", () => {
  it("maps THIRD_PARTY and COURT_RECORD; excludes COUNSEL", () => {
    expect(newClientPackHolderLabel("THIRD_PARTY", "THIRD_PARTY (lender)")).toBe("the lender");
    expect(newClientPackHolderLabel("THIRD_PARTY", "THIRD_PARTY (district)")).toBe("the district");
    expect(newClientPackHolderLabel("COURT_RECORD", "COURT_RECORD")).toBe("the court record");
    expect(newClientPackHolderLabel("COUNSEL", "COUNSEL")).toBeNull();
  });
});

describe("applyChecklistTailorRules", () => {
  const rows = [
    {
      key: "pay stubs",
      title: "Pay stubs",
      appliesWhen: "is paid by an employer",
      holderType: "ASKER_OR_CLIENT" as const,
      holder: "ASKER_OR_CLIENT",
      gapKind: "REQUESTABLE_DOCUMENT",
    },
    {
      key: "photo id",
      title: "Photo ID",
      appliesWhen: null,
      holderType: "ASKER_OR_CLIENT" as const,
      holder: "ASKER_OR_CLIENT",
      gapKind: "REQUESTABLE_DOCUMENT",
    },
  ];

  it("empty text uses no-model path", () => {
    const result = checklistTailorWithoutModel(rows, false);
    expect(result.items.find((row) => row.key === "photo id")?.tag).toBe("plain");
    expect(result.items.find((row) => row.key === "pay stubs")?.tag).toBe("depends");
  });

  it("demotes ask/leave_out when quote is missing from text", () => {
    const result = applyChecklistTailorRules(rows, "Single, wages from one employer", {
      rows: [
        { key: "pay stubs", decision: "ask", reason: "Employer income mentioned.", quote: "wages from Mars" },
      ],
      extras: [],
    });
    expect(result.items.find((row) => row.key === "pay stubs")?.tag).toBe("depends");
  });

  it("accepts valid quote for ask", () => {
    const text = "Single, wages from one employer";
    const result = applyChecklistTailorRules(rows, text, {
      rows: [{ key: "pay stubs", decision: "ask", reason: "You mentioned wages.", quote: "wages from one employer" }],
      extras: [],
    });
    const pay = result.items.find((row) => row.key === "pay stubs");
    expect(pay?.ticked).toBe(true);
    expect(pay?.tag).toBe("from_note");
  });

  it("drops extras without quote or with advice words", () => {
    const text = "car loan from Chase";
    const result = applyChecklistTailorRules(rows, text, {
      rows: [],
      extras: [
        { title: "Lien paperwork", reason: "You should file this.", quote: "car loan" },
        { title: "Lien paperwork", reason: "You mentioned a car loan.", quote: "car loan" },
      ],
    });
    expect(result.items.filter((row) => row.custom)).toHaveLength(1);
  });

  it("quote matching is case-insensitive with normalized whitespace", () => {
    expect(quoteAppearsInText("Car   Loan", "we talked about car loan today")).toBe(true);
  });

  it("rejects quotes shorter than three characters or without word boundaries", () => {
    expect(quoteAppearsInText("ab", "there is ab today")).toBe(false);
    expect(quoteAppearsInText("loan", "we talked about carloan today")).toBe(false);
    expect(quoteAppearsInText("loan", "we talked about car loan today")).toBe(true);
  });

  it("reasonFailsGuard catches advice words", () => {
    expect(reasonFailsGuard("You must file soon.")).toBe(true);
    expect(reasonFailsGuard("You mentioned wages.")).toBe(false);
  });
});