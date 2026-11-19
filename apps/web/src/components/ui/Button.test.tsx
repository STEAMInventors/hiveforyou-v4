// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./Button";

afterEach(cleanup);

describe("Button", () => {
  it("renders primary", () => {
    render(<Button>Send</Button>);
    expect(screen.getByRole("button", { name: "Send" }).className).toContain("bg-blue-deep");
  });
});