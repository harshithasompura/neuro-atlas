import { pipeline } from "@huggingface/transformers";
import { EMBED_DIMS, EMBED_MODEL } from "./config";

const BATCH = 16;
const MAX_CHARS = 1100; // ~256 tokens, the model's effective window

export const embeddingText = (title: string, abstract: string | null) =>
  `${title}. ${abstract ?? ""}`.slice(0, MAX_CHARS);

/**
 * Sentence embeddings (L2-normalized, mean pooled) computed locally with an int8 ONNX build of MiniLM.
 * Texts are length-sorted before batching so padding stays small; output is in input order.
 */
export async function embed(texts: string[], onProgress: (done: number) => void): Promise<Float32Array> {
  const extractor = await pipeline("feature-extraction", EMBED_MODEL, { dtype: "q8", device: "cpu" });
  const order = texts.map((_, i) => i).sort((a, b) => texts[a]!.length - texts[b]!.length);
  const out = new Float32Array(texts.length * EMBED_DIMS);

  for (let start = 0; start < order.length; start += BATCH) {
    const ids = order.slice(start, start + BATCH);
    const tensor = await extractor(
      ids.map((i) => texts[i]!),
      { pooling: "mean", normalize: true },
    );
    const data = tensor.data as Float32Array;
    ids.forEach((textIndex, row) => out.set(data.subarray(row * EMBED_DIMS, (row + 1) * EMBED_DIMS), textIndex * EMBED_DIMS));
    onProgress(Math.min(start + BATCH, order.length));
  }
  return out;
}
