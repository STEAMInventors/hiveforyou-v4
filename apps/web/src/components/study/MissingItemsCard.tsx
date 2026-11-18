"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useMemo, type ReactNode } from "react";

import { Card } from "@/components/workspace/Card";
import {
  itemMatchesShowFilter,
  MISSING_SHOW_FILTERS,
  MISSING_SHOW_LABEL,
  missingShowFilterFromParam,
  parseMissingShowParam,
  type MissingShowFilter,
} from "@/lib/missing-show-filter";

import type { DisplayState } from "./status-state";

export { missingItemStateForConflict, missingItemStateForRequest } from "./missing-item-state";

export type MissingItemRow = {
  readonly id: string;
  readonly state: DisplayState;
  readonly node: ReactNode;
};

const SEGMENT_ACTIVE = "border-ink bg-ink text-paper";
const SEGMENT_IDLE =
  "border-line bg-paper text-graphite hover:border-line-strong hover:text-ink";

type MissingItemsCardProps = {
  readonly items: readonly MissingItemRow[];
};

export function MissingItemsCard({ items }: MissingItemsCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const groupId = useId();

  const active = missingShowFilterFromParam(parseMissingShowParam(searchParams.get("show")));

  const counts = useMemo(() => {
    const tally: Record<Exclude<MissingShowFilter, "all">, number> = { needs: 0, changed: 0, missing: 0 };
    for (const item of items) {
      if (item.state === "needs" || item.state === "changed" || item.state === "missing") {
        tally[item.state] += 1;
      }
    }
    return tally;
  }, [items]);

  const visible = useMemo(
    () => items.filter((item) => itemMatchesShowFilter(item.state, active)),
    [active, items],
  );

  const setFilter = useCallback(
    (filter: MissingShowFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      if (filter === "all") params.delete("show");
      else params.set("show", filter);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <Card
      title="Items"
      headerRight={
        <div
          role="group"
          aria-label="Filter items"
          className="flex flex-wrap gap-1"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const idx = MISSING_SHOW_FILTERS.indexOf(active);
            if (event.key === "Home") {
              setFilter(MISSING_SHOW_FILTERS[0]!);
              return;
            }
            if (event.key === "End") {
              setFilter(MISSING_SHOW_FILTERS[MISSING_SHOW_FILTERS.length - 1]!);
              return;
            }
            const delta = event.key === "ArrowRight" ? 1 : -1;
            const next = (idx + delta + MISSING_SHOW_FILTERS.length) % MISSING_SHOW_FILTERS.length;
            setFilter(MISSING_SHOW_FILTERS[next]!);
          }}
        >
          {MISSING_SHOW_FILTERS.map((filter) => {
            const pressed = active === filter;
            const count =
              filter === "all"
                ? items.length
                : counts[filter];
            const suffix = filter === "all" ? (count > 0 ? ` ${count}` : "") : ` ${count}`;
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={pressed}
                className={`inline-flex h-7 cursor-pointer items-center rounded-control border px-2.5 text-caption font-medium ${pressed ? SEGMENT_ACTIVE : SEGMENT_IDLE}`}
                onClick={() => setFilter(filter)}
              >
                {MISSING_SHOW_LABEL[filter]}
                {suffix}
              </button>
            );
          })}
        </div>
      }
      testId="missing-items-card"
    >
      {visible.length === 0 ? (
        <p className="m-0 text-small text-graphite" data-testid="missing-items-empty">
          Nothing in this view.
        </p>
      ) : (
        <div className="flex flex-col gap-0 divide-y divide-line" role="list" aria-labelledby={groupId}>
          <span id={groupId} className="sr-only">
            Study items
          </span>
          {visible.map((item) => (
            <div key={item.id} className="py-4 first:pt-0 last:pb-0" role="listitem">
              {item.node}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}