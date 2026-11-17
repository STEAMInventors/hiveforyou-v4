import { describe, expect, it } from "vitest";

import { boardPollStateFromFailures } from "./hive-board-poll";

describe("boardPollStateFromFailures", () => {
  it("shows reconnecting only after three failures", () => {
    expect(boardPollStateFromFailures(0)).toBe("ok");
    expect(boardPollStateFromFailures(2)).toBe("ok");
    expect(boardPollStateFromFailures(3)).toBe("reconnecting");
  });
});