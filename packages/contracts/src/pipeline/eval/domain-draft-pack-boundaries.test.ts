import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDomainPack } from "../domain-pack-compiler";
import { assessRelationshipTypedSource } from "../domain-relationship-verification";
import type { DomainPackSource } from "../domain-pack-source";

describe("unpublished draft pack boundaries", () => {
  it("returns NO_TYPED_SOURCE for every draft relationship and does not embed the pack id", () => {
    const proof = compileDomainPack(JSON.parse(readFileSync(join(import.meta.dirname, "../../../../../packs/drafts/iep-us-federal/v0.3.0/iep-domain-pack-source.stage4b.json"), "utf8")) as DomainPackSource);
    expect(proof.ok).toBe(true);
    if (!proof.ok) return;
    expect(proof.value.identity).toMatchObject({ packId: "iep-us-federal", version: "0.3.0" });
    const relationships = proof.value.definitions.filter((definition) => definition.kind === "relationship");
    expect(relationships.length).toBeGreaterThan(0);
    for (const relationship of relationships) {
      expect(assessRelationshipTypedSource(relationship.id, undefined)).toBe("NO_TYPED_SOURCE");
      expect(assessRelationshipTypedSource(relationship.id, [])).toBe("NO_TYPED_SOURCE");
    }
    const sourceText = readFileSync(new URL("../domain-relationship-verification.ts", import.meta.url), "utf8");
    expect(sourceText).not.toContain("iep-us-federal");
  });

  it("does not embed the draft pack id in the binder", () => {
    const sourceText = readFileSync(new URL("../domain-investigation-binder.ts", import.meta.url), "utf8");
    expect(sourceText).not.toContain("iep-us-federal");
  });

  it("does not embed the draft pack word in evidence pin preparation", () => {
    const sourceText = readFileSync(new URL("../domain-investigation-evidence-pin.ts", import.meta.url), "utf8");
    expect(sourceText.toLowerCase()).not.toContain("iep");
  });
});
