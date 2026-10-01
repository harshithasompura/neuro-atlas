/**
 * A stylised lateral brain silhouette (frontal lobe left, occipital right) used as the container for the
 * particle field. It is a metaphor, not anatomy: papers are placed inside it by semantic similarity, and no
 * region of the outline is claimed to correspond to a brain area.
 *
 * Pure geometry, shared by the build pipeline (to place papers) and the renderer (to draw the outline).
 */

export type Pt = readonly [number, number];

/** Hand-placed control polygon, clockwise from the top of the cortex. y grows downward. */
const CONTROL: Pt[] = [
  [0.0, -0.67], [0.34, -0.65], [0.64, -0.53], [0.86, -0.31], [0.97, -0.06], [0.98, 0.12], [0.92, 0.27],
  // cerebellum
  [0.82, 0.34], [0.86, 0.47], [0.75, 0.6], [0.57, 0.64], [0.41, 0.58], [0.31, 0.49],
  // brainstem
  [0.29, 0.62], [0.27, 0.8], [0.12, 0.83], [0.1, 0.62], [0.06, 0.47],
  // temporal lobe underside, pole, and the lateral fissure notch
  [-0.16, 0.45], [-0.4, 0.47], [-0.62, 0.41], [-0.77, 0.29], [-0.76, 0.18], [-0.5, 0.13], [-0.78, 0.07],
  // frontal lobe
  [-0.93, -0.05], [-0.93, -0.27], [-0.76, -0.5], [-0.49, -0.63], [-0.23, -0.68],
];

const chaikin = (pts: Pt[], rounds: number): Pt[] => {
  let cur = pts;
  for (let r = 0; r < rounds; r++) {
    const next: Pt[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]!;
      const b = cur[(i + 1) % cur.length]!;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    cur = next;
  }
  return cur;
};

/** Gentle gyral scalloping of the cortex edge, faded out over the brainstem and cerebellum. */
function scallop(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = pts[(i + pts.length - 1) % pts.length]!;
    const next = pts[(i + 1) % pts.length]!;
    s += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    let nx = next[1] - prev[1];
    let ny = -(next[0] - prev[0]);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const cortex = p[1] < 0.3 && !(p[0] > 0.78 && p[1] > 0.28) ? 1 : 0;
    const a = 0.013 * cortex * Math.sin((s / 0.13) * Math.PI * 2);
    out.push([p[0] + nx * a, p[1] + ny * a]);
  }
  return out;
}

export const OUTLINE: Pt[] = scallop(chaikin(CONTROL, 4));

export const BRAIN_BOUNDS = (() => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of OUTLINE) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
})();

/** Even-odd ray cast against the outline polygon. */
export function insideBrain(x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [xi, yi] = OUTLINE[i]!;
    const [xj, yj] = OUTLINE[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** mulberry32: shared seeded PRNG. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from a point to the closest outline segment. */
function distanceToOutline(x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [ax, ay] = OUTLINE[j]!;
    const [bx, by] = OUTLINE[i]!;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

export interface Lattice {
  /** [x0, y0, x1, y1, ...] cell centres inside the silhouette, exactly n of them */
  sites: Float32Array;
  /** side of one cell in world units */
  cell: number;
  /** lattice origin: the centre of cell (0, 0) */
  originX: number;
  originY: number;
}

/**
 * The dot matrix: a square grid of cells inside the silhouette, tuned so that exactly `n` cells exist.
 * The cell size is found by bisection; any surplus cells are dropped from the edge inwards, so the outline
 * stays a clean staircase and the interior stays a perfect grid.
 */
export function sampleLattice(n: number): Lattice {
  const { minX, maxX, minY, maxY } = BRAIN_BOUNDS;
  const build = (cell: number) => {
    const sites: [number, number][] = [];
    for (let y = minY + cell / 2; y < maxY; y += cell) for (let x = minX + cell / 2; x < maxX; x += cell) if (insideBrain(x, y)) sites.push([x, y]);
    return sites;
  };
  let lo = 0.004;
  let hi = 0.1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (build(mid).length >= n) lo = mid;
    else hi = mid;
  }
  const sites = build(lo);
  const ranked = sites.map((p, i) => ({ i, d: distanceToOutline(p[0], p[1]) })).sort((a, b) => a.d - b.d);
  const drop = new Set(ranked.slice(0, sites.length - n).map((r) => r.i));
  const out = new Float32Array(n * 2);
  let w = 0;
  sites.forEach((p, i) => {
    if (!drop.has(i)) (out[w * 2] = p[0], out[w * 2 + 1] = p[1], w++);
  });
  return { sites: out, cell: lo, originX: minX + lo / 2, originY: minY + lo / 2 };
}
