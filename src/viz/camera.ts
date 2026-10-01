/** World -> screen: sx = (x - cx) * k + w/2, sy = (y - cy) * k + h/2 (y grows downward on screen). */
export interface View {
  cx: number;
  cy: number;
  /** pixels per world unit */
  k: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const MAX_ZOOM = 60;

export function fitView(b: Bounds, w: number, h: number, pad = 56): View {
  const bw = Math.max(b.maxX - b.minX, 1e-6);
  const bh = Math.max(b.maxY - b.minY, 1e-6);
  const k = Math.max(1, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh));
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, k };
}

export const toScreen = (v: View, w: number, h: number, x: number, y: number): [number, number] => [(x - v.cx) * v.k + w / 2, (y - v.cy) * v.k + h / 2];
export const toWorld = (v: View, w: number, h: number, sx: number, sy: number): [number, number] => [(sx - w / 2) / v.k + v.cx, (sy - h / 2) / v.k + v.cy];

/** Zoom by `factor` keeping the world point under (sx, sy) fixed. */
export function zoomAt(v: View, w: number, h: number, sx: number, sy: number, factor: number, kMin: number, kMax: number): View {
  const k = Math.min(kMax, Math.max(kMin, v.k * factor));
  const [wx, wy] = toWorld(v, w, h, sx, sy);
  return { k, cx: wx - (sx - w / 2) / k, cy: wy - (sy - h / 2) / k };
}

export const panBy = (v: View, dx: number, dy: number): View => ({ ...v, cx: v.cx - dx / v.k, cy: v.cy - dy / v.k });

/** Interpolate with k on a log scale so zooming feels uniform. */
export function lerpView(a: View, b: View, t: number): View {
  return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, k: a.k * (b.k / a.k) ** t };
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
