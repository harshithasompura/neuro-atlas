import { UMAP } from "umap-js";
import { seeded } from "../data/brain";
import { LAYOUT } from "./config";


/**
 * Projects unit-length embeddings to 2D with UMAP using cosine distance (1 - dot).
 * Output is centred on the median and scaled so the 99th-percentile radius is 1,
 * which keeps the field compact while a few outliers can still sit beyond it.
 */
export async function layout(vecs: Float32Array, n: number, d: number, seed: number, onEpoch: (epoch: number, total: number) => void): Promise<Float32Array> {
  const rows: number[][] = Array.from({ length: n }, (_, i) => Array.from(vecs.subarray(i * d, (i + 1) * d)));
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: LAYOUT.nNeighbors,
    minDist: LAYOUT.minDist,
    nEpochs: LAYOUT.epochs,
    random: seeded(seed),
    distanceFn: (a, b) => {
      let dot = 0;
      for (let t = 0; t < a.length; t++) dot += a[t]! * b[t]!;
      return 1 - dot;
    },
  });
  const coords = await umap.fitAsync(rows, (epoch) => onEpoch(epoch, LAYOUT.epochs));

  const xs = coords.map((c) => c[0]!).sort((a, b) => a - b);
  const ys = coords.map((c) => c[1]!).sort((a, b) => a - b);
  const cx = xs[n >> 1]!;
  const cy = ys[n >> 1]!;
  const radii = coords.map((c) => Math.hypot(c[0]! - cx, c[1]! - cy)).sort((a, b) => a - b);
  const scale = radii[Math.floor(n * 0.99)]! || 1;

  const out = new Float32Array(n * 2);
  coords.forEach((c, i) => {
    out[i * 2] = (c[0]! - cx) / scale;
    out[i * 2 + 1] = (c[1]! - cy) / scale;
  });
  return out;
}
