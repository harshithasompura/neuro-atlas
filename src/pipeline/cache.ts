import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const CACHE_DIR = path.resolve(process.cwd(), ".cache");

export const hash = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 12);

export const cachePath = (...parts: string[]) => path.join(CACHE_DIR, ...parts);

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Write via temp file + rename so a crashed build never leaves a half-written cache entry. */
export async function writeAtomic(file: string, data: string | Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export const writeJson = (file: string, value: unknown) => writeAtomic(file, JSON.stringify(value));

export const clearCache = () => rm(CACHE_DIR, { recursive: true, force: true });
