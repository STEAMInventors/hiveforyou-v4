import { describe, expect, it } from "vitest";

import { boardPollIntervalMs, boardPollStateFromFailures, conversationPollIntervalMs } from "./hive-board-poll";

describe("boardPollStateFromFailures", () => {
  it("shows reconnecting only after three failures", () => {
    expect(boardPollStateFromFailures(0)).toBe("ok");
    expect(boardPollStateFromFailures(2)).toBe("ok");
    expect(boardPollStateFromFailures(3)).toBe("reconnecting");
  });
});

describe("conversationPollIntervalMs", () => {
  it("uses 2s while assistant is pending and 15s otherwise", () => {
    expect(conversationPollIntervalMs(true)).toBe(2000);
    expect(conversationPollIntervalMs(false)).toBe(15000);
  });
});

describe("boardPollIntervalMs", () => {
  it("uses 5s when reads are active and 20s otherwise", () => {
    expect(boardPollIntervalMs(true)).toBe(5000);
    expect(boardPollIntervalMs(false)).toBe(20000);
  });
});

/** Integration coverage for HiveBoardThreePane lives in hive-board-polling.test.tsx. */