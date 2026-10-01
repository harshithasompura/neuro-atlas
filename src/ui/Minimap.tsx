"use client";

import { useEffect, useRef } from "react";
import type { AtlasModel } from "@/viz/model";
import { readSubfieldColors, readTokens } from "@/viz/palette";
import { useTheme } from "./theme";
import type { AtlasRenderer } from "@/viz/renderer";

const W = 176;
const H = 118;
const PAD = 8;

/** Whole-brain overview with the viewport outlined. Appears once you have zoomed in; click to move the viewport. */
export function Minimap({ model, renderer, active, selected }: { model: AtlasModel; renderer: AtlasRenderer | null; active: Uint8Array; selected: number | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLCanvasElement | null>(null);
  const theme = useTheme();
  const b = model.bounds;
  const scale = Math.min((W - PAD * 2) / (b.maxX - b.minX), (H - PAD * 2) / (b.maxY - b.minY));
  const ox = W / 2 - ((b.minX + b.maxX) / 2) * scale;
  const oy = H / 2 - ((b.minY + b.maxY) / 2) * scale;

  // static layer: redrawn only when the filter changes
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const c = document.createElement("canvas");
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const tk = readTokens(document.documentElement);
    const colors = readSubfieldColors(document.documentElement, model.atlas.subfields);
    for (const pass of [0, 1]) {
      for (let i = 0; i < model.n; i++) {
        if (active[i] !== pass) continue;
        ctx.globalAlpha = pass ? 0.85 : 0.18;
        ctx.fillStyle = pass ? colors[model.sub[i]!]! : tk.fg3;
        ctx.fillRect(model.xs[i]! * scale + ox - 0.5, model.ys[i]! * scale + oy - 0.5, 1.2, 1.2);
      }
    }
    layer.current = c;
    ref.current?.dispatchEvent(new Event("repaint"));
  }, [model, active, scale, ox, oy, theme]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !renderer) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = W * dpr;
    el.height = H * dpr;
    const ctx = el.getContext("2d")!;
    const tk = readTokens(document.documentElement);
    const paint = () => {
      wrap.current?.setAttribute("data-visible", String(renderer.zoom > 1.35));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = tk.bg;
      ctx.fillRect(0, 0, W, H);
      if (layer.current) ctx.drawImage(layer.current, 0, 0, W, H);
      const v = renderer.view;
      const hw = renderer.w / v.k / 2;
      const hh = renderer.h / v.k / 2;
      ctx.strokeStyle = tk.fg;
      ctx.lineWidth = 1;
      ctx.strokeRect((v.cx - hw) * scale + ox, (v.cy - hh) * scale + oy, hw * 2 * scale, hh * 2 * scale);
      if (selected !== null) {
        const [sx, sy] = [model.xs[selected]! * scale + ox, model.ys[selected]! * scale + oy];
        ctx.strokeStyle = tk.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    paint();
    el.addEventListener("repaint", paint);
    const off = renderer.subscribe(paint);
    return () => {
      off();
      el.removeEventListener("repaint", paint);
    };
  }, [renderer, model, selected, scale, ox, oy, theme]);

  const go = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!renderer || (e.type === "pointermove" && e.buttons === 0)) return;
    const r = e.currentTarget.getBoundingClientRect();
    renderer.flyTo({ ...renderer.view, cx: (e.clientX - r.left - ox) / scale, cy: (e.clientY - r.top - oy) / scale }, 0);
  };

  return (
    <div className="minimap" ref={wrap} data-visible="false">
      <canvas ref={ref} style={{ width: W, height: H }} onPointerDown={go} onPointerMove={go} role="img" aria-label="Overview of the whole brain with the current viewport outlined. Click to move the viewport." />
    </div>
  );
}
