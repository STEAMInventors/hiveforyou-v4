"use client";

import { type ApplicationViewComponent, recomputeScenario } from "@hiveforyou/contracts";
import { useId, useMemo, useState } from "react";

import { CARD_CLASS, formatValue, HEADING_CLASS, SourceChips, StatusBadge } from "./a2ui-parts";

type ScenarioProps = Extract<ApplicationViewComponent, { component: "ScenarioExplorer" }>;

const DECIMAL = /^-?\d{1,15}(\.\d{1,12})?$/;

/**
 * The Writer chose this scenario; every result is computed by trusted code. Only assumptions can be
 * changed here, documented inputs stay as the documents state them.
 */
export function ScenarioExplorerView({ scenario, verifiedInputs, refs }: ScenarioProps) {
  const baseId = useId();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const claims = useMemo(
    () =>
      verifiedInputs.map((input) => ({
        id: input.id,
        kind: "CALCULATION" as const,
        numericStatus: "VERIFIED" as const,
        computedValue: input.computedValue,
      })),
    [verifiedInputs],
  );
  const valid = Object.fromEntries(Object.entries(overrides).filter(([, value]) => DECIMAL.test(value.trim())));
  const changed = Object.keys(valid).length > 0;
  const results = changed ? recomputeScenario(scenario, valid, claims) : scenario.results;

  return (
    <section className={CARD_CLASS} data-component="ScenarioExplorer">
      <div className="flex flex-col gap-1">
        <h3 className={HEADING_CLASS}>{scenario.title}</h3>
        <p className="m-0 text-[14.5px] leading-[1.55] text-ink-muted">{scenario.question}</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Inputs">
        {scenario.parameters.map((parameter) => {
          const inputId = `${baseId}-${parameter.name}`;
          const editable = parameter.basis === "ASSUMPTION";
          const value = overrides[parameter.name] ?? parameter.value;
          const invalid = editable && overrides[parameter.name] !== undefined && !DECIMAL.test(value.trim());
          return (
            <li key={parameter.name} className="flex flex-wrap items-center gap-2">
              <label htmlFor={inputId} className="min-w-[160px] flex-1 text-[14px] text-ink">
                {parameter.label}
                <span className="ml-1.5 text-[12px] text-ink-subtle">{editable ? "assumption" : "from your documents"}</span>
              </label>
              <input
                id={inputId}
                inputMode="decimal"
                readOnly={!editable}
                aria-invalid={invalid || undefined}
                value={value}
                onChange={(event) => setOverrides((current) => ({ ...current, [parameter.name]: event.target.value }))}
                className={`w-32 rounded-control border px-2.5 py-1.5 font-mono text-[13.5px] ${
                  editable ? "border-line-strong bg-paper text-ink" : "border-line bg-mist text-ink-muted"
                } ${invalid ? "border-coral" : ""}`}
              />
              {parameter.unit ? <span className="text-[13px] text-ink-subtle">{parameter.unit}</span> : null}
            </li>
          );
        })}
      </ul>
      <ul className="m-0 flex list-none flex-col gap-2 border-t border-line p-0 pt-3" aria-label="Results" aria-live="polite">
        {results.map((result) => (
          <li key={result.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[14.5px] text-ink">{result.label}</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[15px] font-semibold text-ink">{formatValue(result.value, result.unit)}</span>
              <StatusBadge status={result.status} usesAssumptions={result.usesAssumptions} />
            </span>
          </li>
        ))}
      </ul>
      {changed ? (
        <button
          type="button"
          className="self-start text-[13px] font-medium text-cell-blue-deep underline"
          onClick={() => setOverrides({})}
        >
          Reset assumptions
        </button>
      ) : null}
      <SourceChips refs={refs} />
    </section>
  );
}
