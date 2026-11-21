import type { HiveAttentionCounts } from "@hiveforyou/contracts";

const ORDER = ["needs", "changed", "missing", "checked"] as const;

const STATE_CLASS: Record<(typeof ORDER)[number], string> = {
  needs: "text-blue-deep",
  changed: "text-honey-deep",
  missing: "text-coral-deep",
  checked: "text-leaf-deep",
};

const STATE_LABEL: Record<(typeof ORDER)[number], (n: number) => string> = {
  needs: (n) => `${n} to review`,
  changed: (n) => `${n} changed`,
  missing: (n) => `${n} missing`,
  checked: (n) => `${n} checked`,
};

export function formatStateLineParts(counts: HiveAttentionCounts): { key: string; label: string; className: string }[] {
  return ORDER.flatMap((key) => {
    const n = counts[key];
    if (!n || n <= 0) {
      return [];
    }
    return [{ key, label: STATE_LABEL[key](n), className: STATE_CLASS[key] }];
  });
}