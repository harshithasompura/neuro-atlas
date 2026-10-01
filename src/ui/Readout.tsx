"use client";

import { useEffect, useRef } from "react";
import type { AtlasRenderer } from "@/viz/renderer";

/** Live viewport readout. Updates the DOM directly so panning never re-renders React. */
export function Readout({ renderer, total, visible }: { renderer: AtlasRenderer | null; total: number; visible: number }) {
  const zoom = useRef<HTMLSpanElement>(null);
  const view = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!renderer) return;
    const paint = () => {
      if (zoom.current) zoom.current.textContent = `${renderer.zoom.toFixed(renderer.zoom < 10 ? 1 : 0)}x`;
      if (view.current) view.current.textContent = renderer.stats.inView.toLocaleString("en-US");
    };
    paint();
    return renderer.subscribe(paint);
  }, [renderer]);

  return (
    <p className="readout mono" aria-label="Viewport readout">
      <span>
        <b>{visible.toLocaleString("en-US")}</b> of {total.toLocaleString("en-US")} shown
      </span>
      <span>
        <b ref={view}>-</b> in view
      </span>
      <span>
        zoom <b ref={zoom}>-</b>
      </span>
    </p>
  );
}
