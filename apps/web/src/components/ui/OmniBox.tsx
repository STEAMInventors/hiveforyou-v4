"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { ChipRef } from "@/components/study/SourceChip";

import { Avatar } from "./AvatarStack";
import {
  highlightPieces,
  omniHasMatches,
  omniHits,
  type OmniCatalog,
  type OmniHit,
} from "./omni-catalog";

export type OmniBoxProps = {
  /** The assistant's name, or null when the assistant is off for this hive (no Ask row). */
  assistantName: string | null;
  audience: "staff" | "client";
  catalog: OmniCatalog;
  query: string;
  onQueryChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sends the typed text to the chat. */
  onAsk: (question: string) => void;
  onOpenChip: (chip: ChipRef) => void;
  inputId?: string;
};

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="icon h-4 w-4 shrink-0 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.2-3.2" />
    </svg>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightPieces(text, query).map((piece, index) =>
        piece.match ? (
          <mark key={index} className="rounded-sm bg-cite px-px text-inherit">
            {piece.text}
          </mark>
        ) : (
          <span key={index}>{piece.text}</span>
        ),
      )}
    </>
  );
}

type Row = { kind: "hit"; hit: OmniHit } | { kind: "ask" };

/**
 * The box is find-only (DESIGN "The box"): statements, open items and documents, filtered client-side,
 * with "Ask <assistant>: <query>" last. It never calls a model. Questions live in the chat.
 */
