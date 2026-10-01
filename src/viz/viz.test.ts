import assert from "node:assert/strict";
import { test } from "node:test";
import { fitView, toScreen, toWorld, zoomAt } from "./camera";
import { topicTrends } from "./filters";
import type { AtlasModel } from "./model";

test("zoomAt keeps the world point under the cursor fixed", () => {
  const v = fitView({ minX: -1, maxX: 1, minY: -1, maxY: 1 }, 800, 600);
  const [wx, wy] = toWorld(v, 800, 600, 640, 120);
  const z = zoomAt(v, 800, 600, 640, 120, 4, 1, 1e6);
  const [sx, sy] = toScreen(z, 800, 600, wx, wy);
  assert.ok(Math.abs(sx - 640) < 1e-6 && Math.abs(sy - 120) < 1e-6);
  assert.ok(Math.abs(z.k / v.k - 4) < 1e-9);
});

test("topicTrends uses shares, so uniform growth gives ratio ~1", () => {
  const years = [2015, 2015, 2015, 2015, 2024, 2024, 2024, 2024, 2024, 2024, 2024, 2024];
  const topic = [0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1];
  const m = { n: years.length, year: Uint16Array.from(years), topic: Uint16Array.from(topic), atlas: { topics: [{}, {}] } } as unknown as AtlasModel;
  const t = topicTrends(m, [2015, 2015], [2024, 2024], 1);
  assert.equal(t.length, 2);
  for (const row of t) assert.ok(Math.abs(row.ratio - 1) < 0.2, `ratio ${row.ratio}`);
});

test("computeSelection applies year, subfield, topic and query together", async () => {
  const { computeSelection } = await import("./filters");
  const m = {
    n: 4,
    year: Uint16Array.from([2015, 2018, 2018, 2022]),
    sub: Uint8Array.from([0, 0, 1, 1]),
    topic: Uint16Array.from([0, 1, 2, 2]),
    haystack: ["sleep a", "sleep b", "memory c", "sleep d"],
  } as unknown as AtlasModel;
  const base = { from: 2015, to: 2026, subfields: new Set<number>(), topic: null, query: "" };
  assert.equal(computeSelection(m, base).activeCount, 4);
  assert.equal(computeSelection(m, { ...base, from: 2016, to: 2018 }).activeCount, 2);
  assert.equal(computeSelection(m, { ...base, subfields: new Set([1]) }).activeCount, 2);
  assert.equal(computeSelection(m, { ...base, subfields: new Set([1]), topic: 2, from: 2020 }).activeCount, 1);
  const q = computeSelection(m, { ...base, query: "SLEEP" });
  assert.equal(q.matchCount, 3);
  assert.equal(q.activeCount, 4); // search highlights; it never removes papers
});
