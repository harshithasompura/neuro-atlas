import { sampleLattice, seeded, type Lattice } from "../data/brain";

/**
 * Places papers on the dot-matrix lattice inside the brain silhouette, keeping semantic neighbourhoods together.
 *
 *  1. Rotate the UMAP cloud so its principal axis lies along the silhouette's long axis.
 *  2. Pair papers with lattice cells by recursive median bisection: split both sets in half along the same
 *     direction, pair the halves, recurse. It is a bijection that preserves left/right/up/down order at every
 *     scale (a cheap, rank-preserving optimal-transport-style assignment), so papers that were close stay close.
 *
 * One paper per cell: the matrix has exactly as many dots as there are papers.
 */
export function warpToLattice(umap: Float32Array, n: number): { xy: Float32Array; lattice: Lattice } {
  const lattice = sampleLattice(n);
  return { xy: transport(principalAlign(umap, n), lattice.sites, n), lattice };
}

/** Rotate about the median so the major axis is horizontal; orient by skew so the result is deterministic. */
export function principalAlign(xy: Float32Array, n: number): Float32Array {
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) (mx += xy[i * 2]!, my += xy[i * 2 + 1]!);
  mx /= n;
  my /= n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xy[i * 2]! - mx, dy = xy[i * 2 + 1]! - my;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const c = Math.cos(-angle), s = Math.sin(-angle);
  const out = new Float32Array(n * 2);
  let skew = 0;
  for (let i = 0; i < n; i++) {
    const dx = xy[i * 2]! - mx, dy = xy[i * 2 + 1]! - my;
    out[i * 2] = dx * c - dy * s;
    out[i * 2 + 1] = dx * s + dy * c;
    skew += out[i * 2]! ** 3;
  }
  if (skew < 0) for (let i = 0; i < n; i++) out[i * 2] = -out[i * 2]!;
  return out;
}

/** Bisection transport: returns, for each source point, the coordinates of the target site it was paired with. */
export function transport(src: Float32Array, tgt: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n * 2);
  const si = Int32Array.from({ length: n }, (_, i) => i);
  const ti = Int32Array.from({ length: n }, (_, i) => i);
  const keyS = new Float64Array(n);
  const keyT = new Float64Array(n);

  const recurse = (lo: number, hi: number) => {
    const len = hi - lo;
    if (len === 1) {
      const s = si[lo]!, t = ti[lo]!;
      out[s * 2] = tgt[t * 2]!;
      out[s * 2 + 1] = tgt[t * 2 + 1]!;
      return;
    }
    // split direction = principal axis of the target sites in this range
    let mx = 0, my = 0;
    for (let a = lo; a < hi; a++) (mx += tgt[ti[a]! * 2]!, my += tgt[ti[a]! * 2 + 1]!);
    mx /= len;
    my /= len;
    let cxx = 0, cyy = 0, cxy = 0;
    for (let a = lo; a < hi; a++) {
      const dx = tgt[ti[a]! * 2]! - mx, dy = tgt[ti[a]! * 2 + 1]! - my;
      cxx += dx * dx;
      cyy += dy * dy;
      cxy += dx * dy;
    }
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    for (let a = lo; a < hi; a++) {
      keyS[si[a]!] = src[si[a]! * 2]! * ux + src[si[a]! * 2 + 1]! * uy;
      keyT[ti[a]!] = tgt[ti[a]! * 2]! * ux + tgt[ti[a]! * 2 + 1]! * uy;
    }
    si.subarray(lo, hi).sort((a, b) => keyS[a]! - keyS[b]!);
    ti.subarray(lo, hi).sort((a, b) => keyT[a]! - keyT[b]!);
    const mid = lo + (len >> 1);
    recurse(lo, mid);
    recurse(mid, hi);
  };
  recurse(0, n);
  return out;
}

/**
 * Fraction of each sampled paper's embedding-space neighbours that are among its `within` nearest
 * neighbours on the 2D map. 1 = neighbourhoods fully preserved; ~within/n = random.
 */
export function neighbourhoodPreservation(xy: Float32Array, n: number, neighbors: Int32Array, k: number, within = 30, sample = 600, seed = 5): number {
  const rnd = seeded(seed);
  let hit = 0, total = 0;
  const d = new Float64Array(n);
  const order = new Int32Array(n);
  for (let s = 0; s < sample; s++) {
    const i = Math.floor(rnd() * n);
    for (let j = 0; j < n; j++) {
      const dx = xy[j * 2]! - xy[i * 2]!, dy = xy[j * 2 + 1]! - xy[i * 2 + 1]!;
      d[j] = j === i ? Infinity : dx * dx + dy * dy;
      order[j] = j;
    }
    // partial selection of the `within` nearest: cheap enough at n ~ 8k
    const near = new Set(Array.from(order).sort((a, b) => d[a]! - d[b]!).slice(0, within));
    for (let t = 0; t < k; t++) {
      const j = neighbors[i * k + t]!;
      if (j >= 0) {
        total++;
        if (near.has(j)) hit++;
      }
    }
  }
  return total ? hit / total : 0;
}
