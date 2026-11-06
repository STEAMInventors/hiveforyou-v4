// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { bankruptcyC13Fixture } from "./fixtures/bankruptcy-c13";
import { EvidenceViewerProvider } from "./EvidenceViewer";
import { ReadProblemNotice, readProblemsFromCoverage } from "./ReadProblemNotice";
import { StudyReport } from "./StudyReport";
import { SourceChips } from "./SourceChip";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(cleanup);

describe("HiveMark and CellGlyph", () => {
  it("renders one HiveMark on meta, footer, difference footer, and read-problem notice; CellGlyph on every SourceChip", () => {
    const fixture = bankruptcyC13Fixture("PRO");
    const { container } = render(
      <StudyReport
        hiveId={fixture.hiveId}
        view={fixture.view}
        sources={fixture.sources}
        header={{ kind: "report", audience: "PRO", fallbackTitle: fixture.title, revisionNumber: 1, writtenAt: fixture.writtenAt }}
        coverageGaps={[]}
        documentPages={fixture.documentPages}
      />,
    );
    expect(container.querySelectorAll('[data-testid="hive-mark"]')).toHaveLength(4);
    const chips = screen.getAllByTestId("source-chip");
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(within(chip).getByTestId("cell-glyph")).toBeTruthy();
    }
    cleanup();

    render(
      <EvidenceViewerProvider hiveId={HIVE_ID} labels={new Map([["d", "Doc"]])} fileNames={{}}>
        <ReadProblemNotice
          problems={readProblemsFromCoverage(
            [
              {
                key: "k",
                sourceDocumentId: "40e10002-0000-4000-8000-000000000002",
                fileName: "water.pdf",
                reason: "NO_TEXT",
                pageNumbers: [],
                material: true,
              },
            ],
            () => "Water bill",
            () => 1,
          )}
          documentsHref="/hives/x/documents"
        />
        <SourceChips refs={[{ sourceDocumentId: "d", pageNumber: 2, quote: "x" }]} />
      </EvidenceViewerProvider>,
    );
    expect(screen.getByTestId("read-problem-notice").querySelectorAll('[data-testid="hive-mark"]')).toHaveLength(1);
  });
});
