// @vitest-environment jsdom
import type { StudyViewRow } from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { countStates, StateBar } from "./StateBar";

afterEach(cleanup);

const ref = { sourceDocumentId: "d", pageNumber: 1, quote: "q" };
const row = (id: string, status: string | null, relations: ("supporting" | "updating")[] = ["supporting"]): StudyViewRow => ({
  id,
  status,
  values: relations.map((relation, index) => ({ factId: `${id}-${index}`, valueAsWritten: "v", sourceRef: ref, relation })),
});

describe("countStates", () => {
  it("counts spine elements by state and adds the missing list's items", () => {
    const rows = [
      row("S1", "CONFLICTED"),
      row("S2", "OPEN"),
      row("S3", "SUPERSEDED", ["supporting", "updating"]),
      row("S4", "CURRENT"),
      row("S5", "SUPPORTED"),
      row("S6", "SUPPORTED", ["supporting", "updating"]),
      row("S7", "UNSUPPORTED", []),
      row("S8", null),
    ];
    expect(countStates(rows, 3)).toEqual({ needs: 2, changed: 3, missing: 4, checked: 1 });
  });
});

describe("StateBar", () => {
  const targets = { needs: "a", changed: "b", missing: "c", checked: "d" };

  it("shows pills in fixed order, hides zero counts and links each to its section", () => {
    render(<StateBar counts={{ needs: 1, changed: 0, missing: 2, checked: 5 }} targets={targets} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "1 issue to resolve",
      "2 documents missing",
      "5 facts confirmed",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["#a", "#c", "#d"]);
  });

  it("uses the plural for more than one item that needs you, and hands navigation to the page", () => {
    const onNavigate = vi.fn();
    render(<StateBar counts={{ needs: 2, changed: 1, missing: 0, checked: 0 }} targets={targets} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("2 issues to resolve"));
    expect(onNavigate).toHaveBeenCalledWith("a");
  });

  it("renders nothing when every count is zero", () => {
    const { container } = render(<StateBar counts={{ needs: 0, changed: 0, missing: 0, checked: 0 }} targets={targets} />);
    expect(container.textContent).toBe("");
  });
});
