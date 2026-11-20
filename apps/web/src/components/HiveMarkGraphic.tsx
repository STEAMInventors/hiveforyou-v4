/**
 * The four-cell mark as inline SVG so the cells can arrive one by one (brand guide §4).
 * `animate` plays once per page load; the CSS lives in globals.css (`.hero-mark`) and is
 * removed under prefers-reduced-motion, so the finished mark always shows.
 */
export function HiveMarkGraphic({
  animate = false,
  heightPx = 64,
  className = "",
}: {
  animate?: boolean;
  heightPx?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="-17.32 -25 34.64 50"
      aria-hidden
      focusable="false"
      style={{ height: heightPx, width: (heightPx * 34.64) / 50 }}
      className={`block shrink-0 ${animate ? "hero-mark" : ""} ${className}`.trim()}
      data-testid="hive-mark-graphic"
    >
      <polygon className="c1 fill-blue" points="0,-24.3 8.05,-19.65 8.05,-10.35 0,-5.7 -8.05,-10.35 -8.05,-19.65" />
      <polygon className="c2 fill-coral" points="8.66,-9.3 16.71,-4.65 16.71,4.65 8.66,9.3 0.61,4.65 0.61,-4.65" />
      <polygon className="c3 fill-honey" points="0,5.7 8.05,10.35 8.05,19.65 0,24.3 -8.05,19.65 -8.05,10.35" />
      <polygon className="c4 fill-leaf" points="-8.66,-9.3 -0.61,-4.65 -0.61,4.65 -8.66,9.3 -16.71,4.65 -16.71,-4.65" />
    </svg>
  );
}
