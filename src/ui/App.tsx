"use client";

import { CircleHelp, Moon, PanelLeft, Sun, Waves } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Atlas } from "@/data/types";
import { computeSelection } from "@/viz/filters";
import { buildModel } from "@/viz/model";
import type { AtlasRenderer, LabelHit } from "@/viz/renderer";
import { AtlasCanvas } from "./AtlasCanvas";
import { Boot } from "./Boot";
import { Detail } from "./Detail";
import { Minimap } from "./Minimap";
import { Rail } from "./Rail";
import { Readout } from "./Readout";
import { Search } from "./Search";
import { Shortcuts } from "./Shortcuts";
import { motionOn, setMotion, setTheme, systemReducesMotion, useMotion, useTheme } from "./theme";
import { TimeStream } from "./TimeStream";
import { useAtlas } from "./use-atlas";

const NARROW = "(max-width: 820px), (max-height: 540px)";
const subscribeNarrow = (cb: () => void) => {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function App() {
  const { state, retry } = useAtlas();
  if (state.status !== "ready") return <Boot state={state} onRetry={() => retry(true)} />;
  return <Explorer atlas={state.atlas} onRebuild={() => retry(true)} />;
}

function Explorer({ atlas, onRebuild }: { atlas: Atlas; onRebuild: () => void }) {
  const model = useMemo(() => buildModel(atlas), [atlas]);
  const years = model.years;
  const full: [number, number] = useMemo(() => [years[0]!, years[years.length - 1]!], [years]);

  const [range, setRange] = useState<[number, number]>(full);
  const [subs, setSubs] = useState<ReadonlySet<number>>(new Set());
  const [topic, setTopic] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [peek, setPeek] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [railToggled, setRailToggled] = useState(false);
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
  const [help, setHelp] = useState(false);
  const [renderer, setRenderer] = useState<AtlasRenderer | null>(null);
  const theme = useTheme();
  const motion = useMotion();
  const searchInput = useRef<HTMLInputElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const trail = useRef<{ origin: number; at: number } | null>(null);
  /** on narrow screens the rail is a drawer that closes after a choice; on wide screens it stays as the user left it */
  const closeDrawer = useCallback(() => {
    if (narrow) setRailToggled(false);
  }, [narrow]);

  // the mobile drawer starts right under the top bar, whatever height that ends up being
  useEffect(() => {
    const app = appRef.current;
    const top = app?.querySelector(".top");
    if (!app || !top) return;
    const measure = () => app.style.setProperty("--top-bottom", `${Math.round(top.getBoundingClientRect().bottom)}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(top);
    return () => ro.disconnect();
  }, []);

  const deferredQuery = useDeferredValue(query);
  const selection = useMemo(() => computeSelection(model, { from: range[0], to: range[1], subfields: subs, topic, query: deferredQuery }), [model, range, subs, topic, deferredQuery]);

  // push filter + selection state into the particle renderer
  useEffect(() => {
    renderer?.set({ active: selection.active, matches: selection.matches, matchCount: selection.matchCount, selected: closing ? null : selected, peek });
  }, [renderer, selection, selected, closing, peek]);

  // year-by-year sweep: slow enough for the particles to settle before the next year
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setRange(([a, b]) => {
        const next = a === b ? a + 1 : years[0]!;
        if (next > years[years.length - 1]!) {
          setPlaying(false);
          return full;
        }
        return [next, next];
      });
    }, 1400);
    return () => clearInterval(id);
  }, [playing, years, full]);

  const togglePlay = useCallback(() => {
    if (!playing) setRange([years[0]!, years[0]!]);
    setPlaying(!playing);
  }, [playing, years]);

  const changeRange = useCallback((r: [number, number]) => {
    setPlaying(false);
    setRange((prev) => (prev[0] === r[0] && prev[1] === r[1] ? prev : r)); // dragging within one year must not re-render
  }, []);

  const clearFilters = useCallback(() => {
    setSubs(new Set());
    setTopic(null);
    setRange(full);
    setPlaying(false);
  }, [full]);

  const toggleSub = useCallback(
    (s: number) =>
      setSubs((prev) => {
        const next = new Set(prev);
        if (next.has(s)) next.delete(s);
        else next.add(s);
        return next;
      }),
    [],
  );

  /** Select a paper; if the active filters would hide it, relax exactly the ones that do. */
  const pickPaper = useCallback(
    (i: number, focus = true, stepping = false) => {
      const y = model.year[i]!;
      if (y < range[0] || y > range[1]) setRange([Math.min(range[0], y), Math.max(range[1], y)]);
      if (subs.size && !subs.has(model.sub[i]!)) setSubs(new Set([...subs, model.sub[i]!]));
      if (topic !== null && topic !== model.topic[i]) setTopic(null);
      if (!stepping) trail.current = null;
      setClosing(false);
      setSelected(i);
      closeDrawer();
      // on narrow screens the detail sheet covers the lower half of the map, so keep the paper in the upper part
      if (focus) renderer?.focusPoint(i, stepping && renderer ? renderer.zoom : 7, narrow ? 0.27 : 0.5);
      else if (narrow && renderer) renderer.focusPoint(i, renderer.zoom, 0.27);
    },
    [model, range, subs, topic, renderer, closeDrawer, narrow],
  );

  const stepRelated = useCallback(
    (dir: 1 | -1) => {
      if (selected === null) return;
      const t = trail.current ?? { origin: selected, at: -1 };
      const list = atlas.papers[t.origin]!.neighbors;
      const at = (t.at + dir + list.length) % list.length;
      trail.current = { origin: t.origin, at };
      pickPaper(list[at]!, true, true);
    },
    [atlas.papers, selected, pickPaper],
  );

  const pickTopic = useCallback(
    (t: number | null) => {
      setTopic(t);
      closeDrawer();
      if (t !== null) renderer?.focusTopic(t);
      else renderer?.fitAll();
    },
    [renderer, closeDrawer],
  );

  const onLabel = useCallback(
    (hit: LabelHit) => {
      if (hit.kind === "topic") pickTopic(hit.id);
      else toggleSub(hit.id);
    },
    [pickTopic, toggleSub],
  );

  const requestClose = useCallback(() => {
    if (!motionOn()) setSelected(null);
    else setClosing(true);
  }, []);

  // keyboard: "/" focuses search, "?" opens the key sheet, Escape peels back one layer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchInput.current?.focus();
      } else if (e.key === "?") {
        setHelp(true);
      } else if (e.key === "Escape") {
        if (selected !== null && !closing) requestClose();
        else if (query) setQuery("");
        else if (subs.size || topic !== null || range[0] !== full[0] || range[1] !== full[1]) clearFilters();
        else closeDrawer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, closing, query, subs, topic, range, full, clearFilters, requestClose, closeDrawer]);

  const { meta } = atlas;
  const sel = selected !== null ? atlas.papers[selected]! : null;

  return (
    <div className="app" ref={appRef} data-detail={sel ? "open" : "closed"} data-rail={railToggled && !narrow ? "hidden" : "shown"} data-searching={searching}>
      <a className="skip" href="#field">
        Skip to the map
      </a>
      <header className="top">
        <button
          className="icon-btn rail-toggle"
          onClick={() => setRailToggled((t) => !t)}
          aria-expanded={narrow ? railToggled : !railToggled}
          aria-controls="rail"
          aria-label="Toggle filters panel"
        >
          <PanelLeft size={18} />
        </button>
        <div className="brand">
          <span className="brand-name">
            <i aria-hidden="true" /> Neuro Atlas
          </span>
          <span className="brand-meta mono">
            {model.n.toLocaleString("en-US")} of {meta.poolCount.toLocaleString("en-US")} works, {meta.source.yearRange[0]} to {meta.source.yearRange[1]}
          </span>
        </div>
        <Search model={model} query={query} onQuery={setQuery} onPickPaper={pickPaper} onPickTopic={pickTopic} onPeek={setPeek} onFocusChange={setSearching} inputRef={searchInput} />
        <button
          className="icon-btn"
          onClick={() => setMotion(!motion)}
          aria-pressed={motion}
          aria-label={motion ? "Animation is on. Turn it off" : systemReducesMotion() ? "Animation is off because your system asks for reduced motion. Turn it on" : "Animation is off. Turn it on"}
          title={motion ? "Animation on" : "Animation off"}
        >
          <Waves size={18} className="motion-icon" data-on={motion} />
        </button>
        <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="icon-btn" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts">
          <CircleHelp size={18} />
        </button>
      </header>

      {meta.partial && (
        <div className="partial mono" role="status">
          Partial data: {meta.partial.received.toLocaleString("en-US")} of {meta.partial.requested.toLocaleString("en-US")} requested works. {meta.partial.reason}
          <button className="link" onClick={onRebuild}>
            Retry missing pages
          </button>
        </div>
      )}

      <div id="rail" className="rail-slot" data-open={railToggled}>
        <Rail model={model} range={range} subs={subs} topic={topic} active={selection.active} onToggleSub={toggleSub} onClear={clearFilters} onTopic={pickTopic} onRebuild={onRebuild} />
      </div>

      <main className="stage" id="field">
        <AtlasCanvas model={model} onReady={setRenderer} onSelect={(i) => (i === null ? (selected !== null && requestClose()) : pickPaper(i, false))} onLabel={onLabel} onStep={stepRelated} />
        <Readout renderer={renderer} total={model.n} visible={selection.activeCount} />
        <div className="minimap-slot">
          <Minimap model={model} renderer={renderer} active={selection.active} selected={selected} />
        </div>
        {selection.activeCount === 0 && (
          <div className="empty" role="status">
            <h2>Nothing in this selection</h2>
            <p>The years, subfield and topic filters leave no papers.</p>
            <button className="btn btn-accent" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
        {query.trim() && selection.matchCount === 0 && selection.activeCount > 0 && (
          <div className="no-match mono" role="status">
            No loaded paper matches &ldquo;{query.trim()}&rdquo;. The map is unchanged.
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {sel ? `Selected: ${sel.title}, ${sel.year}, ${sel.citations} citations.` : `${selection.activeCount} papers shown.`}
        </p>
      </main>

      <TimeStream model={model} range={range} subs={subs} topic={topic} playing={playing} onRange={changeRange} onPlay={togglePlay} visible={selection.activeCount} />

      {sel && selected !== null && (
        <Detail
          model={model}
          renderer={renderer}
          index={selected}
          active={selection.active}
          closing={closing}
          onClose={requestClose}
          onClosed={() => {
            setSelected(null);
            setClosing(false);
          }}
          onPick={(i) => pickPaper(i)}
        />
      )}

      <Shortcuts open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
