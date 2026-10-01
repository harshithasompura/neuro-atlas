"use client";

import { useEffect, useRef, useState } from "react";
import { motionOn } from "./theme";

/** A number that counts to its new value instead of jumping, so a change in the data reads as a change. */
export function Num({ value, ms = 360, plain = false }: { value: number; ms?: number; plain?: boolean }) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    if (current.current === value) return;
    const from = current.current;
    const t0 = performance.now();
    const duration = motionOn() ? ms : 0;
    let raf = 0;
    const step = (t: number) => {
      const p = duration === 0 ? 1 : Math.min(1, (t - t0) / duration);
      current.current = Math.round(from + (value - from) * (1 - (1 - p) ** 3));
      setShown(current.current);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);

  return <>{plain ? String(shown) : shown.toLocaleString("en-US")}</>;
}
