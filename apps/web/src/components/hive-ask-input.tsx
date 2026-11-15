"use client";

import { type FormEvent, useId, useState } from "react";

import { HiveClientError } from "@/lib/hives-client";
import { createIntentRequest } from "@/lib/source-documents-client";

type AskState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string; correlationId: string | null };

/**
 * Saves the question as the Hive's intent. Nothing is answered here: the next study build from
 * Documents takes it into account, and the status line says so.
 */
export function HiveAskInput({ hiveId }: { hiveId: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<AskState>({ kind: "idle" });
  const inputId = useId();
  const statusId = useId();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const intentText = text.trim();
    if (intentText === "" || state.kind === "saving") return;
    setState({ kind: "saving" });
    try {
      await createIntentRequest(hiveId, { intentText, clientRequestId: crypto.randomUUID() });
      setText("");
      setState({ kind: "saved" });
    } catch (error) {
      setState({
        kind: "failed",
        message: error instanceof HiveClientError ? error.message : "We couldn't save your question. Try again.",
        correlationId: error instanceof HiveClientError ? error.correlationId : null,
      });
    }
  };

  const statusText =
    state.kind === "saved"
      ? "Saved. Your next study build uses this question."
      : state.kind === "failed"
        ? `${state.message}${state.correlationId ? ` Support reference: ${state.correlationId}` : ""}`
        : "";

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5" data-testid="hive-ask">
      <label htmlFor={inputId} className="sr-only">
        Ask about these documents
      </label>
      <div className="hive-ask flex min-h-12 items-center gap-2 border border-line bg-paper py-1 pl-4 pr-1">
        <input
          id={inputId}
          type="text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (state.kind !== "saving") setState({ kind: "idle" });
          }}
          placeholder="Ask about these documents"
          aria-describedby={statusText ? statusId : undefined}
          className="min-h-10 min-w-0 flex-1 border-0 bg-transparent p-0 text-body text-ink placeholder:text-quiet"
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={text.trim() === "" || state.kind === "saving"}
          className="inline-flex min-h-10 shrink-0 items-center rounded-[10px] border-0 bg-transparent px-3 text-[15px] font-semibold text-cell-blue-deep hover:bg-cell-blue-wash disabled:cursor-not-allowed disabled:text-quiet disabled:hover:bg-transparent"
        >
          {state.kind === "saving" ? "Saving…" : "Ask"}
        </button>
      </div>
      <p id={statusId} role="status" className="m-0 min-h-0 text-small text-graphite empty:hidden">
        {statusText}
      </p>
    </form>
  );
}

/** In-hive header pill: hive name chip, question field, and status below the header row. */
export function HiveWorkspaceAsk({ hiveId, hiveName }: { hiveId: string; hiveName: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<AskState>({ kind: "idle" });
  const inputId = useId();
  const statusId = useId();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const intentText = text.trim();
    if (intentText === "" || state.kind === "saving") return;
    setState({ kind: "saving" });
    try {
      await createIntentRequest(hiveId, { intentText, clientRequestId: crypto.randomUUID() });
      setText("");
      setState({ kind: "saved" });
    } catch (error) {
      setState({
        kind: "failed",
        message: error instanceof HiveClientError ? error.message : "We couldn't save your question. Try again.",
        correlationId: error instanceof HiveClientError ? error.correlationId : null,
      });
    }
  };

  const statusText =
    state.kind === "saved"
      ? "Saved. Your next study build uses this question."
      : state.kind === "failed"
        ? `${state.message}${state.correlationId ? ` Support reference: ${state.correlationId}` : ""}`
        : "";

  return (
    <>
      <div
        className="order-3 flex min-h-12 min-w-0 max-w-[680px] flex-[1_1_360px] basis-full items-center gap-2 rounded-pill border border-line bg-paper py-1 pl-1.5 pr-1 shadow-[0_1px_6px_rgb(31_35_40/0.1)] min-[600px]:order-2 min-[600px]:basis-auto"
        data-testid="hive-header-ask-pill"
      >
        <span
          className="max-w-[180px] shrink-0 truncate rounded-pill bg-mist px-3 py-1.5 text-[14px] font-semibold text-ink"
          title={hiveName}
        >
          {hiveName}
        </span>
        <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2" data-testid="hive-ask">
          <label htmlFor={inputId} className="sr-only">
            Add a question for the next study build
          </label>
          <input
            id={inputId}
            type="text"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (state.kind !== "saving") setState({ kind: "idle" });
            }}
            placeholder="Add a question for the next study build"
            aria-describedby={statusText ? statusId : undefined}
            className="min-h-10 min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-0 focus-visible:outline-none"
            maxLength={2000}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            disabled={text.trim() === "" || state.kind === "saving"}
            className="inline-flex min-h-10 shrink-0 items-center rounded-pill border-0 bg-mist px-3.5 text-[14px] font-medium text-ink transition-colors hover:bg-line disabled:cursor-not-allowed disabled:opacity-45"
          >
            {state.kind === "saving" ? "Saving…" : "Add question"}
          </button>
        </form>
      </div>
      {statusText ? (
        <p
          id={statusId}
          role="status"
          className={`order-4 m-0 w-full basis-full px-0 pb-2.5 pt-0 text-[13.5px] ${
            state.kind === "saved" ? "text-leaf-deep" : "text-coral-deep"
          }`}
        >
          {statusText}
        </p>
      ) : null}
    </>
  );
}