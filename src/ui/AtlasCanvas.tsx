"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { zoomAt } from "@/viz/camera";
import type { AtlasModel } from "@/viz/model";
import { readSubfieldColors, readTokens, subfieldVar } from "@/viz/palette";
import { motionOn, useMotion, useTheme } from "./theme";
import { AtlasRenderer, type LabelHit } from "@/viz/renderer";

interface Props {
  model: AtlasModel;
  onReady: (r: AtlasRenderer | null) => void;
  onSelect: (i: number | null) => void;
  onLabel: (hit: LabelHit) => void;
  /** step through the selected paper's related papers: +1 next, -1 previous */
  onStep: (dir: 1 | -1) => void;
}

function placeCard(c: HTMLDivElement | null, box: HTMLElement, x: number, y: number) {
  if (!c) return;
  const w = c.offsetWidth || 280;
  const h = c.offsetHeight || 120;
  const left = x + 16 + w > box.clientWidth ? x - 16 - w : x + 16;
  const top = Math.min(Math.max(26, y + 14), box.clientHeight - h - 8);
  c.style.transform = `translate(${Math.max(26, left)}px, ${top}px)`;
}

/** Owns the <canvas>, its renderer and all pointer / keyboard navigation. */
export function AtlasCanvas({ model, onReady, onSelect, onLabel, onStep }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<AtlasRenderer | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const theme = useTheme();
  const motion = useMotion();
  const pos = useRef({ x: 0, y: 0 });
  const cb = useRef({ onSelect, onLabel });
  useEffect(() => {
    cb.current = { onSelect, onLabel };
  });
  useEffect(() => renderer?.set({ hover: hovered }), [renderer, hovered]);
  useEffect(() => renderer?.setMotion(motion), [renderer, motion]);
  useEffect(() => renderer?.retheme(readTokens(document.documentElement), readSubfieldColors(document.documentElement, model.atlas.subfields)), [renderer, theme, model.atlas.subfields]);

  useEffect(() => {
    const el = canvas.current!;
    const box = wrap.current!;
    const r = new AtlasRenderer(el, model, readTokens(document.documentElement), readSubfieldColors(document.documentElement, model.atlas.subfields), motionOn());
    const fit = () => {
      const { width, height } = box.getBoundingClientRect();
      if (width > 0 && height > 0) r.resize(width, height, window.devicePixelRatio || 1);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    fit();
    void document.fonts?.ready.then(() => r.invalidate());
    setRenderer(r);
    onReady(r);

    /* ---- pointer navigation ---- */
    const pts = new Map<number, { x: number; y: number }>();
    let press: { x: number; y: number; moved: boolean } | null = null;
    let pinch: { dist: number } | null = null;
    let hoverRaf = 0;
    let lastHover = -2;
    const local = (e: { clientX: number; clientY: number }) => {
      const b = el.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };

    const moveCard = (x: number, y: number) => {
      pos.current = { x, y };
      placeCard(card.current, box, x, y);
    };

    const onDown = (e: PointerEvent) => {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone (e.g. synthetic event); dragging still works without capture */
      }
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) press = { ...p, moved: false };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
        press = null;
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      const prev = pts.get(e.pointerId);
      if (prev) {
        pts.set(e.pointerId, p);
        if (pinch && pts.size === 2) {
          const [a, b] = [...pts.values()];
          const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          r.zoomBy(dist / pinch.dist, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
          pinch.dist = dist;
        } else if (press) {
          if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > 4) {
            press.moved = true;
            if (lastHover !== -1) setHovered(null);
            lastHover = -1;
          }
          if (press.moved) r.panPixels(p.x - prev.x, p.y - prev.y);
        }
      }
      if (e.pointerType === "mouse") {
        r.setPointer([p.x, p.y]);
        if (!press?.moved && !hoverRaf)
          hoverRaf = requestAnimationFrame(() => {
            hoverRaf = 0;
            const hit = r.hitTest(p.x, p.y);
            if (hit !== lastHover) {
              lastHover = hit;
              setHovered(hit >= 0 ? hit : null);
            }
            el.style.cursor = hit >= 0 || r.labelAt(p.x, p.y) ? "pointer" : press?.moved ? "grabbing" : "crosshair";
            moveCard(p.x, p.y);
          });
      }
    };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (press && !press.moved && pts.size === 0) {
        const hit = r.hitTest(p.x, p.y);
        const label = hit < 0 ? r.labelAt(p.x, p.y) : null;
        if (label) cb.current.onLabel(label);
        else cb.current.onSelect(hit >= 0 ? hit : null);
      }
      if (pts.size === 0) press = null;
    };
    const onLeave = () => {
      r.setPointer(null);
      lastHover = -2;
      setHovered(null);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      r.zoomBy(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0016)), p.x, p.y);
    };
    const onDouble = (e: MouseEvent) => {
      const p = local(e);
      r.flyTo(zoomAt(r.view, r.w, r.h, p.x, p.y, 2.2, r.fit.k * 0.7, r.fit.k * 90), 280);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDouble);
    return () => {
      cancelAnimationFrame(hoverRaf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDouble);
      r.dispose();
      setRenderer(null);
      onReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- renderer is created once per model
  }, [model]);

  // the card mounts after the hover state changes; place it before paint at the last pointer position
  useLayoutEffect(() => {
    if (hovered !== null && wrap.current) placeCard(card.current, wrap.current, pos.current.x, pos.current.y);
  }, [hovered]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!renderer) return;
    const step = e.shiftKey ? 240 : 80;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => renderer.panPixels(step, 0),
      ArrowRight: () => renderer.panPixels(-step, 0),
      ArrowUp: () => renderer.panPixels(0, step),
      ArrowDown: () => renderer.panPixels(0, -step),
      "+": () => renderer.flyTo({ ...renderer.view, k: renderer.view.k * 1.6 }, 200),
      "=": () => renderer.flyTo({ ...renderer.view, k: renderer.view.k * 1.6 }, 200),
      "-": () => renderer.flyTo({ ...renderer.view, k: renderer.view.k / 1.6 }, 200),
      "0": () => renderer.fitAll(),
      ".": () => onStep(1),
      ",": () => onStep(-1),
      Enter: () => {
        const i = renderer.nearestToCenter();
        if (i >= 0) onSelect(i);
      },
    };
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  };

  const p = hovered === null ? null : model.atlas.papers[hovered]!;
  const topic = p ? model.atlas.topics[p.topic]! : null;
  return (
    <div className="canvas-wrap" ref={wrap}>
      <canvas
        ref={canvas}
        tabIndex={0}
        role="application"
        aria-label={`Particle field of ${model.n.toLocaleString("en-US")} neuroscience papers inside a brain silhouette, placed by similarity of meaning. Arrow keys pan, plus and minus zoom, Enter selects the paper nearest the centre, period and comma step through related papers, zero fits the view.`}
        onKeyDown={onKey}
      />
      {p && topic && (
        <div className="hover" ref={card} aria-hidden="true">
          <p className="hover-title">{p.title}</p>
          <p className="mono hover-meta">
            {p.year} · {p.citations.toLocaleString("en-US")} {p.citations === 1 ? "cite" : "cites"} · {p.authorCount} {p.authorCount === 1 ? "author" : "authors"}
          </p>
          <p className="hover-topic">
            <i style={{ background: subfieldVar(model.atlas.subfields[topic.subfield]!.id) }} />
            {topic.name}
          </p>
          <p className="hover-by">
            {p.authors.slice(0, 3).join(", ")}
            {p.authorCount > 3 ? " et al." : ""}
          </p>
          {(p.institutions[0] !== undefined || p.venue >= 0) && (
            <p className="hover-by">{[p.venue >= 0 ? model.atlas.venues[p.venue] : null, p.institutions[0] !== undefined ? model.atlas.institutions[p.institutions[0]] : null].filter(Boolean).join(" · ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
