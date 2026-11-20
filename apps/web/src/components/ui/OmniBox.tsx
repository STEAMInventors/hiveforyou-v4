"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { ChipRef } from "@/components/study/SourceChip";

import { Avatar } from "./AvatarStack";
import { Button } from "./Button";
import { SourceRefs } from "./SourceRefs";
import {
  highlightPieces,
  omniHasMatches,
  omniHits,
  type OmniCatalog,
  type OmniHit,
} from "./omni-catalog";
import { AssistantReplyBody } from "@/components/hives/assistant-reply-body";

export type OmniAnswer = {
  question: string;
  pending: boolean;
  longWait: boolean;
  text: string | null;
  refs: readonly ChipRef[];
  handoff: boolean;
  readonlyNote: string | null;
};

export type OmniBoxProps = {
  assistantName: string;
  audience: "staff" | "client";
  catalog: OmniCatalog;
  staffFirstName?: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  answer: OmniAnswer | null;
  onAsk: (question: string) => void;
  onOpenQuestion: (hit: Extract<OmniHit, { kind: "question" }>) => void;
  onOpenChip: (chip: ChipRef) => void;
  onHandoff: () => void;
  onNewQuestion: () => void;
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

export function OmniBox({
  assistantName,
  audience,
  catalog,
  staffFirstName,
  query,
  onQueryChange,
  open,
  onOpenChange,
  answer,
  onAsk,
  onOpenQuestion,
  onOpenChip,
  onHandoff,
  onNewQuestion,
  inputId = "omni",
}: OmniBoxProps) {
  const listId = useId();
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => omniHits(catalog, query), [catalog, query]);
  const placeholder =
    audience === "client"
      ? `Ask ${assistantName} about your documents`
      : `Ask ${assistantName} or find anything in this hive`;

  useEffect(() => {
    setActive(0);
  }, [query, open, answer]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
        onOpenChange(true);
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        onOpenChange(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange, open]);

  const activate = (hit: OmniHit) => {
    if (hit.kind === "ask") {
      onAsk(query);
      return;
    }
    if (hit.kind === "suggestion") {
      onQueryChange(hit.text);
      onAsk(hit.text);
      return;
    }
    if (hit.kind === "question") {
      onOpenQuestion(hit);
      return;
    }
    const chip = hit.kind === "statement" ? hit.statement.ref : hit.kind === "item" ? hit.item.ref : hit.document.ref;
    if (chip) onOpenChip(chip);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(hits.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[active] ?? hits[0];
      if (hit) activate(hit);
    }
  };

  const activeId = hits[active] ? `${listId}-${hits[active].id}` : undefined;
  const privacy =
    audience === "client"
      ? `Only you and ${staffFirstName || "your team"}'s team can see your questions.`
      : "Only you can see your questions.";

  return (
    <div className={`relative min-w-0 ${open ? "open" : ""}`} data-testid="omni">
      <label
        className={`flex h-10 items-center gap-2.5 rounded-input border border-transparent bg-mist px-3.5 transition-[background,border-color,box-shadow] hover:bg-hover min-[760px]:h-[42px] ${
          open ? "border-line-strong bg-paper shadow-lift" : ""
        }`}
      >
        <SearchIcon />
        <span className="sr-only">{placeholder}</span>
        <input
          id={inputId}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={open && !answer ? listId : undefined}
          aria-activedescendant={open && !answer ? activeId : undefined}
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
          {answer ? (
            <div role="dialog" aria-label={`${assistantName}'s answer`} className="px-2.5 pb-1.5 pt-3">
              {answer.readonlyNote ? <p className="m-0 mb-2 text-meta text-ink-2">{answer.readonlyNote}</p> : null}
              <p className="m-0 mb-2.5 font-semibold text-ink">{answer.question}</p>
              <div className="mb-1.5 flex items-center gap-2 text-meta text-ink-3">
                <Avatar person={{ id: "ai", name: assistantName, kind: "assistant" }} size="sm" />
                <b className="text-[13.5px] text-ink">{assistantName}</b>
                <span className="rounded-tag border border-line-strong px-[5px] text-[11px] font-semibold leading-[17px] text-ink-2">
                  AI assistant
                </span>
                <span>answers only from the documents</span>
              </div>
              {answer.pending ? (
                <p role="status" className="m-0 text-body text-ink-3" data-testid="omni-typing">
                  {answer.longWait ? "…still working on it…" : "Looking through the documents"}
                  {answer.longWait ? null : <TypingDots />}
                </p>
              ) : (
                <div className="text-body leading-[1.6] text-ink">
                  <AssistantReplyBody text={answer.text ?? ""} />
                  {answer.refs.length ? <SourceRefs refs={answer.refs} /> : null}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
                <p className="m-0 text-meta text-ink-3">{privacy}</p>
                {answer.handoff && !answer.pending ? (
                  <Button variant="secondary" type="button" onClick={onHandoff}>
                    Ask {staffFirstName || "your team"}
                  </Button>
                ) : (
                  <Button variant="quiet" type="button" onClick={onNewQuestion}>
                    New question
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div id={listId} role="listbox" aria-label="Find or ask">
              <HitRow
                id={`${listId}-ask`}
                selected={active === 0}
                onHover={() => setActive(0)}
                onChoose={() => activate(hits[0]!)}
              >
                <Avatar person={{ id: "ai", name: assistantName, kind: "assistant" }} size="sm" />
                <span>
                  {query.trim() ? (
                    <>
                      Ask {assistantName}: <b>{query.trim()}</b>
                    </>
                  ) : (
                    <>Ask {assistantName} a question about the documents</>
                  )}
                </span>
                <span className="text-[11.5px] text-ink-3">{query.trim() ? "Enter" : ""}</span>
              </HitRow>
              <Groups
                catalog={catalog}
                query={query}
                hits={hits}
                active={active}
                listId={listId}
                onHover={setActive}
                onChoose={activate}
              />
              {query.trim() && !omniHasMatches(hits) ? (
                <p className="px-3 py-2 text-meta text-ink-3">
                  Nothing in this hive matches “{query.trim()}”. Press Enter to ask {assistantName}.
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="hive-assistant-typing-dots ms-1 inline-flex gap-[3px]" aria-hidden>
      <span />
      <span />
      <span />
    </span>
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

function Groups({
  catalog,
  query,
  hits,
  active,
  listId,
  onHover,
  onChoose,
}: {
  catalog: OmniCatalog;
  query: string;
  hits: OmniHit[];
  active: number;
  listId: string;
  onHover: (index: number) => void;
  onChoose: (hit: OmniHit) => void;
}) {
  const trimmed = query.trim();
  if (!trimmed) {
    const suggestions = hits.filter((hit): hit is Extract<OmniHit, { kind: "suggestion" }> => hit.kind === "suggestion");
    const yours = hits.filter((hit): hit is Extract<OmniHit, { kind: "question" }> => hit.kind === "question" && hit.audience === "yours");
    const clients = hits.filter((hit): hit is Extract<OmniHit, { kind: "question" }> => hit.kind === "question" && hit.audience === "client");
    return (
      <>
        {suggestions.map((hit) => {
          const index = hits.indexOf(hit);
          return (
            <HitRow key={hit.id} id={`${listId}-${hit.id}`} selected={active === index} onHover={() => onHover(index)} onChoose={() => onChoose(hit)}>
              <span />
              <span>{hit.text}</span>
              <span />
            </HitRow>
          );
        })}
        {yours.length ? <GroupTitle>Your questions</GroupTitle> : null}
        {yours.map((hit) => {
          const index = hits.indexOf(hit);
          return (
            <HitRow key={hit.id} id={`${listId}-${hit.id}`} selected={active === index} onHover={() => onHover(index)} onChoose={() => onChoose(hit)}>
              <span />
              <span>{hit.question.question}</span>
              <span />
            </HitRow>
          );
        })}
        {clients.length ? (
          <GroupTitle>
            {catalog.clientName || "Client"}&apos;s questions <span className="tabular-nums">{catalog.clientQuestions.length}</span>
          </GroupTitle>
        ) : null}
        {clients.map((hit) => {
          const index = hits.indexOf(hit);
          return (
            <HitRow key={hit.id} id={`${listId}-${hit.id}`} selected={active === index} onHover={() => onHover(index)} onChoose={() => onChoose(hit)}>
              <span />
              <span>{hit.question.question}</span>
              <span />
            </HitRow>
          );
        })}
      </>
    );
  }
  const statements = hits.filter((hit): hit is Extract<OmniHit, { kind: "statement" }> => hit.kind === "statement");
  const items = hits.filter((hit): hit is Extract<OmniHit, { kind: "item" }> => hit.kind === "item");
  const documents = hits.filter((hit): hit is Extract<OmniHit, { kind: "document" }> => hit.kind === "document");
  return (
    <>
      {statements.length ? <GroupTitle>In the documents</GroupTitle> : null}
      {statements.map((hit) => {
        const index = hits.indexOf(hit);
        return (
          <HitRow key={hit.id} id={`${listId}-${hit.id}`} selected={active === index} onHover={() => onHover(index)} onChoose={() => onChoose(hit)}>
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
        const index = hits.indexOf(hit);
        return (
          <HitRow key={hit.id} id={`${listId}-${hit.id}`} selected={active === index} onHover={() => onHover(index)} onChoose={() => onChoose(hit)}>
            <span />
            <span>
              <Marked text={hit.item.title} query={trimmed} />
            </span>
            <span />
          </HitRow>
        );
      })}
      {documents.length ? <GroupTitle>Documents</GroupTitle> : null}
      {documents.map((hit) => {
        const index = hits.indexOf(hit);
        return (
          <HitRow key={hit.id} id={`${listId}-${hit.id}`} selected={active === index} onHover={() => onHover(index)} onChoose={() => onChoose(hit)}>
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
    </>
  );
}

function GroupTitle({ children }: { children: ReactNode }) {
  return <h4 className="mx-2 mb-1.5 mt-2 border-t border-line px-0 pt-2 font-sans text-[12px] font-semibold text-ink-3 first:border-t-0">{children}</h4>;
}
