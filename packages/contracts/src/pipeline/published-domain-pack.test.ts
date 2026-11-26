import { describe, expect, it } from "vitest";

import { compareEditionVersions, selectPublishedDomainPack, type PublishedEditionCandidate } from "./published-domain-pack";

function edition(overrides: Partial<PublishedEditionCandidate> = {}): PublishedEditionCandidate {
  return {
    domain: "alpha",
    packId: "pack-alpha",
    version: "1.0.0",
    publication: "PUBLISHED",
    approval: "APPROVED",
    investigationPromptId: "hive.domain-investigation/2",
    intentHints: ["alpha-signal"],
    documentHints: ["alpha-record"],
    ...overrides,
  };
}

const HIVE = { intentText: "Need an alpha-signal review", documents: ["alpha-record.pdf"] };

describe("selectPublishedDomainPack", () => {
  it("picks the latest approved edition of the matching domain", () => {
    const selected = selectPublishedDomainPack(
      [
        edition({ version: "0.4.0", investigationPromptId: "hive.domain-investigation/1" }),
        edition({ version: "0.9.0", packId: "pack-beta", domain: "beta", intentHints: ["beta-signal"], documentHints: ["beta-record"] }),
        edition({ version: "0.5.0" }),
        edition({ version: "0.6.0", publication: "UNPUBLISHED" }),
        edition({ version: "0.7.0", approval: "DRAFT" }),
      ],
      HIVE,
    );
    expect(selected).toMatchObject({
      status: "selected",
      edition: { packId: "pack-alpha", version: "0.5.0", investigationPromptId: "hive.domain-investigation/2" },
    });
  });

  it("uses the latest edition even when an older edition of the same domain scores higher", () => {
    const selected = selectPublishedDomainPack(
      [
        edition({ version: "0.4.0", intentHints: ["alpha-signal", "extra-signal"], documentHints: ["alpha-record", "extra-record"] }),
        edition({ version: "0.5.0" }),
      ],
      { intentText: "alpha-signal extra-signal", documents: ["alpha-record extra-record"] },
    );
    expect(selected).toMatchObject({ status: "selected", edition: { version: "0.5.0" } });
  });

  it("leaves a hive on no edition when the hints stay below the threshold", () => {
    expect(selectPublishedDomainPack([edition()], { intentText: "unrelated", documents: ["note.txt"] })).toEqual({
      status: "none",
    });
  });

  it("does not let one shared hint select an edition", () => {
    expect(
      selectPublishedDomainPack([edition({ intentHints: ["alpha-signal"], documentHints: [] })], {
        intentText: "alpha-signal only",
        documents: [],
      }),
    ).toEqual({ status: "none" });
  });

  it("orders dotted numeric versions", () => {
    expect(compareEditionVersions("0.5.0", "0.4.0")).toBeGreaterThan(0);
    expect(compareEditionVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareEditionVersions("1.0.0", "0.9.0")).toBeGreaterThan(0);
  });
});
