"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "neuro-atlas-theme";
const MOTION_KEY = "neuro-atlas-motion";

const read = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });
  return () => mo.disconnect();
}

export const motionOn = () => document.documentElement.dataset.motion !== "off";

/** Whether animation is on. It starts from the system's reduced-motion setting; the top-bar switch overrides it. */
export const useMotion = (): boolean => useSyncExternalStore(subscribe, motionOn, () => true);

export function setMotion(on: boolean) {
  document.documentElement.dataset.motion = on ? "on" : "off";
  try {
    localStorage.setItem(MOTION_KEY, on ? "on" : "off");
  } catch {
    /* storage blocked: the choice just won't persist */
  }
}

/** True when the operating system asks for reduced motion (used to explain why animation starts off). */
export const systemReducesMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Current theme. Light is the default; dark is chosen with the toggle and remembered. */
export const useTheme = (): Theme => useSyncExternalStore(subscribe, read, () => "light");

export function setTheme(theme: Theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage blocked: the choice just won't persist */
  }
}

/** Runs before first paint (inlined in <head>) so a remembered dark choice never flashes the light theme. */
export const THEME_INIT = `try{var d=document.documentElement,s=localStorage;if(s.getItem("${KEY}")==="dark")d.dataset.theme="dark";var m=s.getItem("${MOTION_KEY}");d.dataset.motion=m==="off"||(m!=="on"&&matchMedia("(prefers-reduced-motion: reduce)").matches)?"off":"on"}catch(e){document.documentElement.dataset.motion="on"}`;
