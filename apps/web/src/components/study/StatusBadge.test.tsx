// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusBadge, statusToState } from "./StatusBadge";

afterEach(cleanup);

describe("statusToState", () => {
  it.each([
    ["CONFLICTED", "needs"],
    ["OPEN", "needs"],
    ["SUPERSEDED", "changed"],
    ["UPDATED", "changed"],
    ["CURRENT", "changed"],
    ["GAP", "missing"],
    ["UNSUPPORTED", "missing"],
    ["UNREADABLE", "missing"],
    ["SUPPORTED", "checked"],
    ["supported", "checked"],
  ])("%s -> %s", (status, state) => {
    expect(statusToState(status)).toBe(state);
  });

  it("shows a supported value that a later fact updates as changed, and never overrides other states", () => {
    expect(statusToState("SUPPORTED", { updated: true })).toBe("changed");
    expect(statusToState("CONFLICTED", { updated: true })).toBe("needs");
    expect(statusToState("UNSUPPORTED", { updated: true })).toBe("missing");
  });

  it("gives unknown or missing statuses no state", () => {
    expect(statusToState(null)).toBeNull();
    expect(statusToState(undefined)).toBeNull();
    expect(statusToState("MAYBE")).toBeNull();
  });
});

describe("StatusBadge", () => {
  it("always carries its text, never an internal status word", () => {
    const { container } = render(<StatusBadge state="needs" />);
    expect(container.textContent).toBe("Needs you");
  });
});
