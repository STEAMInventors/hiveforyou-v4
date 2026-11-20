import type { ApplicationViewComponent } from "@hiveforyou/contracts";

import { CARD_CLASS, formatValue, HEADING_CLASS, SourceChips, StatusBadge } from "./a2ui-parts";

type ChartProps = Extract<ApplicationViewComponent, { component: "Chart" }>;

const WIDTH = 480;
const HEIGHT = 180;
const PAD = 24;

/** SVG chart over bound values only, with the same data as a table for screen readers and checking. */
export function ChartView({ title, kind, unit, points }: ChartProps) {
  const numeric = points.map((point) => (point.value === null ? null : Number(point.value)));
  const finite = numeric.filter((value): value is number => value !== null && Number.isFinite(value));
  const max = Math.max(0, ...finite);
  const min = Math.min(0, ...finite);
  const span = max - min || 1;
  const step = (WIDTH - PAD * 2) / Math.max(points.length, 1);
  const y = (value: number) => HEIGHT - PAD - ((value - min) / span) * (HEIGHT - PAD * 2);
  const linePoints = numeric
    .map((value, index) => (value === null || !Number.isFinite(value) ? null : `${PAD + step * index + step / 2},${y(value)}`))
    .filter((point): point is string => point !== null)
    .join(" ");

  return (
    <section className={CARD_CLASS} data-component="Chart">
      <h3 className={HEADING_CLASS}>{title}</h3>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" aria-hidden>
        <line x1={PAD} x2={WIDTH - PAD} y1={y(0)} y2={y(0)} className="stroke-line-strong" strokeWidth={1} />
        {kind === "bar"
          ? numeric.map((value, index) =>
              value === null || !Number.isFinite(value) ? null : (
                <rect
                  key={points[index].label}
                  x={PAD + step * index + step * 0.2}
                  width={step * 0.6}
                  y={Math.min(y(value), y(0))}
                  height={Math.abs(y(0) - y(value))}
                  className={points[index].status === "VERIFIED" ? "fill-leaf" : "fill-cell-blue"}
                  rx={3}
                />
              ),
            )
          : <polyline points={linePoints} fill="none" className="stroke-cell-blue" strokeWidth={2.5} />}
      </svg>
      <table className="w-full border-collapse text-left text-[13.5px]">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="border-b border-line text-ink-subtle">
            <th className="py-1.5 font-medium">Item</th>
            <th className="py-1.5 font-medium">Value{unit ? ` (${unit})` : ""}</th>
            <th className="py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label} className="border-b border-line align-top last:border-b-0">
              <td className="py-2 pr-3 text-ink">
                {point.label}
                <div className="mt-1">
                  <SourceChips refs={point.refs} />
                </div>
              </td>
              <td className="py-2 pr-3 font-mono text-ink">{formatValue(point.value, null)}</td>
              <td className="py-2">
                <StatusBadge status={point.status} usesAssumptions={point.usesAssumptions} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
