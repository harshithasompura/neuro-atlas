import { BRAIN_BOUNDS } from "@/data/brain";
import { MAX_ZOOM, easeInOut, fitView, lerpView, panBy, toScreen, toWorld, zoomAt, type Bounds, type View } from "./camera";
import type { AtlasModel } from "./model";
import type { Tokens } from "./palette";

const TAU = Math.PI * 2;
const LEVELS = 6;

/* ripple: a ring of extra size and brightness that travels outward from where something changed, then fades */
const WAVE_SPEED = 1.35; // map units per second
const WAVE_WIDTH = 0.12;
const WAVE_LIFE = 0.95; // seconds for the amplitude to fall by 1/e
const WAVE_END = 2.0;
/** how long a change takes to travel across the matrix (ms per map unit) */
const TRAVEL_MS = 340;
const MAX_TRAVEL_MS = 520;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (x: number, a: number, b: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const hash = (i: number) => (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;

export interface RenderState {
  /** 1 where the paper passes the year/subfield/topic filters */
  active: Uint8Array;
  /** null = no query; otherwise 1 for matching papers */
  matches: Uint8Array | null;
  matchCount: number;
  selected: number | null;
  hover: number | null;
  /** a search result the user is pointing at */
  peek: number | null;
}

interface Anchor {
  x: number;
  y: number;
  n: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Wave {
  x: number;
  y: number;
  t0: number;
  amp: number;
}

export interface LabelHit {
  kind: "subfield" | "topic";
  id: number;
}

/**
 * Canvas renderer for the dot matrix. Every paper is one dot on a square grid inside the brain silhouette;
 * the empty grid around it stays faintly lit, like an LED panel. Nothing moves off its cell. Change travels as
 * ripples: when a filter, year or selection changes, dots switch on and off in a wave from where it happened.
 */
export class AtlasRenderer {
  view: View;
  readonly fit: View = { cx: 0, cy: 0, k: 1 };
  w = 0;
  h = 0;
  /** screen coordinates of every paper as of the last draw */
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  stats = { inView: 0, shown: 0 };
  pointer: [number, number] | null = null;
  /** false = no travelling ripples, no staggered switching, camera moves instantly */
  motion: boolean;

  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private vis: Float32Array;
  /** what each dot is heading towards (changes ripple outward, so this lags `state.active`) */
  private target: Uint8Array;
  private due: Float64Array;
  private pend: Uint8Array;
  private state: RenderState;
  private raf = 0;
  private last = 0;
  private fly: { from: View; to: View; t0: number; ms: number } | null = null;
  private listeners = new Set<() => void>();
  private waves: Wave[] = [];
  private subAnchors: (Anchor | null)[] = [];
  private topicAnchors: (Anchor | null)[] = [];
  private byTopic: number[][] = [];
  private byCites: Int32Array;
  private bucket: Int16Array;
  private order: Int32Array;
  private waveBoost: Float32Array;
  private labels: (Rect & LabelHit)[] = [];
  private activeCount = 0;
  private boost = 1;
  private introduced = false;
  private disposed = false;
  private introTimer = 0;
  private cx0: number;
  private cy0: number;
  /** the matrix: cell -> paper index, -1 where the grid is empty */
  private occ: Int32Array;
  private cell: number;
  private ox: number;
  private oy: number;
  private cols: number;
  private rows: number;

  constructor(
    private canvas: HTMLCanvasElement,
    private m: AtlasModel,
    private tk: Tokens,
    private colors: string[],
    motion: boolean,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas is not available in this browser");
    const n = m.n;
    this.ctx = ctx;
    this.motion = motion;
    this.view = { cx: 0, cy: 0, k: 1 };
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.vis = new Float32Array(n);
    this.target = new Uint8Array(n);
    this.due = new Float64Array(n);
    this.pend = new Uint8Array(n);
    this.bucket = new Int16Array(n);
    this.order = new Int32Array(n);
    this.waveBoost = new Float32Array(n);
    this.state = { active: new Uint8Array(n), matches: null, matchCount: 0, selected: null, hover: null, peek: null };
    this.byCites = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => m.cites[b]! - m.cites[a]!);
    this.byTopic = m.atlas.topics.map(() => []);
    for (let i = 0; i < n; i++) this.byTopic[m.topic[i]!]!.push(i);
    this.cx0 = (m.bounds.minX + m.bounds.maxX) / 2;
    this.cy0 = (m.bounds.minY + m.bounds.maxY) / 2;

    this.cell = m.atlas.meta.layout.cell;
    this.ox = BRAIN_BOUNDS.minX + this.cell / 2;
    this.oy = BRAIN_BOUNDS.minY + this.cell / 2;
    this.cols = Math.ceil((BRAIN_BOUNDS.maxX - BRAIN_BOUNDS.minX) / this.cell) + 1;
    this.rows = Math.ceil((BRAIN_BOUNDS.maxY - BRAIN_BOUNDS.minY) / this.cell) + 1;
    this.occ = new Int32Array(this.cols * this.rows).fill(-1);
    for (let i = 0; i < n; i++) {
      const gx = Math.round((m.xs[i]! - this.ox) / this.cell);
      const gy = Math.round((m.ys[i]! - this.oy) / this.cell);
      if (gx >= 0 && gx < this.cols && gy >= 0 && gy < this.rows) this.occ[gy * this.cols + gx] = i;
    }
  }

  /* ---------- public API ---------- */

  /** Switch theme: new tokens and subfield inks, repaint. */
  retheme(tk: Tokens, colors: string[]) {
    this.tk = tk;
    this.colors = colors;
    this.invalidate();
  }

  setMotion(on: boolean) {
    this.motion = on;
    if (!on) {
      this.waves = [];
      this.fly = null;
      this.target.set(this.state.active);
      this.pend.fill(0);
      this.vis.set(this.state.active);
    }
    this.invalidate();
  }

  resize(w: number, h: number, dpr: number) {
    const first = this.w === 0;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    Object.assign(this.fit, fitView(this.m.bounds as Bounds, w, h, Math.min(44, Math.round(w * 0.05))));
    if (first) this.view = { ...this.fit };
    this.invalidate();
  }

  set(patch: Partial<RenderState>) {
    const prev = this.state;
    const activeChanged = patch.active !== undefined && patch.active !== prev.active;
    const selChanged = patch.selected !== undefined && patch.selected !== prev.selected;
    this.state = { ...prev, ...patch };
    if (activeChanged) {
      this.activeCount = this.state.active.reduce((a, b) => a + b, 0);
      this.stats.shown = this.activeCount;
      this.computeAnchors();
      if (!this.introduced) this.intro();
      else this.switchDots();
    }
    if (selChanged && this.state.selected !== null) this.ping(this.m.xs[this.state.selected]!, this.m.ys[this.state.selected]!, 1.25);
    this.invalidate();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  invalidate() {
    if (!this.disposed && !this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.introTimer);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.listeners.clear();
  }

  get zoom() {
    return this.view.k / this.fit.k;
  }

  flyTo(to: View, ms = 650) {
    const clamped = this.constrain(to);
    if (!this.motion || ms <= 0) {
      this.fly = null;
      this.view = clamped;
    } else this.fly = { from: { ...this.view }, to: clamped, t0: performance.now(), ms };
    this.invalidate();
  }

  fitAll() {
    this.flyTo({ ...this.fit });
  }

  /** Centre a paper at `yFrac` of the canvas height (0.5 = middle) and zoom in to at least `minZoom`. */
  focusPoint(i: number, minZoom = 7, yFrac = 0.5) {
    const k = Math.max(this.view.k, this.fit.k * minZoom);
    this.flyTo({ cx: this.m.xs[i]!, cy: this.m.ys[i]! + (this.h * (0.5 - yFrac)) / k, k });
  }

  focusTopic(t: number) {
    this.focusIndices(this.byTopic[t]!);
  }

  /** Frame the central 85% of the given papers (ignores far outliers). */
  focusIndices(idx: number[]) {
    if (idx.length === 0) return;
    const xs = idx.map((i) => this.m.xs[i]!).sort((a, b) => a - b);
    const ys = idx.map((i) => this.m.ys[i]!).sort((a, b) => a - b);
    const lo = Math.floor(idx.length * 0.075);
    const hi = Math.max(lo, Math.ceil(idx.length * 0.925) - 1);
    const b: Bounds = { minX: xs[lo]!, maxX: xs[hi]!, minY: ys[lo]!, maxY: ys[hi]! };
    const v = fitView(b, this.w, this.h, 90);
    this.flyTo({ cx: v.cx, cy: v.cy, k: clamp(v.k, this.fit.k * 1.2, this.fit.k * 22) });
  }

  zoomBy(factor: number, sx = this.w / 2, sy = this.h / 2) {
    this.fly = null;
    this.view = zoomAt(this.view, this.w, this.h, sx, sy, factor, this.fit.k * 0.7, this.fit.k * MAX_ZOOM);
    this.invalidate();
  }

  panPixels(dx: number, dy: number) {
    this.fly = null;
    this.view = this.constrain(panBy(this.view, dx, dy));
    this.invalidate();
  }

  setPointer(p: [number, number] | null) {
    this.pointer = p;
  }

  worldAt(sx: number, sy: number) {
    return toWorld(this.view, this.w, this.h, sx, sy);
  }

  /** Where a paper is on screen right now. */
  screenPos(i: number): [number, number] {
    return [this.sx[i]!, this.sy[i]!];
  }

  /** Launch a ripple from a point on the map. */
  ping(x: number, y: number, amp = 1) {
    if (!this.motion || this.disposed) return;
    this.waves.push({ x, y, t0: performance.now(), amp });
    if (this.waves.length > 5) this.waves.shift();
    this.invalidate();
  }

  /** Nearest visible paper within reach of the cursor, or -1. Looks only at the grid cells around the pointer. */
  hitTest(px: number, py: number): number {
    const { active } = this.state;
    const [wx, wy] = toWorld(this.view, this.w, this.h, px, py);
    const gx = Math.round((wx - this.ox) / this.cell);
    const gy = Math.round((wy - this.oy) / this.cell);
    const reachCells = Math.max(1, Math.ceil(10 / (this.cell * this.view.k)));
    let best = -1;
    let bestD = Infinity;
    for (let dy = -reachCells; dy <= reachCells; dy++) {
      for (let dx = -reachCells; dx <= reachCells; dx++) {
        const cx = gx + dx;
        const cy = gy + dy;
        if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) continue;
        const i = this.occ[cy * this.cols + cx]!;
        if (i < 0 || !active[i] || this.vis[i]! < 0.3) continue;
        const d = (this.sx[i]! - px) ** 2 + (this.sy[i]! - py) ** 2;
        const reach = Math.max(this.dotRadius(i) + 3, Math.min(10, this.cell * this.view.k * 0.6));
        if (d <= reach * reach && d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  /** A topic or subfield label under the pointer, if one was drawn there. */
  labelAt(px: number, py: number): LabelHit | null {
    for (const l of this.labels) if (px >= l.x && px <= l.x + l.w && py >= l.y && py <= l.y + l.h) return { kind: l.kind, id: l.id };
    return null;
  }

  nearestToCenter(): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.m.n; i++) {
      if (!this.state.active[i]) continue;
      const d = (this.sx[i]! - this.w / 2) ** 2 + (this.sy[i]! - this.h / 2) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /* ---------- change as a wave ---------- */

  /** First paint: dots switch on in publication order, older to newer, with a ripple from the centre. */
  private intro() {
    this.introduced = true;
    if (!this.motion) {
      this.target.set(this.state.active);
      this.vis.set(this.state.active);
      return;
    }
    const now = performance.now();
    const [y0, y1] = [this.m.years[0]!, this.m.years[this.m.years.length - 1]!];
    for (let i = 0; i < this.m.n; i++) {
      this.pend[i] = 1;
      this.due[i] = now + ((this.m.year[i]! - y0) / Math.max(1, y1 - y0)) * 750 + hash(i) * 90;
    }
    this.introTimer = window.setTimeout(() => this.ping(this.cx0, this.cy0, 0.7), 500);
  }

  /** The selection changed: dots that switch on or off do so in a wave moving away from where the change is. */
  private switchDots() {
    const { m } = this;
    const { active } = this.state;
    let ox = 0, oy = 0, c = 0;
    for (let i = 0; i < m.n; i++) if (active[i] !== this.target[i]) (ox += m.xs[i]!, oy += m.ys[i]!, c++);
    if (c === 0) return;
    ox /= c;
    oy /= c;
    if (!this.motion) {
      this.target.set(active);
      this.vis.set(active);
      return;
    }
    const now = performance.now();
    for (let i = 0; i < m.n; i++) {
      if (active[i] === this.target[i] && !this.pend[i]) continue;
      this.pend[i] = 1;
      this.due[i] = now + Math.min(MAX_TRAVEL_MS, Math.hypot(m.xs[i]! - ox, m.ys[i]! - oy) * TRAVEL_MS);
    }
    this.ping(ox, oy, 0.8);
  }

  /** Extra size and brightness each dot gets right now from the ripples passing through it. */
  private computeWaves(now: number) {
    const { m, waveBoost } = this;
    waveBoost.fill(0);
    this.waves = this.waves.filter((w) => (now - w.t0) / 1000 < WAVE_END);
    for (const w of this.waves) {
      const t = (now - w.t0) / 1000;
      const radius = WAVE_SPEED * t;
      const amp = w.amp * Math.exp(-t / WAVE_LIFE);
      for (let i = 0; i < m.n; i++) {
        const d = Math.hypot(m.xs[i]! - w.x, m.ys[i]! - w.y) - radius;
        if (d > WAVE_WIDTH * 3 || d < -WAVE_WIDTH * 3) continue;
        waveBoost[i]! += amp * Math.exp(-((d / WAVE_WIDTH) ** 2));
      }
    }
  }

  /** Label anchor = centre of the densest neighbourhood, not the mean: subfields are multi-modal. */
  private anchor(idx: number[]): Anchor | null {
    if (idx.length === 0) return null;
    const { bounds: b, xs, ys } = this.m;
    const G = 24;
    const cell = (v: number, lo: number, hi: number) => Math.min(G - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * G)));
    const grid = new Uint16Array(G * G);
    for (const i of idx) grid[cell(ys[i]!, b.minY, b.maxY) * G + cell(xs[i]!, b.minX, b.maxX)]!++;
    let best = -1, bx = 0, by = 0;
    for (let cy = 0; cy < G; cy++) {
      for (let cx = 0; cx < G; cx++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (cx + dx >= 0 && cx + dx < G && cy + dy >= 0 && cy + dy < G) sum += grid[(cy + dy) * G + cx + dx]!;
        if (sum > best) (best = sum, bx = cx, by = cy);
      }
    }
    let sx = 0, sy = 0, c = 0;
    for (const i of idx) {
      if (Math.abs(cell(xs[i]!, b.minX, b.maxX) - bx) <= 1 && Math.abs(cell(ys[i]!, b.minY, b.maxY) - by) <= 1) (sx += xs[i]!, sy += ys[i]!, c++);
    }
    return { x: sx / c, y: sy / c, n: idx.length };
  }

  private computeAnchors() {
    const { active } = this.state;
    const subIdx: number[][] = this.m.atlas.subfields.map(() => []);
    this.topicAnchors = this.byTopic.map((idx, t) => {
      const on = idx.filter((i) => active[i]);
      subIdx[this.m.atlas.topics[t]!.subfield]!.push(...on);
      return this.anchor(on);
    });
    this.subAnchors = subIdx.map((idx) => this.anchor(idx));
  }

  private constrain(v: View): View {
    const b = this.m.bounds;
    const pad = 0.2;
    return {
      k: clamp(v.k, this.fit.k * 0.7, this.fit.k * MAX_ZOOM),
      cx: clamp(v.cx, b.minX - pad, b.maxX + pad),
      cy: clamp(v.cy, b.minY - pad, b.maxY + pad),
    };
  }

  /** Side of one matrix cell on screen. */
  private cellPx() {
    return this.cell * this.view.k;
  }

  /** Dot radius in px: citations set the size, never more than half a cell. */
  private dotRadius(i: number) {
    return Math.min(0.5, (0.2 + 0.28 * this.m.weight[i]!) * this.boost) * this.cellPx();
  }

  /* ---------- frame loop ---------- */

  private tick = (t: number) => {
    this.raf = 0;
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0.016;
    this.last = t;
    const now = performance.now();
    let again = false;

    if (this.fly) {
      const p = clamp((t - this.fly.t0) / this.fly.ms, 0, 1);
      this.view = lerpView(this.fly.from, this.fly.to, easeInOut(p));
      if (p >= 1) this.fly = null;
      else again = true;
    }

    // dots whose turn has come
    const { m, vis, target, pend, due } = this;
    const { active } = this.state;
    for (let i = 0; i < m.n; i++) {
      if (pend[i]) {
        if (now >= due[i]!) {
          target[i] = active[i]!;
          pend[i] = 0;
        } else again = true;
      }
      const dv = target[i]! - vis[i]!;
      if (dv !== 0) {
        if (Math.abs(dv) < 0.01 || !this.motion) vis[i] = target[i]!;
        else {
          vis[i]! += dv * (1 - Math.exp(-dt / 0.09));
          again = true;
        }
      }
    }

    const frac = Math.max(this.activeCount, 1) / m.n;
    const boostTarget = this.motion ? clamp((1 / Math.max(frac, 0.05)) ** 0.22, 1, 1.6) : 1;
    if (Math.abs(boostTarget - this.boost) > 0.004) {
      this.boost += (boostTarget - this.boost) * (1 - Math.exp(-dt / 0.18));
      again = true;
    } else this.boost = boostTarget;

    if (this.waves.length) {
      this.computeWaves(now);
      again = true;
    } else if (this.waveBoost.some((v) => v !== 0)) this.waveBoost.fill(0);

    this.draw(now);
    this.listeners.forEach((fn) => fn());
    if (again) this.invalidate();
    else this.last = 0;
  };

  private draw(now: number) {
    const { ctx, tk } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = tk.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    const z = this.zoom;
    this.project();
    this.drawEmptyMatrix(now);
    this.drawDots();
    this.labels = [];
    this.drawLabels(z);
    this.drawOverlay();
  }

  private project() {
    const { view: v, m } = this;
    const ox = this.w / 2 - v.cx * v.k;
    const oy = this.h / 2 - v.cy * v.k;
    for (let i = 0; i < m.n; i++) {
      this.sx[i] = m.xs[i]! * v.k + ox;
      this.sy[i] = m.ys[i]! * v.k + oy;
    }
  }

  /** The unlit panel: every empty cell of the grid in view gets a faint dot, so the matrix reads as a surface. */
  private drawEmptyMatrix(now: number) {
    const { ctx, view: v, tk } = this;
    const cellPx = this.cellPx();
    if (cellPx < 3) return;
    const [x0, y0] = toWorld(v, this.w, this.h, 0, 0);
    const [x1, y1] = toWorld(v, this.w, this.h, this.w, this.h);
    const g0x = Math.floor((x0 - this.ox) / this.cell);
    const g1x = Math.ceil((x1 - this.ox) / this.cell);
    const g0y = Math.floor((y0 - this.oy) / this.cell);
    const g1y = Math.ceil((y1 - this.oy) / this.cell);
    const base = Math.max(0.7, cellPx * 0.075);
    ctx.fillStyle = tk.fg3;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    for (let gy = g0y; gy <= g1y; gy++) {
      for (let gx = g0x; gx <= g1x; gx++) {
        if (gx >= 0 && gx < this.cols && gy >= 0 && gy < this.rows && this.occ[gy * this.cols + gx]! >= 0) continue;
        const sx = (this.ox + gx * this.cell - v.cx) * v.k + this.w / 2;
        const sy = (this.oy + gy * this.cell - v.cy) * v.k + this.h / 2;
        ctx.rect(sx - base / 2, sy - base / 2, base, base);
      }
    }
    ctx.fill();
    ctx.globalAlpha = 1;

    // ripples travel through the empty panel too, so the whole surface answers
    if (!this.waves.length) return;
    ctx.fillStyle = tk.fg2;
    for (const w of this.waves) {
      const t = (now - w.t0) / 1000;
      const radius = WAVE_SPEED * t;
      const amp = w.amp * Math.exp(-t / WAVE_LIFE);
      ctx.beginPath();
      const reach = WAVE_WIDTH * 2.5;
      for (let gy = g0y; gy <= g1y; gy++) {
        for (let gx = g0x; gx <= g1x; gx++) {
          if (gx >= 0 && gx < this.cols && gy >= 0 && gy < this.rows && this.occ[gy * this.cols + gx]! >= 0) continue;
          const wx = this.ox + gx * this.cell;
          const wy = this.oy + gy * this.cell;
          const d = Math.hypot(wx - w.x, wy - w.y) - radius;
          if (d > reach || d < -reach) continue;
          const b = amp * Math.exp(-((d / WAVE_WIDTH) ** 2));
          if (b < 0.04) continue;
          const sx = (wx - v.cx) * v.k + this.w / 2;
          const sy = (wy - v.cy) * v.k + this.h / 2;
          const r = base * (0.6 + 1.6 * b);
          ctx.globalAlpha = Math.min(0.7, 0.2 + 0.7 * b);
          ctx.moveTo(sx + r, sy);
          ctx.arc(sx, sy, r, 0, TAU);
        }
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawDots() {
    const { ctx, m, vis, sx, sy, bucket, order, waveBoost } = this;
    const { active, matches, matchCount } = this.state;
    const cellPx = this.cellPx();
    const nSub = m.atlas.subfields.length;
    const nb = nSub * LEVELS;
    const [y0, y1] = [m.years[0]!, m.years[m.years.length - 1]!];
    const dim = matches && matchCount > 0;
    const counts = new Int32Array(nb + 1);
    let inView = 0;

    // dots outside the selection stay as a small unlit dot: the matrix never loses its shape
    const ghost = Math.max(0.8, cellPx * 0.1);
    ctx.fillStyle = this.tk.fg3;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    for (let i = 0; i < m.n; i++) {
      if (active[i] || vis[i]! > 0.5) continue;
      const x = sx[i]!, y = sy[i]!;
      if (x < 0 || y < 0 || x > this.w || y > this.h) continue;
      ctx.rect(x - ghost / 2, y - ghost / 2, ghost, ghost);
    }
    ctx.fill();
    ctx.globalAlpha = 1;

    for (let i = 0; i < m.n; i++) {
      bucket[i] = -1;
      const v = vis[i]!;
      if (v < 0.02) continue;
      const x = sx[i]!, y = sy[i]!;
      if (x < -cellPx || y < -cellPx || x > this.w + cellPx || y > this.h + cellPx) continue;
      if (active[i]) inView++;
      const recency = (m.year[i]! - y0) / Math.max(1, y1 - y0);
      let a = (0.55 + 0.4 * recency) * v + 0.6 * waveBoost[i]!;
      if (dim && !matches![i]) a *= 0.14;
      const level = clamp(Math.ceil(a * LEVELS), 1, LEVELS) - 1;
      const b = m.sub[i]! * LEVELS + level;
      bucket[i] = b;
      counts[b + 1]!++;
    }
    this.stats.inView = inView;

    for (let b = 0; b < nb; b++) counts[b + 1]! += counts[b]!;
    const cursor = counts.slice(0, nb);
    for (let i = 0; i < m.n; i++) {
      const b = bucket[i]!;
      if (b >= 0) order[cursor[b]!++] = i;
    }

    for (let b = 0; b < nb; b++) {
      const from = counts[b]!;
      const to = counts[b + 1]!;
      if (from === to) continue;
      ctx.fillStyle = this.colors[Math.floor(b / LEVELS)]!;
      ctx.globalAlpha = ((b % LEVELS) + 1) / LEVELS;
      ctx.beginPath();
      for (let t = from; t < to; t++) {
        const i = order[t]!;
        const r = Math.min(cellPx * 0.66, Math.max(0.85, this.dotRadius(i)) * (0.45 + 0.55 * vis[i]!) * (1 + 1.4 * waveBoost[i]!));
        ctx.moveTo(sx[i]! + r, sy[i]!);
        ctx.arc(sx[i]!, sy[i]!, r, 0, TAU);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private halo(text: string, x: number, y: number) {
    const { ctx, tk } = this;
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = tk.bg;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }

  private drawLabels(z: number) {
    const { ctx, tk, m } = this;
    const placed: Rect[] = [];
    const free = (r: Rect) => placed.every((p) => r.x + r.w < p.x || p.x + p.w < r.x || r.y + r.h < p.y || p.y + p.h < r.y);
    const inside = (r: Rect) => r.x > 8 && r.y > 8 && r.x + r.w < this.w - 8 && r.y + r.h < this.h - 8;
    const view = this.view;
    ctx.textBaseline = "alphabetic";

    // L1: subfields (field overview)
    const a1 = 1 - smooth(z, 2.2, 3.8);
    if (a1 > 0.02) {
      ctx.globalAlpha = a1;
      ctx.textAlign = "left";
      const list = this.subAnchors.map((a, s) => ({ a, s })).filter((e): e is { a: Anchor; s: number } => e.a !== null).sort((p, q) => q.a.n - p.a.n);
      for (const { a, s } of list) {
        const [x, y] = toScreen(view, this.w, this.h, a.x, a.y);
        const name = m.atlas.subfields[s]!.name;
        ctx.font = `600 15px ${tk.display}`;
        const wTxt = ctx.measureText(name).width + 20;
        const r: Rect = { x: x - wTxt / 2, y: y - 18, w: wTxt, h: 38 };
        if (!inside(r) || !free(r)) continue;
        placed.push(r);
        this.labels.push({ ...r, kind: "subfield", id: s });
        ctx.fillStyle = this.colors[s]!;
        ctx.beginPath();
        ctx.arc(r.x + 5, r.y + 11, 4.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = tk.fg;
        this.halo(name, r.x + 16, r.y + 16);
        ctx.font = `400 11.5px ${tk.mono}`;
        ctx.fillStyle = tk.fg2;
        this.halo(`${a.n.toLocaleString("en-US")} papers`, r.x + 16, r.y + 32);
      }
      ctx.globalAlpha = 1;
    }

    // L2: research topics
    const a2 = smooth(z, 1.7, 2.8) * (1 - smooth(z, 9, 15));
    if (a2 > 0.02) {
      ctx.globalAlpha = a2;
      ctx.font = `500 13px ${tk.display}`;
      ctx.textAlign = "center";
      const min = Math.max(2, Math.round(26 / z));
      const list = this.topicAnchors.map((a, t) => ({ a, t })).filter((e): e is { a: Anchor; t: number } => e.a !== null && e.a.n >= min).sort((p, q) => q.a.n - p.a.n);
      let drawn = 0;
      for (const { a, t } of list) {
        if (drawn >= 40) break;
        const [x, y] = toScreen(view, this.w, this.h, a.x, a.y);
        const name = m.atlas.topics[t]!.name;
        const wTxt = ctx.measureText(name).width;
        const r: Rect = { x: x - wTxt / 2 - 4, y: y - 10, w: wTxt + 8, h: 20 };
        if (!inside(r) || !free(r)) continue;
        placed.push(r);
        this.labels.push({ ...r, kind: "topic", id: t });
        drawn++;
        ctx.fillStyle = tk.fg;
        this.halo(name, x, y + 4);
      }
      ctx.globalAlpha = 1;
    }

    // L3: individual papers, most cited first
    const a3 = smooth(z, 4.5, 6.5);
    if (a3 > 0.02) {
      ctx.globalAlpha = a3;
      ctx.font = `400 13px ${tk.display}`;
      ctx.textAlign = "left";
      let drawn = 0;
      for (let t = 0; t < m.n && drawn < 16; t++) {
        const i = this.byCites[t]!;
        if (!this.state.active[i] || this.vis[i]! < 0.6) continue;
        const x = this.sx[i]!, y = this.sy[i]!;
        if (x < 0 || y < 0 || x > this.w || y > this.h) continue;
        const title = m.atlas.papers[i]!.title;
        const text = title.length > 58 ? `${title.slice(0, 57)}...` : title;
        const r: Rect = { x: x + 9, y: y - 12, w: ctx.measureText(text).width + 12, h: 26 };
        if (!inside(r) || !free(r)) continue;
        placed.push(r);
        drawn++;
        // a quiet pill keeps the title legible over the dots behind it
        ctx.globalAlpha = a3 * 0.88;
        ctx.fillStyle = tk.bg;
        ctx.beginPath();
        ctx.roundRect(r.x - 3, r.y + 1, r.w - 4, r.h - 4, 6);
        ctx.fill();
        ctx.globalAlpha = a3;
        ctx.fillStyle = tk.fg;
        ctx.fillText(text, r.x + 3, y + 4);
      }
      ctx.globalAlpha = 1;
    }
  }

  private ring(i: number, extra: number, width: number, color: string, dash: number[] = []) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(this.sx[i]!, this.sy[i]!, this.dotRadius(i) + extra, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawOverlay() {
    const { ctx, tk, m } = this;
    const { selected, hover, peek, matches, matchCount } = this.state;
    const papers = m.atlas.papers;
    const cellPx = this.cellPx();

    // search matches
    if (matches && matchCount > 0 && matchCount <= 300) {
      ctx.strokeStyle = tk.accent;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let i = 0; i < m.n; i++) {
        if (!matches[i] || !this.state.active[i]) continue;
        const x = this.sx[i]!, y = this.sy[i]!;
        if (x < 0 || y < 0 || x > this.w || y > this.h) continue;
        const r = this.dotRadius(i) + 3.5;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.stroke();
    }

    // hover: a light touch that shows the paper's neighbourhood
    if (hover !== null && hover !== selected) {
      const p = papers[hover]!;
      ctx.strokeStyle = tk.fg;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const j of p.neighbors) {
        if (!this.state.active[j]) continue;
        ctx.moveTo(this.sx[hover]!, this.sy[hover]!);
        ctx.lineTo(this.sx[j]!, this.sy[j]!);
      }
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      for (const j of p.neighbors) if (this.state.active[j]) this.ring(j, 2, 1, tk.fg);
      ctx.globalAlpha = 1;
      this.ring(hover, 3, 1.5, tk.fg);
    }

    if (peek !== null) this.ring(peek, 6, 1.5, tk.accent, [3, 3]);

    if (selected === null) return;
    const p = papers[selected]!;
    const x = this.sx[selected]!, y = this.sy[selected]!;
    const r = this.dotRadius(selected) * 1.5;

    // propagation: selected paper to its nearest papers, each lit as a larger dot
    p.neighbors.forEach((j, t) => {
      if (!this.state.active[j]) return;
      ctx.strokeStyle = tk.accent;
      ctx.globalAlpha = clamp((p.neighborSim[t]! - 0.25) / 0.6, 0.2, 0.85);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(this.sx[j]!, this.sy[j]!);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.colors[m.sub[j]!]!;
      ctx.beginPath();
      ctx.arc(this.sx[j]!, this.sy[j]!, this.dotRadius(j) * 1.3, 0, TAU);
      ctx.fill();
      this.ring(j, 2.5, 1.25, tk.accent);
    });
    ctx.globalAlpha = 1;

    if (x < 0 || y < 0 || x > this.w || y > this.h) {
      const ex = clamp(x, 14, this.w - 14);
      const ey = clamp(y, 14, this.h - 14);
      ctx.fillStyle = tk.accent;
      ctx.beginPath();
      ctx.arc(ex, ey, 5, 0, TAU);
      ctx.fill();
      return;
    }
    ctx.fillStyle = this.colors[m.sub[selected]!]!;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    this.ring(selected, 3, 2, tk.accent);
    // reticle, sized to the matrix cell so it reads as "this cell"
    const d = Math.max(r + 9, cellPx * 0.9);
    const len = 6;
    ctx.strokeStyle = tk.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      ctx.moveTo(x + sx * d, y + sy * (d - len));
      ctx.lineTo(x + sx * d, y + sy * d);
      ctx.lineTo(x + sx * (d - len), y + sy * d);
    }
    ctx.stroke();
  }
}
