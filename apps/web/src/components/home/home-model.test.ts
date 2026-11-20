import { describe, expect, it } from "vitest";

import type { HiveMessage } from "@hiveforyou/contracts";

import {
  buildHiveHomeContent,
  findMissingRecordsTitle,
  lastWroteFromMessages,
  missingRecordsDetail,
  missingRecordsTitle,
  requestComposerText,
  stillToComeTitles,
} from "./home-model";

const NOW = new Date("2026-11-19T15:00:00.000Z");

function message(partial: Partial<HiveMessage> & Pick<HiveMessage, "id" | "createdAt" | "isMine">): HiveMessage {
  return {
    authorKind: "person",
    authorRole: "client",
    authorUserId: "u",
    authorDisplayName: "Dana Ortiz",
    authorRoleLabel: "Client",
    body: "Hello",
    sourceRefs: [],
    replyToMessageId: null,
    ...partial,
  };
}

describe("home model", () => {
  it("keeps only records that are not in yet", () => {
    expect(
      stillToComeTitles([
        { title: "  2023 statements ", status: "not_in" },
        { title: "ID", status: "in" },
        { title: "Lease", status: "added_pending" },
        { title: "   ", status: "not_in" },
      ]),
    ).toEqual(["2023 statements"]);
  });

  it("builds the missing-records line from the first two titles", () => {
    expect(findMissingRecordsTitle(1)).toBe("Find 1 missing record");
    expect(findMissingRecordsTitle(4)).toBe("Find 4 missing records");
    expect(missingRecordsTitle(1, "Dana")).toBe("Ask Dana for 1 missing record");
    expect(missingRecordsTitle(3, null)).toBe("Ask the client for 3 missing records");
    expect(missingRecordsDetail(["Bank statements", "Tax return"])).toBe("Bank statements · Tax return");
    expect(missingRecordsDetail(["Bank statements", "Tax return", "Deed", "Will"])).toBe(
      "Bank statements · Tax return · 2 more",
    );
    expect(requestComposerText([" Bank ", "", "Deed"])).toBe("Bank\nDeed");
  });

  it("uses the other person's latest message", () => {
    const wrote = lastWroteFromMessages(
      [
        message({ id: "1", createdAt: "2026-11-19T14:13:00.000Z", isMine: false, authorDisplayName: "Dana Ortiz" }),
        message({ id: "2", createdAt: "2026-11-19T14:40:00.000Z", isMine: true, authorDisplayName: "Priya Shah" }),
        message({
          id: "3",
          createdAt: "2026-11-18T14:13:00.000Z",
          isMine: false,
          authorKind: "assistant",
          authorDisplayName: "Sarah",
        }),
      ],
      NOW,
    );
    expect(wrote?.name).toBe("Dana");
    expect(wrote?.when.startsWith("today at ")).toBe(true);
  });

  it("omits a checklist and drops zero review counts from the content the sentence reads", () => {
    const content = buildHiveHomeContent({
      documentCount: 4,
      checklist: [],
      progress: null,
      openItems: [],
      topics: [],
      sources: null,
      messages: [],
      now: NOW,
      study: { revisionNumber: 2, acceptedAt: "2026-11-03T00:00:00.000Z" },
      documentRows: [],
      calculations: [],
    });
    expect(content.checklistSize).toBeNull();
    expect(content.documentsIn).toBe(4);
    expect(content.toReview).toBe(0);
    expect(content.stillToCome).toEqual([]);
    expect(content.study).toEqual({ revisionNumber: 2, acceptedLabel: "Nov 3" });
    expect(content.statementCount).toBe(0);
    expect(content.coverage).toEqual([]);
  });

  it("counts checklist progress separately from open review items", () => {
    const content = buildHiveHomeContent({
      documentCount: 8,
      checklist: [
        { title: "Statements", status: "not_in" },
        { title: "Award", status: "in" },
      ],
      progress: { in: 1, total: 2 },
      openItems: [
        { id: "n1", kind: "needs", title: "Confirm the transfer", question: "The page names the amount.", factIds: ["f1"] },
      ],
      topics: [
        {
          id: "t1",
          title: "Accounts",
          uncertain: true,
          statements: [
            { id: "s1", text: "Two transfers left the account.", values: [] },
            { id: "s2", text: "A third is dated later.", values: [] },
          ],
          openItems: [],
        },
      ],
      sources: { documents: {}, facts: { f1: { sourceDocumentId: "d1", pageNumber: 2, quote: "q" } } },
      messages: [],
      now: NOW,
      study: null,
      documentRows: [{ id: "d1", typeInPlainWords: "Bank statement", status: "SUPPORTED", values: [] }],
      calculations: [{ id: "c1", label: "Total", op: "sum", inputs: "deposits", per: "" }],
    });
    expect(content.documentsIn).toBe(1);
    expect(content.checklistSize).toBe(2);
    expect(content.stillToCome).toEqual(["Statements"]);
    expect(content.toReview).toBe(1);
    expect(content.reviewSteps[0]?.refs).toEqual([
      { sourceDocumentId: "d1", pageNumber: 2, quote: "q", factIds: ["f1"] },
    ]);
    expect(content.statementCount).toBe(2);
    expect(content.coverage).toEqual([{ id: "d1", label: "Bank statement", state: "checked" }]);
    expect(content.calculations).toEqual([{ id: "c1", label: "Total", detail: "sum · deposits" }]);
    expect(content.hasStudy).toBe(false);
  });
});
