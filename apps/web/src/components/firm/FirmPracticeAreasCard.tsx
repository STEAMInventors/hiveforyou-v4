"use client";

import type { ListFirmResponse } from "@hiveforyou/contracts";
import { useState } from "react";

import { PRIMARY_BUTTON_CLASS } from "@/components/button-classes";
import { useWorkspaceAction } from "@/components/workspace/useWorkspaceAction";
import type { PracticeAreaSetupOption } from "@/server/firm/practice-area-options";

type FirmPracticeAreasCardProps = {
  firm: ListFirmResponse;
  options: PracticeAreaSetupOption[];
};

export function FirmPracticeAreasCard({ firm, options }: FirmPracticeAreasCardProps) {
  const canEdit = firm.firm?.callerRole === "owner" || firm.firm?.callerRole === "attorney";
  const [selected, setSelected] = useState<string[]>(firm.firm?.practiceAreas ?? []);
  const action = useWorkspaceAction("/account/firm");

  const toggle = (packId: string) => {
    if (!canEdit) return;
    setSelected((current) =>
      current.includes(packId) ? current.filter((id) => id !== packId) : [...current, packId],
    );
    action.clearError();
  };

  async function save() {
    if (!canEdit || action.pending) return;
    const result = await action.run({
      url: "/api/v1/firm/practice-areas",
      method: "PATCH",
      body: { practiceAreas: selected },
      failureMessage: "Could not save your areas. Try again.",
    });
    if (result !== null && typeof result === "object" && result && "firm" in result) {
      const next = (result as ListFirmResponse).firm?.practiceAreas;
      if (next) setSelected(next);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-paper p-5" data-testid="firm-practice-areas-card">
      <div>
        <h2 className="m-0 text-[18px] font-semibold text-ink">What you handle</h2>
        <p className="m-0 mt-1 text-small text-graphite">
          {canEdit ? "Choose all practice areas that apply." : "Your firm owner or attorney manages these."}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {options.map((area) => {
          const on = selected.includes(area.packId);
          return (
            <label
              key={area.packId}
              data-testid={`firm-practice-area-${area.packId}`}
              className={`flex min-h-11 items-start gap-3 rounded-control border px-3.5 py-3 ${
                on ? "border-cell-blue-deep bg-cell-blue-wash" : "border-line bg-paper"
              } ${canEdit ? "cursor-pointer" : "opacity-90"}`}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={on}
                disabled={!canEdit}
                onChange={() => toggle(area.packId)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-ink">{area.label}</span>
                <span className="text-[13px] text-graphite">{area.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      {action.inlineError ? (
        <p role="alert" className="m-0 text-sm text-coral-deep">
          {action.inlineError.message}
          {action.inlineError.reference ? ` Reference ${action.inlineError.reference}.` : ""}
          {action.inlineError.retryable ? (
            <button
              type="button"
              className="ml-1 border-0 bg-transparent p-0 font-semibold text-cell-blue-deep"
              onClick={() =>
                void action.retrySameKey({
                  url: "/api/v1/firm/practice-areas",
                  method: "PATCH",
                  body: { practiceAreas: selected },
                  failureMessage: "Could not save your areas. Try again.",
                })
              }
            >
              Try again
            </button>
          ) : null}
        </p>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          className={`${PRIMARY_BUTTON_CLASS} h-11 self-start`}
          disabled={action.pending}
          onClick={() => void save()}
        >
          {action.pending ? "Saving…" : "Save"}
        </button>
      ) : null}
    </section>
  );
}