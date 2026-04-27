// apply() trichotomy battery. Table-driven where the assertion is just
// `result.kind`; pulled out into per-test cases when there's downstream
// shape-structure to inspect.
//
// Disk-outer + rect-tool interactions live in apply-disk-rect.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";

import { apply, type AuthoringShape, type Op } from "../index.ts";
import { rodOf, rectShapeOf } from "../presets.ts";

test("rod → add-hole entirely inside → ok, kind stays disk", () => {
  const rod = rodOf(5); // r=2.5
  const op: Op = { kind: "add-hole", center: { x: 0, y: 0 }, cursor: { x: 1, y: 0 } };
  const r = apply(rod, op);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape.kind, "disk");
  assert.equal(r.shape.holes.length, 1);
  assert.equal(r.shape.holes[0]?.kind, "circle");
});

test("rod → add-hole crossing the outer → warning, polygon with notched outer, no hole prim", () => {
  const rod = rodOf(5); // r=2.5
  // Hole center at (2, 0), radius 1 → reaches x=3, outer at x=2.5 → crosses.
  const op: Op = { kind: "add-hole", center: { x: 2, y: 0 }, cursor: { x: 3, y: 0 } };
  const r = apply(rod, op);
  assert.equal(r.kind, "warning");
  if (r.kind !== "warning") return;
  assert.equal(r.shape.kind, "polygon");
  assert.equal(r.shape.holes.length, 0); // bite went through the boundary
});

test("rod → add-hole entirely outside → error", () => {
  const rod = rodOf(5);
  const op: Op = { kind: "add-hole", center: { x: 100, y: 100 }, cursor: { x: 101, y: 100 } };
  const r = apply(rod, op);
  assert.equal(r.kind, "error");
});

test("rod-with-clean-hole → move-hole-center far outside → error, no shape returned", () => {
  const rod = rodOf(5);
  const seeded = apply(rod, {
    kind: "add-hole", center: { x: 0, y: 0 }, cursor: { x: 1, y: 0 },
  });
  if (seeded.kind !== "ok") throw new Error("setup failed");
  const op: Op = { kind: "move-hole-center", index: 0, target: { x: 100, y: 100 } };
  const r = apply(seeded.shape, op);
  assert.equal(r.kind, "error");
});

test("rod-with-clean-hole → move-hole-center across boundary → warning + polygon", () => {
  const rod = rodOf(5);
  const seeded = apply(rod, {
    kind: "add-hole", center: { x: 0, y: 0 }, cursor: { x: 1, y: 0 },
  });
  if (seeded.kind !== "ok") throw new Error("setup failed");
  // Hole had r=1 at origin; move center to (2, 0) → reaches x=3, crosses outer.
  const r = apply(seeded.shape, { kind: "move-hole-center", index: 0, target: { x: 2, y: 0 } });
  assert.equal(r.kind, "warning");
  if (r.kind !== "warning") return;
  assert.equal(r.shape.kind, "polygon");
});

test("move-vert with out-of-range index → invalid (UI bug, not user error)", () => {
  const rect = rectShapeOf(10, 20);
  const op: Op = { kind: "move-vert", sel: { kind: "outer", index: 0 }, index: 99, target: { x: 0, y: 0 } };
  const r = apply(rect, op);
  assert.equal(r.kind, "invalid");
});

test("move-disk-center on a polygon → invalid (kind mismatch is a UI bug)", () => {
  const rect = rectShapeOf(10, 20);
  const op: Op = { kind: "move-disk-center", target: { x: 5, y: 5 } };
  const r = apply(rect, op);
  assert.equal(r.kind, "invalid");
});

test("delete-vert that would leave 2 vertices → error (recoverable, user can undo gesture)", () => {
  // Triangle: 3 vertices. Deleting one would leave 2 → not enough for a polygon.
  const tri: AuthoringShape = {
    kind: "polygon",
    outers: [[
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 },
    ]],
    holes: [],
  };
  const op: Op = { kind: "delete-vert", sel: { kind: "outer", index: 0 }, index: 0 };
  const r = apply(tri, op);
  assert.equal(r.kind, "error");
});

test("apply does not mutate the input shape", () => {
  const rod = rodOf(5);
  const before = JSON.stringify(rod);
  apply(rod, { kind: "move-disk-center", target: { x: 100, y: 100 } });
  apply(rod, { kind: "add-hole", center: { x: 0, y: 0 }, cursor: { x: 1, y: 0 } });
  apply(rod, { kind: "translate-prim", sel: { kind: "disk" }, delta: { x: 5, y: 5 } });
  assert.equal(JSON.stringify(rod), before);
});
