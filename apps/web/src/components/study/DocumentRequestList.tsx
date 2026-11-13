"use client";

import type { DocumentRequestItem, StudyViewDocumentRequestList } from "@hiveforyou/contracts";
import {
  DOCUMENT_REQUEST_LIST_LEGACY_HINT,
  askNowDocumentRequestCount,
  draftRequestPlainText,
  type HolderLabelContext,
  holderTypeLabel,
  parseDocumentRequestWhy,
  partitionDocumentRequests,
} from "@hiveforyou/contracts";
import { useCallback, useId, useMemo, useState } from "react";

import { SourceChips, type ChipRef } from "./SourceChip";

type DocumentRequestListProps = {
  readonly component: StudyViewDocumentRequestList;
  readonly customer: boolean;
  sentenceChips: (factIds: readonly string[]) => ChipRef[];
  readonly holderContext?: HolderLabelContext;
};

function headerLine(askNow: number, askLater: number, customer: boolean): string {
  if (askNow === 0 && askLater === 0) return "";
  if (customer) {
    if (askNow > 0 && askLater > 0) {
      return `${askNow} document${askNow === 1 ? "" : "s"} to ask for before you sign or meet, and ${askLater} record${askLater === 1 ? "" : "s"} to expect later.`;
    }
    if (askNow > 0) return `${askNow} document${askNow === 1 ? "" : "s"} worth asking for before you sign or meet.`;
    return `${askLater} record${askLater === 1 ? "" : "s"} to expect later.`;
  }
  if (askNow > 0 && askLater > 0) {
    return `${askNow} to request from the client now and ${askLater} to follow up on later.`;
  }
  if (askNow > 0) return `${askNow} document${askNow === 1 ? "" : "s"} to request from the client.`;
  return `${askLater} record${askLater === 1 ? "" : "s"} to track for later.`;
}

function BasisTag({ item }: { item: DocumentRequestItem }) {
  if (item.basis.type === "MENTIONED") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1 text-small text-quiet">
        Mentioned in{" "}
        <SourceChips
          refs={item.basis.sourceRefs.map((ref) => ({
            sourceDocumentId: ref.sourceDocumentId,
            pageNumber: ref.pageNumber,
            quote: ref.quote,
          }))}
        />
      </span>
    );
  }
  return (
    <span className="rounded-chip bg-mist px-2 py-0.5 text-caption font-medium text-graphite" data-basis="usually-expected">
      Usually expected
    </span>
  );
}

function showWhy(title: string, why: string): boolean {
  const reason = why.trim();
  return reason !== "" && reason !== title.trim();
}

