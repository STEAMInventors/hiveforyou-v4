import { describe, expect, it } from "vitest";

import { clientHomeLeadSentence, stillToSendSectionCount } from "./client-home-model";

describe("client-home-model", () => {
  it("describes outstanding items in the lead sentence", () => {
    expect(clientHomeLeadSentence(2, "Priya Shah")).toBe("2 things left to send. Everything else is in.");
    expect(clientHomeLeadSentence(1, "Priya Shah")).toBe("1 thing left to send. Everything else is in.");
  });

  it("falls back when everything is in", () => {
    expect(clientHomeLeadSentence(0, "Priya Shah")).toBe("Everything we asked for is in. Priya will be in touch.");
    expect(clientHomeLeadSentence(0, null)).toBe("Everything we asked for is in. Your team will be in touch.");
  });

  it("counts missing checklist rows for Still to send", () => {
    expect(
      stillToSendSectionCount([
        { gapId: "a", title: "A", status: "not_in", statusText: "" },
        { gapId: "b", title: "B", status: "in", statusText: "" },
      ] as const),
    ).toBe(1);
  });
});