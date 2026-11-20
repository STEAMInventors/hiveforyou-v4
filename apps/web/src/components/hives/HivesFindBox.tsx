"use client";

import { useEffect, useRef } from "react";

import { useClientsHomeSearch } from "@/lib/hives/clients-home-context";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.2-3.2" />
    </svg>
  );
}

/** The top bar's box on Your hives: it finds a client or hive and filters the list in place. */
export function HivesFindBox() {
  const search = useClientsHomeSearch();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!search) return null;

  return (
    <label
      className="flex h-10 items-center gap-2.5 rounded-input border border-line-strong bg-paper px-3.5 transition-[border-color,box-shadow] hover:border-ink-3 focus-within:border-ink-3 focus-within:shadow-lift min-[760px]:h-[42px]"
      data-testid="hives-find"
    >
      <SearchIcon />
      <input
        ref={inputRef}
        type="search"
        aria-label="Find a client or hive"
        autoComplete="off"
        value={search.findQuery}
        placeholder="Find a client or hive"
        data-testid="header-find-client"
        className="h-full min-w-0 flex-1 border-0 bg-transparent text-body text-ink outline-none focus-visible:outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
        onChange={(event) => search.setFindQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (search.findQuery) search.setFindQuery("");
            else event.currentTarget.blur();
          }
        }}
      />
      <span aria-hidden className="hidden rounded-tag border border-line-strong bg-paper px-1.5 text-[11.5px] leading-[18px] text-ink-3 min-[760px]:inline">
        /
      </span>
    </label>
  );
}
