import { OpenAlexError } from "../data/openalex";
import type { PipelineEvent } from "../data/types";
import { buildAtlas } from "./build";
import { clearCache } from "./cache";
import { readConfig } from "./config";

/**
 * `pnpm pipeline [--clean]` builds .cache/atlas.json from live OpenAlex data.
 * When stdout is not a terminal (the API route spawns it that way) it emits one JSON event per line.
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local: fine */
}

const machine = !process.stdout.isTTY;
const send = (ev: PipelineEvent) => process.stdout.write(`${JSON.stringify(ev)}\n`);
let lastLog = 0;

async function main() {
  if (process.argv.includes("--clean")) await clearCache();
  const cfg = readConfig();
  await buildAtlas(cfg, (stage, done, total, message) => {
    if (machine) return send({ type: "progress", stage, done, total, message });
    const now = Date.now();
    if (now - lastLog < 500 && done < total) return;
    lastLog = now;
    console.log(`[${stage}] ${message}`);
  });
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    const message = e instanceof OpenAlexError || e instanceof Error ? e.message : String(e);
    if (machine) send({ type: "error", message });
    else console.error(message);
    process.exit(1);
  },
);
