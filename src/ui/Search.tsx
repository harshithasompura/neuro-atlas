"use client";

import { Search as SearchIcon, X } from "lucide-react";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { searchAtlas } from "@/viz/filters";
import type { AtlasModel } from "@/viz/model";
import { subfieldVar } from "@/viz/palette";

interface Props {
  model: AtlasModel;
  query: string;
  onQuery: (q: string) => void;
  onPickPaper: (i: number) => void;
  onPickTopic: (t: number) => void;
  /** the result the user is pointing at, so the map can mark where it lives */
  onPeek: (i: number | null) => void;
  onFocusChange: (focused: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

type Row = { kind: "topic" | "paper"; index: number };

export function Search({ model, query, onQuery, onPickPaper, onPickTopic, onPeek, onFocusChange, inputRef }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const deferred = useDeferredValue(query);
  const hits = useMemo(() => searchAtlas(model, deferred), [model, deferred]);
  const wrap = useRef<HTMLDivElement>(null);

  const rows: Row[] = [...hits.topics.map((index) => ({ kind: "topic" as const, index })), ...hits.papers.map((index) => ({ kind: "paper" as const, index }))];
  const showList = open && query.trim().length > 0;
  const current = showList ? rows[cursor] : undefined;

  useEffect(() => {
    onPeek(current?.kind === "paper" ? current.index : null);
  }, [current?.kind, current?.index, onPeek]);

  const pick = (r: Row) => {
    setOpen(false);
    inputRef.current?.blur(); // hand the screen back to the map and the panels
    if (r.kind === "paper") onPickPaper(r.index);
    else onPickTopic(r.index);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => Math.min(rows.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      pick(current);
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else onQuery("");
      e.stopPropagation();
    }
  };

  return (
    <div
      className="search"
      ref={wrap}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget)) {
          setOpen(false);
          onFocusChange(false);
        }
      }}
    >
      <label className="search-box">
        <SearchIcon size={16} aria-hidden="true" />
        <span className="sr-only">Search papers, authors, institutions and topics</span>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={showList}
          aria-controls={`${id}-list`}
          aria-activedescendant={current ? `${id}-${cursor}` : undefined}
          aria-autocomplete="list"
          value={query}
          placeholder={`Search ${model.n.toLocaleString("en-US")} papers, authors, topics`}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            onQuery(e.target.value);
            setOpen(true);
            setCursor(0);
          }}
          onFocus={() => {
            setOpen(true);
            onFocusChange(true);
          }}
          onKeyDown={onKey}
        />
        {query ? (
          <>
            <span className="mono search-count" aria-live="polite">
              {hits.paperTotal.toLocaleString("en-US")} {hits.paperTotal === 1 ? "match" : "matches"}
            </span>
            <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => (onQuery(""), inputRef.current?.focus())}>
              <X size={15} />
            </button>
          </>
        ) : (
          <kbd className="kbd-hint" aria-hidden="true">
            /
          </kbd>
        )}
      </label>
      {showList && (
        <ul className="results" role="listbox" id={`${id}-list`} aria-label="Search results">
          {rows.length === 0 && (
            <li className="results-empty" role="presentation">
              <b>No match in the loaded sample</b>
              <span className="mono">Nothing for &ldquo;{query.trim()}&rdquo;. The map is unchanged.</span>
            </li>
          )}
          {rows.map((r, i) => {
            const paper = r.kind === "paper" ? model.atlas.papers[r.index]! : null;
            const topic = r.kind === "topic" ? model.atlas.topics[r.index]! : null;
            const sub = topic ? topic.subfield : paper ? model.sub[r.index]! : 0;
            return (
              <li
                key={`${r.kind}${r.index}`}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === cursor}
                data-active={i === cursor}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
                onMouseEnter={() => setCursor(i)}
              >
                <i className="swatch" style={{ background: subfieldVar(model.atlas.subfields[sub]!.id) }} />
                <span className="result-label">{paper ? paper.title : topic!.name}</span>
                <span className="mono result-meta">{paper ? `${paper.year} · ${paper.citations.toLocaleString("en-US")} ${paper.citations === 1 ? "cite" : "cites"}` : `topic · ${model.topicCount[r.index]} papers`}</span>
              </li>
            );
          })}
          {hits.paperTotal > hits.papers.length && (
            <li className="results-more mono" role="presentation">
              +{(hits.paperTotal - hits.papers.length).toLocaleString("en-US")} more. Everything else on the map is dimmed.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
