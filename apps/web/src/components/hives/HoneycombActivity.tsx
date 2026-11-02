import { useCallback, useEffect, useRef, useState } from "react";

/** Brand mark geometry (viewBox 0 0 100 100), clockwise from top: Blue, Coral, Honey, Leaf. */
const CELLS: readonly (readonly [number, number])[] = [
  [50, 20],
  [67.32, 50],
  [50, 80],
  [32.68, 50],
];
export const HONEYCOMB_COLORS = ["#3B7CF6", "#EF5143", "#F6B826", "#2FA35A"] as const;
const REST_GREYS = ["#D3D7DD", "#C9CED6", "#DADEE3", "#C2C8D0"] as const;
const HEX = "0,-17.6 15.24,-8.8 15.24,8.8 0,17.6 -15.24,8.8 -15.24,-8.8";
const COMET_RADII = [3.4, 2.6, 1.9] as const;
const COMET_FADE = [1, 0.5, 0.22] as const;

/** Approved Living Hive timings. Relay laps cover four cells (0.65 s per cell while reading). */
export const LIVING_HIVE_MS = {
  relayLap: 2600,
  relayLapAfterReading: 3200,
  deposit: 1050,
  swarm: 1150,
  sync: 1500,
  hold: 900,
  rest: 700,
} as const;

export type LivingHiveMode = "processing" | "success" | "failed" | "still";
export type HoneycombArrival = { seq: number; kind: "single" | "batch"; finished: number };

type LightEffectType = "deposit" | "swarm" | "sync" | "hold";
export type HoneycombEffectType = LightEffectType | "rest";
export type HoneycombLightEffect = { type: LightEffectType; cell: number; start: number; duration: number };
export type HoneycombRelay = { start: number; lights: 1 | 2 };

export type HoneycombFrame = {
  lift: number[];
  rings: ({ progress: number; color: string } | null)[];
  comets: { points: (readonly [number, number])[]; opacity: number }[];
};

const bell = (t: number, peak: number, width: number) => Math.exp(-(((t - peak) / width) ** 2));
const ease = (f: number) => (f < 0.5 ? 4 * f * f * f : 1 - (-2 * f + 2) ** 3 / 2);
const circularDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 4;
  return Math.min(d, 4 - d);
};

function relayPoint(q: number): readonly [number, number] {
  const wrapped = ((q % 4) + 4) % 4;
  const a = Math.floor(wrapped);
  const b = (a + 1) % 4;
  const g = wrapped - a;
  const [ax, ay] = CELLS[a]!;
  const [bx, by] = CELLS[b]!;
  return [ax + (bx - ax) * g, ay + (by - ay) * g];
}

/** Light intensities for one moment; the mark's geometry and colours are never changed. */
export function honeycombFrame(input: {
  now: number;
  effects: readonly HoneycombLightEffect[];
  relay: HoneycombRelay | null;
}): HoneycombFrame {
  const lift = [0, 0, 0, 0];
  const rings: HoneycombFrame["rings"] = [null, null, null, null];
  const comets: HoneycombFrame["comets"] = [];
  let envelope = 0;

  for (const fx of input.effects) {
    const t = (input.now - fx.start) / fx.duration;
    if (t < 0 || t >= 1) {
      continue;
    }
    if (fx.type === "deposit") {
      const k = fx.cell;
      lift[k] = Math.max(lift[k]!, bell(t, 0.22, 0.2));
      for (const n of [(k + 1) % 4, (k + 3) % 4]) {
        lift[n] = Math.max(lift[n]!, 0.62 * bell(t, 0.47, 0.15));
      }
      const opposite = (k + 2) % 4;
      lift[opposite] = Math.max(lift[opposite]!, 0.5 * bell(t, 0.63, 0.15));
      rings[k] = { progress: Math.min(1, t / 0.9), color: HONEYCOMB_COLORS[k]! };
      envelope = Math.max(envelope, bell(t, 0.4, 0.38));
    } else if (fx.type === "swarm") {
      for (let i = 0; i < 4; i += 1) {
        const ti = t - 0.07 * i;
        lift[i] = Math.max(lift[i]!, 0.85 * bell(ti, 0.26, 0.19));
        if (ti > 0) {
          rings[i] = { progress: Math.min(1, ti / 0.75), color: HONEYCOMB_COLORS[i]! };
        }
      }
      envelope = Math.max(envelope, bell(t, 0.45, 0.4));
    } else if (fx.type === "sync") {
      const v = 0.85 * (bell(t, 0.2, 0.1) + bell(t, 0.52, 0.1));
      for (let i = 0; i < 4; i += 1) {
        lift[i] = Math.max(lift[i]!, v);
        if (t > 0.52) {
          rings[i] = { progress: Math.min(1, (t - 0.52) / 0.45), color: HONEYCOMB_COLORS[i]! };
        }
      }
      envelope = 1;
    } else {
      const v = 0.55 * bell(t, 0.35, 0.2);
      for (let i = 0; i < 4; i += 1) {
        lift[i] = Math.max(lift[i]!, v);
      }
      envelope = 1;
    }
  }

  const relay = input.relay;
  if (relay && input.now >= relay.start) {
    const lap = relay.lights === 1 ? LIVING_HIVE_MS.relayLap : LIVING_HIVE_MS.relayLapAfterReading;
    const base = (((input.now - relay.start) / lap) * 4) % 4;
    for (let c = 0; c < relay.lights; c += 1) {
      const raw = (base + c * 2) % 4;
      const seg = Math.floor(raw);
      const p = seg + ease(raw - seg);
      for (let i = 0; i < 4; i += 1) {
        const d = circularDistance(p, i);
        lift[i] = Math.max(lift[i]!, (1 - envelope) * 0.62 * Math.max(0, 1 - d / 1.05) ** 1.6);
      }
      comets.push({ points: [relayPoint(p), relayPoint(p - 0.07), relayPoint(p - 0.14)], opacity: 1 - envelope });
    }
  }

  return { lift, rings, comets };
}

