import { BRAIN_BOUNDS } from "@/data/brain";
import type { Atlas } from "@/data/types";

/**
 * Column-oriented view of the atlas for the renderer. Pure derivation from Atlas, nothing here is
 * fetched or invented; the arrays just make per-point loops cheap.
 */
export interface AtlasModel {
  atlas: Atlas;
  n: number;
  xs: Float32Array;
  ys: Float32Array;
  year: Uint16Array;
  cites: Uint32Array;
  sub: Uint8Array;
  topic: Uint16Array;
  /** DERIVED: dot size weight 0..1, square-root of citations capped at the 99th percentile */
  weight: Float32Array;
  /** DERIVED: share of sampled papers with fewer citations, 0..1 */
  citePercentile: Float32Array;
  haystack: string[];
  years: number[];
  /** sampled papers per [year index][subfield] */
  yearSub: Uint32Array;
  /** sampled papers per topic */
  topicCount: Uint32Array;
  /** extent of the silhouette */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export function buildModel(atlas: Atlas): AtlasModel {
  const { papers, subfields, topics } = atlas;
  const n = papers.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const year = new Uint16Array(n);
  const cites = new Uint32Array(n);
  const sub = new Uint8Array(n);
  const topic = new Uint16Array(n);
  const haystack: string[] = new Array(n);
  const topicCount = new Uint32Array(topics.length);

  papers.forEach((p, i) => {
    xs[i] = p.x;
    ys[i] = p.y;
    year[i] = p.year;
    cites[i] = p.citations;
    topic[i] = p.topic;
    sub[i] = topics[p.topic]!.subfield;
    topicCount[p.topic]!++;
    haystack[i] = [
      p.title,
      p.authors.join(" "),
      topics[p.topic]!.name,
      subfields[sub[i]!]!.name,
      p.institutions.map((j) => atlas.institutions[j]).join(" "),
      p.venue >= 0 ? atlas.venues[p.venue] : "",
      p.year,
    ]
      .join(" ")
      .toLowerCase();
  });

  const sorted = Float64Array.from(cites).sort();
  const cap = Math.max(1, sorted[Math.floor(n * 0.99)] ?? 1);
  const weight = new Float32Array(n);
  const citePercentile = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    weight[i] = Math.sqrt(Math.min(cites[i]!, cap) / cap);
    // lower-bound binary search for rank among sorted citation counts
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < cites[i]!) lo = mid + 1;
      else hi = mid;
    }
    citePercentile[i] = lo / n;
  }

  const [y0, y1] = atlas.meta.source.yearRange;
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
  const yearSub = new Uint32Array(years.length * subfields.length);
  for (let i = 0; i < n; i++) {
    const yi = year[i]! - y0;
    if (yi >= 0 && yi < years.length) yearSub[yi * subfields.length + sub[i]!]!++;
  }

  return { atlas, n, xs, ys, year, cites, sub, topic, weight, citePercentile, haystack, years, yearSub, topicCount, bounds: BRAIN_BOUNDS };
}
