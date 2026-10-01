import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import type { PipelineEvent, WorkDetail } from "@/data/types";
import { cachePath, readJson } from "@/pipeline/cache";
import { configKey, readConfig } from "@/pipeline/config";

type Write = (line: string) => void;

interface Job {
  listeners: Set<Write>;
  last: string | null;
  done: Promise<void>;
}

/** One build at a time per server process; concurrent requests join the running job. */
const g = globalThis as { __atlasJob?: Job | null };

const line = (ev: PipelineEvent) => JSON.stringify(ev);

function startJob(): Job {
  const job: Job = { listeners: new Set(), last: null, done: Promise.resolve() };
  const broadcast = (l: string) => {
    job.last = l;
    job.listeners.forEach((w) => w(l));
  };

  job.done = new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/pipeline/cli.ts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buffer = "";
    let reported: string | null = null;
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!raw.startsWith("{")) continue;
        try {
          const ev = JSON.parse(raw) as PipelineEvent;
          if (ev.type === "error") reported = ev.message;
          else broadcast(raw);
        } catch {
          /* not an event */
        }
      }
    });
    child.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString("utf8")).slice(-2000)));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(reported ?? (stderr.trim().split("\n").pop() || `pipeline exited with code ${code}`)));
    });
  });
  const clear = () => {
    if (g.__atlasJob === job) g.__atlasJob = null;
  };
  job.done.then(clear, clear);
  return job;
}

const atlasFile = () => cachePath(`atlas-${configKey(readConfig())}.json`);

const exists = (file: string) => stat(file).then(() => true, () => false);

/**
 * Streams NDJSON lines: progress events while a build runs, then one `result` line with the atlas.
 * `refresh` forces a rebuild (resuming from cached OpenAlex pages, so only missing pages cost credits).
 */
export async function streamAtlas(refresh: boolean, write: Write): Promise<void> {
  if (refresh || !(await exists(atlasFile()))) {
    const job = (g.__atlasJob ??= startJob());
    if (job.last) write(job.last);
    job.listeners.add(write);
    try {
      await job.done;
    } finally {
      job.listeners.delete(write);
    }
  }
  const text = await readFile(atlasFile(), "utf8");
  write(`{"type":"result","atlas":${text}}`);
}

export const errorLine = (message: string) => line({ type: "error", message });

let detailCache: { file: string; mtime: number; data: Record<string, WorkDetail> } | null = null;

export async function loadDetail(id: string): Promise<WorkDetail | null> {
  const file = cachePath(`details-${configKey(readConfig())}.json`);
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  if (detailCache?.file !== file || detailCache.mtime !== info.mtimeMs) {
    const data = await readJson<Record<string, WorkDetail>>(file);
    if (!data) return null;
    detailCache = { file, mtime: info.mtimeMs, data };
  }
  return detailCache.data[id] ?? null;
}
