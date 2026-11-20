import {
  type DocumentRead,
  type DocumentReadStatus,
  isActiveDocumentReadStatus,
} from "@hiveforyou/contracts";

export const DOCUMENT_READ_POLL_INTERVAL_MS = 3000;
export const POLL_FAILURES_BEFORE_NOTICE = 3;
export const DOCUMENT_READ_STALE_UPDATE_MS = 4 * 60 * 1000;

export type ReadPollState = "ok" | "reconnecting" | "auth_expired";

export type ReadStatusPresentation = { label: string; className: string };

const ACTIVE_PILL = "bg-cell-blue-wash text-cell-blue-deep";
const NEEDS_ATTENTION_PILL = "bg-coral-wash text-coral-deep";

const STATUS_PRESENTATION: Record<DocumentReadStatus, ReadStatusPresentation> = {
  QUEUED: { label: "Waiting", className: "bg-mist text-ink-muted" },
  READING: { label: "Reading", className: ACTIVE_PILL },
  SAVING: { label: "Saving", className: ACTIVE_PILL },
  VERIFYING: { label: "Checking", className: ACTIVE_PILL },
  SUCCEEDED: { label: "Read", className: "bg-leaf-wash text-leaf-deep" },
  PARTIAL: { label: "Partly read", className: NEEDS_ATTENTION_PILL },
  UNREADABLE: { label: "Can't be read", className: NEEDS_ATTENTION_PILL },
  FAILED: { label: "Didn't finish", className: NEEDS_ATTENTION_PILL },
};

export function readStatusPresentation(status: DocumentReadStatus): ReadStatusPresentation {
  return STATUS_PRESENTATION[status];
}

function pagesPhrase(count: number): string {
  return `${count} page${count === 1 ? "" : "s"}`;
}

/** One line per document; every claim comes from the recorded attempt. */
export function documentReadDetail(read: DocumentRead): string {
  switch (read.status) {
    case "QUEUED":
      return "Waiting to be read.";
    case "READING":
      return "Reading pages.";
    case "SAVING":
      return read.totalPhysicalPages
        ? `Saving ${pagesPhrase(read.totalPhysicalPages)}.`
        : "Saving pages.";
    case "VERIFYING":
      return "Checking the saved pages.";
    case "SUCCEEDED":
      return `${pagesPhrase(read.verifiedPageCount ?? 0)} saved and checked.`;
    case "PARTIAL": {
      const saved = read.verifiedPageCount ?? 0;
      const total = read.totalPhysicalPages ?? saved;
      const unreadable = read.unreadablePageCount ?? 0;
      const readable = Math.max(0, saved - unreadable);
      return `${readable} of ${pagesPhrase(total)} have readable text.`;
    }
    case "UNREADABLE":
    case "FAILED":
      return read.errorMessageSafe ?? "We couldn't finish reading this document.";
  }
}

export type ReadCounter = {
  total: number;
  read: number;
  unreadable: number;
  failed: number;
  active: number;
};

export function readCounter(reads: readonly DocumentRead[]): ReadCounter {
  const counter: ReadCounter = { total: reads.length, read: 0, unreadable: 0, failed: 0, active: 0 };
  for (const read of reads) {
    if (read.status === "SUCCEEDED" || read.status === "PARTIAL") {
      counter.read += 1;
    } else if (read.status === "UNREADABLE") {
      counter.unreadable += 1;
    } else if (read.status === "FAILED") {
      counter.failed += 1;
    } else {
      counter.active += 1;
    }
  }
  return counter;
}

export function hasActiveReads(reads: readonly DocumentRead[]): boolean {
  return reads.some((read) => isActiveDocumentReadStatus(read.status));
}

export function retryableFailedReads(reads: readonly DocumentRead[]): DocumentRead[] {
  return reads.filter((read) => read.status === "FAILED" && read.retryable !== false);
}

export const READ_STEPS = [
  { key: "QUEUED", label: "Waiting" },
  { key: "READING", label: "Reading" },
  { key: "SAVING", label: "Saving" },
  { key: "VERIFYING", label: "Checking" },
  { key: "DONE", label: "Done" },
] as const;

