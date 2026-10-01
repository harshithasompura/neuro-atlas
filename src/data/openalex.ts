import { z } from "zod";

/**
 * OpenAlex client. Behaviour follows the OpenAlex docs:
 *  - base https://api.openalex.org, optional `api_key` query param (free key = 10x daily budget)
 *  - `per_page` max 100, `sample` max 10,000 (+ `seed` for reproducible paging),
 *    page * per_page must stay <= 10,000
 *  - 429 = rate limit or daily credit budget; 5xx = retry with exponential backoff; other 4xx do not retry
 *  - `select` accepts top-level fields only
 */

export const OPENALEX_BASE = "https://api.openalex.org";
export const PER_PAGE = 100;
export const MAX_SAMPLE = 10_000;

export const WORKS_SELECT = [
  "id",
  "doi",
  "title",
  "publication_year",
  "publication_date",
  "cited_by_count",
  "type",
  "primary_topic",
  "authorships",
  "primary_location",
  "abstract_inverted_index",
  "keywords",
].join(",");

const nameRef = z.object({ display_name: z.string().nullish() });

export const workSchema = z.object({
  id: z.string(),
  doi: z.string().nullish(),
  title: z.string().nullish(),
  publication_year: z.number(),
  publication_date: z.string().nullish(),
  cited_by_count: z.number(),
  type: z.string().nullish(),
  primary_topic: z
    .object({
      id: z.string(),
      display_name: z.string(),
      subfield: z.object({ id: z.string(), display_name: z.string() }),
    })
    .nullish(),
  authorships: z.array(z.object({ author: nameRef, institutions: z.array(nameRef) })).default([]),
  primary_location: z
    .object({ landing_page_url: z.string().nullish(), source: nameRef.nullish() })
    .nullish(),
  abstract_inverted_index: z.record(z.string(), z.array(z.number())).nullish(),
  keywords: z.array(z.object({ display_name: z.string() })).nullish(),
});

export type OpenAlexWork = z.infer<typeof workSchema>;

const envelope = z.object({
  meta: z.object({ count: z.number() }),
  results: z.array(z.unknown()).default([]),
  group_by: z.array(z.object({ key: z.string(), count: z.number() })).default([]),
});

export class OpenAlexError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly budgetExhausted = false,
  ) {
    super(message);
    this.name = "OpenAlexError";
  }
}

export interface ClientOptions {
  apiKey?: string;
  /** called with the credits OpenAlex reports as remaining after each request */
  onCredits?: (remaining: number) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(path: string, params: Record<string, string>, opts: ClientOptions): Promise<z.infer<typeof envelope>> {
  const url = new URL(path, OPENALEX_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (opts.apiKey) url.searchParams.set("api_key", opts.apiKey);

  const maxAttempts = 5;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(2 ** attempt * 500);
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      lastError = e;
      continue;
    }
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    if (Number.isFinite(remaining) && res.headers.has("x-ratelimit-remaining")) opts.onCredits?.(remaining);

    if (res.ok) {
      const parsed = envelope.safeParse(await res.json());
      if (!parsed.success) throw new OpenAlexError(`Unexpected OpenAlex response shape: ${parsed.error.message}`);
      return parsed.data;
    }
    if (res.status === 429) {
      const exhausted = res.headers.get("x-ratelimit-remaining") === "0";
      if (exhausted) {
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        const when = Number.isFinite(reset) ? ` Budget resets in ~${Math.ceil(reset / 60)} min.` : "";
        throw new OpenAlexError(`OpenAlex daily credit budget exhausted.${when} Set OPENALEX_API_KEY for a 10x budget.`, 429, true);
      }
      lastError = new OpenAlexError("OpenAlex rate limit (429)", 429);
      continue;
    }
    if (res.status >= 500) {
      lastError = new OpenAlexError(`OpenAlex server error (${res.status})`, res.status);
      continue;
    }
    const detail = await res.text().catch(() => "");
    throw new OpenAlexError(`OpenAlex rejected the request (${res.status}): ${detail.slice(0, 300)}`, res.status);
  }
  throw lastError instanceof OpenAlexError
    ? lastError
    : new OpenAlexError(`OpenAlex unreachable after ${maxAttempts} attempts: ${String(lastError)}`);
}

export interface Pool {
  count: number;
  byYear: { year: number; count: number }[];
  bySubfield: { id: string; count: number }[];
}

/** Size and composition of the full (unsampled) pool the sample is drawn from. 3 requests. */
export async function fetchPool(filter: string, opts: ClientOptions): Promise<Pool> {
  const [total, years, subfields] = await Promise.all([
    request("/works", { filter, per_page: "1" }, opts),
    request("/works", { filter, group_by: "publication_year" }, opts),
    request("/works", { filter, group_by: "primary_topic.subfield.id" }, opts),
  ]);
  return {
    count: total.meta.count,
    byYear: years.group_by.map((g) => ({ year: Number(g.key), count: g.count })).sort((a, b) => a.year - b.year),
    bySubfield: subfields.group_by.map((g) => ({ id: g.key.split("/").pop() ?? g.key, count: g.count })),
  };
}

export interface SamplePage {
  works: OpenAlexWork[];
  /** records that failed schema validation */
  invalid: number;
}

/** One page of a seeded uniform random sample of the filtered pool. */
export async function fetchSamplePage(
  filter: string,
  sampleSize: number,
  seed: number,
  page: number,
  opts: ClientOptions,
): Promise<SamplePage> {
  if (sampleSize > MAX_SAMPLE) throw new OpenAlexError(`sample size ${sampleSize} exceeds the OpenAlex maximum of ${MAX_SAMPLE}`);
  const body = await request(
    "/works",
    { filter, sample: String(sampleSize), seed: String(seed), per_page: String(PER_PAGE), page: String(page), select: WORKS_SELECT },
    opts,
  );
  const works: OpenAlexWork[] = [];
  let invalid = 0;
  for (const raw of body.results) {
    const parsed = workSchema.safeParse(raw);
    if (parsed.success) works.push(parsed.data);
    else invalid++;
  }
  return { works, invalid };
}
