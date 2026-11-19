// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageHead } from "./PageHead";

afterEach(cleanup);

describe("PageHead", () => {
  it("renders title and description", () => {
    render(<PageHead title="Hive board" description="One line about this page." />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hive board");
    expect(screen.getByText("One line about this page.")).toBeTruthy();
  });
});