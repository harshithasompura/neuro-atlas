"use client";

import { ExternalLink, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WorkDetail } from "@/data/types";
import type { AtlasModel } from "@/viz/model";
import { subfieldVar } from "@/viz/palette";
import type { AtlasRenderer } from "@/viz/renderer";

type Extra = { id: string; state: "loading" } | { id: string; state: "ready"; detail: WorkDetail } | { id: string; state: "error"; message: string };

interface Props {
  model: AtlasModel;
  renderer: AtlasRenderer | null;
  index: number;
  active: Uint8Array;
  closing: boolean;
  onClose: () => void;
  onClosed: () => void;
  onPick: (i: number) => void;
}

/** The selected paper. It opens outward from the particle's position on the map and closes back into it. */
export function Detail({ model, renderer, index, active, closing, onClose, onClosed, onPick }: Props) {
  const { atlas } = model;
  const p = atlas.papers[index]!;
  const topic = atlas.topics[p.topic]!;
  const sub = atlas.subfields[topic.subfield]!;
  const root = useRef<HTMLElement>(null);
  const [extra, setExtra] = useState<Extra>({ id: p.id, state: "loading" });

  // origin of the reveal: the particle, in this panel's own coordinates
  useLayoutEffect(() => {
    const el = root.current;
    const stage = document.querySelector(".stage");
    if (!el || !stage || !renderer || el.dataset.origin) return;
    const [px, py] = renderer.screenPos(index);
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    el.style.setProperty("--ox", `${s.left + px - r.left}px`);
    el.style.setProperty("--oy", `${s.top + py - r.top}px`);
    el.dataset.origin = "set";
  }, [renderer, index]);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/work/${p.id}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setExtra({ id: p.id, state: "ready", detail: (await r.json()) as WorkDetail });
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setExtra({ id: p.id, state: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => ac.abort();
  }, [p.id]);

  const detail = extra.id === p.id && extra.state === "ready" ? extra.detail : null;
  const pct = Math.round(model.citePercentile[index]! * 100);
  const authors = detail?.authors ?? p.authors;
  const institutions = detail?.institutions ?? p.institutions.map((i) => atlas.institutions[i]!);

  return (
    <aside
      className="detail"
      ref={root}
      data-closing={closing}
      aria-label="Selected paper"
      onAnimationEnd={(e) => {
        if (closing && e.target === root.current) onClosed();
      }}
    >
      <header className="detail-head">
        <span className="mono detail-id">paper {p.id}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close paper details">
          <X size={16} />
        </button>
      </header>

      <div className="detail-scroll">
        <div className="detail-body" key={p.id}>
          <h2 className="detail-title">{p.title}</h2>
          <p className="detail-topic">
            <i className="swatch" style={{ background: subfieldVar(sub.id) }} />
            <span>
              {topic.name}
              <small>{sub.name}</small>
            </span>
          </p>

          <dl className="facts">
            <div>
              <dt>Published</dt>
              <dd className="mono">{p.date}</dd>
            </div>
            <div>
              <dt>Cited by</dt>
              <dd className="mono">
                {p.citations.toLocaleString("en-US")} <small>{p.citations === 0 ? "uncited so far" : `top ${Math.max(1, 100 - pct)}%`}</small>
              </dd>
            </div>
            <div>
              <dt>Authors</dt>
              <dd className="mono">{p.authorCount}</dd>
            </div>
          </dl>

          {p.venue >= 0 && (
            <p className="kv">
              <span>Source</span> {atlas.venues[p.venue]}
            </p>
          )}
          {authors.length > 0 && (
            <p className="kv">
              <span>Authors</span> {authors.slice(0, 8).join(", ")}
              {authors.length > 8 ? ` and ${authors.length - 8} more` : ""}
            </p>
          )}
          {institutions.length > 0 && (
            <p className="kv">
              <span>Institutions</span> {institutions.slice(0, 4).join(", ")}
              {institutions.length > 4 ? ` and ${institutions.length - 4} more` : ""}
            </p>
          )}

          <section aria-label="Abstract">
            <h3>Abstract</h3>
            {extra.id === p.id && extra.state === "loading" && <p className="mono dim">Loading abstract...</p>}
            {extra.id === p.id && extra.state === "error" && <p className="mono dim">Abstract unavailable ({extra.message}).</p>}
            {detail && (detail.abstract ? <p className="abstract">{detail.abstract}</p> : <p className="mono dim">OpenAlex has no abstract for this work.</p>)}
            {detail && detail.keywords.length > 0 && <p className="kw mono">{detail.keywords.slice(0, 6).join(", ")}</p>}
          </section>

          <section aria-label="Related research">
            <h3>
              Nearest in meaning <span className="mono">cosine similarity</span>
            </h3>
            <ol className="near">
              {p.neighbors.map((j, t) => {
                const q = atlas.papers[j]!;
                const hidden = !active[j];
                const sim = p.neighborSim[t]!;
                return (
                  <li key={j}>
                    <button onClick={() => onPick(j)} aria-label={`${q.title}, ${q.year}, similarity ${sim.toFixed(2)}${hidden ? ", outside the current filter" : ""}`}>
                      <span className="mono near-sim">
                        {sim.toFixed(2)}
                        <i style={{ width: `${Math.max(8, sim * 100)}%` }} />
                      </span>
                      <span className="near-title">{q.title}</span>
                      <span className="mono near-year" data-hidden={hidden}>
                        {q.year}
                        {hidden ? " (filtered out)" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <footer className="detail-links">
            {p.doi && (
              <a href={p.doi} target="_blank" rel="noreferrer">
                DOI <ExternalLink size={13} aria-hidden="true" />
              </a>
            )}
            <a href={`https://openalex.org/${p.id}`} target="_blank" rel="noreferrer">
              OpenAlex <ExternalLink size={13} aria-hidden="true" />
            </a>
          </footer>
        </div>
      </div>
    </aside>
  );
}
