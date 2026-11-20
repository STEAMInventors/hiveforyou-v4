// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FRONT_EXAMPLE } from "@/content/front-page";

import { FrontExample } from "./FrontExample";

afterEach(cleanup);

describe("FrontExample", () => {
  it("opens on the first statement and shows its cited page", () => {
    render(<FrontExample example={FRONT_EXAMPLE} />);
    const area = screen.getByTestId("front-example-page-area");
    expect(within(area).getByText("Pay stub")).toBeTruthy();
    expect(within(area).getByText("Page 1 of 2")).toBeTruthy();
    expect(within(area).getByText("$2,140.00")).toBeTruthy();
    const statements = screen.getAllByRole("button", { pressed: true });
    expect(statements).toHaveLength(1);
    expect(statements[0]!.textContent).toContain("Gross pay is $2,140.00");
  });

  it("swaps the page when another statement is chosen", () => {
    render(<FrontExample example={FRONT_EXAMPLE} />);
    fireEvent.click(screen.getByRole("button", { name: /car loan/ }));
    const area = screen.getByTestId("front-example-page-area");
    expect(within(area).getByText("Auto loan statement")).toBeTruthy();
    expect(within(area).getByText("$9,860.40")).toBeTruthy();
    expect(screen.getByRole("button", { name: /car loan/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Gross pay/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("announces the swapped page politely and keeps the example synthetic and labelled", () => {
    render(<FrontExample example={FRONT_EXAMPLE} />);
    expect(screen.getByTestId("front-example-page-area").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("Example · synthetic documents")).toBeTruthy();
  });

  it("lists what is still to come and has no other interactive control than the statements", () => {
    render(<FrontExample example={FRONT_EXAMPLE} />);
    for (const item of FRONT_EXAMPLE.missing) {
      expect(screen.getByText(item)).toBeTruthy();
    }
    expect(screen.getAllByRole("button")).toHaveLength(FRONT_EXAMPLE.statements.length);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
