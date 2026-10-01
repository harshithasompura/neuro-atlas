"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AtlasModel } from "@/viz/model";
import { subfieldVar } from "@/viz/palette";
import { Num } from "./Num";

interface Props {
  model: AtlasModel;
  range: [number, number];
  subs: ReadonlySet<number>;
  topic: number | null;
  playing: boolean;
  onRange: (r: [number, number]) => void;
  onPlay: () => void;
  visible: number;
}

const H_FULL = 92;
const H_SHORT = 64;
const AXIS = 24;
const PAD = 16;

const SHORT = "(max-height: 540px)";
const subscribeShort = (cb: () => void) => {
  const mq = window.matchMedia(SHORT);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

type Pt = [number, number];

/** Catmull-Rom through the points, as cubic Bezier segments. */
function curve(pts: Pt[], move: boolean): string {
  let d = move ? `M${pts[0]![0]},${pts[0]![1]}` : `L${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * The time lens. A stream of papers per year (layers = subfields, width = volume) with a draggable window.
 * Moving the window re-lights the stream and moves the particle field with it.
 */
export function TimeStream({ model, range, subs, topic, playing, onRange, onPlay, visible }: Props) {
  const { atlas, years } = model;
  const k = atlas.subfields.length;
  const nYears = years.length;
  const y0 = years[0]!;
  const yLast = years[nYears - 1]!;
  const short = useSyncExternalStore(subscribeShort, () => window.matchMedia(SHORT).matches, () => false);
  const H = short ? H_SHORT : H_FULL;
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const mode = useRef<{ type: "new" | "move" | "left" | "right"; anchor: number; start: [number, number] } | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);

  const colW = (W - PAD * 2) / nYears;
  const xc = (yi: number) => PAD + (yi + 0.5) * colW;
  const plotH = H - AXIS;

  const stream = useMemo(() => {
    const cols = new Uint32Array(nYears * k);
    for (let i = 0; i < model.n; i++) {
      if (subs.size && !subs.has(model.sub[i]!)) continue;
      if (topic !== null && model.topic[i] !== topic) continue;
      cols[(model.year[i]! - y0) * k + model.sub[i]!]!++;
    }
    const totals = years.map((_, yi) => {
      let t = 0;
      for (let s = 0; s < k; s++) t += cols[yi * k + s]!;
      return t;
    });
    const share = model.n / atlas.meta.poolCount;
    const pool = years.map((y) => (atlas.meta.poolByYear.find((p) => p.year === y)?.count ?? 0) * share);
    const unfiltered = subs.size === 0 && topic === null;
    const max = Math.max(1, ...totals, ...(unfiltered ? pool : []));
    const px = (plotH / 2 - 4) / (max / 2);
    const mid = plotH / 2;
    const layers = atlas.subfields.map((sf, s) => {
      const top: Pt[] = [];
      const bot: Pt[] = [];
      years.forEach((_, yi) => {
        let below = 0;
        for (let t = 0; t < s; t++) below += cols[yi * k + t]!;
        const lo = mid - (totals[yi]! / 2) * px + below * px;
        top.push([xc(yi), lo]);
        bot.push([xc(yi), lo + cols[yi * k + s]! * px]);
      });
      const d = `${curve(top, true)}${curve([...bot].reverse(), false)}Z`;
      return { id: sf.id, d, color: subfieldVar(sf.id) };
    });
    const env = (sign: 1 | -1) => curve(pool.map((v, yi): Pt => [xc(yi), mid + sign * (v / 2) * px]), true);
    return { cols, totals, layers, poolTop: unfiltered ? env(-1) : null, poolBottom: unfiltered ? env(1) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- xc/plotH derive from W, which is listed
  }, [model, subs, topic, years, k, nYears, y0, atlas, W, plotH]);

  const thisYear = new Date().getFullYear();
  const inProgress = yLast === thisYear;
  const left = PAD + (range[0] - y0) * colW;
  const right = PAD + (range[1] - y0 + 1) * colW;
  const width = range[1] - range[0] + 1;
  const full = range[0] === y0 && range[1] === yLast;

  const yearAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return y0 + clamp(Math.floor((clientX - r.left - PAD) / colW), 0, nYears - 1);
  };

  const capture = (e: React.PointerEvent) => {
    try {
      box.current!.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone; the drag continues without capture */
    }
  };

  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".lens-edge")) return;
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-hit]")?.dataset.hit;
    const y = yearAt(e.clientX);
    capture(e);
    setDragging(true);
    if (hit === "body" && !full) mode.current = { type: "move", anchor: y, start: [...range] };
    else {
      mode.current = { type: "new", anchor: y, start: [...range] };
      onRange([y, y]);
    }
  };

  const edgeDown = (edge: "left" | "right") => (e: React.PointerEvent) => {
    e.stopPropagation();
    capture(e);
    setDragging(true);
    mode.current = { type: edge, anchor: 0, start: [...range] };
  };

  const move = (e: React.PointerEvent) => {
    const y = yearAt(e.clientX);
    const m = mode.current;
    if (!m) {
      setHover(y - y0);
      return;
    }
    if (m.type === "new") onRange([Math.min(m.anchor, y), Math.max(m.anchor, y)]);
    else if (m.type === "left") onRange([Math.min(y, m.start[1]), Math.max(y, m.start[1])]);
    else if (m.type === "right") onRange([Math.min(y, m.start[0]), Math.max(y, m.start[0])]);
    else {
      const w = m.start[1] - m.start[0];
      const a = clamp(m.start[0] + (y - m.anchor), y0, yLast - w);
      onRange([a, a + w]);
    }
  };

  const up = () => {
    mode.current = null;
    setDragging(false);
  };

  const nudge = (edge: 0 | 1, d: number) => {
    const next: [number, number] = [...range];
    next[edge] = clamp(next[edge] + d, y0, yLast);
    if (next[0] > next[1]) next[1 - edge] = next[edge];
    onRange(next);
  };

  const edgeKey = (edge: 0 | 1) => (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0;
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      nudge(edge, e.key === "Home" ? -99 : 99);
    } else if (d) {
      e.preventDefault();
      nudge(edge, d);
    }
  };

  const bodyKey = (e: React.KeyboardEvent) => {
    const slide = (to: number) => onRange([to, to + width - 1]);
    if (e.key === "ArrowLeft") (e.preventDefault(), slide(clamp(range[0] - 1, y0, yLast - width + 1)));
    else if (e.key === "ArrowRight") (e.preventDefault(), slide(clamp(range[0] + 1, y0, yLast - width + 1)));
    else if (e.key === "Home") (e.preventDefault(), slide(y0));
    else if (e.key === "End") (e.preventDefault(), slide(yLast - width + 1));
    else if (e.key === " ") (e.preventDefault(), onPlay());
  };

  const hoverInfo = useMemo(() => {
    if (hover === null || hover < 0 || hover >= nYears) return null;
    let best = 0;
    for (let s = 1; s < k; s++) if (stream.cols[hover * k + s]! > stream.cols[hover * k + best]!) best = s;
    const total = stream.totals[hover]!;
    return { year: y0 + hover, total, lead: atlas.subfields[best]!.name, leadShare: total ? stream.cols[hover * k + best]! / total : 0 };
  }, [hover, nYears, k, stream, y0, atlas.subfields]);

  const sparse = colW < 34;
  const layerEls = (opacity: number) => (
    <g opacity={opacity}>
      {stream.layers.map((l) => (
        <path key={l.id} d={l.d} fill={l.color} stroke="var(--bg)" strokeWidth="1" strokeLinejoin="round" />
      ))}
    </g>
  );

  return (
    <section className="time" aria-label="Time lens">
      <div className="time-side">
        <p className="years" aria-live="polite">
          <span>
            <Num value={range[0]} plain ms={280} />
          </span>
          {range[1] !== range[0] && (
            <>
              <i aria-hidden="true">to</i>
              <span>
                <Num value={range[1]} plain ms={280} />
              </span>
            </>
          )}
        </p>
        <p className="mono time-count">
          <b>
            <Num value={visible} />
          </b>{" "}
          papers in the lens
        </p>
        <div className="time-actions">
          <button className="btn btn-accent" onClick={onPlay} aria-pressed={playing}>
            {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            {playing ? "Pause" : <>Play<span className="narrow-hide"> years</span></>}
          </button>
          <button className="link" onClick={() => onRange([y0, yLast])} disabled={full}>
            All years
          </button>
        </div>
      </div>

      <div className="stream-wrap">
        <div
          className="stream"
          ref={box}
          data-dragging={dragging}
          data-full={full}
          style={{ height: H }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={() => !mode.current && setHover(null)}
        >
          <svg className="stream-layer" width={W} height={H} aria-hidden="true">
            {layerEls(0.3)}
          </svg>
          <svg className="stream-layer stream-lit" width={W} height={H} aria-hidden="true" style={{ clipPath: `inset(0px ${Math.max(0, W - right)}px 0px ${left}px)` }}>
            {layerEls(1)}
          </svg>
          <svg className="stream-layer stream-over" width={W} height={H} aria-hidden="true">
            <defs>
              <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="2.5" height="6" fill="var(--bg)" opacity="0.85" />
              </pattern>
            </defs>
            {stream.poolTop && <path d={stream.poolTop} fill="none" stroke="var(--fg-2)" strokeWidth="1" strokeDasharray="2 3" />}
            {stream.poolBottom && <path d={stream.poolBottom} fill="none" stroke="var(--fg-2)" strokeWidth="1" strokeDasharray="2 3" />}
            {inProgress && <rect x={PAD + (nYears - 1) * colW} y="0" width={colW} height={H - AXIS} fill="url(#hatch)" />}
            <line x1={PAD} x2={W - PAD} y1={H - AXIS + 0.5} y2={H - AXIS + 0.5} stroke="var(--line-2)" />
          </svg>

          {years.map((y, yi) => {
            const inLens = y >= range[0] && y <= range[1];
            if (sparse && yi % 2 === (nYears - 1) % 2) return null;
            return (
              <span key={y} className="tick mono" data-on={inLens} style={{ left: xc(yi) }}>
                {y}
              </span>
            );
          })}

          {hover !== null && !dragging && hoverInfo && (
            <>
              <i className="cursor" style={{ left: xc(hover) }} />
              <div className="tip" style={{ left: clamp(xc(hover), 100, W - 100) }} role="presentation">
                <b>{hoverInfo.year}</b>
                <span className="mono">{hoverInfo.total.toLocaleString("en-US")} papers</span>
                <span className="mono">
                  {hoverInfo.lead}, {Math.round(hoverInfo.leadShare * 100)}%
                </span>
                {hoverInfo.year === thisYear && <span className="mono">year in progress</span>}
              </div>
            </>
          )}

          <div className="lens" style={{ left, width: right - left }} data-hit="body">
            <div className="lens-body" role="group" tabIndex={0} aria-label={`Time lens, ${range[0]} to ${range[1]}. Left and right arrows move it, Home and End jump, Space plays.`} onKeyDown={bodyKey} />
            <button
              className="lens-edge left"
              role="slider"
              aria-label="First year of the lens"
              aria-valuemin={y0}
              aria-valuemax={yLast}
              aria-valuenow={range[0]}
              onKeyDown={edgeKey(0)}
              onPointerDown={edgeDown("left")}
            />
            <button
              className="lens-edge right"
              role="slider"
              aria-label="Last year of the lens"
              aria-valuemin={y0}
              aria-valuemax={yLast}
              aria-valuenow={range[1]}
              onKeyDown={edgeKey(1)}
              onPointerDown={edgeDown("right")}
            />
          </div>
        </div>
        <p className="stream-legend mono">
          <span>layers: subfields, width: papers per year</span>
          {stream.poolTop && <span>dashed: OpenAlex pool x {(model.n / atlas.meta.poolCount * 100).toFixed(2)}%</span>}
          {inProgress && <span>{yLast} is still in progress</span>}
        </p>
      </div>
    </section>
  );
}
