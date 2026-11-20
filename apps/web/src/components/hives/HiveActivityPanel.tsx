import type { HiveBoardModel } from "@hiveforyou/contracts";

import { Card } from "@/components/workspace/Card";

export function HiveActivityPanel({ board, assistantName }: { board: HiveBoardModel; assistantName: string }) {
  const rows = [...board.activity].reverse();
  return (
    <Card>
      {rows.length === 0 ? (
        <p className="m-0 text-small text-graphite">Nothing yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((entry) => (
            <li key={`${entry.at}-${entry.text}`} className="flex gap-3 border-t border-line py-3 first:border-0 first:pt-0">
              <span className="w-[118px] shrink-0 text-caption text-quiet">{entry.atLabel}</span>
              <p className="m-0 text-small leading-snug text-ink">
                <span
                  className={`font-semibold ${
                    entry.actor === assistantName || entry.actor === "HiveForYou" ? "text-cell-blue-deep" : "text-ink"
                  }`}
                >
                  {entry.actor}
                </span>{" "}
                {entry.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}