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

test("rod → add-hole entirely outside → warning, hole silently dropped", () => {
  const rod = rodOf(5);
  const op: Op = { kind: "add-hole", center: { x: 100, y: 100 }, cursor: { x: 101, y: 100 } };
  const r = apply(rod, op);
  assert.equal(r.kind, "warning");
  if (r.kind !== "warning") return;
  assert.equal(r.tag, "hole-outside-shape");
  assert.equal(r.shape, rod);
});

test("rod-with-clean-hole → move-hole-center far outside → warning, base unchanged", () => {
  const rod = rodOf(5);
  const seeded = apply(rod, {
    kind: "add-hole", center: { x: 0, y: 0 }, cursor: { x: 1, y: 0 },
  });
  if (seeded.kind !== "ok") throw new Error("setup failed");
  const op: Op = { kind: "move-hole-center", index: 0, target: { x: 100, y: 100 } };
  const r = apply(seeded.shape, op);
  assert.equal(r.kind, "warning");
  if (r.kind !== "warning") return;
  assert.equal(r.tag, "hole-outside-shape");
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

test("move-vert onto an adjacent neighbor → ok, vertex collapses (rect → triangle)", () => {
  const rect = rectShapeOf(10, 10); // 4 corners
  // Drag corner 0 onto corner 1.
  const ol = (rect as { kind: "polygon"; outers: { x: number; y: number }[][] }).outers[0]!;
  const target = ol[1]!;
  const op: Op = { kind: "move-vert", sel: { kind: "outer", index: 0 }, index: 0, target };
  const r = apply(rect, op);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  if (r.shape.kind !== "polygon") throw new Error("expected polygon");
  assert.equal(r.shape.outers[0]!.length, 3);
});

test("move-vert onto an adjacent neighbor on a triangle → error (would leave 2 vertices)", () => {
  const tri: AuthoringShape = {
    kind: "polygon",
    outers: [[
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 },
    ]],
    holes: [],
  };
  const op: Op = {
    kind: "move-vert", sel: { kind: "outer", index: 0 }, index: 0,
    target: { x: 10, y: 0 },
  };
  const r = apply(tri, op);
  assert.equal(r.kind, "error");
  if (r.kind !== "error") return;
  assert.equal(r.tag, "breaks-polygon");
});

test("move-vert into a self-intersection → error self-intersecting", () => {
  // Square (0,0)-(10,0)-(10,10)-(0,10). Drag corner (0,0) over to the
  // far-right side — the new edge from (0,10) to (15,5) crosses the
  // right edge from (10,0) to (10,10), producing a bowtie.
  const sq: AuthoringShape = {
    kind: "polygon",
    outers: [[
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ]],
    holes: [],
  };
  const op: Op = {
    kind: "move-vert", sel: { kind: "outer", index: 0 }, index: 0,
    target: { x: 15, y: 5 },
  };
  const r = apply(sq, op);
  assert.equal(r.kind, "error");
  if (r.kind !== "error") return;
  assert.equal(r.tag, "self-intersecting");
});

test("move-vert on a polygon hole that crosses the outer → error hole-overlap", () => {
  // 20x20 square outer, a 4x4 polygon hole near the center. Drag one hole
  // vertex outside the outer.
  const shape: AuthoringShape = {
    kind: "polygon",
    outers: [[
      { x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 },
    ]],
    holes: [{
      kind: "polygon",
      outline: [
        { x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 },
      ],
    }],
  };
  const op: Op = {
    kind: "move-vert", sel: { kind: "hole", index: 0 }, index: 0,
    target: { x: -20, y: -20 }, // pulls the corner well outside the outer
  };
  const r = apply(shape, op);
  assert.equal(r.kind, "error");
  if (r.kind !== "error") return;
  assert.equal(r.tag, "hole-overlap");
});

test("move-vert on a polygon hole into another hole → error hole-overlap", () => {
  // Two adjacent square holes. Drag a vertex of hole 0 deep into hole 1.
  const shape: AuthoringShape = {
    kind: "polygon",
    outers: [[
      { x: -20, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 10 }, { x: -20, y: 10 },
    ]],
    holes: [
      { kind: "polygon", outline: [
        { x: -8, y: -2 }, { x: -2, y: -2 }, { x: -2, y: 2 }, { x: -8, y: 2 },
      ]},
      { kind: "polygon", outline: [
        { x: 2, y: -2 }, { x: 8, y: -2 }, { x: 8, y: 2 }, { x: 2, y: 2 },
      ]},
    ],
  };
  // Drag hole 0's right-bottom corner (-2,-2) into hole 1 at (5,0).
  const op: Op = {
    kind: "move-vert", sel: { kind: "hole", index: 0 }, index: 1,
    target: { x: 5, y: 0 },
  };
  const r = apply(shape, op);
  assert.equal(r.kind, "error");
  if (r.kind !== "error") return;
  assert.equal(r.tag, "hole-overlap");
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
  apply(rod, { kind: "move-disk-radius", r: 7 });
  assert.equal(JSON.stringify(rod), before);
});

// 0-op contract: degenerate gestures are silently ok, returning the base
// unchanged by reference. Keeps editor.ts free of "is this drag big enough?"
// guards.

test("paint-rect with anchor==cursor → ok, base unchanged", () => {
  const rod = rodOf(5);
  const r = apply(rod, { kind: "paint-rect", anchor: { x: 0, y: 0 }, cursor: { x: 0, y: 0 } });
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape, rod);
});

test("erase-rect with zero-width drag → ok, base unchanged", () => {
  const rect = rectShapeOf(10, 20);
  const r = apply(rect, { kind: "erase-rect", anchor: { x: 1, y: 0 }, cursor: { x: 1, y: 5 } });
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape, rect);
});

test("add-hole with cursor==center → ok, base unchanged", () => {
  const rod = rodOf(5);
  const r = apply(rod, { kind: "add-hole", center: { x: 0, y: 0 }, cursor: { x: 0, y: 0 } });
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape, rod);
});

test("move-disk-radius r=0 → ok, base unchanged (silent revert)", () => {
  const rod = rodOf(5);
  const r = apply(rod, { kind: "move-disk-radius", r: 0 });
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.shape, rod);
});

test("move-disk-radius r<0 → invalid (only a buggy op-builder produces this)", () => {
  const rod = rodOf(5);
  const r = apply(rod, { kind: "move-disk-radius", r: -1 });
  assert.equal(r.kind, "invalid");
});
