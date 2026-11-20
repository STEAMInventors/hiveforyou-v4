"use client";

import { useEffect, useState } from "react";

export type FindingsTocEntry = {
  id: string;
  label: string;
  count?: number | null;
};

function FilterIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
      className="shrink-0 text-ink-3"
    >
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

export function FindingsFindBar({
  visible,
  query,
  onQueryChange,
  onClear,
  matchSummary,
  toc,
  jumpTo,
}: {
  visible: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onClear: () => void;
  matchSummary: string | null;
  toc: readonly FindingsTocEntry[];
  jumpTo: (id: string) => void;
}) {
  if (!visible) return null;
  return (
    <div className="mt-4 flex flex-col gap-2" data-testid="findings-find-bar">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-paper px-3 py-2 focus-within:border-line-strong">
          <FilterIcon />
          <span className="sr-only">Filter findings</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Filter by a word, name or amount"
            autoComplete="off"
            className="min-w-0 flex-1 border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
            data-testid="findings-filter-input"
          />
        </label>
        <label className="min-[1280px]:hidden">
          <span className="sr-only">Jump to</span>
          <select
            className="h-10 min-w-[9rem] rounded-control border border-line bg-paper px-2 text-meta text-ink"
            defaultValue=""
            onChange={(event) => {
              const id = event.target.value;
              if (id) jumpTo(id);
              event.target.value = "";
            }}
            data-testid="findings-jump-select"
          >
            <option value="">Jump to…</option>
            {toc.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
                {entry.count != null ? ` (${entry.count})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {matchSummary ? (
        <p className="m-0 text-meta text-ink-3" role="status" data-testid="findings-filter-status">
          {matchSummary}{" "}
          <button type="button" className="border-0 bg-transparent p-0 text-meta font-medium text-blue-deep hover:underline" onClick={onClear}>
            Clear
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function FindingsOnThisPage({
  toc,
  activeId,
  onNavigate,
}: {
  toc: readonly FindingsTocEntry[];
  activeId: string | null;
  onNavigate: (id: string) => void;
}) {
  if (toc.length <= 3) return null;
  return (
    <aside
      className="hidden w-[200px] shrink-0 min-[1280px]:sticky min-[1280px]:top-24 min-[1280px]:block"
      aria-label="On this page"
      data-testid="findings-on-this-page"
    >
      <p className="m-0 text-meta font-semibold text-ink-3">On this page</p>
      <nav className="mt-2 flex flex-col">
        {toc.map((entry) => {
          const current = entry.id === activeId;
          return (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              className={`flex min-h-9 items-center justify-between gap-2 rounded-chip px-2 py-1 text-meta no-underline hover:bg-hover hover:text-ink ${
                current ? "bg-hover font-semibold text-ink" : "text-ink-2"
              }`}
              aria-current={current ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(entry.id);
              }}
            >
              <span>{entry.label}</span>
              {entry.count != null ? <span className="tabular-nums text-ink-3">{entry.count}</span> : null}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

export function useFindingsScrollSpy(sectionIds: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(sectionIds[0] ?? null);
  useEffect(() => {
    if (sectionIds.length === 0 || typeof IntersectionObserver === "undefined") return undefined;
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element != null);
    if (elements.length === 0) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target.id;
        if (top) setActive(top);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [sectionIds]);
  return active;
}