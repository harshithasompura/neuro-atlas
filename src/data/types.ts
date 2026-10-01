/**
 * Application data model. Everything downstream of normalization (pipeline, API, UI)
 * speaks these types, never raw OpenAlex JSON.
 *
 * Fields tagged SOURCE come straight from an OpenAlex work record.
 * Fields tagged DERIVED are computed by this project from source fields.
 */

export interface Subfield {
  /** SOURCE: OpenAlex subfield id, e.g. "2805" */
  id: string;
  name: string;
}

export interface Topic {
  /** SOURCE: OpenAlex topic id, e.g. "T10581" */
  id: string;
  name: string;
  /** index into Atlas.subfields */
  subfield: number;
}

export interface Paper {
  /** SOURCE: OpenAlex work id without URL prefix, e.g. "W2145339207" */
  id: string;
  title: string;
  year: number;
  /** SOURCE: publication_date, ISO yyyy-mm-dd */
  date: string;
  /** SOURCE: cited_by_count at time of retrieval */
  citations: number;
  /** SOURCE: primary_topic; index into Atlas.topics */
  topic: number;
  /** SOURCE: first authors in author order (max 4) */
  authors: string[];
  authorCount: number;
  /** SOURCE: most frequent institutions across authorships (max 3), indexes into Atlas.institutions */
  institutions: number[];
  /** SOURCE: primary_location.source; index into Atlas.venues or -1 */
  venue: number;
  doi: string | null;
  /** DERIVED: centre of this paper's cell in the dot matrix: UMAP of the title+abstract embedding, paired with a lattice cell inside the silhouette */
  x: number;
  y: number;
  /** DERIVED: nearest papers by cosine similarity in embedding space (indexes into Atlas.papers) */
  neighbors: number[];
  /** DERIVED: cosine similarity for each neighbor, same order */
  neighborSim: number[];
}

export interface AtlasMeta {
  builtAt: string;
  /** hash of the build configuration, used to decide whether a cached atlas is still valid */
  configKey: string;
  source: {
    endpoint: string;
    filter: string;
    sampleSize: number;
    seed: number;
    perPage: number;
    pagesFetched: number;
    pagesRequested: number;
    yearRange: [number, number];
  };
  /** SOURCE: meta.count of the unsampled filter: size of the pool the sample was drawn from */
  poolCount: number;
  /** SOURCE: group_by=publication_year over the whole pool */
  poolByYear: { year: number; count: number }[];
  /** SOURCE: group_by=primary_topic.subfield.id over the whole pool */
  poolBySubfield: { id: string; count: number }[];
  embedding: { model: string; dims: number; textFields: string };
  layout: {
    method: string;
    nNeighbors: number;
    minDist: number;
    epochs: number;
    seed: number;
    silhouette: string;
    /** side of one dot-matrix cell, in map units */
    cell: number;
    /** share of a paper's 8 embedding neighbours found among its 30 nearest map neighbours, before and after the silhouette warp */
    fidelity: { umap: number; silhouette: number; within: number };
  };
  /** Set when fewer works were retrieved than requested. */
  partial: { requested: number; received: number; reason: string } | null;
  /** works dropped because they lacked a title/topic or failed schema validation */
  skipped: number;
}

export interface Atlas {
  meta: AtlasMeta;
  subfields: Subfield[];
  topics: Topic[];
  institutions: string[];
  venues: string[];
  papers: Paper[];
}

/** Served lazily per paper; too large to ship with the atlas. */
export interface WorkDetail {
  /** SOURCE: reconstructed from abstract_inverted_index */
  abstract: string | null;
  keywords: string[];
  authors: string[];
  institutions: string[];
  landingPage: string | null;
}

export type Stage = "pool" | "fetch" | "embed" | "neighbors" | "layout" | "write";

export type PipelineEvent =
  | { type: "progress"; stage: Stage; done: number; total: number; message: string }
  | { type: "result"; atlas: Atlas }
  | { type: "error"; message: string };