export function OmniBox({
  assistantName,
  audience,
  catalog,
  query,
  onQueryChange,
  open,
  onOpenChange,
  onAsk,
  onOpenChip,
  inputId = "omni",
}: OmniBoxProps) {
  const listId = useId();
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => omniHits(catalog, query), [catalog, query]);
  const trimmed = query.trim();
  const canAsk = assistantName !== null && trimmed !== "";
  const rows = useMemo<Row[]>(() => {
    const list: Row[] = hits.map((hit) => ({ kind: "hit", hit }));
    if (canAsk) list.push({ kind: "ask" });
    return list;
  }, [canAsk, hits]);
  const placeholder = audience === "client" ? "Find in your documents" : "Find anything in this hive";

  useEffect(() => {
    setActive(-1);
  }, [query, open]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    // Capture phase, and the key is marked handled, so the evidence view (Escape order: sheet, box, view)
    // does not also close. Blur first: closing re-renders, and a focused input would open the box again.
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      inputRef.current?.blur();
      onOpenChange(false);
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [onOpenChange, open]);

  const activate = (row: Row) => {
    if (row.kind === "ask") {
      onAsk(trimmed);
      return;
    }
    const hit = row.hit;
    const chip = hit.kind === "statement" ? hit.statement.ref : hit.kind === "item" ? hit.item.ref : hit.document.ref;
    if (chip) onOpenChip(chip);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(rows.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(-1, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = active >= 0 ? rows[active] : undefined;
      if (row) activate(row);
      else if (canAsk) onAsk(trimmed);
    }
  };

  const rowId = (row: Row) => `${listId}-${row.kind === "ask" ? "ask" : row.hit.id}`;
  const activeId = active >= 0 && rows[active] ? rowId(rows[active]!) : undefined;
  const askIndex = canAsk ? rows.length - 1 : -1;

  const statements = hits.filter((hit): hit is Extract<OmniHit, { kind: "statement" }> => hit.kind === "statement");
  const items = hits.filter((hit): hit is Extract<OmniHit, { kind: "item" }> => hit.kind === "item");
  const documents = hits.filter((hit): hit is Extract<OmniHit, { kind: "document" }> => hit.kind === "document");
  const indexOfHit = (hit: OmniHit) => rows.findIndex((row) => row.kind === "hit" && row.hit === hit);

  return (
    <div className={`relative min-w-0 ${open ? "open" : ""}`} data-testid="omni">
      <label
        className={`flex h-10 items-center gap-2.5 rounded-input border bg-paper px-3.5 transition-[background,border-color,box-shadow] min-[760px]:h-[42px] ${
          open
            ? "border-line-strong shadow-lift"
            : "border-line-strong hover:border-ink-3 focus-within:border-ink-3 focus-within:shadow-lift"
        }`}
      >
        <SearchIcon />
        <span className="sr-only">{placeholder}</span>
        <input
          id={inputId}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? activeId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
          onChange={(event) => {
            onQueryChange(event.target.value);
            onOpenChange(true);
          }}
          onFocus={() => onOpenChange(true)}
          onKeyDown={onInputKeyDown}
        />
        <span className="hidden rounded-tag border border-line-strong bg-paper px-1.5 text-[11.5px] leading-[18px] text-ink-3 min-[760px]:inline">/</span>
      </label>
      {open ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[min(70vh,640px)] overflow-y-auto rounded-popover border border-line bg-paper p-2 shadow-pop motion-safe:animate-[hfy-rise_180ms_cubic-bezier(.16,1,.3,1)] max-[759px]:fixed max-[759px]:left-2 max-[759px]:right-2 max-[759px]:top-16"
          data-testid="omni-pop"
        >
          <div id={listId} role="listbox" aria-label="Find in this hive">
            {!trimmed ? (
              <p className="m-0 px-3 py-2.5 text-meta text-ink-3" data-testid="omni-empty">
                Type to find statements, open items and documents in this hive.
                {assistantName ? ` To ask a question, use ${assistantName}.` : ""}
              </p>
            ) : null}
            {statements.length ? <GroupTitle>In the documents</GroupTitle> : null}
            {statements.map((hit) => {
              const index = indexOfHit(hit);
              return (
                <HitRow key={hit.id} id={`${listId}-${hit.id}`} selected={active === index} onHover={() => setActive(index)} onChoose={() => activate(rows[index]!)}>
                  <span />
                  <span>
                    <Marked text={hit.statement.text} query={trimmed} />
                    <small className="mt-px block text-[12px] text-ink-3">{hit.statement.topic}</small>
                  </span>
                  <span className="text-meta tabular-nums text-ink-3">{hit.statement.pageLabel}</span>
                </HitRow>
              );
            })}
            {items.length ? <GroupTitle>Open items</GroupTitle> : null}
            {items.map((hit) => {
              const index = indexOfHit(hit);
              return (
                <HitRow key={hit.id} id={`${listId}-${hit.id}`} selected={active === index} onHover={() => setActive(index)} onChoose={() => activate(rows[index]!)}>
                  <span />
                  <span>
                    <Marked text={hit.item.title} query={trimmed} />
                    <small className="mt-px block text-[12px] text-ink-3">
                      {hit.item.kind === "missing" ? "Still to come" : "To review"}
                    </small>
                  </span>
                  <span />
                </HitRow>
              );
            })}
            {documents.length ? <GroupTitle>Documents</GroupTitle> : null}
            {documents.map((hit) => {
              const index = indexOfHit(hit);
              return (
                <HitRow key={hit.id} id={`${listId}-${hit.id}`} selected={active === index} onHover={() => setActive(index)} onChoose={() => activate(rows[index]!)}>
                  <span />
                  <span>
                    <Marked text={hit.document.role} query={trimmed} />
                    <small className="mt-px block text-[12px] text-ink-3">
                      {hit.document.typeLabel}
                      {hit.document.period ? ` · ${hit.document.period}` : ""}
                    </small>
                  </span>
                  <span className="text-meta tabular-nums text-ink-3">{hit.document.pages}</span>
                </HitRow>
              );
            })}
            {trimmed && !omniHasMatches(hits) ? (
              <p className="m-0 px-3 py-2 text-meta text-ink-3" data-testid="omni-no-matches">
                Nothing in this hive matches “{trimmed}”.
              </p>
            ) : null}
            {canAsk && assistantName ? (
              <div className={omniHasMatches(hits) ? "mt-1 border-t border-line pt-1" : ""}>
                <HitRow
                  id={`${listId}-ask`}
                  selected={active === askIndex}
                  onHover={() => setActive(askIndex)}
                  onChoose={() => onAsk(trimmed)}
                >
                  <Avatar person={{ id: "ai", name: assistantName, kind: "assistant" }} size="sm" />
                  <span>
                    Ask {assistantName}: <b>{trimmed}</b>
                  </span>
                  <span className="text-[11.5px] text-ink-3">Enter</span>
                </HitRow>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HitRow({
  id,
  selected,
  onHover,
  onChoose,
  children,
}: {
  id: string;
  selected: boolean;
  onHover: () => void;
  onChoose: () => void;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={selected}
      className={`grid w-full grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2 py-2 text-left text-[13.5px] leading-snug ${
        selected ? "bg-mist" : "hover:bg-mist"
      }`}
      onMouseEnter={onHover}
      onClick={onChoose}
    >
      {children}
    </button>
  );
}

function GroupTitle({ children }: { children: ReactNode }) {
  return <h4 className="mx-2 mb-1.5 mt-2 border-t border-line px-0 pt-2 font-sans text-[12px] font-semibold text-ink-3 first:border-t-0">{children}</h4>;
}
