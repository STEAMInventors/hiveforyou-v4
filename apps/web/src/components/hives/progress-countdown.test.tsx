// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
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

  it("re-anchors when the server estimate moves by more than 15 seconds", () => {
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

  it("decreases monotonically between re-anchors", async () => {
    render(
      <ProgressCountdown
        estimate={{
          estimatedCompletionAt: "2026-11-05T12:05:00.000Z",
          estimatedCompletionLowAt: "2026-11-05T12:03:00.000Z",
          estimatedCompletionHighAt: "2026-11-05T12:07:00.000Z",
        }}
      />,
    );
    expect(screen.getByTestId("progress-countdown").textContent).toContain("5:00");
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId("progress-countdown").textContent).toContain("4:59");
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId("progress-countdown").textContent).toContain("4:58");
  });

  it("keeps counting down smoothly when polls drift by less than 15 seconds", () => {
    const anchored = {
      estimatedCompletionAt: "2026-11-05T12:05:00.000Z",
      estimatedCompletionLowAt: "2026-11-05T12:03:00.000Z",
      estimatedCompletionHighAt: "2026-11-05T12:07:00.000Z",
    };
    const { rerender } = render(<ProgressCountdown estimate={anchored} />);
    expect(screen.getByTestId("progress-countdown").textContent).toContain("5:00");

    vi.advanceTimersByTime(2_000);
    rerender(
      <ProgressCountdown
        estimate={{
          estimatedCompletionAt: "2026-11-05T12:04:58.000Z",
          estimatedCompletionLowAt: "2026-11-05T12:03:00.000Z",
          estimatedCompletionHighAt: "2026-11-05T12:07:00.000Z",
        }}
      />,
    );
    expect(screen.getByTestId("progress-countdown").textContent).toContain("4:58");
  });

  it("shows a realistic minute range from remaining duration", () => {
    render(
      <ProgressCountdown
        estimate={{
          estimatedCompletionAt: "2026-11-05T12:10:00.000Z",
          estimatedCompletionLowAt: "2026-11-05T12:06:30.000Z",
          estimatedCompletionHighAt: "2026-11-05T12:13:30.000Z",
        }}
      />,
    );
    expect(screen.getByTestId("progress-countdown").textContent).toContain("estimated 7–14 min");
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
