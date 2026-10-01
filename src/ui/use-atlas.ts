"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Atlas, PipelineEvent, Stage } from "@/data/types";

export interface StageProgress {
  done: number;
  total: number;
  message: string;
}

export type AtlasState =
  | { status: "loading"; stages: Partial<Record<Stage, StageProgress>>; startedAt: number }
  | { status: "ready"; atlas: Atlas }
  | { status: "error"; message: string };

const initial = (): AtlasState => ({ status: "loading", stages: {}, startedAt: Date.now() });

/** Loads the atlas from /api/atlas, which streams build progress (NDJSON) before the final result. */
export function useAtlas() {
  const [state, setState] = useState<AtlasState>(initial);

  const current = useRef<AbortController | null>(null);

  const load = useCallback(async (refresh: boolean, signal: AbortSignal) => {
    try {
      const res = await fetch(`/api/atlas${refresh ? "?refresh=1" : ""}`, { signal });
      if (!res.ok || !res.body) throw new Error(`Atlas request failed (HTTP ${res.status}).`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let got = false;

      const handle = (ev: PipelineEvent) => {
        if (ev.type === "progress") {
          setState((s) => (s.status === "loading" ? { ...s, stages: { ...s.stages, [ev.stage]: { done: ev.done, total: ev.total, message: ev.message } } } : s));
        } else if (ev.type === "result") {
          got = true;
          setState({ status: "ready", atlas: ev.atlas });
        } else {
          got = true;
          setState({ status: "error", message: ev.message });
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const text = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (text) handle(JSON.parse(text) as PipelineEvent);
        }
      }
      if (!got) throw new Error("The server closed the connection before sending an atlas.");
    } catch (e) {
      if (signal.aborted) return;
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const start = useCallback(
    (refresh: boolean) => {
      current.current?.abort();
      const ac = new AbortController();
      current.current = ac;
      void load(refresh, ac.signal);
    },
    [load],
  );

  useEffect(() => {
    // external fetch on mount; state is only set after awaited network events
    // eslint-disable-next-line react-hooks/set-state-in-effect
    start(false);
    return () => current.current?.abort();
  }, [start]);

  const retry = useCallback(
    (refresh = true) => {
      setState(initial());
      start(refresh);
    },
    [start],
  );
  return { state, retry };
}
