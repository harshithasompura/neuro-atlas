import { readFile } from "node:fs/promises";
import { OPENALEX_BASE, OpenAlexError, PER_PAGE, fetchPool, fetchSamplePage, type Pool } from "../data/openalex";
import { deDash, normalizeWork, type NormalizedWork } from "../data/normalize";
import type { Atlas, Paper, Stage, WorkDetail } from "../data/types";
import { cachePath, hash, readJson, writeAtomic, writeJson } from "./cache";
import { EMBED_DIMS, EMBED_MODEL, FILTER, LAYOUT, NEIGHBORS_K, YEAR_RANGE, configKey, pagesKey, type BuildConfig } from "./config";
import { embed, embeddingText } from "./embed";
import { knn } from "./knn";
import { layout } from "./layout";
import { neighbourhoodPreservation, warpToLattice } from "./warp";

const round3 = (v: number) => Math.round(v * 1e3) / 1e3;

export type Emit = (stage: Stage, done: number, total: number, message: string) => void;

interface CachedPage {
  works: NormalizedWork[];
  invalid: number;
}

const MIN_WORKS = 500;
const FETCH_CONCURRENCY = 3;

async function loadPool(cfg: BuildConfig, emit: Emit): Promise<Pool> {
  const file = cachePath(`pool-${pagesKey(cfg)}.json`);
  const cached = await readJson<Pool>(file);
  if (cached) {
    emit("pool", 1, 1, `${cached.count.toLocaleString("en-US")} works in pool (cached)`);
    return cached;
  }
  emit("pool", 0, 1, "counting the OpenAlex pool");
  const pool = await fetchPool(FILTER, { apiKey: cfg.apiKey });
  await writeJson(file, pool);
  emit("pool", 1, 1, `${pool.count.toLocaleString("en-US")} works in pool`);
  return pool;
}

