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
          aria-describedby={state.kind === "idle" ? undefined : statusId}
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
        {state.kind === "saved"
          ? "Saved. Your next study build from Documents uses this question."
          : state.kind === "failed"
            ? `${state.message}${state.correlationId ? ` Support reference: ${state.correlationId}` : ""}`
            : ""}
      </p>
    </form>
  );
}
