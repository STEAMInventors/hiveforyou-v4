import { describe, expect, it } from "vitest";

import { EMPTY_OMNI_CATALOG, type OmniCatalog } from "@/lib/omni-catalog-model";
import { omniHits } from "@/lib/omni-catalog-search";

import {
  omniOpenItemsFromChecklist,
  omniStatementsFromTopics,
  mergeOmniCatalog,
} from "./omni-catalog-build";

describe("omni-catalog-build", () => {
  it("indexes checklist gaps as open items", () => {
    const items = omniOpenItemsFromChecklist([
      {
        gapId: "g1",
        title: "Checking statements Apr–Jun 2023",
        status: "not_in",
        statusText: "Not in yet",
        action: { kind: "link", label: "Add it", href: "#" },
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Checking statements Apr–Jun 2023");
  });

  it("lets the box find home statements without a model call", () => {
    const catalog: OmniCatalog = mergeOmniCatalog({
      statements: omniStatementsFromTopics([
        {
          id: "t1",
          title: "Premiums",
          uncertain: false,
          statements: [
            {
              id: "s1",
              text: "The monthly premium for 2023 was $142.",
              values: [
                {
                  factId: "f1",
                  valueAsWritten: "$142",
                  sourceRef: { sourceDocumentId: "d1", pageNumber: 2, quote: "142" },
                },
              ],
            },
          ],
          openItems: [],
        },
      ]),
    });
    const hits = omniHits(catalog, "2023");
    expect(hits.some((hit) => hit.kind === "statement" && hit.statement.text.includes("2023"))).toBe(true);
    expect(EMPTY_OMNI_CATALOG.suggestions).toEqual([]);
  });
});