/** Fetches (or resumes fetching) the seeded sample, one cached file per page. */
async function loadPages(cfg: BuildConfig, emit: Emit) {
  const pages = Math.ceil(cfg.sampleSize / PER_PAGE);
  const dir = `pages-${pagesKey(cfg)}`;
  const results = new Map<number, CachedPage>();
  let credits: number | null = null;
  let failure: string | null = null;
  let next = 1;
  let done = 0;

  const worker = async () => {
    while (!failure) {
      const page = next++;
      if (page > pages) return;
      const file = cachePath(dir, `${page}.json`);
      let entry = await readJson<CachedPage>(file);
      if (!entry) {
        try {
          const raw = await fetchSamplePage(FILTER, cfg.sampleSize, cfg.seed, page, {
            apiKey: cfg.apiKey,
            onCredits: (n) => (credits = n),
          });
          const normalized = raw.works.map(normalizeWork);
          entry = {
            works: normalized.filter((w): w is NormalizedWork => w !== null),
            invalid: raw.invalid + normalized.filter((w) => w === null).length,
          };
          await writeJson(file, entry);
        } catch (e) {
          failure = e instanceof OpenAlexError ? e.message : String(e);
          return;
        }
      }
      results.set(page, entry);
      emit("fetch", ++done, pages, `page ${done}/${pages}${credits === null ? "" : ` · ${credits} credits left`}`);
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  return { results, pages, failure };
}

function assemble(works: NormalizedWork[], xy: Float32Array, nn: ReturnType<typeof knn>, fidelity: Atlas["meta"]["layout"]["fidelity"], cell: number, extra: Pick<Atlas["meta"], "source" | "poolCount" | "poolByYear" | "poolBySubfield" | "partial" | "skipped" | "configKey">) {
  const subfieldIndex = new Map<string, number>();
  const topicIndex = new Map<string, number>();
  const instIndex = new Map<string, number>();
  const venueIndex = new Map<string, number>();
  const subfields: Atlas["subfields"] = [];
  const topics: Atlas["topics"] = [];
  const institutions: string[] = [];
  const venues: string[] = [];
  const intern = (map: Map<string, number>, key: string, add: () => void) => {
    let i = map.get(key);
    if (i === undefined) {
      i = map.size;
      map.set(key, i);
      add();
    }
    return i;
  };

  const details: Record<string, WorkDetail> = {};
  const papers: Paper[] = works.map((raw, i) => {
    const w = cleanWork(raw);
    const sf = intern(subfieldIndex, w.topic.subfieldId, () => subfields.push({ id: w.topic.subfieldId, name: w.topic.subfieldName }));
    const topic = intern(topicIndex, w.topic.id, () => topics.push({ id: w.topic.id, name: w.topic.name, subfield: sf }));
    const inst = w.institutions.slice(0, 3).map((n) => intern(instIndex, n, () => institutions.push(n)));
    const venue = w.venue ? intern(venueIndex, w.venue, () => venues.push(w.venue as string)) : -1;
    details[w.id] = { abstract: w.abstract, keywords: w.keywords, authors: w.authors, institutions: w.institutions, landingPage: w.landingPage };
    const row = nn.idx.subarray(i * nn.k, (i + 1) * nn.k);
    return {
      id: w.id,
      title: w.title,
      year: w.year,
      date: w.date,
      citations: w.citations,
      topic,
      authors: w.authors.slice(0, 4),
      authorCount: w.authorCount,
      institutions: inst,
      venue,
      doi: w.doi,
      x: Math.round(xy[i * 2]! * 1e4) / 1e4,
      y: Math.round(xy[i * 2 + 1]! * 1e4) / 1e4,
      neighbors: Array.from(row),
      neighborSim: Array.from(nn.sim.subarray(i * nn.k, (i + 1) * nn.k), (s) => Math.round(s * 1e3) / 1e3),
    };
  });

  // stable colour order: subfields sorted by OpenAlex id; remap indexes
  const order = subfields.map((_, i) => i).sort((a, b) => Number(subfields[a]!.id) - Number(subfields[b]!.id));
  const remap = new Map(order.map((old, now) => [old, now]));
  const sortedSubfields = order.map((i) => subfields[i]!);
  for (const t of topics) t.subfield = remap.get(t.subfield)!;

  const atlas: Atlas = {
    meta: {
      ...extra,
      builtAt: new Date().toISOString(),
      embedding: { model: EMBED_MODEL, dims: EMBED_DIMS, textFields: "title + abstract (first 1,100 chars)" },
      layout: { method: LAYOUT.method, nNeighbors: LAYOUT.nNeighbors, minDist: LAYOUT.minDist, epochs: LAYOUT.epochs, seed: extra.source.seed, silhouette: "stylised lateral brain, square dot matrix", cell, fidelity },
    },
    subfields: sortedSubfields,
    topics,
    institutions,
    venues,
    papers,
  };
  return { atlas, details };
}

const cleanWork = (w: NormalizedWork): NormalizedWork => ({
  ...w,
  title: deDash(w.title),
  topic: { ...w.topic, name: deDash(w.topic.name), subfieldName: deDash(w.topic.subfieldName) },
  authors: w.authors.map(deDash),
  institutions: w.institutions.map(deDash),
  venue: w.venue ? deDash(w.venue) : null,
  abstract: w.abstract ? deDash(w.abstract) : null,
  keywords: w.keywords.map(deDash),
});

/** Runs the whole pipeline and writes atlas-<key>.json / details-<key>.json into .cache/. */
export async function buildAtlas(cfg: BuildConfig, emit: Emit): Promise<void> {
  const pool = await loadPool(cfg, emit);
  const { results, pages, failure } = await loadPages(cfg, emit);

  const byId = new Map<string, NormalizedWork>();
  let invalid = 0;
  for (const page of [...results.keys()].sort((a, b) => a - b)) {
    const entry = results.get(page)!;
    invalid += entry.invalid;
    for (const w of entry.works) byId.set(w.id, w);
  }
  const works = [...byId.values()];
  if (works.length < MIN_WORKS) {
    throw new Error(failure ?? `OpenAlex returned only ${works.length} usable works; need at least ${MIN_WORKS}.`);
  }
  const partial = results.size < pages ? { requested: pages * PER_PAGE, received: works.length, reason: failure ?? "some pages were not retrieved" } : null;

  // embeddings (cached per exact work set)
  const worksKey = hash({ ids: works.map((w) => w.id), model: EMBED_MODEL });
  const embFile = cachePath(`emb-${worksKey}.f32`);
  let vecs: Float32Array;
  try {
    const buf = await readFile(embFile);
    if (buf.byteLength !== works.length * EMBED_DIMS * 4) throw new Error("size mismatch");
    vecs = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    emit("embed", works.length, works.length, "embeddings loaded from cache");
  } catch {
    const texts = works.map((w) => embeddingText(w.title, w.abstract));
    emit("embed", 0, works.length, `loading ${EMBED_MODEL}`);
    vecs = await embed(texts, (n) => emit("embed", n, works.length, `${n}/${works.length} abstracts embedded`));
    await writeAtomic(embFile, new Uint8Array(vecs.buffer, vecs.byteOffset, vecs.byteLength));
  }

  emit("neighbors", 0, works.length, "nearest neighbours in embedding space");
  const nn = knn(vecs, works.length, EMBED_DIMS, NEIGHBORS_K, (row) => emit("neighbors", row, works.length, `${row}/${works.length}`));

  const layoutFile = cachePath(`layout-${worksKey}-${hash({ LAYOUT, seed: cfg.seed })}.f32`);
  let xy: Float32Array;
  try {
    const buf = await readFile(layoutFile);
    if (buf.byteLength !== works.length * 8) throw new Error("size mismatch");
    xy = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    emit("layout", 1, 1, "layout loaded from cache");
  } catch {
    emit("layout", 0, LAYOUT.epochs, "UMAP");
    xy = await layout(vecs, works.length, EMBED_DIMS, cfg.seed, (e, total) => emit("layout", e, total, `epoch ${e}/${total}`));
    await writeAtomic(layoutFile, new Uint8Array(xy.buffer, xy.byteOffset, xy.byteLength));
  }

  emit("layout", 0, 1, "fitting the dot matrix");
  const { xy: mapped, lattice } = warpToLattice(xy, works.length);
  const within = 30;
  const fidelity = {
    umap: round3(neighbourhoodPreservation(xy, works.length, nn.idx, nn.k, within)),
    silhouette: round3(neighbourhoodPreservation(mapped, works.length, nn.idx, nn.k, within)),
    within,
  };
  emit("layout", 1, 1, `dot matrix fitted (neighbour fidelity ${fidelity.umap} to ${fidelity.silhouette})`);

  emit("write", 0, 1, "writing atlas");
  const key = configKey(cfg);
  const { atlas, details } = assemble(works, mapped, nn, fidelity, lattice.cell, {
    configKey: key,
    source: {
      endpoint: `${OPENALEX_BASE}/works`,
      filter: FILTER,
      sampleSize: cfg.sampleSize,
      seed: cfg.seed,
      perPage: PER_PAGE,
      pagesFetched: results.size,
      pagesRequested: pages,
      yearRange: YEAR_RANGE,
    },
    poolCount: pool.count,
    poolByYear: pool.byYear,
    poolBySubfield: pool.bySubfield,
    partial,
    skipped: invalid,
  });
  await writeJson(cachePath(`details-${key}.json`), details);
  await writeJson(cachePath(`atlas-${key}.json`), atlas); // written last: its existence means the build completed
  emit("write", 1, 1, `${atlas.papers.length} works`);
}
