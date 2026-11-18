import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parsePackMarkdown } from "../pipeline/pack-contracts";
import {
  buildNewClientChecklistRows,
  invitePrimaryLabel,
  mergePackChangeKeepingCustom,
  tryAddCustomChecklistItem,
  validateNewClientForm,
} from "./new-client-checklist";

const repoRoot = join(import.meta.dirname, "../../../..");
const packsDir = join(repoRoot, "packs");

const loadPack = (fileName: string) => {
  const parsed = parsePackMarkdown(readFileSync(join(packsDir, fileName), "utf8"));
  if (!parsed.ok) throw new Error(`pack parse failed: ${fileName}`);
  return parsed.value;
};

describe("buildNewClientChecklistRows", () => {
  it("lists client rows first and counsel rows are excluded", () => {
    for (const name of readdirSync(packsDir).filter((entry) => entry.endsWith(".md"))) {
      const pack = loadPack(name);
      const rows = buildNewClientChecklistRows(pack);
      expect(rows.length).toBeGreaterThan(0);
      const client = rows.filter((row) => row.group === "client");
      const other = rows.filter((row) => row.group === "other");
      expect(client.every((row) => row.defaultTicked)).toBe(true);
      expect(other.every((row) => !row.defaultTicked && row.sourceLabel)).toBe(true);
    }
  });
});

describe("tryAddCustomChecklistItem", () => {
  it("rejects empty, too long, duplicate, and cap", () => {
    const existing = [{ key: "a", title: "Pay stubs", ticked: true, custom: false }];
    expect(tryAddCustomChecklistItem("  ", existing).ok).toBe(false);
    expect(tryAddCustomChecklistItem("x".repeat(121), existing).ok).toBe(false);
    expect(tryAddCustomChecklistItem("pay stubs", existing).ok).toBe(false);
    const many = Array.from({ length: 40 }, (_, index) => ({
      key: `k${index}`,
      title: `Item ${index}`,
      ticked: true,
      custom: false,
    }));
    expect(tryAddCustomChecklistItem("One more", many).ok).toBe(false);
  });
});

describe("mergePackChangeKeepingCustom", () => {
  it("keeps custom items when the matter type changes", () => {
    const packA = buildNewClientChecklistRows(loadPack(readdirSync(packsDir).find((f) => f.endsWith(".md"))!));
    const packB = buildNewClientChecklistRows(
      loadPack(readdirSync(packsDir).filter((f) => f.endsWith(".md"))[1] ?? readdirSync(packsDir)[0]!),
    );
    const current = [
      ...packA.map((row) => ({ key: row.key, title: row.title, ticked: true, custom: false as const })),
      { key: "custom:extra", title: "Extra", ticked: true, custom: true as const },
    ];
    const merged = mergePackChangeKeepingCustom(packB, current);
    expect(merged.some((row) => row.custom && row.title === "Extra")).toBe(true);
  });
});

describe("validateNewClientForm", () => {
  it("requires email and checklist only for invite with a pack", () => {
    expect(validateNewClientForm({ name: "", email: "", mode: "documents", packId: null, selection: [] }).nameError).toBeTruthy();
    expect(
      validateNewClientForm({
        name: "Ruth",
        email: "bad",
        mode: "invite",
        packId: "widget-review",
        selection: [],
      }).checklistError,
    ).toBeTruthy();
    expect(
      validateNewClientForm({ name: "Ruth", email: "ruth@example.com", mode: "invite", packId: null, selection: [] })
        .checklistError,
    ).toBeNull();
  });
});

describe("invitePrimaryLabel", () => {
  it("uses the first name when present", () => {
    expect(invitePrimaryLabel("Ruth Ortiz")).toBe("Invite Ruth to upload");
    expect(invitePrimaryLabel("")).toBe("Invite them to upload");
  });
});