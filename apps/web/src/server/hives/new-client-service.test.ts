import { packChecklistItems } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { loadPackEntries } from "@/server/pipeline/pack-loader";

import { buildStartChecklistPayload } from "./new-client-service";

describe("buildStartChecklistPayload", () => {
  const correlationId = "00000000-0000-4000-8000-000000000001";
  const { entries } = loadPackEntries();
  const firstPack = entries[0];
  if (!firstPack) throw new Error("no packs loaded");
  const sampleTitle = packChecklistItems(firstPack.pack)[0]?.title;
  if (!sampleTitle) throw new Error("no pack rows");

  it("rejects unknown non-custom pack titles", () => {
    expect(() =>
      buildStartChecklistPayload(firstPack.id, [{ title: "Alien disclosure form", custom: false }], correlationId),
    ).toThrow();
  });

  it("derives keys from normalized titles", () => {
    const result = buildStartChecklistPayload(firstPack.id, [{ title: sampleTitle, custom: false }], correlationId);
    expect(result.rpcItems[0]?.key).toBe(sampleTitle.toLowerCase());
  });

  it("records pack with custom-only rows via start_checklist payload", () => {
    const result = buildStartChecklistPayload(
      firstPack.id,
      [{ title: "Lease for a storage unit", custom: true }],
      correlationId,
    );
    expect(result.rpcItems).toHaveLength(1);
    expect(result.customsForAdd).toHaveLength(0);
    expect(result.rpcItems[0]?.key).toBe("lease for a storage unit");
  });
});