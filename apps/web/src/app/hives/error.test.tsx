// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import HivesError from "./error";

describe("hives/error", () => {
  it("renders a centred error without the clients sidebar", () => {
    const reset = vi.fn();
    render(<HivesError error={new Error("fail")} reset={reset} />);
    expect(screen.queryByRole("navigation", { name: /clients/i })).toBeNull();
    expect(screen.getByTestId("workspace-error")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to your hives/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});