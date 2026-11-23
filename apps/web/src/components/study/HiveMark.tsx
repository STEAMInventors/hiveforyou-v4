/** Four regular hexagons (pointy top) in a diamond; brand colours clockwise from top. */
export function HiveMark({ className = "h-4 w-4 shrink-0" }: { readonly className?: string }) {
  const u = 8;
  const d = u * (Math.sqrt(3) / 2);
  const center = (cx: number, cy: number) =>
    `${cx},${cy - u} ${cx + d},${cy - u / 2} ${cx + d},${cy + u / 2} ${cx},${cy + u} ${cx - d},${cy + u / 2} ${cx - d},${cy - u / 2}`;
  return (
    <svg className={className} viewBox="-20 -22 40 44" aria-hidden fill="none" data-testid="hive-mark">
      <polygon points={center(0, -u)} fill="var(--color-blue)" />
      <polygon points={center(d, 0)} fill="var(--color-coral)" />
      <polygon points={center(0, u)} fill="var(--color-honey)" />
      <polygon points={center(-d, 0)} fill="var(--color-leaf)" />
    </svg>
  );
}
