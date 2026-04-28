// symCompose contract: per-primitive orbit emission with canonical-region
// clamping, then normalize + check.

import { test } from "node:test";
import assert from "node:assert/strict";

import { symCompose } from "../symmetry.ts";
import { rodOf, rectShapeOf } from "../presets.ts";
import type { AuthoringShape } from "../shape.ts";

test("rod (disk-at-origin) → D1 → identity (reference-equal)", () => {
  const rod = rodOf(5);
  const r = symCompose(rod, "D1");
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape, rod); // fast-path returns input by reference
});

test("rod → D4 → identity (the regressing case)", () => {
  const rod = rodOf(5);
  const r = symCompose(rod, "D4");
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape, rod);
});

test("disk-at-origin with circle hole at origin → D4 → identity", () => {
  const shape: AuthoringShape = {
    kind: "disk", cx: 0, cy: 0, r: 5,
    holes: [{ kind: "circle", cx: 0, cy: 0, r: 1 }],
  };
  const r = symCompose(shape, "D4");
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape, shape);
});

test("disk-at-origin with circle hole at (3, 0) → D1 → 2 circle holes", () => {
  const shape: AuthoringShape = {
    kind: "disk", cx: 0, cy: 0, r: 5,
    holes: [{ kind: "circle", cx: 3, cy: 0, r: 1 }],
  };
  const r = symCompose(shape, "D1");
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape.kind, "disk");
  assert.equal(r.shape.holes.length, 2);
  for (const h of r.shape.holes) assert.equal(h.kind, "circle");
});

test("disk-at-origin with circle hole at (3, 3) → D4 → 4 circle holes (stabilizer)", () => {
  // (3,3) lies on the y=x mirror line of D4, so the orbit collapses from 8 to 4.
  const shape: AuthoringShape = {
    kind: "disk", cx: 0, cy: 0, r: 10,
    holes: [{ kind: "circle", cx: 3, cy: 3, r: 1 }],
  };
  const r = symCompose(shape, "D4");
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape.kind, "disk");
  assert.equal(r.shape.holes.length, 4);
});

test("circle hole outside canonical region → dropped", () => {
  // Hole at (-3, 0) — center in X<0 — gets filtered by center-membership.
  // The mirror copy of *no other hole* lands at (-3, 0), so the result has
  // no hole at all.
  const shape: AuthoringShape = {
    kind: "disk", cx: 0, cy: 0, r: 5,
    holes: [{ kind: "circle", cx: -3, cy: 0, r: 1 }],
  };
  const r = symCompose(shape, "D1");
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape.holes.length, 0);
});

test("two input holes whose orbits collide → dedup to 2", () => {
  // Hole A at (3, 0) and hole B at (-3, 0) both r=1. B drops (out of region);
  // A emits 2 holes (orbit). Net: 2 holes. Note this is NOT 4; the pre-filter
  // drops B, then A's orbit covers both sides without duplication.
  const shape: AuthoringShape = {
    kind: "disk", cx: 0, cy: 0, r: 6,
    holes: [
      { kind: "circle", cx: 3, cy: 0, r: 1 },
      { kind: "circle", cx: -3, cy: 0, r: 1 },
    ],
  };
  const r = symCompose(shape, "D1");
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape.holes.length, 2);
});

test("disk at (5, 0) → D1 → polygonized, disconnected → error", () => {
  // Off-center disk. Orbit gives two disjoint disks → check() flags
  // disconnects-shape.
  const shape: AuthoringShape = {
    kind: "disk", cx: 5, cy: 0, r: 1, holes: [],
  };
  const r = symCompose(shape, "D1");
  assert.equal(r.kind, "error");
  if (r.kind !== "error") return;
  assert.equal(r.tag, "disconnects-shape");
});

test("rect spanning X=0 → D1 → symmetric polygon", () => {
  const rect = rectShapeOf(20, 4); // centered at origin, X∈[-10,10]
  const r = symCompose(rect, "D1");
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape.kind, "polygon");
  if (r.shape.kind !== "polygon") return;
  assert.equal(r.shape.outers.length, 1);
  // Vertices should be mirror-symmetric about X=0.
  const verts = r.shape.outers[0]!;
  const has = (x: number, y: number) =>
    verts.some(v => Math.abs(v.x - x) < 1e-9 && Math.abs(v.y - y) < 1e-9);
  for (const v of verts) {
    assert.ok(has(-v.x, v.y), `mirror of (${v.x}, ${v.y}) missing`);
  }
});

test("polygon shape entirely in X<0 → D1 → empties-shape error", () => {
  const shape: AuthoringShape = {
    kind: "polygon",
    outers: [[
      { x: -10, y: -2 }, { x: -5, y: -2 }, { x: -5, y: 2 }, { x: -10, y: 2 },
    ]],
    holes: [],
  };
  const r = symCompose(shape, "D1");
  assert.equal(r.kind, "error");
  if (r.kind !== "error") return;
  assert.equal(r.tag, "empties-shape");
});

test("symCompose output coords land on the 0.1µm grid", () => {
  const rect = rectShapeOf(20, 7); // centered at origin
  const r = symCompose(rect, "D4");
  if (r.kind !== "ok" && r.kind !== "warning") throw new Error("setup");
  const isGrid = (v: number) => Math.abs(Math.round(v * 10000) - v * 10000) < 1e-7;
  if (r.shape.kind === "polygon") {
    for (const o of r.shape.outers) for (const p of o) {
      assert.ok(isGrid(p.x) && isGrid(p.y), `off-grid: ${p.x},${p.y}`);
    }
  }
});
