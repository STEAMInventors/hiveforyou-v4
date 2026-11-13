// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProgressElapsed } from "./progress-elapsed";

afterEach(cleanup);

describe("ProgressElapsed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T15:00:30.000Z"));
  });

  it("shows monotonic elapsed time and step detail", () => {
    render(
      <ProgressElapsed
        startedAt="2026-11-09T15:00:00.000Z"
        stepLabel="Reading source files: page 24 of 35"
        typicalRange="2–5 min"
      />,
    );
    expect(screen.getByTestId("progress-elapsed").textContent).toContain("Running for 0:30");
    expect(screen.getByTestId("progress-elapsed").textContent).toContain("page 24 of 35");
    expect(screen.getByTestId("progress-elapsed").textContent).toContain("Usually 2–5 min");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId("progress-elapsed").textContent).toContain("Running for 0:32");
  });
});
