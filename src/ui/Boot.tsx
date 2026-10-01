"use client";

import { useEffect, useState } from "react";
import { OUTLINE } from "@/data/brain";
import type { Stage } from "@/data/types";
import type { AtlasState } from "./use-atlas";

const STAGES: { id: Stage; label: string; what: string }[] = [
  { id: "pool", label: "Count", what: "size of the OpenAlex pool" },
  { id: "fetch", label: "Fetch", what: "a seeded random sample, 100 works per request" },
  { id: "embed", label: "Embed", what: "title and abstract become 384 numbers, computed on this machine" },
  { id: "neighbors", label: "Relate", what: "nearest papers by cosine similarity" },
  { id: "layout", label: "Place", what: "UMAP, then fitted into the silhouette" },
  { id: "write", label: "Assemble", what: "write the atlas" },
];

const PATH = (() => {
  const { minX, maxX, minY, maxY } = OUTLINE.reduce(
    (b, [x, y]) => ({ minX: Math.min(b.minX, x), maxX: Math.max(b.maxX, x), minY: Math.min(b.minY, y), maxY: Math.max(b.maxY, y) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  const s = 300 / (maxX - minX);
  return { d: OUTLINE.map(([x, y], i) => `${i ? "L" : "M"}${((x - minX) * s + 10).toFixed(1)},${((y - minY) * s + 10).toFixed(1)}`).join("") + "Z", w: 320, h: (maxY - minY) * s + 20 };
})();

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="mono">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
}

export function Boot({ state, onRetry }: { state: Exclude<AtlasState, { status: "ready" }>; onRetry: () => void }) {
  if (state.status === "error") {
    return (
      <main className="boot" role="alert">
        <p className="boot-eyebrow">Atlas unavailable</p>
        <h1 className="boot-title">The map could not be built.</h1>
        <p className="boot-error mono">{state.message}</p>
        <p className="boot-note">Nothing is shown in place of real data. Check the connection and the OpenAlex credit budget, then try again. Pages already retrieved are reused.</p>
        <button className="btn btn-accent" onClick={onRetry}>
          Try again
        </button>
      </main>
    );
  }

  const fractions = STAGES.map((s) => {
    const p = state.stages[s.id];
    return p ? Math.min(1, p.done / Math.max(1, p.total)) : 0;
  });
  const overall = fractions.reduce((a, b) => a + b, 0) / STAGES.length;
  const current = Math.max(0, fractions.findIndex((f) => f < 1));

  return (
    <main className="boot" aria-busy="true">
      <svg className="boot-brain" viewBox={`0 0 ${PATH.w} ${PATH.h}`} style={{ aspectRatio: `${PATH.w} / ${PATH.h}` }} role="img" aria-label={`Building the map, ${Math.round(overall * 100)} percent`}>
        <path d={PATH.d} pathLength={1} className="boot-brain-ghost" />
        <path d={PATH.d} pathLength={1} className="boot-brain-draw" style={{ strokeDasharray: `${overall} 1` }} />
      </svg>
      <p className="boot-eyebrow">
        Building the map <span aria-hidden="true">/</span> <Elapsed since={state.startedAt} />
      </p>
      <h1 className="boot-title">Real neuroscience papers from OpenAlex, placed by meaning.</h1>
      <ol className="stages" aria-live="polite">
        {STAGES.map((s, i) => {
          const p = state.stages[s.id];
          const done = fractions[i] === 1;
          return (
            <li key={s.id} data-state={done ? "done" : i === current && p ? "run" : "wait"}>
              <span className="stage-name">{s.label}</span>
              <span className="stage-what mono">{p && !done ? p.message : s.what}</span>
              <span className="stage-bar" role="progressbar" aria-label={s.label} aria-valuenow={Math.round(fractions[i]! * 100)} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${fractions[i]! * 100}%` }} />
              </span>
            </li>
          );
        })}
      </ol>
      <p className="boot-note">The first build takes a few minutes: about 8,000 works are sampled, their abstracts embedded here and the layout computed. The result is cached, so later loads are immediate.</p>
    </main>
  );
}
