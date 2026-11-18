// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => cleanup());

import { WorkspaceError } from "./WorkspaceError";

describe("WorkspaceError", () => {
  it("shows Try again only when retryable", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <WorkspaceError message="Safe message." correlationId="abcd1234-5678" retryable onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();

    rerender(<WorkspaceError message="Safe message." correlationId="abcd1234-5678" retryable={false} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("never shows raw exception text in the message prop", () => {
    render(<WorkspaceError message="We could not load this section." correlationId="abcd1234-5678" />);
    expect(screen.getByText("We could not load this section.")).toBeTruthy();
    expect(screen.queryByText(/stack|sql|select /i)).toBeNull();
    expect(screen.getByText("abcd1234")).toBeTruthy();
    expect(screen.getByText(/Reference/)).toBeTruthy();
  });

  it("shows Error code when only a Next digest is available", () => {
    render(<WorkspaceError message="We could not load this section." errorDigest="digest-123" />);
    expect(screen.getByText(/Error code/)).toBeTruthy();
    expect(screen.getByText("digest-123")).toBeTruthy();
    expect(screen.queryByText(/Reference/)).toBeNull();
  });
});