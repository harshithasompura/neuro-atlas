/**
 * Colour = OpenAlex subfield. The eight inks live in CSS as --sf-<subfield id>, one set per theme: the
 * validated categorical palette from the dataviz skill (blue, orange, green, violet, aqua, magenta, red, yellow;
 * every adjacent pair clears the normal-vision and colour-blind floors), stepped for each surface. Assignment is
 * by taxonomy id, so a subfield keeps its colour under any filter, and the largest subfields get the strongest
 * hues. Labels, the legend and spatial grouping carry identity too, never colour alone.
 */
export const subfieldVar = (id: string) => `var(--sf-${id}, var(--sf-fallback))`;

export interface Tokens {
  bg: string;
  fg: string;
  fg2: string;
  fg3: string;
  line: string;
  accent: string;
  display: string;
  mono: string;
}

/** Canvas can't read CSS classes, so pull the same custom properties the DOM uses. */
export function readTokens(el: HTMLElement): Tokens {
  const s = getComputedStyle(el);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--bg", "#fff7f0"),
    fg: v("--fg", "#1a1210"),
    fg2: v("--fg-2", "#5b4a42"),
    fg3: v("--fg-3", "#6e5a4f"),
    line: v("--line", "rgba(48,28,18,0.13)"),
    accent: v("--accent", "#1a1210"),
    display: v("--font-display", "system-ui, sans-serif"),
    mono: v("--font-mono", "ui-monospace, monospace"),
  };
}

export function readSubfieldColors(el: HTMLElement, subfields: { id: string }[]): string[] {
  const s = getComputedStyle(el);
  const fallback = s.getPropertyValue("--sf-fallback").trim() || "#6e5a4f";
  return subfields.map((sf) => s.getPropertyValue(`--sf-${sf.id}`).trim() || fallback);
}
