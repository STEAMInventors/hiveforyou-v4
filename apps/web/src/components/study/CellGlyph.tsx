/** Single pointy-top hexagon for source chips. */
export function CellGlyph({ className = "h-[10px] w-[10px] shrink-0" }: { readonly className?: string }) {
  const u = 5;
  const d = u * (Math.sqrt(3) / 2);
  const points = `0,${-u} ${d},${-u / 2} ${d},${u / 2} 0,${u} ${-d},${u / 2} ${-d},${-u / 2}`;
  return (
    <svg className={className} viewBox={`${-d - 1} ${-u - 1} ${2 * d + 2} ${2 * u + 2}`} aria-hidden data-testid="cell-glyph">
      <polygon points={points} fill="var(--honey)" stroke="var(--honey-deep)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
