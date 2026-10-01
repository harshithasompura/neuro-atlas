import type { AtlasModel } from "./model";

export interface Filters {
  from: number;
  to: number;
  /** empty = all subfields */
  subfields: ReadonlySet<number>;
  topic: number | null;
  query: string;
}

export interface Selection {
  /** 1 where the paper passes year + subfield + topic filters */
  active: Uint8Array;
  activeCount: number;
  /** null when there is no query; otherwise 1 where the paper matches every query token */
  matches: Uint8Array | null;
  matchCount: number;
}

export const tokens = (q: string) => q.toLowerCase().split(/\s+/).filter((t) => t.length > 0);

export function computeSelection(m: AtlasModel, f: Filters): Selection {
  const { n, year, sub, topic } = m;
  const active = new Uint8Array(n);
  let activeCount = 0;
  const allSubs = f.subfields.size === 0;
  for (let i = 0; i < n; i++) {
    const y = year[i]!;
    if (y < f.from || y > f.to) continue;
    if (!allSubs && !f.subfields.has(sub[i]!)) continue;
    if (f.topic !== null && topic[i] !== f.topic) continue;
    active[i] = 1;
    activeCount++;
  }

  const toks = tokens(f.query);
  let matches: Uint8Array | null = null;
  let matchCount = 0;
  if (toks.length > 0) {
    matches = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const h = m.haystack[i]!;
      if (toks.every((t) => h.includes(t))) {
        matches[i] = 1;
        matchCount++;
      }
    }
  }
  return { active, activeCount, matches, matchCount };
}

/** Papers per subfield within [from, to], restricted by an optional topic. Used by the legend. */
export function subfieldCounts(m: AtlasModel, from: number, to: number): Uint32Array {
  const k = m.atlas.subfields.length;
  const out = new Uint32Array(k);
  const y0 = m.years[0]!;
  for (let yi = Math.max(0, from - y0); yi <= Math.min(m.years.length - 1, to - y0); yi++)
    for (let s = 0; s < k; s++) out[s]! += m.yearSub[yi * k + s]!;
  return out;
}

export interface TopicTrend {
  topic: number;
  early: number;
  late: number;
  /** DERIVED: ratio of the topic's share of papers in the late window to its share in the early window */
  ratio: number;
}

/**
 * Compares each topic's share of the sample in an early vs a late window (add-one smoothed).
 * Shares, not raw counts, because publication volume itself grows over time.
 */
export function topicTrends(m: AtlasModel, early: [number, number], late: [number, number], minCount = 12): TopicTrend[] {
  const nTopics = m.atlas.topics.length;
  const e = new Uint32Array(nTopics);
  const l = new Uint32Array(nTopics);
  let eTotal = 0, lTotal = 0;
  for (let i = 0; i < m.n; i++) {
    const y = m.year[i]!;
    if (y >= early[0] && y <= early[1]) (e[m.topic[i]!]!++, eTotal++);
    else if (y >= late[0] && y <= late[1]) (l[m.topic[i]!]!++, lTotal++);
  }
  const out: TopicTrend[] = [];
  for (let t = 0; t < nTopics; t++) {
    if (e[t]! + l[t]! < minCount) continue;
    out.push({ topic: t, early: e[t]!, late: l[t]!, ratio: ((l[t]! + 1) / (lTotal + 1)) / ((e[t]! + 1) / (eTotal + 1)) });
  }
  return out;
}

export interface SearchHits {
  papers: number[];
  topics: number[];
  /** total papers matching, not just those returned */
  paperTotal: number;
}

/** Search over the loaded atlas only: papers (title, authors, topic, institution, venue) and topic names. */
export function searchAtlas(m: AtlasModel, query: string, limitPapers = 6, limitTopics = 3): SearchHits {
  const toks = tokens(query);
  if (toks.length === 0) return { papers: [], topics: [], paperTotal: 0 };
  const hits: number[] = [];
  for (let i = 0; i < m.n; i++) if (toks.every((t) => m.haystack[i]!.includes(t))) hits.push(i);
  hits.sort((a, b) => m.cites[b]! - m.cites[a]!);
  const topics = m.atlas.topics
    .map((t, idx) => ({ idx, name: t.name.toLowerCase(), n: m.topicCount[idx]! }))
    .filter((t) => toks.every((k) => t.name.includes(k)))
    .sort((a, b) => b.n - a.n)
    .slice(0, limitTopics)
    .map((t) => t.idx);
  return { papers: hits.slice(0, limitPapers), topics, paperTotal: hits.length };
}
