import type { StudyViewRow } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { formatDocumentDate, selectUpcoming, timelineDateText } from "./Timeline";

const event = (id: string, date: string | null, asWritten = ""): StudyViewRow => ({ id, date, asWritten, statement: id, values: [] });

describe("selectUpcoming", () => {
  const rows = [event("T1", "2026-04-10"), event("T2", "2026-05-20"), event("T3", "2026-05-14"), event("T4", null, "next spring")];

  it("picks the earliest event dated after the newest document", () => {
    expect(selectUpcoming(rows, ["2026-03-02", "2026-04-28", null])?.id).toBe("T3");
  });

  it("returns nothing when no event comes after the newest document", () => {
    expect(selectUpcoming(rows, ["2026-06-01"])).toBeNull();
  });

  it("never treats an event on the newest document's own date as upcoming", () => {
    expect(selectUpcoming([event("T1", "2026-04-28")], ["2026-04-28"])).toBeNull();
  });

  it("returns nothing when no document is dated, so urgency is never invented", () => {
    expect(selectUpcoming(rows, [null, undefined, "spring"])).toBeNull();
  });
});

describe("dates", () => {
  it("formats ISO dates and falls back to the date as written", () => {
    expect(formatDocumentDate("2026-05-14")).toBe("May 14, 2026");
    expect(formatDocumentDate("May 2026")).toBeNull();
    expect(timelineDateText(event("T", null, "next spring"))).toBe("next spring");
    expect(timelineDateText(event("T", null))).toBe("Undated");
  });
});