function RequestWhy({ title, why }: { title: string; why: string }) {
  if (!showWhy(title, why)) return null;
  const parsed = parseDocumentRequestWhy(why);
  if ("plain" in parsed) {
    return <span className="text-body text-graphite">{parsed.plain}</span>;
  }
  return (
    <div className="flex flex-col gap-1 text-body text-graphite">
      <span>{parsed.lead}</span>
      <ul className="m-0 list-disc pl-5">
        {parsed.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </div>
  );
}

export function DocumentRequestList({ component, customer, sentenceChips, holderContext }: DocumentRequestListProps) {
  const holderCtx: HolderLabelContext = { customer, ...holderContext };
  const parts = partitionDocumentRequests(component);
  const askNow = parts.items.filter(
    (item) => item.kind === "REQUESTABLE_DOCUMENT" && item.holderType !== "COURT_RECORD",
  );
  const courtRecordCount =
    component.courtRecordCount ??
    parts.items.filter((item) => item.kind === "REQUESTABLE_DOCUMENT" && item.holderType === "COURT_RECORD").length;
  const askLater = parts.items.filter((item) => item.kind === "FUTURE_RECORD");
  const interactive = !component.fallback;
  const listId = useId();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(askNow.map((item) => item.id)));
  const [copied, setCopied] = useState(false);

  const askNowCount = useMemo(
    () =>
      askNowDocumentRequestCount({
        items: parts.items,
        observations: [],
        courtRecordCount: component.courtRecordCount ?? 0,
        legacyLines: parts.legacyLines,
        ...(component.intakePrompts ? { intakePrompts: component.intakePrompts } : {}),
      }),
    [component.courtRecordCount, component.intakePrompts, parts.items, parts.legacyLines],
  );
  const summary = useMemo(() => headerLine(askNowCount, askLater.length, customer), [askNowCount, askLater.length, customer]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const copyDraft = useCallback(async () => {
    const text = draftRequestPlainText(parts.items, selected);
    if (text === "") return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [parts.items, selected]);

  return (
    <div className="flex flex-col gap-5" data-testid="document-request-list" data-fallback={component.fallback ? "true" : "false"}>
      {summary ? <p className="m-0 max-w-prose text-body text-graphite">{summary}</p> : null}
      {component.intro ? (
        <p className="m-0 max-w-prose text-body text-ink">
          {component.intro.text} <SourceChips refs={sentenceChips(component.intro.factIds)} />
        </p>
      ) : null}
      {parts.legacyLines.length > 0 ? (
        <>
          <p className="m-0 max-w-prose text-small text-quiet" data-testid="document-request-legacy-hint">
            {DOCUMENT_REQUEST_LIST_LEGACY_HINT}
          </p>
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5" data-testid="document-request-legacy-list">
            {parts.legacyLines.map((line) => (
              <li key={line.id} className="max-w-prose text-body text-ink" data-kind="LEGACY_STATEMENT">
                {line.text}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {courtRecordCount > 0 ? (
        <p className="m-0 max-w-prose text-body text-graphite" data-testid="court-register-line">
          {courtRecordCount} {courtRecordCount === 1 ? "item" : "items"}: check the court&apos;s claims register
        </p>
      ) : null}
      {askNow.length > 0 ? (
        <RequestGroup title="Ask now" items={askNow} listId={`${listId}-now`} interactive={interactive} selected={selected} onToggle={toggle} holderCtx={holderCtx} />
      ) : null}
      {askLater.length > 0 ? (
        <RequestGroup title="Later" items={askLater} listId={`${listId}-later`} interactive={false} selected={selected} onToggle={toggle} holderCtx={holderCtx} later />
      ) : null}
      {component.intakePrompts && component.intakePrompts.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby={`${listId}-intake`}>
          <h4 id={`${listId}-intake`} className="m-0 text-small font-semibold text-ink">
            Worth collecting if you have them
          </h4>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-body text-graphite">
            {component.intakePrompts.map((prompt) => (
              <li key={prompt.id}>{prompt.text}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {interactive && askNow.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-line bg-paper px-4 text-body font-medium text-ink hover:bg-mist"
            data-action="draftRequest"
            onClick={() => void copyDraft()}
          >
            {copied ? "Copied" : customer ? "Copy request wording" : "Copy client request"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RequestGroup({
  title,
  items,
  listId,
  interactive,
  selected,
  onToggle,
  holderCtx,
  later = false,
}: {
  title: string;
  items: readonly DocumentRequestItem[];
  listId: string;
  interactive: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  holderCtx: HolderLabelContext;
  later?: boolean;
}) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby={listId}>
      <h4 id={listId} className="m-0 flex items-center gap-2 text-small font-semibold text-ink">
        <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-pill bg-coral" />
        {title}
      </h4>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((item) => (
          <li key={item.id} className="flex gap-3 rounded-card border border-line bg-paper p-3" data-row-id={item.id} data-kind={item.kind}>
            {interactive && item.kind === "REQUESTABLE_DOCUMENT" ? (
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-cell"
                checked={selected.has(item.id)}
                onChange={() => onToggle(item.id)}
                aria-label={`Include ${item.title} in draft request`}
              />
            ) : null}
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="font-medium text-ink">{item.title}</span>
              {!later ? (
                <>
                  <RequestWhy title={item.title} why={item.why} />
                  <BasisTag item={item} />
                  {item.holderType ? (
                    <span className="text-small text-quiet">Likely held by: {holderTypeLabel(item.holderType, item.holder, holderCtx)}</span>
                  ) : item.holder ? (
                    <span className="text-small text-quiet">Likely held by: {item.holder}</span>
                  ) : null}
                </>
              ) : (
                <span className="text-body text-graphite">
                  {item.when ? `Expected: ${item.when}` : showWhy(item.title, item.why) ? item.why : null}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
