// @vitest-environment jsdom
import type { DocumentRead, DocumentReadStatus } from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReadDocumentsModal } from "./ReadDocumentsModal";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const STATUSES: DocumentReadStatus[] = [
  "QUEUED",
  "READING",
  "SAVING",
  "VERIFYING",
  "SUCCEEDED",
  "PARTIAL",
  "UNREADABLE",
  "FAILED",
];
const TERMINAL = new Set<DocumentReadStatus>(["SUCCEEDED", "PARTIAL", "UNREADABLE", "FAILED"]);

function docId(index: number): string {
  return `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
}

function makeRead(
  status: DocumentReadStatus,
  index = 0,
  overrides: Partial<DocumentRead> = {},
): DocumentRead {
  const finished = TERMINAL.has(status);
  return {
    id: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
    hiveId: HIVE_ID,
    sourceDocumentId: docId(index),
    requestId: "66666666-6666-4666-8666-666666666666",
    attemptNumber: 1,
    status,
    totalPhysicalPages: status === "QUEUED" || status === "READING" ? null : 3,
    verifiedPageCount: finished && status !== "FAILED" ? 3 : null,
    unreadablePageCount: status === "PARTIAL" ? 1 : null,
    errorCode: status === "FAILED" ? "PAGE_READ_FAILED" : status === "UNREADABLE" ? "DOCUMENT_UNREADABLE" : null,
    errorMessageSafe:
      status === "FAILED"
        ? "Reading this document timed out. You can try again."
        : status === "UNREADABLE"
          ? "We couldn't find readable text in this document."
          : null,
    retryable: status === "FAILED" ? true : status === "UNREADABLE" ? false : null,
    correlationId: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
    createdAt: "2026-11-01T22:00:00.000Z",
    startedAt: status === "QUEUED" ? null : "2026-11-01T22:00:01.000Z",
    updatedAt: new Date().toISOString(),
    finishedAt: finished ? "2026-11-01T22:00:05.000Z" : null,
    ...overrides,
  };
}

const fileNames = new Map(STATUSES.map((status, index) => [docId(index), `synthetic-${status.toLowerCase()}.pdf`]));

type ModalProps = ComponentProps<typeof ReadDocumentsModal>;

function renderModal(reads: DocumentRead[], overrides: Partial<ModalProps> = {}): ModalProps {
  const props: ModalProps = {
    open: true,
    reads,
    fileNames,
    pollState: "ok",
    arrival: null,
    returnFocusRef: createRef<HTMLElement>(),
    onClose: vi.fn(),
    onRetry: null,
    retryBusy: false,
    retryError: null,
    ...overrides,
  };
  render(<ReadDocumentsModal {...props} />);
  return props;
}

function stepStates(): (string | null)[] {
  return within(screen.getByTestId("read-steps"))
    .getAllByRole("listitem")
    .map((step) => step.getAttribute("data-state"));
}

describe("ReadDocumentsModal", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders nothing when closed or when there are no reads", () => {
    const { container } = render(
      <ReadDocumentsModal
        open={false}
        reads={[makeRead("READING")]}
        fileNames={fileNames}
        pollState="ok"
        arrival={null}
        returnFocusRef={createRef()}
        onClose={() => undefined}
        onRetry={null}
        retryBusy={false}
        retryError={null}
      />,
    );
    expect(container.innerHTML).toBe("");
    cleanup();
    renderModal([]);
    expect(screen.queryByTestId("read-documents-modal")).toBeNull();
  });

  it("shows each of the eight statuses with its own label and recorded detail", () => {
    renderModal(STATUSES.map((status, index) => makeRead(status, index)));
    const rows = screen.getAllByTestId("read-document-row");
    expect(rows.map((row) => row.getAttribute("data-status"))).toEqual(STATUSES);

    const expected: Record<DocumentReadStatus, [string, string]> = {
      QUEUED: ["Waiting", "Waiting to be read."],
      READING: ["Reading", "Reading pages."],
      SAVING: ["Saving", "Saving 3 pages."],
      VERIFYING: ["Checking", "Checking the saved pages."],
      SUCCEEDED: ["Read", "3 pages saved and checked."],
      PARTIAL: ["Partly read", "2 of 3 pages have readable text."],
      UNREADABLE: ["Can't be read", "We couldn't find readable text in this document."],
      FAILED: ["Didn't finish", "Reading this document timed out. You can try again."],
    };
    rows.forEach((row, index) => {
      const status = STATUSES[index]!;
      const [label, detail] = expected[status];
      within(row).getByText(label);
      within(row).getByText(detail);
      within(row).getByText(`synthetic-${status.toLowerCase()}.pdf`);
      const hasReference = within(row).queryByText(/Support reference/) !== null;
      expect(hasReference).toBe(status === "FAILED" || status === "UNREADABLE");
    });
  });

  it("while reading, follows the slowest document and offers to run in the background", () => {
    const props = renderModal([makeRead("SAVING", 0), makeRead("READING", 1)]);
    screen.getByRole("heading", { name: "Reading your documents" });
    expect(stepStates()).toEqual(["done", "active", "pending", "pending", "pending"]);
    expect(screen.getByTestId("read-documents-modal").getAttribute("data-outcome")).toBe("active");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run in background" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows Getting started when every document is still queued", () => {
    renderModal([makeRead("QUEUED", 0), makeRead("QUEUED", 1)]);
    screen.getByRole("heading", { name: "Getting started" });
    screen.getByText("2 documents lined up to be read.");
    expect(stepStates()).toEqual(["active", "pending", "pending", "pending", "pending"]);
  });

  it("reports success only when every recorded attempt succeeded", () => {
    renderModal([makeRead("SUCCEEDED", 0), makeRead("SUCCEEDED", 1)]);
    screen.getByRole("heading", { name: "All 2 documents are read" });
    expect(screen.getByTestId("read-count").textContent).toBe("2");
    expect(screen.getByTestId("read-documents-modal").getAttribute("data-outcome")).toBe("succeeded");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2");
    expect(stepStates()).toEqual(["done", "done", "done", "done", "done"]);
    screen.getByRole("button", { name: "Close" });
    expect(screen.getByTestId("read-live").textContent).toBe("All 2 documents are read");
  });

  it("treats partly read and unreadable documents as finished, not successful", () => {
    renderModal([makeRead("SUCCEEDED", 0), makeRead("PARTIAL", 5), makeRead("UNREADABLE", 6)]);
    screen.getByRole("heading", { name: "Reading finished" });
    screen.getByText(/2 of 3 documents read/);
    expect(screen.getByTestId("read-documents-modal").getAttribute("data-outcome")).toBe("finished");
  });

  it("explains failures with a support reference and lets the owner try again", () => {
    const onRetry = vi.fn();
    renderModal([makeRead("SUCCEEDED", 0), makeRead("FAILED", 7)], { onRetry });
    screen.getByRole("heading", { name: "Reading didn't finish" });
    screen.getByText("Support reference: 77777777-7777-4777-8777-000000000007");
    screen.getByText("What you can do");
    expect(stepStates().at(-1)).toBe("stopped");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides Try again when nothing can be retried", () => {
    renderModal([makeRead("FAILED", 7, { retryable: false })]);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    screen.getByText(/Contact support with the reference/);
  });

  it("disables Try again while a retry is starting and shows retry errors", () => {
    renderModal([makeRead("FAILED", 7)], {
      onRetry: vi.fn(),
      retryBusy: true,
      retryError: { message: "Could not start reading your documents.", correlationId: "ref-123" },
    });
    expect((screen.getByRole("button", { name: "Starting…" }) as HTMLButtonElement).disabled).toBe(true);
    screen.getByText("Could not start reading your documents. Support reference: ref-123");
  });

  it("shows connection notices from durable polling", () => {
    renderModal([makeRead("READING", 1)], { pollState: "reconnecting" });
    screen.getByText(/trouble reaching HiveForYou/);
    cleanup();
    renderModal([makeRead("READING", 1)], { pollState: "auth_expired" });
    screen.getByText(/session expired/);
  });

  it("notes when no update has been recorded for several minutes", () => {
    renderModal([makeRead("READING", 1, { updatedAt: "2020-01-01T00:00:00.000Z" })]);
    screen.getByText(/haven't recorded a new update/);
  });

  it("closes on Escape", () => {
    const props = renderModal([makeRead("READING", 1)]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
