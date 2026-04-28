// symCompose contract: clip + transform + union over an AuthoringShape.
// The UI later layers a check(D) gate; these tests assert only what
// symCompose itself returns (shape or null).

import { test } from "node:test";
import assert from "node:assert/strict";

import { symCompose, type AffineMat } from "../symmetry.ts";
import { rodOf, rectShapeOf } from "../presets.ts";
import type { AuthoringShape, Outline } from "../shape.ts";

const I: AffineMat = [1, 0, 0, 1, 0, 0];
const MIRROR_Y: AffineMat = [-1, 0, 0, 1, 0, 0]; // (x,y) → (-x, y)

const BIG = 1e5;
// CCW rectangle covering the X≥0 half-plane within ±BIG.
const RIGHT_HALF: Outline = [
  { x: 0, y: -BIG }, { x: BIG, y: -BIG }, { x: BIG, y: BIG }, { x: 0, y: BIG },
];

test("symCompose fast path: null region + identity-only → reference-equal", () => {
  const rod = rodOf(5);
  const out = symCompose(rod, null, [I]);
  assert.equal(out, rod);
});

test("symCompose mirror of self-symmetric rod-at-origin → equivalent shape", () => {
  const rod = rodOf(5);
  const out = symCompose(rod, RIGHT_HALF, [I, MIRROR_Y]);
  assert.notEqual(out, null);
  if (!out) return;
  // Outer should be a single connected piece (rod was symmetric, mirror reproduces it).
  assert.equal(out.kind, "polygon");
  if (out.kind !== "polygon") return;
  assert.equal(out.outers.length, 1);
});

test("symCompose mirror of off-axis disk → two disjoint outers", () => {
  // Small disk at (5, 3), radius 1. Right half clip leaves it intact (it's
  // entirely in X≥0). Mirror copy is at (-5, 3). Result has two outers.
  const offAxisDisk: AuthoringShape = {
    kind: "disk", cx: 5, cy: 3, r: 1, holes: [],
  };
  const out = symCompose(offAxisDisk, RIGHT_HALF, [I, MIRROR_Y]);
  assert.notEqual(out, null);
  if (!out) return;
  assert.equal(out.kind, "polygon");
  if (out.kind !== "polygon") return;
  assert.equal(out.outers.length, 2);
});

test("symCompose mirror of rect crossing X=0 → single symmetric outer", () => {
  // 20×4 rect centered at origin spans X∈[-10,10]. Clip to X≥0 gives
  // 10×4 at X∈[0,10]. Mirror copy at X∈[-10,0]. Union touches at X=0 →
  // single connected piece.
  const rect = rectShapeOf(20, 4);
  const out = symCompose(rect, RIGHT_HALF, [I, MIRROR_Y]);
  assert.notEqual(out, null);
  if (!out) return;
  assert.equal(out.kind, "polygon");
  if (out.kind !== "polygon") return;
  assert.equal(out.outers.length, 1);
  // Result should be symmetric about X=0: every vertex's mirror is also a vertex.
  const verts = out.outers[0]!;
  const has = (x: number, y: number) =>
    verts.some(v => Math.abs(v.x - x) < 1e-9 && Math.abs(v.y - y) < 1e-9);
  for (const v of verts) {
    assert.ok(has(-v.x, v.y), `mirror of (${v.x}, ${v.y}) missing`);
  }
});

test("symCompose with shape entirely outside region → null", () => {
  const offAxisDisk: AuthoringShape = {
    kind: "disk", cx: -10, cy: 0, r: 2, holes: [],
  };
  const out = symCompose(offAxisDisk, RIGHT_HALF, [I]);
  assert.equal(out, null);
});

test("symCompose output coords land on the 0.1µm grid", () => {
  const offAxisDisk: AuthoringShape = {
    kind: "disk", cx: 5, cy: 3, r: 1, holes: [],
  };
  const out = symCompose(offAxisDisk, RIGHT_HALF, [I, MIRROR_Y]);
  assert.notEqual(out, null);
  if (!out || out.kind !== "polygon") return;
  const isGrid = (v: number) => Math.abs(Math.round(v * 10000) - v * 10000) < 1e-7;
  for (const o of out.outers) for (const p of o) {
    assert.ok(isGrid(p.x) && isGrid(p.y), `off-grid: ${p.x},${p.y}`);
  }
});
