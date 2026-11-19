// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Disclosure } from "./Disclosure";
import { MetaLine } from "./MetaLine";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { ShowMore } from "./ShowMore";

afterEach(cleanup);

describe("ui gallery components", () => {
  it("renders Section with ink rule", () => {
    render(
      <Section title="To review">
        <p>Row</p>
      </Section>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "To review" })).toBeTruthy();
  });

  it("renders MetaLine", () => {
    render(<MetaLine>Study v3</MetaLine>);
    expect(screen.getByTestId("meta-line").textContent).toContain("Study v3");
  });

  it("renders Segmented", () => {
    render(
      <Segmented
        ariaLabel="Filter"
        options={[{ id: "all", label: "All", count: 3 }]}
        value="all"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "All 3" })).toBeTruthy();
  });

  it("renders ShowMore", () => {
    render(<ShowMore label="Show all 9" />);
    expect(screen.getByRole("button", { name: "Show all 9" })).toBeTruthy();
  });

  it("renders Disclosure closed", () => {
    render(
      <Disclosure title="More detail">
        <p>Body</p>
      </Disclosure>,
    );
    expect(screen.getByText("More detail")).toBeTruthy();
  });
});