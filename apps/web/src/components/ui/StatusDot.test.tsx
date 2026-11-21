// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusDot } from "./StatusDot";

afterEach(cleanup);

describe("StatusDot", () => {
  it("shows dot and label", () => {
    render(<StatusDot state="needs" />);
    expect(screen.getByText("To review")).toBeTruthy();
  });

  it("adds Received", () => {
    render(<StatusDot state="received" />);
    expect(screen.getByText("Received")).toBeTruthy();
  });
});