export type ReadStep = { label: string; state: "done" | "active" | "stopped" | "pending" };

/** The step row follows the slowest active document, so it never claims more than every document reached. */
export function readSteps(reads: readonly DocumentRead[]): ReadStep[] {
  const activeIndexes = reads
    .filter((read) => isActiveDocumentReadStatus(read.status))
    .map((read) => READ_STEPS.findIndex((step) => step.key === read.status));
  const finished = activeIndexes.length === 0;
  const stopped = finished && reads.some((read) => read.status === "FAILED");
  const activeIndex = finished ? READ_STEPS.length - 1 : Math.min(...activeIndexes);
  return READ_STEPS.map((step, index) => {
    if (finished) {
      if (index < activeIndex) {
        return { label: step.label, state: "done" as const };
      }
      return { label: step.label, state: stopped ? ("stopped" as const) : ("done" as const) };
    }
    if (index < activeIndex) {
      return { label: step.label, state: "done" as const };
    }
    return { label: step.label, state: index === activeIndex ? ("active" as const) : ("pending" as const) };
  });
}

export type ReadModalOutcome = "active" | "succeeded" | "finished" | "failed";

export function readModalOutcome(reads: readonly DocumentRead[]): ReadModalOutcome {
  const counter = readCounter(reads);
  if (counter.active > 0) {
    return "active";
  }
  if (counter.failed > 0) {
    return "failed";
  }
  return counter.unreadable === 0 && reads.every((read) => read.status === "SUCCEEDED")
    ? "succeeded"
    : "finished";
}

function documentsPhrase(count: number): string {
  return `${count} document${count === 1 ? "" : "s"}`;
}

export function readModalCopy(reads: readonly DocumentRead[]): { title: string; sub: string } {
  const counter = readCounter(reads);
  switch (readModalOutcome(reads)) {
    case "succeeded":
      return {
        title: counter.total === 1 ? "Your document is read" : `All ${counter.total} documents are read`,
        sub: "Every page was saved and checked against what was read.",
      };
    case "finished":
      return {
        title: "Reading finished",
        sub: `${counter.read} of ${documentsPhrase(counter.total)} read. Some pages or documents had no readable text.`,
      };
    case "failed":
      return {
        title: "Reading didn't finish",
        sub: `${counter.read} of ${documentsPhrase(counter.total)} read and saved. Nothing was marked read unless its pages were saved and checked.`,
      };
    case "active":
      break;
  }
  if (reads.every((read) => read.status === "QUEUED")) {
    return { title: "Getting started", sub: `${documentsPhrase(counter.total)} lined up to be read.` };
  }
  return {
    title: "Reading your documents",
    sub: "Each page is read, saved and checked. This can take a few minutes per document.",
  };
}

export function pollStateFromFailures(failures: number, authExpired: boolean): ReadPollState {
  if (authExpired) {
    return "auth_expired";
  }
  return failures >= POLL_FAILURES_BEFORE_NOTICE ? "reconnecting" : "ok";
}

/** True when the newest recorded update among active reads is older than a few minutes. */
export function isReadProgressStale(reads: readonly DocumentRead[], nowMs: number): boolean {
  const active = reads.filter((read) => isActiveDocumentReadStatus(read.status));
  if (active.length === 0) {
    return false;
  }
  const newest = Math.max(...active.map((read) => Date.parse(read.updatedAt)).filter(Number.isFinite));
  return Number.isFinite(newest) && nowMs - newest >= DOCUMENT_READ_STALE_UPDATE_MS;
}

/** Live-region line for newly finished documents between two polls. */
export function readArrivalMessage(previous: ReadCounter, next: ReadCounter): string | null {
  const readDelta = Math.max(0, next.read - previous.read);
  const unreadableDelta = Math.max(0, next.unreadable - previous.unreadable);
  const parts: string[] = [];
  if (readDelta === 1) {
    parts.push("Another document is read.");
  } else if (readDelta > 1) {
    parts.push(`${readDelta} more documents are read.`);
  }
  if (unreadableDelta === 1) {
    parts.push("1 document couldn't be read.");
  } else if (unreadableDelta > 1) {
    parts.push(`${unreadableDelta} documents couldn't be read.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
