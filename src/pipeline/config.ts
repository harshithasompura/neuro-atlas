import { z } from "zod";
import { OUTLINE } from "../data/brain";
import { MAX_SAMPLE, PER_PAGE, WORKS_SELECT } from "../data/openalex";
import { hash } from "./cache";

/** OpenAlex taxonomy: field 28 = Neuroscience. Primary topic must sit in that field. */
export const FILTER = "primary_topic.field.id:28,publication_year:2015-2026,has_abstract:true,type:article|review";
export const YEAR_RANGE: [number, number] = [2015, 2026];

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIMS = 384;
export const NEIGHBORS_K = 8;
export const LAYOUT = { method: "UMAP (umap-js, cosine)", nNeighbors: 15, minDist: 0.15, epochs: 400 } as const;

/** Bump when the shape or meaning of the cached atlas changes. */
export const SCHEMA_VERSION = 4;

const env = z.object({
  OPENALEX_API_KEY: z.string().trim().min(1).optional(),
  ATLAS_SAMPLE_SIZE: z.coerce.number().int().min(500).max(MAX_SAMPLE).default(8000),
  ATLAS_SEED: z.coerce.number().int().default(7),
});

export interface BuildConfig {
  sampleSize: number;
  seed: number;
  apiKey: string | undefined;
}

export function readConfig(source: NodeJS.ProcessEnv = process.env): BuildConfig {
  const e = env.parse({
    OPENALEX_API_KEY: source.OPENALEX_API_KEY || undefined,
    ATLAS_SAMPLE_SIZE: source.ATLAS_SAMPLE_SIZE || undefined,
    ATLAS_SEED: source.ATLAS_SEED || undefined,
  });
  return { sampleSize: e.ATLAS_SAMPLE_SIZE, seed: e.ATLAS_SEED, apiKey: e.OPENALEX_API_KEY };
}

/** Identifies the fetch (which works are in the sample). The API key is not part of it. */
export const pagesKey = (cfg: BuildConfig) =>
  hash({ FILTER, select: WORKS_SELECT, perPage: PER_PAGE, sample: cfg.sampleSize, seed: cfg.seed });

/** Identifies the whole atlas: sample + embedding model + layout parameters + schema. */
export const configKey = (cfg: BuildConfig) =>
  hash({ pages: pagesKey(cfg), EMBED_MODEL, LAYOUT, NEIGHBORS_K, SCHEMA_VERSION, silhouette: hash(OUTLINE) });
