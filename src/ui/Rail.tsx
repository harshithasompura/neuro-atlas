"use client";

import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { subfieldCounts, topicTrends } from "@/viz/filters";
import type { AtlasModel } from "@/viz/model";
import { subfieldVar } from "@/viz/palette";
import { Num } from "./Num";

interface Props {
  model: AtlasModel;
  range: [number, number];
  subs: ReadonlySet<number>;
  topic: number | null;
  active: Uint8Array;
  onToggleSub: (s: number) => void;
  onClear: () => void;
  onTopic: (t: number | null) => void;
  onRebuild: () => void;
}

const fmt = (n: number) => n.toLocaleString("en-US");

function Spark({ values, range, years, color }: { values: number[]; range: [number, number]; years: number[]; color: string }) {
  const W = 64;
  const H = 18;
  const max = Math.max(1, ...values);
  const pt = (i: number) => `${(i / (values.length - 1)) * W},${H - 2 - (values[i]! / max) * (H - 4)}`;
  const all = values.map((_, i) => pt(i)).join(" ");
  const sel = values.flatMap((_, i) => (years[i]! >= range[0] && years[i]! <= range[1] ? [pt(i)] : [])).join(" ");
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" className="spark">
      <polyline points={all} fill="none" stroke="var(--line-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {sel && <polyline points={sel} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export function Rail({ model, range, subs, topic, active, onToggleSub, onClear, onTopic, onRebuild }: Props) {
  const { atlas, years } = model;
  const k = atlas.subfields.length;
  const windowCounts = useMemo(() => subfieldCounts(model, range[0], range[1]), [model, range]);
  const totalCounts = useMemo(() => subfieldCounts(model, years[0]!, years[years.length - 1]!), [model, years]);
  const windowTotal = windowCounts.reduce((a, b) => a + b, 0);
  const isFull = range[0] === years[0] && range[1] === years[years.length - 1];

  const topicRows = useMemo(() => {
    const c = new Uint32Array(atlas.topics.length);
    for (let i = 0; i < model.n; i++) {
      const y = model.year[i]!;
      if (y < range[0] || y > range[1]) continue;
      if (subs.size && !subs.has(model.sub[i]!)) continue;
      c[model.topic[i]!]!++;
    }
    return Array.from(c, (n, t) => ({ t, n })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 12);
  }, [model, atlas.topics.length, range, subs]);

  const trends = useMemo(() => {
    const y0 = years[0]!;
    const y1 = years[years.length - 1]!;
    const rows = topicTrends(model, [y0, y0 + 2], [y1 - 2, y1]).sort((a, b) => b.ratio - a.ratio);
    return { up: rows.slice(0, 5), down: rows.slice(-5).reverse(), early: `${y0} to ${String(y0 + 2).slice(2)}`, late: `${y1 - 2} to ${String(y1).slice(2)}` };
  }, [model, years]);

  const citeBins = useMemo(() => {
    const edges = [0, 1, 3, 10, 30, 100, 300, Infinity];
    const bins = new Array<number>(edges.length - 1).fill(0);
    for (let i = 0; i < model.n; i++) {
      if (!active[i]) continue;
      const c = model.cites[i]!;
      let b = 0;
      while (b < bins.length - 1 && c >= edges[b + 1]!) b++;
      bins[b]!++;
    }
    return { bins, labels: ["0", "1-2", "3-9", "10-29", "30-99", "100-299", "300+"] };
  }, [model, active]);
  const citeMax = Math.max(1, ...citeBins.bins);
  const filtered = subs.size > 0 || topic !== null;
  const { fidelity } = atlas.meta.layout;

  return (
    <aside className="rail" aria-label="Filters and statistics">
      <section aria-labelledby="h-sub">
        <header className="rail-head">
          <h2 id="h-sub">Subfields</h2>
          <span className="mono rail-sub">{isFull ? "share of sample" : "change in share"}</span>
          {filtered && (
            <button className="link" onClick={onClear}>
              Reset
            </button>
          )}
        </header>
        <ul className="legend">
          {atlas.subfields.map((s, i) => {
            const n = windowCounts[i]!;
            const share = windowTotal ? n / windowTotal : 0;
            const delta = (share - totalCounts[i]! / model.n) * 100;
            const on = subs.size === 0 || subs.has(i);
            const series = years.map((_, yi) => model.yearSub[yi * k + i]!);
            return (
              <li key={s.id}>
                <button className="legend-row" aria-pressed={subs.has(i)} data-dim={!on} onClick={() => onToggleSub(i)}>
                  <i className="swatch" style={{ background: subfieldVar(s.id) }} />
                  <span className="legend-name">{s.name}</span>
                  <span className="mono legend-n">
                    <Num value={n} />
                  </span>
                  <Spark values={series} range={range} years={years} color={subfieldVar(s.id)} />
                  <span className="mono legend-delta" title={isFull ? "share of the sample" : "change in share versus the whole period, in points"}>
                    {isFull ? `${(share * 100).toFixed(1)}%` : `${delta >= 0 ? "+" : "-"}${Math.abs(delta).toFixed(1)}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="h-top">
        <header className="rail-head">
          <h2 id="h-top">Topics</h2>
          <span className="mono rail-sub">{subs.size ? "in selected subfields" : "in the time lens"}</span>
          {topic !== null && (
            <button className="link" onClick={() => onTopic(null)}>
              Clear
            </button>
          )}
        </header>
        <ul className="topics">
          {topicRows.map(({ t, n }) => (
            <li key={t}>
              <button className="topic-row" aria-pressed={topic === t} onClick={() => onTopic(topic === t ? null : t)}>
                <span className="topic-name">{atlas.topics[t]!.name}</span>
                <span className="mono topic-n">
                  <Num value={n} />
                </span>
                <span className="topic-bar" style={{ width: `${(n / topicRows[0]!.n) * 100}%`, background: subfieldVar(atlas.subfields[atlas.topics[t]!.subfield]!.id) }} />
              </button>
            </li>
          ))}
          {topicRows.length === 0 && <li className="note mono">No topics in this window.</li>}
        </ul>
      </section>

      <section aria-labelledby="h-trend">
        <header className="rail-head">
          <h2 id="h-trend">Rising and falling</h2>
          <span className="mono rail-sub">derived</span>
        </header>
        {[
          { title: "Rising", rows: trends.up },
          { title: "Falling", rows: trends.down },
        ].map((g) => (
          <div key={g.title}>
            <h3 className="rail-h3">{g.title}</h3>
            <ul className="topics">
              {g.rows.map((r) => (
                <li key={r.topic}>
                  <button className="topic-row" aria-pressed={topic === r.topic} onClick={() => onTopic(topic === r.topic ? null : r.topic)}>
                    <span className="topic-name">{atlas.topics[r.topic]!.name}</span>
                    <span className="mono topic-n" title={`${r.early} papers early, ${r.late} late`}>
                      x{r.ratio.toFixed(1)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="note mono">
          A topic&rsquo;s share of the sample in {trends.late} divided by its share in {trends.early}. Topics with at least 12 papers across both windows.
        </p>
      </section>

      <section aria-labelledby="h-cite">
        <header className="rail-head">
          <h2 id="h-cite">Citations</h2>
          <span className="mono rail-sub">shown papers</span>
        </header>
        <div className="hist" role="img" aria-label={`Citation distribution: ${citeBins.labels.map((l, i) => `${l} citations: ${citeBins.bins[i]}`).join("; ")}`}>
          {citeBins.bins.map((b, i) => (
            <div key={i} className="hist-col" title={`${citeBins.labels[i]} citations: ${b} papers`}>
              <i style={{ height: `${(b / citeMax) * 100}%` }} />
              <span className="mono">{citeBins.labels[i]}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="about">
        <h2>About this map</h2>
        <dl className="mono">
          <div>
            <dt>source</dt>
            <dd>OpenAlex /works</dd>
          </div>
          <div>
            <dt>sample</dt>
            <dd>
              {fmt(atlas.papers.length)} of {fmt(atlas.meta.poolCount)}, seed {atlas.meta.source.seed}
            </dd>
          </div>
          <div>
            <dt>filter</dt>
            <dd>
              field 28, {atlas.meta.source.yearRange[0]} to {atlas.meta.source.yearRange[1]}, with abstract
            </dd>
          </div>
          <div>
            <dt>embedding</dt>
            <dd>{atlas.meta.embedding.model.split("/")[1]}</dd>
          </div>
          <div>
            <dt>layout</dt>
            <dd>UMAP fitted into a stylised brain. Neighbour fidelity {Math.round(fidelity.umap * 100)}% to {Math.round(fidelity.silhouette * 100)}%. Position means similarity, not anatomy.</dd>
          </div>
          <div>
            <dt>built</dt>
            <dd>{atlas.meta.builtAt.slice(0, 16).replace("T", " ")} UTC</dd>
          </div>
        </dl>
        <button className="link" onClick={onRebuild}>
          <RefreshCw size={12} aria-hidden="true" /> Rebuild from OpenAlex
        </button>
      </footer>

      <div className="credits">
        <p>
          Built by{" "}
          <a href="https://harshithasompura.com" target="_blank" rel="noreferrer">
            harshithasompura
          </a>
        </p>
        <p>
          <a href="https://github.com/harshithasompura/neuro-atlas" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </p>
        <p className="mono">
          Data:{" "}
          <a href="https://openalex.org" target="_blank" rel="noreferrer">
            OpenAlex
          </a>
          , CC0
        </p>
      </div>
    </aside>
  );
}
