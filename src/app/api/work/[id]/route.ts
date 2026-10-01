import { loadDetail } from "@/server/atlas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^W\d+$/.test(id)) return Response.json({ error: "invalid work id" }, { status: 400 });
  const detail = await loadDetail(id);
  if (!detail) return Response.json({ error: "work not in the loaded atlas" }, { status: 404 });
  return Response.json(detail, { headers: { "cache-control": "private, max-age=3600" } });
}
