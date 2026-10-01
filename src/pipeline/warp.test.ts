import assert from "node:assert/strict";
import { test } from "node:test";
import { insideBrain } from "../data/brain";
import { transport, warpToLattice } from "./warp";

test("every paper gets its own lattice cell inside the silhouette, and neighbours stay close", () => {
  // 60x40 grid of source points, deliberately not shaped like a brain
  const w = 60, h = 40, n = w * h;
  const src = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) (src[i * 2] = i % w, src[i * 2 + 1] = Math.floor(i / w));
  const { xy: out, lattice } = warpToLattice(src, n);
  assert.equal(lattice.sites.length, n * 2);

  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    assert.ok(insideBrain(out[i * 2]!, out[i * 2 + 1]!), "every paper lands inside the silhouette");
    seen.add(`${out[i * 2]},${out[i * 2 + 1]}`);
  }
  assert.equal(seen.size, n, "no two papers share a site");
  // dots sit on a regular grid: x offsets from the origin are whole multiples of the cell
  for (let i = 0; i < n; i += 37) {
    const gx = (out[i * 2]! - lattice.originX) / lattice.cell;
    assert.ok(Math.abs(gx - Math.round(gx)) < 1e-2, "x is on the grid");
  }

  // grid neighbours should end up much closer than random pairs
  let near = 0, rand = 0, c = 0;
  for (let i = 0; i < n - 1; i++) {
    if ((i + 1) % w === 0) continue;
    near += Math.hypot(out[i * 2]! - out[i * 2 + 2]!, out[i * 2 + 1]! - out[i * 2 + 3]!);
    const j = (i * 7919) % n;
    rand += Math.hypot(out[i * 2]! - out[j * 2]!, out[i * 2 + 1]! - out[j * 2 + 1]!);
    c++;
  }
  assert.ok(near / c < (rand / c) * 0.2, `neighbour distance ${near / c} vs random ${rand / c}`);
});

test("transport pairs every source with a distinct target", () => {
  const n = 7;
  const src = Float32Array.from([0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0]);
  const tgt = Float32Array.from([6, 1, 5, 1, 4, 1, 3, 1, 2, 1, 1, 1, 0, 1]);
  const out = transport(src, tgt, n);
  assert.deepEqual(Array.from(out.filter((_, i) => i % 2 === 0)), [0, 1, 2, 3, 4, 5, 6]); // order preserved
});
