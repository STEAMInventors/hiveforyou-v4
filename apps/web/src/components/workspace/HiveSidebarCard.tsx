"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { TEXT_LINK_CLASS } from "@/components/button-classes";
import type { ListFirmResponse } from "@hiveforyou/contracts";
import { hiveBadgeInitials } from "@/lib/hives/hive-badge-initials";
import { showsFirmThreePane } from "@/lib/hives/firm-board";

type HiveSidebarCardProps = {
  hive: Hive;
  currentUserId: string | null;
  firm: ListFirmResponse | null;
  assigneeLabel: string | null;
  assigneeTitle: string | null;
  assistantName: string;
};

export function HiveSidebarCard({
  hive,
  currentUserId,
  firm,
  assigneeLabel,
  assigneeTitle,
  assistantName,
}: HiveSidebarCardProps) {
  const router = useRouter();
  const renameId = useId();
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<{ message: string; reference: string | null } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(assistantName);
  const firmClient = showsFirmThreePane(hive) && firm?.firm;
  const stage = hive.stage ?? "open";
  const canTake =
    firmClient &&
    stage !== "closed" &&
    currentUserId &&
    hive.assigneeUserId?.toLowerCase() !== currentUserId.toLowerCase();
  const canHandOver =
    firmClient &&
    stage !== "closed" &&
    currentUserId &&
    hive.assigneeUserId?.toLowerCase() === currentUserId.toLowerCase();

  async function postJson(url: string, body: unknown, idempotencyKey: string): Promise<{ ok: boolean; reference: string | null }> {
    setBusy(true);
    setInlineError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as { correlationId?: string; safeMessage?: string } | null;
      if (!response.ok) {
        setInlineError({
          message: typeof payload?.safeMessage === "string" ? payload.safeMessage : "Something went wrong.",
          reference: typeof payload?.correlationId === "string" ? payload.correlationId.slice(0, 8) : null,
        });
        return { ok: false, reference: payload?.correlationId ?? null };
      }
      router.refresh();
      return { ok: true, reference: null };
    } finally {
      setBusy(false);
    }
  }

  const purpose = hive.description?.trim() ?? "";

  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-paper p-3.5" data-testid="hive-sidebar-card">
      <div className="flex gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-mist text-caption font-bold text-ink"
          aria-hidden
        >
          {hiveBadgeInitials(hive.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-small font-semibold text-ink">{hive.name}</p>
          {purpose ? (
            <p className="m-0 line-clamp-2 text-caption text-graphite">{purpose}</p>
          ) : null}
        </div>
      </div>

      {firmClient ? (
        <>
          <p className="m-0 text-caption text-graphite">
            On it:{" "}
            <span className="font-semibold text-ink">
              {assigneeLabel ?? "Unassigned"}
              {assigneeTitle ? ` · ${assigneeTitle}` : ""}
            </span>{" "}
            {canTake ? (
              <button
                type="button"
                className={`${TEXT_LINK_CLASS} border-0 bg-transparent p-0 font-semibold disabled:opacity-45`}
                disabled={busy}
                onClick={() => void postJson(`/api/v1/hives/${hive.id}/assignment`, { assigneeUserId: currentUserId, clientRequestId: crypto.randomUUID() }, crypto.randomUUID())}
              >
                {busy ? "Saving…" : "Take it"}
              </button>
            ) : null}
            {canHandOver ? (
              <button
                type="button"
                className={`${TEXT_LINK_CLASS} border-0 bg-transparent p-0 font-semibold disabled:opacity-45`}
                disabled={busy}
                onClick={() => void postJson(`/api/v1/hives/${hive.id}/assignment`, { assigneeUserId: null, clientRequestId: crypto.randomUUID() }, crypto.randomUUID())}
              >
                {busy ? "Saving…" : "Hand over"}
              </button>
            ) : null}
          </p>
          <p className="m-0 text-caption text-graphite">
            <span className="font-semibold text-ink">{assistantName}</span> · automated{" "}
            {renaming ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                <label htmlFor={renameId} className="sr-only">
                  Assistant name
                </label>
                <input
                  id={renameId}
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  className="min-h-11 rounded-control border border-line px-2 text-caption"
                />
                <button
                  type="button"
                  className={TEXT_LINK_CLASS}
                  disabled={busy}
                  onClick={async () => {
                    const name = renameValue.trim();
                    const ok = await postJson("/api/v1/firm/assistant", { assistantName: name, clientRequestId: crypto.randomUUID() }, crypto.randomUUID());
                    if (ok.ok) setRenaming(false);
                  }}
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </span>
            ) : (
              <button type="button" className={`${TEXT_LINK_CLASS} border-0 bg-transparent p-0`} onClick={() => setRenaming(true)}>
                Rename
              </button>
            )}
          </p>
        </>
      ) : null}

      {inlineError ? (
        <p role="alert" className="m-0 text-caption text-coral-deep">
          {inlineError.message}
          {inlineError.reference ? ` Reference ${inlineError.reference}.` : ""}
        </p>
      ) : null}
    </div>
  );
}
