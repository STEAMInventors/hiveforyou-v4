// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProgressCountdown } from "./progress-countdown";

describe("ProgressCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("re-anchors when the server sends a new estimate", () => {
    const first = {
      estimatedCompletionAt: "2026-11-05T12:05:00.000Z",
      estimatedCompletionLowAt: "2026-11-05T12:03:00.000Z",
      estimatedCompletionHighAt: "2026-11-05T12:07:00.000Z",
    };
    const { rerender } = render(<ProgressCountdown estimate={first} />);
    expect(screen.getByTestId("progress-countdown").textContent).toContain("5:00");

    rerender(
      <ProgressCountdown
        estimate={{
          estimatedCompletionAt: "2026-11-05T12:10:00.000Z",
          estimatedCompletionLowAt: "2026-11-05T12:07:00.000Z",
          estimatedCompletionHighAt: "2026-11-05T12:13:00.000Z",
        }}
      />,
    );
    expect(screen.getByTestId("progress-countdown").textContent).toContain("10:00");
  });

  it("shows the late message at zero instead of negative time", () => {
    render(
      <ProgressCountdown
        estimate={{
          estimatedCompletionAt: "2026-11-05T11:59:00.000Z",
          estimatedCompletionLowAt: "2026-11-05T11:58:00.000Z",
          estimatedCompletionHighAt: "2026-11-05T12:01:00.000Z",
        }}
      />,
    );
    expect(screen.getByTestId("progress-countdown-late").textContent).toContain("Taking a little longer than usual");
  });
});
