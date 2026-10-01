import { errorLine, streamAtlas } from "@/server/atlas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (l: string) => {
        try {
          controller.enqueue(encoder.encode(`${l}\n`));
        } catch {
          /* client went away; the build keeps running and is cached */
        }
      };
      try {
        await streamAtlas(refresh, write);
      } catch (e) {
        write(errorLine(e instanceof Error ? e.message : String(e)));
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
