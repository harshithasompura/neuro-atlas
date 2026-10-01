export interface Neighbors {
  k: number;
  idx: Int32Array;
  sim: Float32Array;
}

/**
 * Exact k-nearest neighbours by cosine similarity (vectors are unit length, so dot product).
 * O(n^2 d) but only half the pairs are visited; ~15-25s for 8k x 384 in V8.
 */
export function knn(vecs: Float32Array, n: number, d: number, k: number, onProgress: (row: number) => void): Neighbors {
  const idx = new Int32Array(n * k).fill(-1);
  const sim = new Float32Array(n * k).fill(-Infinity);
  const floor = new Float32Array(n).fill(-Infinity);

  const offer = (row: number, other: number, s: number) => {
    if (s <= floor[row]!) return;
    const base = row * k;
    let worst = base;
    for (let t = base + 1; t < base + k; t++) if (sim[t]! < sim[worst]!) worst = t;
    sim[worst] = s;
    idx[worst] = other;
    let min = Infinity;
    for (let t = base; t < base + k; t++) if (sim[t]! < min) min = sim[t]!;
    floor[row] = min;
  };

  for (let i = 0; i < n; i++) {
    const a = i * d;
    for (let j = i + 1; j < n; j++) {
      const b = j * d;
      let dot = 0;
      for (let t = 0; t < d; t++) dot += vecs[a + t]! * vecs[b + t]!;
      offer(i, j, dot);
      offer(j, i, dot);
    }
    if (i % 200 === 0) onProgress(i);
  }

  // sort each row by descending similarity
  for (let i = 0; i < n; i++) {
    const row = Array.from({ length: k }, (_, t) => ({ j: idx[i * k + t]!, s: sim[i * k + t]! })).sort((x, y) => y.s - x.s);
    row.forEach((r, t) => {
      idx[i * k + t] = r.j;
      sim[i * k + t] = r.s;
    });
  }
  return { k, idx, sim };
}