const STILL_FRAME = honeycombFrame({ now: 0, effects: [], relay: null });

/**
 * Living Hive mark for the progress modal. Relay loops only in `processing`; arrivals newer than the
 * one present at mount play once (deposit for one document, swarm for several); `readingDone` turning
 * true while processing plays sync and switches to two relay lights; success holds then rests still;
 * failure fades to grey. Nothing replays on remount; reduced motion keeps the mark completely still.
 */
export function HoneycombActivity({
  mode,
  arrival = null,
  readingDone = false,
  reducedMotion,
  className,
}: {
  mode: LivingHiveMode;
  arrival?: HoneycombArrival | null;
  readingDone?: boolean;
  reducedMotion: boolean;
  className?: string;
}) {
  const cellRefs = useRef<(SVGGElement | null)[]>([]);
  const sheenRefs = useRef<(SVGPolygonElement | null)[]>([]);
  const ringRefs = useRef<(SVGCircleElement | null)[]>([]);
  const cometRefs = useRef<(SVGCircleElement | null)[][]>([[], []]);
  const effectsRef = useRef<HoneycombLightEffect[]>([]);
  const relayStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const seenSeqRef = useRef(arrival?.seq ?? 0);
  const readingDoneRef = useRef(readingDone);
  const modeRef = useRef(mode);
  const effectIdRef = useRef(0);
  const [effect, setEffect] = useState<{ type: HoneycombEffectType; id: number; duration: number } | null>(null);

  const lights: 1 | 2 = readingDone ? 2 : 1;
  const animating = !reducedMotion;

  const paint = useCallback((frame: HoneycombFrame) => {
    for (let i = 0; i < 4; i += 1) {
      const intensity = frame.lift[i] ?? 0;
      cellRefs.current[i]?.style.setProperty("transform", `scale(${(1 + intensity * 0.095).toFixed(4)})`);
      sheenRefs.current[i]?.setAttribute("opacity", (intensity * 0.58).toFixed(3));
      const ring = ringRefs.current[i];
      const state = frame.rings[i];
      if (!ring) {
        continue;
      }
      if (state) {
        const e = 1 - (1 - state.progress) ** 3;
        ring.setAttribute("r", (16 + 48 * e).toFixed(2));
        ring.setAttribute("opacity", (0.6 * (1 - state.progress)).toFixed(3));
        ring.setAttribute("stroke", state.color);
        ring.setAttribute("stroke-width", (3 * (1 - state.progress) + 0.6).toFixed(2));
      } else {
        ring.setAttribute("opacity", "0");
      }
    }
    cometRefs.current.forEach((trail, c) => {
      trail.forEach((dot, j) => {
        if (!dot) {
          return;
        }
        const comet = frame.comets[c];
        if (!comet) {
          dot.setAttribute("opacity", "0");
          return;
        }
        const [x, y] = comet.points[j]!;
        dot.setAttribute("cx", x.toFixed(2));
        dot.setAttribute("cy", y.toFixed(2));
        dot.setAttribute("opacity", (comet.opacity * COMET_FADE[j]!).toFixed(3));
      });
    });
  }, []);

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(
    (now: number) => {
      rafRef.current = null;
      effectsRef.current = effectsRef.current.filter((fx) => now - fx.start < fx.duration);
      const relay =
        modeRef.current === "processing" && relayStartRef.current != null
          ? { start: relayStartRef.current, lights: readingDoneRef.current ? (2 as const) : (1 as const) }
          : null;
      paint(honeycombFrame({ now, effects: effectsRef.current, relay }));
      if (relay || effectsRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    },
    [paint],
  );

  const kick = useCallback(() => {
    if (rafRef.current == null && typeof requestAnimationFrame === "function") {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  const play = useCallback(
    (type: HoneycombEffectType, cell: number, duration: number) => {
      effectIdRef.current += 1;
      setEffect({ type, id: effectIdRef.current, duration });
      if (type !== "rest") {
        effectsRef.current = [...effectsRef.current, { type, cell, start: performance.now(), duration }];
        kick();
      }
    },
    [kick],
  );

  useEffect(() => {
    const previous = modeRef.current;
    modeRef.current = mode;
    if (!animating) {
      stopLoop();
      effectsRef.current = [];
      relayStartRef.current = null;
      setEffect(null);
      paint(STILL_FRAME);
      return;
    }
    if (mode === "processing") {
      if (relayStartRef.current == null) {
        relayStartRef.current = performance.now();
      }
      kick();
      return;
    }
    relayStartRef.current = null;
    effectsRef.current = [];
    setEffect(null);
    if (previous === "processing" && mode === "success") {
      play("hold", 0, LIVING_HIVE_MS.hold);
    } else if (previous === "processing" && mode === "failed") {
      play("rest", 0, LIVING_HIVE_MS.rest);
    }
    kick();
    if (rafRef.current == null) {
      paint(STILL_FRAME);
    }
  }, [animating, kick, mode, paint, play, stopLoop]);

  useEffect(() => {
    const arrivalSeq = arrival?.seq ?? 0;
    if (arrivalSeq <= seenSeqRef.current) {
      return;
    }
    seenSeqRef.current = arrivalSeq;
    if (!animating || modeRef.current !== "processing" || !arrival) {
      return;
    }
    if (arrival.kind === "single") {
      const cell = (((arrival.finished - 1) % 4) + 4) % 4;
      play("deposit", cell, LIVING_HIVE_MS.deposit);
    } else {
      play("swarm", 0, LIVING_HIVE_MS.swarm);
    }
  }, [animating, arrival, play]);

  useEffect(() => {
    const crossed = readingDone && !readingDoneRef.current;
    readingDoneRef.current = readingDone;
    if (!crossed || !animating || modeRef.current !== "processing") {
      return;
    }
    const now = performance.now();
    relayStartRef.current = now + LIVING_HIVE_MS.sync;
    play("sync", 0, LIVING_HIVE_MS.sync);
  }, [animating, play, readingDone]);

  useEffect(() => {
    if (!effect) {
      return;
    }
    const timer = window.setTimeout(
      () => setEffect((current) => (current?.id === effect.id ? null : current)),
      effect.duration,
    );
    return () => window.clearTimeout(timer);
  }, [effect]);

  useEffect(() => stopLoop, [stopLoop]);

  const resting = mode === "failed";
  const fillTransition = animating ? `fill ${LIVING_HIVE_MS.rest}ms ease, stroke ${LIVING_HIVE_MS.rest}ms ease` : "none";

  return (
    <svg
      viewBox="-20 -20 140 140"
      aria-hidden
      focusable="false"
      className={className}
      style={{ overflow: "visible", display: "block" }}
      data-testid="progress-honeycomb"
      data-mode={mode}
      data-active={mode === "processing" ? "true" : "false"}
      data-lights={mode === "processing" ? String(lights) : "0"}
      data-motion={animating ? "live" : "still"}
      data-effect={effect?.type ?? "none"}
    >
      <g>
        {CELLS.map(([x, y], i) => (
          <circle
            key={`ring-${HONEYCOMB_COLORS[i]}`}
            ref={(node) => {
              ringRefs.current[i] = node;
            }}
            cx={x}
            cy={y}
            r={16}
            fill="none"
            stroke={HONEYCOMB_COLORS[i]}
            opacity={0}
          />
        ))}
      </g>
      {CELLS.map(([x, y], i) => (
        <g key={HONEYCOMB_COLORS[i]} transform={`translate(${x} ${y})`}>
          <g
            ref={(node) => {
              cellRefs.current[i] = node;
            }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          >
            <polygon
              points={HEX}
              fill={resting ? REST_GREYS[i] : HONEYCOMB_COLORS[i]}
              stroke={resting ? REST_GREYS[i] : HONEYCOMB_COLORS[i]}
              strokeWidth={1.5}
              strokeLinejoin="round"
              style={{ transition: fillTransition }}
              data-testid="honeycomb-cell"
            />
            <polygon
              ref={(node) => {
                sheenRefs.current[i] = node;
              }}
              points={HEX}
              fill="#FFFFFF"
              opacity={0}
            />
          </g>
        </g>
      ))}
      {[0, 1].map((c) => (
        <g key={`comet-${c}`}>
          {COMET_RADII.map((radius, j) => (
            <circle
              key={radius}
              ref={(node) => {
                cometRefs.current[c]![j] = node;
              }}
              cx={50}
              cy={20}
              r={radius}
              fill="#FFFFFF"
              stroke="rgba(31,35,40,.16)"
              strokeWidth={0.8}
              opacity={0}
            />
          ))}
        </g>
      ))}
      {mode === "success" ? (
        <g transform="translate(50 50)" data-testid="honeycomb-check">
          <circle r={9} fill="#FFFFFF" stroke="#1F2328" strokeWidth={1.6} />
          <path
            d="M-4 0.2 L-1.2 3 L4.2 -2.6"
            fill="none"
            stroke="#1F2328"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      ) : null}
    </svg>
  );
}
