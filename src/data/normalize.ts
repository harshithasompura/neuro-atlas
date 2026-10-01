import type { OpenAlexWork } from "./openalex";

/** A work reduced to what the atlas needs, still keyed by string names (pre-dictionary). */
export interface NormalizedWork {
  id: string;
  title: string;
  year: number;
  date: string;
  citations: number;
  topic: { id: string; name: string; subfieldId: string; subfieldName: string };
  authors: string[];
  authorCount: number;
  institutions: string[];
  venue: string | null;
  doi: string | null;
  abstract: string | null;
  keywords: string[];
  landingPage: string | null;
}

/** The UI never shows em or en dashes; in OpenAlex text they become plain hyphens. */
export const deDash = (s: string) => s.replace(/\s*\u2014\s*/g, " - ").replace(/[\u2013\u2012\u2015]/g, "-");

const shortId = (url: string) => url.slice(url.lastIndexOf("/") + 1);

/** OpenAlex stores abstracts as { word: [positions] }. */
export function abstractFromInvertedIndex(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  const text = words.filter((w) => w !== undefined).join(" ").trim();
  return text.length > 0 ? text : null;
}

/** Returns null for works that can't be placed on the atlas (no title or no primary topic). */
export function normalizeWork(w: OpenAlexWork): NormalizedWork | null {
  const title = w.title?.trim();
  if (!title || !w.primary_topic) return null;

  const names = w.authorships.map((a) => a.author.display_name?.trim()).filter((n): n is string => Boolean(n));

  const instCount = new Map<string, number>();
  for (const a of w.authorships)
    for (const inst of new Set(a.institutions.map((i) => i.display_name?.trim()).filter((n): n is string => Boolean(n))))
      instCount.set(inst, (instCount.get(inst) ?? 0) + 1);
  const institutions = [...instCount].sort((a, b) => b[1] - a[1]).map(([n]) => n);

  return {
    id: shortId(w.id),
    title,
    year: w.publication_year,
    date: w.publication_date ?? `${w.publication_year}-01-01`,
    citations: w.cited_by_count,
    topic: {
      id: shortId(w.primary_topic.id),
      name: w.primary_topic.display_name,
      subfieldId: shortId(w.primary_topic.subfield.id),
      subfieldName: w.primary_topic.subfield.display_name,
    },
    authors: names,
    authorCount: names.length,
    institutions,
    venue: w.primary_location?.source?.display_name?.trim() || null,
    doi: w.doi ?? null,
    abstract: abstractFromInvertedIndex(w.abstract_inverted_index),
    keywords: (w.keywords ?? []).map((k) => k.display_name),
    landingPage: w.primary_location?.landing_page_url ?? null,
  };
}
